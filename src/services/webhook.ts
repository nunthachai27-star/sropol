// Webhook service — processes inbound patient data from non-HOSxP hospitals
import { v4 as uuidv4 } from 'uuid';
import { createHash, randomBytes } from 'crypto';
import type { DatabaseAdapter } from '@/db/adapter';
import { encrypt, getEncryptionKey } from '@/lib/encryption';
import { upsertCachedPatients, detectChanges, detectTransfers, markPatientsDelivered, calculateAndStoreCpdScores } from '@/services/sync';
import type { SyncPatientData } from '@/services/sync';
import { SseManager } from '@/lib/sse';
import { getJourneyByHn, createJourney } from '@/services/journey';
import { AncRiskLevel } from '@/types/domain';

// ─── Webhook payload types ───

export interface WebhookPatientPayload {
  hn: string;
  an: string;
  name: string;
  cid?: string | null;
  age: number;
  gravida?: number | null;
  ga_weeks?: number | null;
  anc_count?: number | null;
  admit_date: string; // ISO 8601
  height_cm?: number | null;
  weight_kg?: number | null;
  weight_diff_kg?: number | null;
  fundal_height_cm?: number | null;
  us_weight_g?: number | null;
  hematocrit_pct?: number | null;
  labor_status?: string; // ACTIVE (default), DELIVERED
  action?: 'upsert' | 'delete'; // default: 'upsert'
}

export type WebhookMode = 'incremental' | 'full_snapshot';

export interface WebhookPayload {
  patients: WebhookPatientPayload[];
  mode?: WebhookMode; // default: 'incremental'
}

export interface WebhookResult {
  patientsProcessed: number;
  newAdmissions: number;
  discharges: number;
  transfers: number;
  deleted: number;
}

// ─── ANC webhook payload ───

export interface WebhookAncVisit {
  date: string;
  visitNumber: number;
  gaWeeks?: number;
  fundalHeightCm?: number;
  weightKg?: number;
  bpSystolic?: number;
  bpDiastolic?: number;
  fetalHr?: number;
}

export interface WebhookAncPatient {
  hn: string;
  name: string;
  cid?: string;
  birthday: string;
  pregNo: number;
  lmp?: string;
  edc?: string;
  riskLevel?: string;
  visits?: WebhookAncVisit[];
  action?: 'upsert' | 'delete'; // default: 'upsert'
}

export interface WebhookAncPayload {
  type: 'anc_data';
  hospitalCode: string;
  patients: WebhookAncPatient[];
}

export interface WebhookAncResult {
  patientsProcessed: number;
  created: number;
  updated: number;
  deleted: number;
}

// ─── Referral webhook payload ───

export interface WebhookReferralPayload {
  type: 'referral_update';
  hospitalCode: string;
  referralId: string;
  status: string;
  reason?: string;
  transportMode?: string;
  arrivedAt?: string;
  action?: 'update' | 'delete'; // default: 'update'
}

export interface WebhookReferralResult {
  referralId: string;
  status: string;
}

// ─── API Key management ───

export function generateApiKey(): string {
  // Format: kklrms_<40 hex chars> (total 47 chars)
  return `kklrms_${randomBytes(20).toString('hex')}`;
}

export function hashApiKey(rawKey: string): string {
  return createHash('sha256').update(rawKey).digest('hex');
}

export async function validateApiKey(
  db: DatabaseAdapter,
  rawKey: string,
): Promise<{ hospitalId: string; keyId: string } | null> {
  const keyHash = hashApiKey(rawKey);

  const rows = await db.query<{
    id: string;
    hospital_id: string;
  }>(
    "SELECT id, hospital_id FROM webhook_api_keys WHERE key_hash = ? AND is_active = true AND revoked_at IS NULL",
    [keyHash],
  );

  if (rows.length === 0) return null;

  // Update last_used_at
  await db.execute(
    'UPDATE webhook_api_keys SET last_used_at = ? WHERE id = ?',
    [new Date().toISOString(), rows[0].id],
  );

  return { hospitalId: rows[0].hospital_id, keyId: rows[0].id };
}

