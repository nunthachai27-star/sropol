// Webhook service — processes inbound patient data from non-HOSxP hospitals
import { v4 as uuidv4 } from 'uuid';
import { createHash, randomBytes } from 'crypto';
import type { DatabaseAdapter } from '@/db/adapter';
import { encrypt, getEncryptionKey } from '@/lib/encryption';
import { upsertCachedPatients, detectChanges, detectTransfers, markPatientsDelivered, calculateAndStoreCpdScores } from '@/services/sync';
import type { SyncPatientData } from '@/services/sync';
import { SseManager } from '@/lib/sse';
import { getActiveJourneyByCid, getJourneyByHn, createJourney } from '@/services/journey';
import { AncRiskLevel } from '@/types/domain';
import { logger } from '@/lib/logger';

// ─── Webhook payload types ───

export interface WebhookPatientPayload {
  hn: string;
  an: string;
  name: string;
  cid: string;           // เลขบัตรประชาชน 13 หลัก (required for cross-hospital matching)
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
  hospitalCode: string; // Must match API key's hospital
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
  hn: string | null;  // null for community ANC patients not registered in hospital patient table
  name: string;
  cid: string;            // เลขบัตรประชาชน 13 หลัก (required for cross-hospital matching)
  birthday: string;
  pregNo: number;
  lmp?: string;
  edc?: string;
  riskLevel?: string;
  changwatCode?: string;        // จังหวัด 2-digit (e.g. "40" = ขอนแก่น)
  amphurCode?: string;          // อำเภอ 2-digit
  tambonCode?: string;          // ตำบล 2-digit
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

// CREATE — sent by sending hospital (รพ.ต้นทาง)
export interface WebhookReferralCreatePayload {
  type: 'referral';
  hospitalCode: string;          // sender's HCODE (matches API key)
  referralId: string;            // sender's referral ID (compound key)
  hn: string;                    // patient HN at sending hospital
  cid: string;                   // national ID (เลขบัตรประชาชน) — same across all hospitals
  name: string;                  // patient name (auto-encrypted)
  toHospitalCode: string;        // destination hospital HCODE
  reason: string;                // referral reason
  diagnosisCode?: string;        // ICD-10 code
  urgencyLevel?: string;         // ROUTINE | URGENT | EMERGENCY (default: ROUTINE)
  changwatCode?: string;         // จังหวัด 2-digit (patient address for GIS)
  amphurCode?: string;           // อำเภอ 2-digit
  tambonCode?: string;           // ตำบล 2-digit
  action?: 'upsert' | 'delete'; // default: 'upsert'
}

// UPDATE — sent by receiving hospital (รพ.ปลายทาง)
export interface WebhookReferralUpdatePayload {
  type: 'referral_update';
  hospitalCode: string;          // who is sending this update (matches API key)
  referralId: string;            // original referral ID
  fromHospitalCode: string;      // sending hospital HCODE (compound key)
  status: string;                // ACCEPTED | IN_TRANSIT | ARRIVED | REJECTED
  reason?: string;               // reason for status change
  rejectionReason?: string;      // reason for rejection (REJECTED only)
  transportMode?: string;        // ambulance, self, etc. (IN_TRANSIT only)
  arrivedAt?: string;            // arrival datetime ISO 8601 (ARRIVED only)
  action?: 'update' | 'delete';  // default: 'update'
}

export type WebhookReferralPayload = WebhookReferralCreatePayload | WebhookReferralUpdatePayload;

export interface WebhookReferralResult {
  referralId: string;
  status: string;
}

// ─── Partograph webhook payload ───
//
// Carries one or more partograph observations (rows on the WHO partogram chart)
// from a non-HOSxP sending system. Validation is deliberately lenient on
// clinical fields — out-of-range or unknown values are passed through to the
// CDSS so it can flag them rather than rejected at the boundary.

export interface WebhookPartographObservation {
  an: string;
  externalObservationId: string;
  observeDatetime: string;
  hourNo?: number | null;
  fetalHeartRate?: number | null;
  amnioticFluid?: string | null;
  amnioticTypeId?: number | null;
  moulding?: string | null;
  cervicalDilationCm?: number | null;
  descentOfHead?: string | null;
  contractionPer10Min?: number | null;
  contractionDurationSec?: number | null;
  contractionStrength?: 'mild' | 'moderate' | 'strong' | null;
  oxytocinUml?: number | null;
  oxytocinDropsMin?: number | null;
  drugsIvFluids?: string | null;
  pulse?: number | null;
  bpSystolic?: number | null;
  bpDiastolic?: number | null;
  temperature?: number | null;
  urineVolumeMl?: number | null;
  urineProtein?: string | null;
  urineGlucose?: string | null;
  urineAcetone?: string | null;
  note?: string | null;
  entryStaff?: string | null;
  entryDatetime?: string | null;
  action?: 'upsert' | 'delete';
}

export interface WebhookPartographPayload {
  type: 'partograph';
  hospitalCode: string;
  observations: WebhookPartographObservation[];
}

export interface WebhookPartographResult {
  observationsAccepted: number;
  observationsSkipped: { an: string; externalObservationId: string; reason: string }[];
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
    if (!p.cid || typeof p.cid !== 'string') {
      errors.push(`patients[${i}].cid is required (string) — เลขบัตรประชาชน 13 หลัก`);
    } else if (!/^\d{13}$/.test(p.cid)) {
      // Strict 13-digit check — required for cross-hospital cidHash matching.
      // A 12- or 14-char CID silently breaks transfer detection in production.
      errors.push(`patients[${i}].cid must be exactly 13 digits (got "${p.cid}")`);
    }
    if (p.age == null || typeof p.age !== 'number') errors.push(`patients[${i}].age is required (number)`);
    if (!p.admit_date || typeof p.admit_date !== 'string') {
      errors.push(`patients[${i}].admit_date is required (ISO 8601 string)`);
    } else if (Number.isNaN(new Date(p.admit_date).getTime())) {
      // Reject "not-a-date" or "2026-13-45" before they reach the DB layer.
      errors.push(`patients[${i}].admit_date must be a valid ISO 8601 string (got "${p.admit_date}")`);
    }
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
    // Compute CID hash for lookup
    const patientCidHash = createHash('sha256').update(patient.cid).digest('hex');

