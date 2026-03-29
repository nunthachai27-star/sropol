// T047: Sync service — polls HOSxP via BMS Session, caches in local DB
import { v4 as uuidv4 } from 'uuid';
import { createHash } from 'crypto';
import type { DatabaseAdapter } from '@/db/adapter';
import type { HosxpIptRow, HosxpPregnancyRow, HosxpPatientRow } from '@/types/hosxp';
import { encrypt } from '@/lib/encryption';
import { calculateAge } from '@/lib/utils';
import { createJourney, getJourneyByHn, transitionToLabor, transitionToDelivered } from '@/services/journey';
import { upsertNewborn } from '@/services/newborn';
import { evaluateAncRisk } from '@/services/anc-risk';
import type { HosxpPersonAncRow, HosxpAncServiceRow, HosxpAncRiskRow, HosxpAncClassifyingRow, HosxpLabourInfantRow } from '@/types/hosxp';
import type { AncRiskInput } from '@/config/anc-risk-rules';
import { HOSXP_RISK_TO_LAB_FLAGS } from '@/config/anc-risk-rules';
import { AncRiskLevel } from '@/types/domain';

export interface SyncPatientData {
  hn: string;
  an: string;
  name: string;
  cid: string | null;
  cidHash: string | null;
  age: number;
  gravida: number | null;
  gaWeeks: number | null;
  ancCount: number | null;
  admitDate: string;
  heightCm?: number | null;
  weightKg?: number | null;
  weightDiffKg?: number | null;
  fundalHeightCm?: number | null;
  usWeightG?: number | null;
  hematocritPct?: number | null;
  laborStatus: string;
  syncedAt: string;
}

export function transformHosxpPatient(
  ipt: HosxpIptRow,
  pregnancy: HosxpPregnancyRow,
  patient: HosxpPatientRow,
  encryptionKey: string,
): SyncPatientData {
  const fullName = `${patient.pname} ${patient.fname} ${patient.lname}`.trim();
  const encryptedName = encrypt(fullName, encryptionKey);
  const encryptedCid = patient.cid ? encrypt(patient.cid, encryptionKey) : null;
  const cidHash = patient.cid
    ? createHash('sha256').update(patient.cid).digest('hex')
    : null;
  const age = calculateAge(patient.birthday);
  const admitDate = `${ipt.regdate}T${ipt.regtime || '00:00:00'}`;
  const laborStatus = ipt.dchdate ? 'DELIVERED' : 'ACTIVE';

  return {
    hn: ipt.hn,
    an: ipt.an,
    name: encryptedName,
    cid: encryptedCid,
    cidHash,
    age,
    gravida: pregnancy.preg_number,
    gaWeeks: pregnancy.ga,
    ancCount: null, // Filled from ANC data separately
    admitDate,
    laborStatus,
    syncedAt: new Date().toISOString(),
  };
}