export async function createApiKey(
  db: DatabaseAdapter,
  hospitalId: string,
  label: string,
): Promise<{ id: string; rawKey: string; keyPrefix: string }> {
  const rawKey = generateApiKey();
  const keyHash = hashApiKey(rawKey);
  const keyPrefix = rawKey.slice(0, 8);
  const id = uuidv4();
  const now = new Date().toISOString();

  await db.execute(
    `INSERT INTO webhook_api_keys (id, hospital_id, key_hash, key_prefix, label, is_active, created_at)
     VALUES (?, ?, ?, ?, ?, true, ?)`,
    [id, hospitalId, keyHash, keyPrefix, label, now],
  );

  return { id, rawKey, keyPrefix };
}

export async function revokeApiKey(
  db: DatabaseAdapter,
  keyId: string,
): Promise<boolean> {
  const now = new Date().toISOString();
  await db.execute(
    'UPDATE webhook_api_keys SET is_active = false, revoked_at = ? WHERE id = ?',
    [now, keyId],
  );
  return true;
}

export async function listApiKeys(
  db: DatabaseAdapter,
  hospitalId?: string,
): Promise<Array<{
  id: string;
  hospitalId: string;
  hcode: string;
  hospitalName: string;
  keyPrefix: string;
  label: string;
  isActive: boolean;
  lastUsedAt: string | null;
  createdAt: string;
  revokedAt: string | null;
}>> {
  const whereClause = hospitalId
    ? 'WHERE wak.hospital_id = ?'
    : '';
  const params = hospitalId ? [hospitalId] : [];

  const rows = await db.query<{
    id: string; hospital_id: string; hcode: string; hospital_name: string;
    key_prefix: string; label: string; is_active: number; last_used_at: string | null;
    created_at: string; revoked_at: string | null;
  }>(
    `SELECT wak.id, wak.hospital_id, h.hcode, h.name as hospital_name,
            wak.key_prefix, wak.label, wak.is_active, wak.last_used_at,
            wak.created_at, wak.revoked_at
     FROM webhook_api_keys wak
     JOIN hospitals h ON h.id = wak.hospital_id
     ${whereClause}
     ORDER BY wak.created_at DESC`,
    params,
  );

  return rows.map((r) => ({
    id: r.id,
    hospitalId: r.hospital_id,
    hcode: r.hcode,
    hospitalName: r.hospital_name,
    keyPrefix: r.key_prefix,
    label: r.label,
    isActive: !!r.is_active,
    lastUsedAt: r.last_used_at,
    createdAt: r.created_at,
    revokedAt: r.revoked_at,
  }));
}

// ─── Webhook payload validation ───

export function validatePayload(body: unknown): {
  valid: boolean;
  error?: string;
  payload?: WebhookPayload;
} {
  if (!body || typeof body !== 'object') {
    return { valid: false, error: 'Request body must be a JSON object' };
  }

  const obj = body as Record<string, unknown>;

  if (!Array.isArray(obj.patients)) {
    return { valid: false, error: '"patients" must be an array' };
  }

  if (obj.patients.length === 0) {
    return { valid: false, error: '"patients" array must not be empty' };
  }

  if (obj.patients.length > 100) {
    return { valid: false, error: '"patients" array must not exceed 100 items per request' };
  }

  const errors: string[] = [];

  for (let i = 0; i < obj.patients.length; i++) {
    const p = obj.patients[i] as Record<string, unknown>;
    if (!p.hn || typeof p.hn !== 'string') errors.push(`patients[${i}].hn is required (string)`);
    if (!p.an || typeof p.an !== 'string') errors.push(`patients[${i}].an is required (string)`);
    if (!p.name || typeof p.name !== 'string') errors.push(`patients[${i}].name is required (string)`);
    if (p.age == null || typeof p.age !== 'number') errors.push(`patients[${i}].age is required (number)`);
    if (!p.admit_date || typeof p.admit_date !== 'string') errors.push(`patients[${i}].admit_date is required (ISO 8601 string)`);
  }

  if (errors.length > 0) {
    return { valid: false, error: `Validation errors: ${errors.join('; ')}` };
  }

  // Validate mode field if provided
  if (obj.mode !== undefined && obj.mode !== 'incremental' && obj.mode !== 'full_snapshot') {
    return { valid: false, error: '"mode" must be "incremental" or "full_snapshot"' };
  }

  return { valid: true, payload: obj as unknown as WebhookPayload };
}