    // Handle delete action — soft delete by setting care_stage to CANCELLED
    if (patient.action === 'delete') {
      const existing = await getActiveJourneyByCid(db, patientCidHash)
        ?? (patient.hn ? await getJourneyByHn(db, patient.hn, hospitalId) : null);
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
    const encryptedCid = encrypt(patient.cid, encryptionKey);
    const cidHash = patientCidHash;

    // Primary lookup by CID (cross-hospital), fallback to HN+hospital (skip if HN is null)
    const patientHn = patient.hn;
    const existing = await getActiveJourneyByCid(db, cidHash)
      ?? (patientHn != null ? await getJourneyByHn(db, patientHn, hospitalId) : null);

    // Detect if incoming data is a NEW pregnancy vs update to existing
    const isNewPregnancy = existing && (
      (patient.pregNo > existing.gravida) ||
      (patient.lmp && existing.lmp && patient.lmp !== existing.lmp)
    );
    const existingIsActive = existing && (existing.careStage === 'PREGNANCY' || existing.careStage === 'LABOR');

    // Overlapping pregnancy warning: new pregnancy while old one not finished
    if (isNewPregnancy && existingIsActive) {
      const daysSinceUpdate = Math.floor(
        (Date.now() - existing.updatedAt.getTime()) / (1000 * 60 * 60 * 24),
      );
      logger.warn('pregnancy_overlap', {
        cidHashPrefix: cidHash.slice(0, 8),
        newPregNo: patient.pregNo,
        oldPregNo: existing.gravida,
        oldCareStage: existing.careStage,
        journeyId: existing.id,
        daysSinceUpdate,
        hcode,
      });
      sseManager.broadcast('patient-update', {
        type: 'pregnancy_overlap_warning',
        hcode,
        cidHashPrefix: cidHash.slice(0, 8),
        oldJourneyId: existing.id,
        oldPregNo: existing.gravida,
        oldCareStage: existing.careStage,
        newPregNo: patient.pregNo,
        daysSinceLastUpdate: daysSinceUpdate,
      });
    }

    // Decide: update existing journey OR create new one
    const shouldCreateNew = !existing || isNewPregnancy;

    let journeyId: string;
    if (!shouldCreateNew && existing) {
      // Update existing journey with latest data (same pregnancy)
      const now = new Date().toISOString();
      await db.execute(
        `UPDATE maternal_journeys SET name = ?, cid = ?, cid_hash = ?, lmp = ?, edc = ?, anc_risk_level = ?, synced_at = ?, updated_at = ? WHERE id = ?`,
        [encryptedName, encryptedCid, cidHash, patient.lmp ?? existing.lmp, patient.edc ?? existing.edc, patient.riskLevel ?? existing.ancRiskLevel, now, now, existing.id],
      );
      journeyId = existing.id;

      sseManager.broadcast('patient-update', {
        type: 'journey_update',
        hcode,
        journeyId: existing.id,
        careStage: existing.careStage,
        ancRiskLevel: patient.riskLevel ?? existing.ancRiskLevel ?? undefined,
      });
      updated++;
    } else {
      // Create new journey (first pregnancy, or new pregnancy after previous)
      const age = patient.birthday ? Math.floor((Date.now() - new Date(patient.birthday).getTime()) / (365.25 * 24 * 60 * 60 * 1000)) : 0;
      const journey = await createJourney(db, {
        hospitalId,
        hn: patientHn ?? '',  // null for community ANC patients not in hospital patient table
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
      journeyId = journey.id;

      sseManager.broadcast('patient-update', {
        type: 'journey_update',
        hcode,
        journeyId: journey.id,
        careStage: 'PREGNANCY',
        ancRiskLevel: patient.riskLevel ?? undefined,
      });
      created++;
    }

    // Update patient location (province/district/sub-district) if provided
    if (patient.changwatCode || patient.amphurCode || patient.tambonCode) {
      const now3 = new Date().toISOString();
      await db.execute(
        `UPDATE maternal_journeys SET changwat_code = ?, amphur_code = ?, tambon_code = ?, updated_at = ? WHERE id = ?`,
        [patient.changwatCode ?? null, patient.amphurCode ?? null, patient.tambonCode ?? null, now3, journeyId],
      );
    }

    // Persist ANC visit records — replace strategy (delete old, insert new)
    if (patient.visits?.length) {
      await db.execute(`DELETE FROM cached_anc_visits WHERE journey_id = ?`, [journeyId]);
      const visitNow = new Date().toISOString();
      for (const visit of patient.visits) {
        await db.execute(
          `INSERT INTO cached_anc_visits
           (id, journey_id, visit_date, visit_number, ga_weeks,
            fundal_height_cm, weight_kg, bp_systolic, bp_diastolic,
            fetal_hr, synced_at, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            uuidv4(), journeyId, visit.date, visit.visitNumber,
            visit.gaWeeks ?? null,
            visit.fundalHeightCm ?? null, visit.weightKg ?? null,
            visit.bpSystolic ?? null, visit.bpDiastolic ?? null,
            visit.fetalHr ?? null, visitNow, visitNow,
          ],
        );
      }
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

// Helper: resolve hospital HCODE → hospital ID
async function resolveHospitalByHcode(
  db: DatabaseAdapter,
  hcode: string,
): Promise<{ id: string; hcode: string } | null> {
  const rows = await db.query<{ id: string; hcode: string }>(
    'SELECT id, hcode FROM hospitals WHERE hcode = ?',
    [hcode],
  );
  return rows.length > 0 ? rows[0] : null;
}

// CREATE referral — sent by sending hospital (รพ.ต้นทาง)
export async function processReferralCreate(
  db: DatabaseAdapter,
  hospitalId: string,
  payload: WebhookReferralCreatePayload,
  sseManager: SseManager,
): Promise<WebhookReferralResult> {
  const fromHospital = await resolveHospitalByHcode(db, payload.hospitalCode);
  const fromHcode = fromHospital?.hcode ?? payload.hospitalCode;

  // Handle delete — compound key: fromHospitalCode + referralId
  if (payload.action === 'delete') {
    await db.execute(
      `DELETE FROM cached_referrals WHERE from_hospital_id = ? AND refer_number = ?`,
      [hospitalId, payload.referralId],
    );

    sseManager.broadcast('patient-update', {
      type: 'referral_update',
      fromHcode,
      toHcode: '',
      referralId: payload.referralId,
      status: 'DELETED',
    });

    return { referralId: payload.referralId, status: 'DELETED' };
  }

  // Resolve destination hospital
  const toHospital = await resolveHospitalByHcode(db, payload.toHospitalCode);
  if (!toHospital) {
    throw new Error(`ไม่พบโรงพยาบาลปลายทาง HCODE "${payload.toHospitalCode}"`);
  }

  // Encrypt patient data (PDPA)
  const encryptionKey = getEncryptionKey();
  const encryptedName = encrypt(payload.name, encryptionKey);
  const encryptedCid = encrypt(payload.cid, encryptionKey);
  const cidHash = createHash('sha256').update(payload.cid).digest('hex');

  // Primary lookup by CID (cross-hospital), fallback to HN+hospital
  const existingJourney = await getActiveJourneyByCid(db, cidHash)
    ?? await getJourneyByHn(db, payload.hn, hospitalId);

  // Also check if patient has active labor data (cached_patients)
  const laborRecord = await db.query<{ id: string; journey_id: string | null; labor_status: string }>(
    `SELECT id, journey_id, labor_status FROM cached_patients WHERE cid_hash = ? AND labor_status = 'ACTIVE' ORDER BY created_at DESC LIMIT 1`,
    [cidHash],
  );
  const hasActiveLaborData = laborRecord.length > 0;

  // Determine patient monitoring status for the referral
  const hasActiveAncRecord = existingJourney != null;
  const hasMonitoringData = hasActiveAncRecord || hasActiveLaborData;

  let journeyId: string;
  if (existingJourney) {
    journeyId = existingJourney.id;
    // Update patient data and current hospital
    const now2 = new Date().toISOString();
    await db.execute(
      `UPDATE maternal_journeys SET name = ?, cid = ?, cid_hash = ?, current_hospital_id = ?, updated_at = ? WHERE id = ?`,
      [encryptedName, encryptedCid, cidHash, hospitalId, now2, journeyId],
    );
  } else if (hasActiveLaborData && laborRecord[0].journey_id) {
    // Patient has labor data with linked journey — use that journey
    journeyId = laborRecord[0].journey_id;
    const now2 = new Date().toISOString();
    await db.execute(
      `UPDATE maternal_journeys SET name = ?, cid = ?, cid_hash = ?, current_hospital_id = ?, updated_at = ? WHERE id = ?`,
      [encryptedName, encryptedCid, cidHash, hospitalId, now2, journeyId],
    );
  } else {
    // No monitoring data — create minimal journey but warn
    const { randomUUID } = await import('crypto');
    journeyId = randomUUID();
    const now = new Date().toISOString();
    await db.execute(
      `INSERT INTO maternal_journeys (id, hospital_id, current_hospital_id, hn, name, cid, cid_hash, age, gravida, para, care_stage, registered_at, stage_changed_at, synced_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, 0, 'PREGNANCY', ?, ?, ?, ?, ?)`,
      [journeyId, hospitalId, hospitalId, payload.hn, encryptedName, encryptedCid, cidHash, now, now, now, now, now],
    );
  }

  // Warn if patient has no active monitoring data in the system
  if (!hasMonitoringData) {
    logger.warn('referral_no_monitoring', {
      referralId: payload.referralId,
      cidHashPrefix: cidHash.slice(0, 8),
      hn: payload.hn,
      fromHcode,
      toHospitalCode: payload.toHospitalCode,
    });
    sseManager.broadcast('patient-update', {
      type: 'referral_no_monitoring_warning',
      fromHcode,
      toHcode: toHospital.hcode,
      referralId: payload.referralId,
      hn: payload.hn,
      cidHashPrefix: cidHash.slice(0, 8),
      journeyId,
      message: 'ไม่พบข้อมูลฝากครรภ์/คลอดในระบบ กรุณาตรวจสอบข้อมูลผู้ป่วย',
    });
  }

  // Update patient location if provided
  if (payload.changwatCode || payload.amphurCode || payload.tambonCode) {
    const nowLoc = new Date().toISOString();
    await db.execute(
      `UPDATE maternal_journeys SET changwat_code = ?, amphur_code = ?, tambon_code = ?, updated_at = ? WHERE id = ?`,
      [payload.changwatCode ?? null, payload.amphurCode ?? null, payload.tambonCode ?? null, nowLoc, journeyId],
    );
  }

  // Check if referral already exists (upsert by compound key)
  const existing = await db.query<{ id: string }>(
    `SELECT id FROM cached_referrals WHERE from_hospital_id = ? AND refer_number = ?`,
    [hospitalId, payload.referralId],
  );

  const now = new Date().toISOString();
  const urgency = payload.urgencyLevel ?? 'ROUTINE';

  if (existing.length > 0) {
    // Update existing referral
    await db.execute(
      `UPDATE cached_referrals SET to_hospital_id = ?, reason = ?, diagnosis_code = ?, urgency_level = ?, updated_at = ? WHERE id = ?`,
      [toHospital.id, payload.reason, payload.diagnosisCode ?? null, urgency, now, existing[0].id],
    );
  } else {
    // Create new referral
    const { randomUUID } = await import('crypto');
    const id = randomUUID();
    await db.execute(
      `INSERT INTO cached_referrals (id, journey_id, refer_number, from_hospital_id, to_hospital_id, status, reason, diagnosis_code, urgency_level, initiated_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'INITIATED', ?, ?, ?, ?, ?, ?)`,
      [id, journeyId, payload.referralId, hospitalId, toHospital.id, payload.reason, payload.diagnosisCode ?? null, urgency, now, now, now],
    );
  }

  sseManager.broadcast('patient-update', {
    type: 'referral_update',
    fromHcode,
    toHcode: toHospital.hcode,
    referralId: payload.referralId,
    status: 'INITIATED',
  });

  return { referralId: payload.referralId, status: 'INITIATED' };
}

// UPDATE referral status — sent by receiving hospital (รพ.ปลายทาง)
export async function processReferralUpdate(
  db: DatabaseAdapter,
  _hospitalId: string,
  payload: WebhookReferralUpdatePayload,
  sseManager: SseManager,
): Promise<WebhookReferralResult> {
  // Resolve the sending hospital (fromHospitalCode) for compound key lookup
  const fromHospital = await resolveHospitalByHcode(db, payload.fromHospitalCode);
  if (!fromHospital) {
    throw new Error(`ไม่พบโรงพยาบาลต้นทาง HCODE "${payload.fromHospitalCode}"`);
  }

  const fromHcode = fromHospital.hcode;

  // Handle delete — compound key: fromHospitalCode + referralId
  if (payload.action === 'delete') {
    const delRows = await db.query<{ to_hospital_id: string }>(
      `SELECT to_hospital_id FROM cached_referrals WHERE from_hospital_id = ? AND refer_number = ?`,
      [fromHospital.id, payload.referralId],
    );
    const toHcode = delRows.length > 0
      ? (await db.query<{ hcode: string }>('SELECT hcode FROM hospitals WHERE id = ?', [delRows[0].to_hospital_id]))[0]?.hcode ?? ''
      : '';

    await db.execute(
      `DELETE FROM cached_referrals WHERE from_hospital_id = ? AND refer_number = ?`,
      [fromHospital.id, payload.referralId],
    );

    sseManager.broadcast('patient-update', {
      type: 'referral_update',
      fromHcode,
      toHcode,
      referralId: payload.referralId,
      status: 'DELETED',
    });

    return { referralId: payload.referralId, status: 'DELETED' };
  }

  // Look up referral by compound key: from_hospital_id + refer_number
  const existing = await db.query<{ id: string; to_hospital_id: string; journey_id: string }>(
    `SELECT id, to_hospital_id, journey_id FROM cached_referrals WHERE from_hospital_id = ? AND refer_number = ?`,
    [fromHospital.id, payload.referralId],
  );

  if (existing.length === 0) {
    throw new Error(`ไม่พบใบส่งต่อ referralId "${payload.referralId}" จาก HCODE "${payload.fromHospitalCode}"`);
  }

  const referralRow = existing[0];
  const now = new Date().toISOString();

  if (payload.status === 'ACCEPTED') {
    await db.execute(
      `UPDATE cached_referrals SET status = 'ACCEPTED', accepted_at = ?, updated_at = ? WHERE id = ?`,
      [now, now, referralRow.id],
    );
  } else if (payload.status === 'REJECTED') {
    await db.execute(
      `UPDATE cached_referrals SET status = 'REJECTED', rejected_at = ?, rejection_reason = ?, updated_at = ? WHERE id = ?`,
      [now, payload.rejectionReason ?? payload.reason ?? null, now, referralRow.id],
    );
  } else if (payload.status === 'IN_TRANSIT') {
    await db.execute(
      `UPDATE cached_referrals SET status = 'IN_TRANSIT', departed_at = ?, transport_mode = ?, updated_at = ? WHERE id = ?`,
      [now, payload.transportMode ?? null, now, referralRow.id],
    );
  } else if (payload.status === 'ARRIVED') {
    await db.execute(
      `UPDATE cached_referrals SET status = 'ARRIVED', arrived_at = ?, updated_at = ? WHERE id = ?`,
      [payload.arrivedAt ?? now, now, referralRow.id],
    );
    // Update journey's current hospital to the receiving hospital
    await db.execute(
      `UPDATE maternal_journeys SET current_hospital_id = ?, updated_at = ? WHERE id = ?`,
      [referralRow.to_hospital_id, now, referralRow.journey_id],
    );
  }

  const toHcodeRows = await db.query<{ hcode: string }>(
    'SELECT hcode FROM hospitals WHERE id = ?',
    [referralRow.to_hospital_id],
  );

  sseManager.broadcast('patient-update', {
    type: 'referral_update',
    fromHcode,
    toHcode: toHcodeRows[0]?.hcode ?? '',
    referralId: payload.referralId,
    status: payload.status,
  });

  return { referralId: payload.referralId, status: payload.status };
}

// ─── Partograph webhook validation + processing ───
//
// Mirrors validatePayload() / processWebhookPayload() patterns. Validation is
// shape-only — clinical out-of-range values (e.g. fetalHeartRate=12) are
// passed through so the CDSS can flag them as alerts instead of being
// silently dropped at the boundary.
export function validatePartographPayload(body: unknown): {
  valid: boolean;
  error?: string;
  payload?: WebhookPartographPayload;
} {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { valid: false, error: 'Request body must be a JSON object' };
  }
  const obj = body as Record<string, unknown>;
  if (!Array.isArray(obj.observations)) {
    return { valid: false, error: '"observations" must be an array' };
  }
  if (obj.observations.length === 0) {
    return { valid: false, error: '"observations" must not be empty' };
  }
  if (obj.observations.length > 200) {
    return { valid: false, error: '"observations" must not exceed 200 items per request' };
  }

  const errors: string[] = [];
  for (let i = 0; i < obj.observations.length; i++) {
    const o = obj.observations[i] as Record<string, unknown>;
    if (!o.an || typeof o.an !== 'string') {
      errors.push(`observations[${i}].an is required (string)`);
    }
    if (!o.externalObservationId || typeof o.externalObservationId !== 'string') {
      errors.push(`observations[${i}].externalObservationId is required (string ≤64)`);
    } else if ((o.externalObservationId as string).length > 64) {
      errors.push(`observations[${i}].externalObservationId must be ≤64 chars`);
    }

    if (o.action !== 'delete') {
      if (!o.observeDatetime || typeof o.observeDatetime !== 'string') {
        errors.push(`observations[${i}].observeDatetime is required (ISO 8601)`);
      } else if (Number.isNaN(new Date(o.observeDatetime as string).getTime())) {
        errors.push(`observations[${i}].observeDatetime must be a valid ISO 8601`);
      }
    }
  }

  if (errors.length > 0) {
    return { valid: false, error: `Validation errors: ${errors.join('; ')}` };
  }

  return { valid: true, payload: obj as unknown as WebhookPartographPayload };
}