export async function upsertCachedPatients(
  db: DatabaseAdapter,
  hospitalId: string,
  patients: SyncPatientData[],
): Promise<number> {
  let count = 0;
  const now = new Date().toISOString();

  for (const p of patients) {
    // Check if patient exists
    const existing = await db.query<{ id: string }>(
      'SELECT id FROM cached_patients WHERE hospital_id = ? AND an = ?',
      [hospitalId, p.an],
    );

    if (existing.length > 0) {
      // Update existing patient
      await db.execute(
        `UPDATE cached_patients SET
          hn = ?, name = ?, cid = ?, cid_hash = ?, age = ?, gravida = ?, ga_weeks = ?,
          anc_count = ?, admit_date = ?, height_cm = ?, weight_kg = ?,
          weight_diff_kg = ?, fundal_height_cm = ?, us_weight_g = ?,
          hematocrit_pct = ?, labor_status = ?, synced_at = ?, updated_at = ?
        WHERE id = ?`,
        [
          p.hn, p.name, p.cid, p.cidHash ?? null, p.age, p.gravida, p.gaWeeks,
          p.ancCount, p.admitDate, p.heightCm ?? null, p.weightKg ?? null,
          p.weightDiffKg ?? null, p.fundalHeightCm ?? null, p.usWeightG ?? null,
          p.hematocritPct ?? null, p.laborStatus, p.syncedAt, now,
          existing[0].id,
        ],
      );
    } else {
      // Insert new patient
      await db.execute(
        `INSERT INTO cached_patients (
          id, hospital_id, hn, an, name, cid, cid_hash, age, gravida, ga_weeks,
          anc_count, admit_date, height_cm, weight_kg, weight_diff_kg,
          fundal_height_cm, us_weight_g, hematocrit_pct, labor_status,
          synced_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          uuidv4(), hospitalId, p.hn, p.an, p.name, p.cid, p.cidHash ?? null, p.age,
          p.gravida, p.gaWeeks, p.ancCount, p.admitDate,
          p.heightCm ?? null, p.weightKg ?? null, p.weightDiffKg ?? null,
          p.fundalHeightCm ?? null, p.usWeightG ?? null, p.hematocritPct ?? null,
          p.laborStatus, p.syncedAt, now, now,
        ],
      );
    }
    count++;
  }

  return count;
}

export interface ChangeDetectionResult {
  newAdmissions: string[];
  discharges: string[];
}

export function detectChanges(
  newData: Pick<SyncPatientData, 'an' | 'laborStatus'>[],
  existingAns: string[],
): ChangeDetectionResult {
  const newAns = newData.map((d) => d.an);
  const newAdmissions = newAns.filter((an) => !existingAns.includes(an));
  const discharges = existingAns.filter((an) => !newAns.includes(an));

  return { newAdmissions, discharges };
}

// Mark patients as DELIVERED — used by both HOSxP polling (discharge detection) and webhook full_snapshot mode
export async function markPatientsDelivered(
  db: DatabaseAdapter,
  hospitalId: string,
  ans: string[],
): Promise<void> {
  if (ans.length === 0) return;
  const now = new Date().toISOString();
  for (const an of ans) {
    await db.execute(
      `UPDATE cached_patients SET labor_status = 'DELIVERED', delivered_at = ?, updated_at = ?
       WHERE hospital_id = ? AND an = ? AND labor_status = 'ACTIVE'`,
      [now, now, hospitalId, an],
    );
  }
}

// T104/T107: Transfer detection — cross-hospital CID matching via cid_hash
export interface TransferDetection {
  cidHash: string;
  fromHospitalId: string;
  fromAn: string;
  toHospitalId: string;
  toAn: string;
}

export async function detectTransfers(
  db: DatabaseAdapter,
  hospitalId: string,
  patients: SyncPatientData[],
): Promise<TransferDetection[]> {
  const transfers: TransferDetection[] = [];

  for (const p of patients) {
    // Skip patients without CID hash — cannot match cross-hospital
    if (!p.cidHash) continue;

    // Find ACTIVE patients at OTHER hospitals with the same cid_hash
    const matches = await db.query<{
      hospital_id: string;
      an: string;
    }>(
      `SELECT hospital_id, an FROM cached_patients
       WHERE cid_hash = ? AND hospital_id != ? AND labor_status = 'ACTIVE'`,
      [p.cidHash, hospitalId],
    );

    for (const match of matches) {
      transfers.push({
        cidHash: p.cidHash,
        fromHospitalId: match.hospital_id,
        fromAn: match.an,
        toHospitalId: hospitalId,
        toAn: p.an,
      });
    }
  }

  return transfers;
}

// T058: Polling scheduler
import { BmsSessionClient } from '@/lib/bms-session';
import { SseManager } from '@/lib/sse';
import { getQuery, ACTIVE_LABOR_PATIENTS } from '@/config/hosxp-queries';
import type { DatabaseDialect } from '@/config/hosxp-queries';
import { calculateCpdScore } from '@/services/cpd-score';
import { RiskLevel } from '@/types/domain';

const pollingIntervals: Map<string, ReturnType<typeof setInterval>> = new Map();

// ─── Intelligent Sync Lock Manager ───
// Prevents concurrent pulls for the same hospital and enforces cooldown periods.

interface SyncState {
  inProgress: boolean;
  lastSyncAt: number; // epoch ms
  lastJwtRefreshAt: number; // epoch ms
}

const syncStates: Map<string, SyncState> = new Map();
const SYNC_COOLDOWN_MS = 10_000; // Don't re-sync if synced within 10 seconds

function getSyncState(hospitalId: string): SyncState {
  let state = syncStates.get(hospitalId);
  if (!state) {
    state = { inProgress: false, lastSyncAt: 0, lastJwtRefreshAt: 0 };
    syncStates.set(hospitalId, state);
  }
  return state;
}

export interface ImmediateSyncResult {
  synced: boolean;
  reason: 'ok' | 'cooldown' | 'in_progress' | 'no_config' | 'error';
  lastSyncAt: string | null;
  patientsCount?: number;
}

/**
 * Request an immediate sync for a hospital. Intelligent algorithm:
 * 1. Check cooldown — skip if synced within SYNC_COOLDOWN_MS
 * 2. Acquire lock — skip if another sync is already in progress
 * 3. Check JWT expiry — refresh from user's session if expired
 * 4. Execute poll — same pipeline as scheduled polling
 * 5. Release lock
 */
export async function requestImmediateSync(
  db: DatabaseAdapter,
  hospitalId: string,
  sseManager: SseManager,
  _userSessionJwt?: string,
): Promise<ImmediateSyncResult> {
  const state = getSyncState(hospitalId);
  const now = Date.now();

  // 1. Cooldown check — recently synced
  if (now - state.lastSyncAt < SYNC_COOLDOWN_MS) {
    return {
      synced: false,
      reason: 'cooldown',
      lastSyncAt: new Date(state.lastSyncAt).toISOString(),
    };
  }

  // 2. Lock check — already syncing
  if (state.inProgress) {
    return {
      synced: false,
      reason: 'in_progress',
      lastSyncAt: state.lastSyncAt ? new Date(state.lastSyncAt).toISOString() : null,
    };
  }

  // 3. Get hospital BMS config
  const configs = await db.query<{
    tunnel_url: string;
    session_jwt: string | null;
    session_expires_at: string | null;
    database_type: string | null;
  }>(
    'SELECT tunnel_url, session_jwt, session_expires_at, database_type FROM hospital_bms_config WHERE hospital_id = ?',
    [hospitalId],
  );

  if (configs.length === 0) {
    return { synced: false, reason: 'no_config', lastSyncAt: null };
  }

  const config = configs[0];

  // Acquire lock
  state.inProgress = true;

  try {
    const encryptionKey = process.env.ENCRYPTION_KEY ?? '';
    const validateUrl = process.env.BMS_VALIDATE_URL ?? 'https://hosxp.net/phapi/PasteJSON';
    let jwt = config.session_jwt;
    let bmsUrl = config.tunnel_url;
    let dbType = (config.database_type ?? 'postgresql') as DatabaseDialect;

    // 4. JWT lifecycle — check expiry and refresh if needed
    const jwtExpired = config.session_expires_at
      ? new Date(config.session_expires_at).getTime() < now
      : !jwt;

    if (!jwt || jwtExpired) {
      // Try to obtain a fresh JWT via BMS Session API
      try {
        const client = new BmsSessionClient(config.tunnel_url);
        const sessionId = await client.getSessionId();
        const sessionConfig = await client.validateSession(sessionId, validateUrl);
        jwt = sessionConfig.jwt;
        bmsUrl = sessionConfig.bmsUrl;
        dbType = (await client.getDatabaseType(bmsUrl, jwt)) as DatabaseDialect;

        // Cache refreshed session
        await db.execute(
          'UPDATE hospital_bms_config SET session_jwt = ?, database_type = ?, session_expires_at = ? WHERE hospital_id = ?',
          [jwt, dbType, sessionConfig.expiresAt.toISOString(), hospitalId],
        );
        state.lastJwtRefreshAt = now;
        console.log(`[SYNC] JWT refreshed for hospital ${hospitalId}`);
      } catch {
        // If BMS Session refresh fails and we have no JWT, we can't sync
        if (!jwt) {
          return { synced: false, reason: 'error', lastSyncAt: null };
        }
        // If we have an old JWT, try it anyway (might still work)
      }
    }

    // 5. Execute poll
    await pollHospital(db, hospitalId, config.tunnel_url, bmsUrl, jwt, dbType, encryptionKey, sseManager);

    state.lastSyncAt = Date.now();

    // Get patient count for response
    const countResult = await db.query<{ cnt: number }>(
      "SELECT COUNT(*) as cnt FROM cached_patients WHERE hospital_id = ? AND labor_status = 'ACTIVE'",
      [hospitalId],
    );

    return {
      synced: true,
      reason: 'ok',
      lastSyncAt: new Date(state.lastSyncAt).toISOString(),
      patientsCount: countResult[0]?.cnt ?? 0,
    };
  } catch (error) {
    console.error(`[SYNC] Immediate sync failed for hospital ${hospitalId}:`, error);
    return { synced: false, reason: 'error', lastSyncAt: null };
  } finally {
    // Release lock
    state.inProgress = false;
  }
}

// T063: Calculate CPD scores for patients after sync — shared by polling and webhook pipelines
export async function calculateAndStoreCpdScores(
  db: DatabaseAdapter,
  hospitalId: string,
  sseManager: SseManager,
): Promise<void> {
  const patients = await db.query<{
    id: string;
    an: string;
    gravida: number | null;
    anc_count: number | null;
    ga_weeks: number | null;
    height_cm: number | null;
    weight_diff_kg: number | null;
    fundal_height_cm: number | null;
    us_weight_g: number | null;
    hematocrit_pct: number | null;
  }>(
    "SELECT id, an, gravida, anc_count, ga_weeks, height_cm, weight_diff_kg, fundal_height_cm, us_weight_g, hematocrit_pct FROM cached_patients WHERE hospital_id = ? AND labor_status = 'ACTIVE'",
    [hospitalId],
  );

  const hospitalRows = await db.query<{ hcode: string }>(
    'SELECT hcode FROM hospitals WHERE id = ?',
    [hospitalId],
  );
  const hcode = hospitalRows[0]?.hcode ?? '';

  for (const p of patients) {
    const factors: Record<string, number> = {};
    if (p.gravida != null) factors.gravida = p.gravida;
    if (p.anc_count != null) factors.ancCount = p.anc_count;
    if (p.ga_weeks != null) factors.gaWeeks = p.ga_weeks;
    if (p.height_cm != null) factors.heightCm = p.height_cm;
    if (p.weight_diff_kg != null) factors.weightDiffKg = p.weight_diff_kg;
    if (p.fundal_height_cm != null) factors.fundalHeightCm = p.fundal_height_cm;
    if (p.us_weight_g != null) factors.usWeightG = p.us_weight_g;
    if (p.hematocrit_pct != null) factors.hematocritPct = p.hematocrit_pct;

    const result = calculateCpdScore(factors);
    const now = new Date().toISOString();

    // Get previous score for comparison
    const prevScores = await db.query<{ risk_level: string }>(
      'SELECT risk_level FROM cpd_scores WHERE patient_id = ? ORDER BY calculated_at DESC LIMIT 1',
      [p.id],
    );
    const prevRiskLevel = prevScores[0]?.risk_level ?? null;

    // Insert new CPD score
    await db.execute(
      `INSERT INTO cpd_scores (
        id, patient_id, score, risk_level, recommendation,
        factor_gravida, factor_anc_count, factor_ga_weeks, factor_height_cm,
        factor_weight_diff, factor_fundal_ht, factor_us_weight, factor_hematocrit,
        missing_factors, calculated_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        uuidv4(), p.id, result.score, result.riskLevel, result.recommendation,
        result.factorScores.gravida ?? null,
        result.factorScores.ancCount ?? null,
        result.factorScores.gaWeeks ?? null,
        result.factorScores.heightCm ?? null,
        result.factorScores.weightDiffKg ?? null,
        result.factorScores.fundalHeightCm ?? null,
        result.factorScores.usWeightG ?? null,
        result.factorScores.hematocritPct ?? null,
        JSON.stringify(result.missingFactors),
        now, now,
      ],
    );

    // Broadcast SSE if risk level changed
    if (prevRiskLevel && prevRiskLevel !== result.riskLevel) {
      sseManager.broadcast('patient-update', {
        type: 'risk_changed',
        hcode,
        an: p.an,
        riskLevel: result.riskLevel,
        previousRiskLevel: prevRiskLevel,
        score: result.score,
      });
    }

    // Alert on HIGH risk
    if (result.riskLevel === RiskLevel.HIGH && prevRiskLevel !== RiskLevel.HIGH) {
      sseManager.broadcast('patient-update', {
        type: 'high_risk_alert',
        hcode,
        an: p.an,
        score: result.score,
        recommendation: result.recommendation,
      });
    }
  }
}

export async function pollHospital(
  db: DatabaseAdapter,
  hospitalId: string,
  tunnelUrl: string,
  bmsUrl: string,
  jwt: string,
  databaseType: DatabaseDialect,
  encryptionKey: string,
  sseManager: SseManager,
): Promise<void> {
  try {
    const client = new BmsSessionClient(tunnelUrl);

    // Query active patients with pregnancy/labour data
    const sql = getQuery(ACTIVE_LABOR_PATIENTS, databaseType);
    const result = await client.executeQuery(sql, bmsUrl, jwt);

    if (result.data.length === 0) {
      await db.execute(
        "UPDATE hospitals SET connection_status = 'ONLINE', last_sync_at = ? WHERE id = ?",
        [new Date().toISOString(), hospitalId],
      );
      return;
    }

    // Get existing patient ANs for change detection
    const existing = await db.query<{ an: string }>(
      "SELECT an FROM cached_patients WHERE hospital_id = ? AND labor_status = 'ACTIVE'",
      [hospitalId],
    );
    const existingAns = existing.map((r) => r.an);

    // Transform and upsert — patient data now comes from single query with JOINs
    const patients: SyncPatientData[] = result.data.map((row) => {
      const rawCid = row.cid ? String(row.cid).trim() : null;
      const fullName = [row.pname, row.fname, row.lname].filter(Boolean).join(' ').trim() || 'ไม่ระบุชื่อ';
      const age = row.birthday ? calculateAge(String(row.birthday)) : 0;

      return {
        hn: String(row.hn ?? ''),
        an: String(row.an ?? ''),
        name: encrypt(fullName, encryptionKey),
        cid: rawCid ? encrypt(rawCid, encryptionKey) : null,
        cidHash: rawCid ? createHash('sha256').update(rawCid).digest('hex') : null,
        age,
        gravida: row.preg_number != null ? Number(row.preg_number) : null,
        gaWeeks: row.ga != null ? Number(row.ga) : null,
        // anc_count from ipt_labour (numeric), anc_complete from ipt_pregnancy ('Y'/'N' flag)
        ancCount: row.anc_count != null ? Number(row.anc_count) : null,
        admitDate: `${row.regdate}T${row.regtime || '00:00:00'}`,
        laborStatus: 'ACTIVE',
        syncedAt: new Date().toISOString(),
      };
    });

    const count = await upsertCachedPatients(db, hospitalId, patients);

    // T107: Detect patient transfers before upserting marks old records
    const transfers = await detectTransfers(db, hospitalId, patients);

    // Get hospital hcode for SSE events (needed for transfers and later)
    const hospitalRows = await db.query<{ hcode: string }>(
      'SELECT hcode FROM hospitals WHERE id = ?',
      [hospitalId],
    );
    const hcode = hospitalRows[0]?.hcode ?? '';

    // Process detected transfers
    for (const transfer of transfers) {
      // Mark old hospital's patient record as TRANSFERRED
      await db.execute(
        `UPDATE cached_patients SET labor_status = 'TRANSFERRED', updated_at = ?
         WHERE hospital_id = ? AND an = ?`,
        [new Date().toISOString(), transfer.fromHospitalId, transfer.fromAn],
      );

      // Get the source hospital hcode for the SSE event
      const fromHospitalRows = await db.query<{ hcode: string }>(
        'SELECT hcode FROM hospitals WHERE id = ?',
        [transfer.fromHospitalId],
      );
      const fromHcode = fromHospitalRows[0]?.hcode ?? '';

      sseManager.broadcast('patient-update', {
        type: 'patient_transfer',
        fromHcode,
        toHcode: hcode,
        an: transfer.toAn,
      });
    }

    // T063: Calculate CPD scores for each patient after upsert
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

    // Mark discharged patients — HOSxP no longer returns them (dchdate set)
    if (changes.discharges.length > 0) {
      await markPatientsDelivered(db, hospitalId, changes.discharges);
      for (const an of changes.discharges) {
        sseManager.broadcast('patient-update', {
          type: 'patient_discharged',
          hcode,
          an,
        });
      }
    }

    if (count > 0) {
      sseManager.broadcast('sync-complete', {
        hcode,
        patientsUpdated: count,
        timestamp: new Date().toISOString(),
      });
    }

    // Update hospital status
    await db.execute(
      "UPDATE hospitals SET connection_status = 'ONLINE', last_sync_at = ? WHERE id = ?",
      [new Date().toISOString(), hospitalId],
    );
  } catch (error) {
    console.error(`Polling failed for hospital ${hospitalId}:`, error);
    await db.execute(
      "UPDATE hospitals SET connection_status = 'OFFLINE' WHERE id = ?",
      [hospitalId],
    );

    // Get hcode for SSE event
    const hospitalRows = await db.query<{ hcode: string }>(
      'SELECT hcode FROM hospitals WHERE id = ?',
      [hospitalId],
    );
    const hcode = hospitalRows[0]?.hcode ?? '';
    sseManager.broadcast('connection-status', {
      hcode,
      status: 'OFFLINE',
      lastSyncAt: new Date().toISOString(),
    });
  }
}

export async function startPolling(db: DatabaseAdapter, sseManager: SseManager): Promise<void> {
  const encryptionKey = process.env.ENCRYPTION_KEY ?? '';
  const validateUrl = process.env.BMS_VALIDATE_URL ?? 'https://hosxp.net/phapi/PasteJSON';

  // Get all hospitals with BMS config
  const configs = await db.query<{
    hospital_id: string;
    tunnel_url: string;
    session_jwt: string | null;
    database_type: string | null;
  }>(
    'SELECT hbc.hospital_id, hbc.tunnel_url, hbc.session_jwt, hbc.database_type FROM hospital_bms_config hbc',
  );

  const numHospitals = configs.length;
  if (numHospitals === 0) {
    console.log('No hospitals with BMS config found. Polling not started.');
    return;
  }

  const POLLING_INTERVAL = 30000; // 30 seconds
  const staggerMs = Math.floor(POLLING_INTERVAL / numHospitals);

  for (let i = 0; i < configs.length; i++) {
    const config = configs[i];
    const delay = i * staggerMs;

    setTimeout(() => {
      const interval = setInterval(async () => {
        // Use the sync lock to prevent overlap with on-demand syncs
        const state = getSyncState(config.hospital_id);
        if (state.inProgress) return; // Skip if an on-demand sync is running

        try {
          state.inProgress = true;

          // Refresh session if needed (check expiry)
          let jwt = config.session_jwt;
          let bmsUrl = config.tunnel_url;
          let dbType = (config.database_type ?? 'postgresql') as DatabaseDialect;

          // Read fresh config from DB (may have been updated by on-demand sync)
          const freshConfig = await db.query<{
            session_jwt: string | null;
            session_expires_at: string | null;
            database_type: string | null;
          }>(
            'SELECT session_jwt, session_expires_at, database_type FROM hospital_bms_config WHERE hospital_id = ?',
            [config.hospital_id],
          );
          if (freshConfig.length > 0) {
            jwt = freshConfig[0].session_jwt;
            dbType = (freshConfig[0].database_type ?? 'postgresql') as DatabaseDialect;

            // Check JWT expiry
            const expired = freshConfig[0].session_expires_at
              ? new Date(freshConfig[0].session_expires_at).getTime() < Date.now()
              : !jwt;

            if (!jwt || expired) {
              const client = new BmsSessionClient(config.tunnel_url);
              const sessionId = await client.getSessionId();
              const sessionConfig = await client.validateSession(sessionId, validateUrl);
              jwt = sessionConfig.jwt;
              bmsUrl = sessionConfig.bmsUrl;
              dbType = (await client.getDatabaseType(bmsUrl, jwt)) as DatabaseDialect;

              await db.execute(
                'UPDATE hospital_bms_config SET session_jwt = ?, database_type = ?, session_expires_at = ? WHERE hospital_id = ?',
                [jwt, dbType, sessionConfig.expiresAt.toISOString(), config.hospital_id],
              );
            }
          }

          await pollHospital(db, config.hospital_id, config.tunnel_url, bmsUrl, jwt!, dbType, encryptionKey, sseManager);
          state.lastSyncAt = Date.now();
        } catch (error) {
          console.error(`Poll cycle failed for hospital ${config.hospital_id}:`, error);
        } finally {
          state.inProgress = false;
        }
      }, POLLING_INTERVAL);

      pollingIntervals.set(config.hospital_id, interval);
    }, delay);
  }

  console.log(`Polling started for ${numHospitals} hospitals (stagger: ${staggerMs}ms)`);
}

export function stopPolling(): void {
  for (const [, interval] of pollingIntervals) {
    clearInterval(interval);
  }
  pollingIntervals.clear();
  console.log('Polling stopped');
}

// --- ANC Sync (Pregnancy Stage) ---

export async function syncAncData(
  db: DatabaseAdapter,
  hospitalId: string,
  ancPatients: HosxpPersonAncRow[],
  ancServices: HosxpAncServiceRow[],
  ancRisks: HosxpAncRiskRow[],
  ancClassifying: HosxpAncClassifyingRow[],
  encryptionKey: string,
): Promise<number> {
  let count = 0;

  for (const anc of ancPatients) {
    const fullName = `${anc.pname}${anc.fname} ${anc.lname}`.trim();
    const encryptedName = encrypt(fullName, encryptionKey);
    const cidHash = anc.cid
      ? createHash('sha256').update(anc.cid).digest('hex')
      : null;
    const encryptedCid = anc.cid ? encrypt(anc.cid, encryptionKey) : null;
    const age = calculateAge(anc.birthday);

    // Find or create journey
    let journey = await getJourneyByHn(db, anc.hn, hospitalId);
    if (!journey) {
      journey = await createJourney(db, {
        hospitalId,
        hn: anc.hn,
        personAncId: anc.person_anc_id,
        name: encryptedName,
        cid: encryptedCid,
        cidHash,
        age,
        gravida: anc.preg_no,
        para: 0,
        lmp: anc.lmp,
        edc: anc.edc,
        ancRiskLevel: AncRiskLevel.LOW,
      });
    } else {
      // Update existing journey with latest data
      const now = new Date().toISOString();
      await db.execute(
        `UPDATE maternal_journeys SET name = ?, cid = ?, cid_hash = ?, age = ?, lmp = ?, edc = ?, person_anc_id = ?, synced_at = ?, updated_at = ? WHERE id = ?`,
        [encryptedName, encryptedCid, cidHash, age, anc.lmp, anc.edc, anc.person_anc_id, now, now, journey.id],
      );
    }

    // Sync ANC visits
    const visits = ancServices.filter((s) => s.person_anc_id === anc.person_anc_id);
    for (const visit of visits) {
      await upsertAncVisit(db, journey.id, visit);
    }

    // Update visit count on journey
    const now = new Date().toISOString();
    const lastVisit = visits.length > 0
      ? visits.sort((a, b) => a.service_date.localeCompare(b.service_date)).at(-1)
      : null;
    await db.execute(
      `UPDATE maternal_journeys SET anc_visit_count = ?, last_anc_date = ?, updated_at = ? WHERE id = ?`,
      [visits.length, lastVisit?.service_date ?? null, now, journey.id],
    );

    // Evaluate ANC risk
    const patientRisks = ancRisks.filter((r) => r.person_anc_id === anc.person_anc_id);
    const patientClassifying = ancClassifying.filter((c) => c.person_anc_id === anc.person_anc_id);
    const latestVisit = lastVisit;

    // Get height from first ANC visit with opdscreen data
    const firstVisitWithHeight = visits.find((v) => v.height != null);
    const heightCm = firstVisitWithHeight?.height ?? 160;

    // Get weight from first visit for pre-pregnancy BMI
    const firstVisitWeight = visits.find((v) => v.bw != null)?.bw;
    const prePregnancyBmi = (firstVisitWeight && heightCm > 0)
      ? (firstVisitWeight / ((heightCm / 100) ** 2))
      : 22;

    // Derive lab boolean flags from HOSxP risk IDs
    const labFlags = {
      rhNegative: false,
      hbsAgPositive: false,
      syphilisPositive: false,
      hivPositive: false,
      thalassemiaDisease: false,
      niptHighRisk: false,
    };
    for (const riskId of patientRisks.map((r) => r.anc_risk_id)) {
      const flagKey = HOSXP_RISK_TO_LAB_FLAGS[riskId];
      if (flagKey) {
        labFlags[flagKey] = true;
      }
    }

    const riskInput: AncRiskInput = {
      age,
      heightCm,
      prePregnancyBmi,
      gravida: anc.preg_no,
      bpSystolic: latestVisit?.bps ?? 120,
      bpDiastolic: latestVisit?.bpd ?? 80,
      o2Sat: 98, // Not available in standard ANC data
      hct: 36,   // Would need lab query — use default for now
      hb: 12,    // Would need lab query — use default for now
      hosxpRiskIds: patientRisks.map((r) => r.anc_risk_id),
      classifyingItems: patientClassifying.map((c) => ({
        itemId: c.person_anc_classifying_item_id,
        value: c.check_value,
      })),
      ...labFlags,
    };

    const riskResult = evaluateAncRisk(riskInput);

    // Save risk assessment
    await upsertAncRisk(db, journey.id, riskResult, riskInput);

    // Update journey risk level
    await db.execute(
      `UPDATE maternal_journeys SET anc_risk_level = ?, updated_at = ? WHERE id = ?`,
      [riskResult.level, now, journey.id],
    );

    count++;
  }

  return count;
}

async function upsertAncVisit(
  db: DatabaseAdapter,
  journeyId: string,
  visit: HosxpAncServiceRow,
): Promise<void> {
  const now = new Date().toISOString();
  const existing = await db.query<{ id: string }>(
    `SELECT id FROM cached_anc_visits WHERE journey_id = ? AND visit_date = ?`,
    [journeyId, visit.service_date],
  );

  if (existing.length > 0) {
    await db.execute(
      `UPDATE cached_anc_visits SET visit_number = ?, ga_weeks = ?, ga_days = ?,
       fundal_height_cm = ?, weight_kg = ?, bp_systolic = ?, bp_diastolic = ?,
       fetal_hr = ?, presentation = ?, engagement = ?, pass_quality = ?,
       provider_code = ?, synced_at = ? WHERE id = ?`,
      [visit.anc_service_number, visit.pa_week, visit.pa_day,
       visit.fundal_height, visit.bw, visit.bps, visit.bpd,
       visit.fetal_heart_rate, visit.baby_position, visit.baby_lead,
       visit.pass_quality === 'Y' ? 1 : 0, visit.doctor_code, now,
       existing[0].id],
    );
  } else {
    await db.execute(
      `INSERT INTO cached_anc_visits (id, journey_id, visit_date, visit_number, ga_weeks, ga_days,
       fundal_height_cm, weight_kg, bp_systolic, bp_diastolic, fetal_hr,
       presentation, engagement, pass_quality, provider_code, synced_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [uuidv4(), journeyId, visit.service_date, visit.anc_service_number,
       visit.pa_week, visit.pa_day, visit.fundal_height, visit.bw,
       visit.bps, visit.bpd, visit.fetal_heart_rate,
       visit.baby_position, visit.baby_lead,
       visit.pass_quality === 'Y' ? 1 : 0, visit.doctor_code, now, now],
    );
  }
}

async function upsertAncRisk(
  db: DatabaseAdapter,
  journeyId: string,
  riskResult: { level: AncRiskLevel; triggeredRules: string[]; recommendation: { facilityTh: string; providerTh: string } },
  _riskInput: AncRiskInput,
): Promise<void> {
  const now = new Date().toISOString();
  await db.execute(
    `INSERT INTO cached_anc_risks (id, journey_id, risk_level, triggered_rules, risk_factors,
     recommended_facility, recommended_provider, screened_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [uuidv4(), journeyId, riskResult.level,
     JSON.stringify(riskResult.triggeredRules), JSON.stringify({}),
     riskResult.recommendation.facilityTh, riskResult.recommendation.providerTh,
     now, now],
  );
}

// --- Journey-Labor Linking ---

export async function linkJourneyToLabor(
  db: DatabaseAdapter,
  hospitalId: string,
  patientHn: string,
  cachedPatientId: string,
): Promise<string> {
  let journey = await getJourneyByHn(db, patientHn, hospitalId);

  if (journey) {
    // Link and transition
    await db.execute(
      `UPDATE cached_patients SET journey_id = ? WHERE id = ?`,
      [journey.id, cachedPatientId],
    );
    if (journey.careStage === 'PREGNANCY') {
      await transitionToLabor(db, journey.id);
    }
    return journey.id;
  }

  // Auto-create journey for walk-in labor
  journey = await createJourney(db, {
    hospitalId,
    hn: patientHn,
    personAncId: null,
    name: '',
    cid: null,
    cidHash: null,
    age: 0,
    gravida: 0,
    para: 0,
    lmp: null,
    edc: null,
    ancRiskLevel: AncRiskLevel.LOW,
  });

  // Immediately transition to LABOR
  await transitionToLabor(db, journey.id);

  await db.execute(
    `UPDATE cached_patients SET journey_id = ? WHERE id = ?`,
    [journey.id, cachedPatientId],
  );

  return journey.id;
}

// --- Newborn Sync ---

export async function syncNewbornData(
  db: DatabaseAdapter,
  journeyId: string,
  infantRows: HosxpLabourInfantRow[],
): Promise<number> {
  let count = 0;

  for (const infant of infantRows) {
    const bornAt = infant.birth_date && infant.birth_time
      ? `${infant.birth_date}T${infant.birth_time}`
      : infant.birth_date ?? new Date().toISOString();

    await upsertNewborn(db, {
      journeyId,
      infantNumber: infant.infant_number,
      sex: infant.sex ?? undefined,
      birthWeightG: infant.birth_weight ?? undefined,
      bodyLengthCm: infant.body_length ?? undefined,
      headCircumCm: infant.head_length ?? undefined,
      temperature: infant.temperature ?? undefined,
      heartRate: infant.hr ?? undefined,
      respiratoryRate: infant.rr ?? undefined,
      apgar1min: infant.apgar_score_min1 ?? undefined,
      apgar5min: infant.apgar_score_min5 ?? undefined,
      apgar10min: infant.apgar_score_min10 ?? undefined,
      resuscitation: {
        ppv: infant.infant_check_ppv === 'Y',
        et_tube: infant.infant_check_et_tube === 'Y',
        chest_pump: infant.infant_check_chest_pump === 'Y',
        oxygen_box: infant.infant_check_oxygen_box === 'Y',
        narcan: infant.infant_check_narcan === 'Y',
      },
      vaccinations: {
        bcg: infant.infant_check_bcg === 'Y',
        hepb: infant.infant_check_hepb === 'Y',
        vitk: infant.infant_check_vitk === 'Y',
        eye_paste: infant.infant_check_eyepaste === 'Y',
        azt: infant.infant_check_azt === 'Y',
      },
      infantIcd10: infant.infant_icd10 ?? undefined,
      infantHn: infant.infant_hn ?? undefined,
      infantAn: infant.infant_an ?? undefined,
      dischargeStatus: infant.infant_dchstts ?? undefined,
      bornAt,
    });
    count++;
  }

  // Transition journey to DELIVERED
  if (infantRows.length > 0) {
    await transitionToDelivered(db, journeyId);
  }

  return count;
}