// ─── Main webhook processing ───

export async function processWebhookPayload(
  db: DatabaseAdapter,
  hospitalId: string,
  payload: WebhookPayload,
  sseManager: SseManager,
): Promise<WebhookResult> {
  const encryptionKey = getEncryptionKey();

  // Get hospital hcode for SSE events
  const hospitalRows = await db.query<{ hcode: string }>(
    'SELECT hcode FROM hospitals WHERE id = ?',
    [hospitalId],
  );
  const hcode = hospitalRows[0]?.hcode ?? '';

  // Get existing patient ANs for change detection
  const existing = await db.query<{ an: string }>(
    "SELECT an FROM cached_patients WHERE hospital_id = ? AND labor_status = 'ACTIVE'",
    [hospitalId],
  );
  const existingAns = existing.map((r) => r.an);

  // Handle deletes first — remove patients marked for deletion
  const toDelete = payload.patients.filter((p) => p.action === 'delete');
  let deletedCount = 0;
  for (const p of toDelete) {
    await db.execute(
      `DELETE FROM cpd_scores WHERE patient_id IN (SELECT id FROM cached_patients WHERE hospital_id = ? AND an = ?)`,
      [hospitalId, p.an],
    );
    await db.execute(
      `DELETE FROM cached_vital_signs WHERE patient_id IN (SELECT id FROM cached_patients WHERE hospital_id = ? AND an = ?)`,
      [hospitalId, p.an],
    );
    await db.execute(
      `DELETE FROM cached_patients WHERE hospital_id = ? AND an = ?`,
      [hospitalId, p.an],
    );
    deletedCount++;
  }

  // Transform remaining patients (upsert) to SyncPatientData
  const toUpsert = payload.patients.filter((p) => p.action !== 'delete');
  const patients: SyncPatientData[] = toUpsert.map((p) => {
    const encryptedName = encrypt(p.name, encryptionKey);
    const encryptedCid = p.cid ? encrypt(p.cid, encryptionKey) : null;
    const cidHash = p.cid
      ? createHash('sha256').update(p.cid).digest('hex')
      : null;

    return {
      hn: p.hn,
      an: p.an,
      name: encryptedName,
      cid: encryptedCid,
      cidHash,
      age: p.age,
      gravida: p.gravida ?? null,
      gaWeeks: p.ga_weeks ?? null,
      ancCount: p.anc_count ?? null,
      admitDate: p.admit_date,
      heightCm: p.height_cm ?? null,
      weightKg: p.weight_kg ?? null,
      weightDiffKg: p.weight_diff_kg ?? null,
      fundalHeightCm: p.fundal_height_cm ?? null,
      usWeightG: p.us_weight_g ?? null,
      hematocritPct: p.hematocrit_pct ?? null,
      laborStatus: p.labor_status ?? 'ACTIVE',
      syncedAt: new Date().toISOString(),
    };
  });

  // Upsert patients (reuse existing sync pipeline)
  await upsertCachedPatients(db, hospitalId, patients);

  // Detect transfers
  const transfers = await detectTransfers(db, hospitalId, patients);
  for (const transfer of transfers) {
    await db.execute(
      `UPDATE cached_patients SET labor_status = 'TRANSFERRED', updated_at = ?
       WHERE hospital_id = ? AND an = ?`,
      [new Date().toISOString(), transfer.fromHospitalId, transfer.fromAn],
    );

    const fromRows = await db.query<{ hcode: string }>(
      'SELECT hcode FROM hospitals WHERE id = ?',
      [transfer.fromHospitalId],
    );
    sseManager.broadcast('patient-update', {
      type: 'patient_transfer',
      fromHcode: fromRows[0]?.hcode ?? '',
      toHcode: hcode,
      an: transfer.toAn,
    });
  }

  // Calculate CPD scores (shared with polling pipeline — Constitution IV)
  await calculateAndStoreCpdScores(db, hospitalId, sseManager);

  // Detect changes and broadcast SSE
  const changes = detectChanges(patients, existingAns);
  for (const an of changes.newAdmissions) {
    sseManager.broadcast('patient-update', {
      type: 'new_admission',
      hcode,
      an,
    });
  }

  // full_snapshot mode: patients NOT in the payload are discharged
  const mode = payload.mode ?? 'incremental';
  let dischargeCount = 0;
  if (mode === 'full_snapshot' && changes.discharges.length > 0) {
    await markPatientsDelivered(db, hospitalId, changes.discharges);
    dischargeCount = changes.discharges.length;
    for (const an of changes.discharges) {
      sseManager.broadcast('patient-update', {
        type: 'patient_discharged',
        hcode,
        an,
      });
    }
  }

  // Broadcast sync-complete
  sseManager.broadcast('sync-complete', {
    hcode,
    patientsUpdated: patients.length,
    source: 'webhook',
    timestamp: new Date().toISOString(),
  });

  // Update hospital status
  await db.execute(
    "UPDATE hospitals SET connection_status = 'ONLINE', last_sync_at = ? WHERE id = ?",
    [new Date().toISOString(), hospitalId],
  );

  return {
    patientsProcessed: patients.length,
    newAdmissions: changes.newAdmissions.length,
    discharges: dischargeCount,
    transfers: transfers.length,
    deleted: deletedCount,
  };
}

// ─── ANC webhook processing ───

export async function processAncWebhook(
  db: DatabaseAdapter,
  hospitalId: string,
  payload: WebhookAncPayload,
  sseManager: SseManager,
): Promise<WebhookAncResult> {
  const encryptionKey = getEncryptionKey();

  const hospitalRows = await db.query<{ hcode: string }>(
    'SELECT hcode FROM hospitals WHERE id = ?',
    [hospitalId],
  );
  const hcode = hospitalRows[0]?.hcode ?? '';

  let created = 0;
  let updated = 0;
  let deleted = 0;

  for (const patient of payload.patients) {
    // Handle delete action — soft delete by setting care_stage to CANCELLED
    if (patient.action === 'delete') {
      const existing = await getJourneyByHn(db, patient.hn, hospitalId);
      if (existing) {
        // Delete related records first
        await db.execute(`DELETE FROM cached_anc_visits WHERE journey_id = ?`, [existing.id]);
        await db.execute(`DELETE FROM cached_anc_risks WHERE journey_id = ?`, [existing.id]);
        await db.execute(`DELETE FROM cached_newborns WHERE journey_id = ?`, [existing.id]);
        await db.execute(`DELETE FROM cached_referrals WHERE journey_id = ?`, [existing.id]);
        await db.execute(`UPDATE cached_patients SET journey_id = NULL WHERE journey_id = ?`, [existing.id]);
        await db.execute(`DELETE FROM maternal_journeys WHERE id = ?`, [existing.id]);
        deleted++;

        sseManager.broadcast('patient-update', {
          type: 'journey_update',
          hcode,
          journeyId: existing.id,
          careStage: 'DELETED',
        });
      }
      continue;
    }

    const encryptedName = encrypt(patient.name, encryptionKey);
    const encryptedCid = patient.cid ? encrypt(patient.cid, encryptionKey) : null;
    const cidHash = patient.cid
      ? createHash('sha256').update(patient.cid).digest('hex')
      : null;

    const existing = await getJourneyByHn(db, patient.hn, hospitalId);

    if (existing) {
      // Update journey with latest data
      const now = new Date().toISOString();
      await db.execute(
        `UPDATE maternal_journeys SET name = ?, cid = ?, cid_hash = ?, lmp = ?, edc = ?, anc_risk_level = ?, synced_at = ?, updated_at = ? WHERE id = ?`,
        [encryptedName, encryptedCid, cidHash, patient.lmp ?? existing.lmp, patient.edc ?? existing.edc, patient.riskLevel ?? existing.ancRiskLevel, now, now, existing.id],
      );

      sseManager.broadcast('patient-update', {
        type: 'journey_update',
        hcode,
        journeyId: existing.id,
        careStage: existing.careStage,
        ancRiskLevel: patient.riskLevel ?? existing.ancRiskLevel ?? undefined,
      });
      updated++;
    } else {
      const age = patient.birthday ? Math.floor((Date.now() - new Date(patient.birthday).getTime()) / (365.25 * 24 * 60 * 60 * 1000)) : 0;
      const journey = await createJourney(db, {
        hospitalId,
        hn: patient.hn,
        personAncId: null,
        name: encryptedName,
        cid: encryptedCid,
        cidHash,
        age,
        gravida: patient.pregNo,
        para: 0,
        lmp: patient.lmp ?? null,
        edc: patient.edc ?? null,
        ancRiskLevel: (patient.riskLevel as AncRiskLevel) ?? AncRiskLevel.LOW,
      });

      sseManager.broadcast('patient-update', {
        type: 'journey_update',
        hcode,
        journeyId: journey.id,
        careStage: 'PREGNANCY',
        ancRiskLevel: patient.riskLevel ?? undefined,
      });
      created++;
    }
  }

  await db.execute(
    "UPDATE hospitals SET connection_status = 'ONLINE', last_sync_at = ? WHERE id = ?",
    [new Date().toISOString(), hospitalId],
  );

  return {
    patientsProcessed: payload.patients.length,
    created,
    updated,
    deleted,
  };
}

// ─── Referral webhook processing ───

export async function processReferralWebhook(
  db: DatabaseAdapter,
  hospitalId: string,
  payload: WebhookReferralPayload,
  sseManager: SseManager,
): Promise<WebhookReferralResult> {
  const hospitalRows = await db.query<{ hcode: string }>(
    'SELECT hcode FROM hospitals WHERE id = ?',
    [hospitalId],
  );
  const hcode = hospitalRows[0]?.hcode ?? '';

  // Handle delete action — remove referral record (human error correction)
  if (payload.action === 'delete') {
    await db.execute(
      `DELETE FROM cached_referrals WHERE refer_number = ?`,
      [payload.referralId],
    );

    sseManager.broadcast('patient-update', {
      type: 'referral_update',
      fromHcode: hcode,
      toHcode: '',
      referralId: payload.referralId,
      status: 'DELETED',
    });

    return {
      referralId: payload.referralId,
      status: 'DELETED',
    };
  }

  // Look up the referral by external ID
  const existing = await db.query<{ id: string; to_hospital_id: string }>(
    `SELECT id, to_hospital_id FROM cached_referrals WHERE refer_number = ?`,
    [payload.referralId],
  );

  if (existing.length > 0) {
    // Update existing referral status
    const now = new Date().toISOString();
    if (payload.status === 'ACCEPTED') {
      await db.execute(
        `UPDATE cached_referrals SET status = 'ACCEPTED', accepted_at = ?, updated_at = ? WHERE refer_number = ?`,
        [now, now, payload.referralId],
      );
    } else if (payload.status === 'IN_TRANSIT') {
      await db.execute(
        `UPDATE cached_referrals SET status = 'IN_TRANSIT', departed_at = ?, transport_mode = ?, updated_at = ? WHERE refer_number = ?`,
        [now, payload.transportMode ?? null, now, payload.referralId],
      );
    } else if (payload.status === 'ARRIVED') {
      await db.execute(
        `UPDATE cached_referrals SET status = 'ARRIVED', arrived_at = ?, updated_at = ? WHERE refer_number = ?`,
        [payload.arrivedAt ?? now, now, payload.referralId],
      );
    }

    const toHcodeRows = await db.query<{ hcode: string }>(
      'SELECT hcode FROM hospitals WHERE id = ?',
      [existing[0].to_hospital_id],
    );

    sseManager.broadcast('patient-update', {
      type: 'referral_update',
      fromHcode: hcode,
      toHcode: toHcodeRows[0]?.hcode ?? '',
      referralId: payload.referralId,
      status: payload.status,
    });
  }

  return {
    referralId: payload.referralId,
    status: payload.status,
  };
}

