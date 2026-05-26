// Polling orchestration — scheduler, sync lock, JWT refresh, immediate sync
import { createHash } from 'crypto';
import type { DatabaseAdapter } from '@/db/adapter';
import { BmsSessionClient } from '@/lib/bms-session';
import { SseManager } from '@/lib/sse';
import { encrypt } from '@/lib/encryption';
import { calculateAge } from '@/lib/utils';
import { getQuery, ACTIVE_LABOR_PATIENTS, PARTOGRAPH_OBSERVATIONS } from '@/config/hosxp-queries';
import type { DatabaseDialect } from '@/config/hosxp-queries';
import {
  upsertCachedPatients,
  detectChanges,
  detectTransfers,
  markPatientsDelivered,
  type SyncPatientData,
} from './patient';
import { upsertPartographObservations, type PartographRow } from './partograph';
import { calculateAndStoreCpdScores } from './cpd-persist';
import { syncAncData } from './anc';
import { logger } from '@/lib/logger';
import { APP_IDENTIFIER } from '@/lib/bms-browser-client';
import { decryptSafe } from '@/lib/encryption';
import { isValidThaiCidChecksum } from '@/lib/cid';
import {
  startSyncRun,
  appendSyncStep,
  finalizeSyncRun,
  recordSkippedSyncRun,
  type SyncRunTrigger,
} from './progress-store';
import type {
  HosxpAncClassifyingRow,
  HosxpAncRiskRow,
  HosxpAncServiceRow,
  HosxpPatientAddressRow,
  HosxpPersonAncRow,
} from '@/types/hosxp';

const pollingIntervals: Map<string, ReturnType<typeof setInterval>> = new Map();

// ─── Intelligent Sync Lock Manager ───
// Prevents concurrent pulls for the same hospital and enforces cooldown periods.

interface SyncState {
  inProgress: boolean;
  syncStartedAt: number;
  lastSyncAt: number;
  lastJwtRefreshAt: number;
}

const syncStates: Map<string, SyncState> = new Map();
const SYNC_COOLDOWN_MS = 10_000;
const SYNC_TIMEOUT_MS = 60_000; // Force-release lock if sync runs longer than this

// Exported so tests can verify the auto-release timeout behavior directly.
// Production callers use this through requestImmediateSync(); tests need it
// to set up "stuck lock" scenarios without actually executing a real sync.
export function getSyncState(hospitalId: string): SyncState {
  let state = syncStates.get(hospitalId);
  if (!state) {
    state = { inProgress: false, syncStartedAt: 0, lastSyncAt: 0, lastJwtRefreshAt: 0 };
    syncStates.set(hospitalId, state);
  }
  // Auto-release stuck locks (e.g. process crashed or HOSxP request hung)
  if (state.inProgress && Date.now() - state.syncStartedAt > SYNC_TIMEOUT_MS) {
    console.warn(
      `[SYNC] Force-releasing stuck sync lock for hospital ${hospitalId} after ${SYNC_TIMEOUT_MS}ms`,
    );
    state.inProgress = false;
  }
  return state;
}

// Test-only: clear the module-level sync state map between tests so they
// don't pollute each other. Underscore-prefixed to discourage prod use.
export function _resetSyncStatesForTesting(): void {
  syncStates.clear();
}

// ─── Authenticity gate ───
// HOSxP returns randomized CID/HN values when the marketplace_token isn't
// supplied (or is invalid). The polling worker fingerprints the upstream by
// re-looking-up the first row's CID — if it doesn't round-trip, the data is
// junk and the cycle is aborted before any writes touch cached_patients.
//
// Verdict is persisted on hospital_bms_config so the admin UI can flag the
// hospital and the next cycle can short-circuit during the cooldown window.

const AUTHENTICITY_COOLDOWN_MS = 60 * 60 * 1000; // 1h after a transient failure
const AUTHENTICITY_FAILURE_STATUSES = new Set([
  'cid_unstable',
  'hn_unstable',
  'cid_invalid_checksum',
  'no_id_field',
  'probe_failed',
  'missing_marketplace_token',
  // Browser-poll's name round-trip probe: old HOSxP API servers return
  // anonymised display PII (fname/lname) while keeping CID stable, so the
  // CID probe alone misses them. See src/lib/browser-poll.ts.
  'name_unstable',
]);
// Permanent suspension — only cleared by an explicit admin re-onboard
// (POST /api/onboarding/hosxp-sync with confirmReonboard=true). Time-based
// cooldown does NOT apply here; the row stays suspended forever otherwise.
const PERMANENT_SKIP_STATUSES = new Set(['purged_pending_reonboard']);

function isAuthenticityFailureStatus(status: string | null | undefined): boolean {
  return Boolean(
    status && (AUTHENTICITY_FAILURE_STATUSES.has(status) || PERMANENT_SKIP_STATUSES.has(status)),
  );
}

function isWithinAuthenticityCooldown(
  checkedAt: string | null | undefined,
  status: string | null | undefined = null,
): boolean {
  if (status && PERMANENT_SKIP_STATUSES.has(status)) return true;
  if (!checkedAt) return false;
  const t = new Date(checkedAt).getTime();
  if (!Number.isFinite(t)) return false;
  return Date.now() - t < AUTHENTICITY_COOLDOWN_MS;
}

export type AuthenticityVerdict =
  | 'authentic'
  | 'cid_unstable'
  | 'hn_unstable'
  | 'cid_invalid_checksum'
  | 'no_id_field'
  | 'probe_failed'
  | 'missing_marketplace_token'
  | 'name_unstable'
  | 'no_data';

export async function recordAuthenticityVerdict(
  db: DatabaseAdapter,
  hospitalId: string,
  status: AuthenticityVerdict,
  reason: string | null,
): Promise<void> {
  const now = new Date().toISOString();
  await db.execute(
    `UPDATE hospital_bms_config
     SET last_authenticity_check_at = ?, last_authenticity_status = ?,
         last_authenticity_reason = ?, updated_at = ?
     WHERE hospital_id = ?`,
    [now, status, reason, now, hospitalId],
  );
}

// Whitelist of characters allowed in a CID/HN before we inline it into the
// probe SQL. Real Thai CIDs are 13 digits; HNs are short alphanumeric. Anything
// outside this set is either an encrypted blob (which we want to reject) or
// unsafe to interpolate — both reasons to skip rather than escape.
const SAFE_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

type AuthenticityFailureStatus =
  | 'cid_unstable'
  | 'hn_unstable'
  | 'cid_invalid_checksum'
  | 'no_id_field'
  | 'probe_failed';

class HospitalDataUnauthenticError extends Error {
  status: AuthenticityFailureStatus;
  constructor(status: AuthenticityFailureStatus) {
    super(`Hospital sync aborted — authenticity status=${status}`);
    this.name = 'HospitalDataUnauthenticError';
    this.status = status;
  }
}

async function fingerprintFirstRow(
  client: BmsSessionClient,
  bmsUrl: string,
  jwt: string,
  marketplaceToken: string | null | undefined,
  firstRow: Record<string, unknown>,
): Promise<
  | { ok: true; idField: 'cid' | 'hn'; idValue: string }
  | { ok: false; status: AuthenticityFailureStatus; detail: string }
> {
  const queryOptions = {
    appIdentifier: APP_IDENTIFIER,
    marketplaceToken: marketplaceToken ?? null,
  };
  const rawCid = typeof firstRow.cid === 'string' ? firstRow.cid.trim() : '';
  const rawHn = typeof firstRow.hn === 'string' ? firstRow.hn.trim() : '';

  if (rawCid && SAFE_ID_RE.test(rawCid)) {
    try {
      const r = await client.executeQuery(
        `SELECT 1 AS one FROM patient WHERE cid = '${rawCid}' LIMIT 1`,
        bmsUrl,
        jwt,
        undefined,
        queryOptions,
      );
      if (r.data.length === 0) {
        return { ok: false, status: 'cid_unstable', detail: `cid=${rawCid} did not round-trip` };
      }
      // Round-trip alone isn't enough: some old HOSxP builds return values
      // that are 13 digits but checksum-invalid (the "13-digit-but-fake"
      // pattern observed at hcode 10996). Those CIDs ARE persisted in the
      // upstream `patient` table — so the round-trip succeeds — yet they're
      // garbage from KK-LRMS's perspective (cidHash never collides with the
      // real person, transfer detection breaks). Reject the cycle here so
      // the data never lands in cached_patients / maternal_journeys.
      if (!isValidThaiCidChecksum(rawCid)) {
        return {
          ok: false,
          status: 'cid_invalid_checksum',
          detail: `cid=${rawCid} round-trips but fails the Thai national-ID checksum`,
        };
      }
      return { ok: true, idField: 'cid', idValue: rawCid };
    } catch (error) {
      return { ok: false, status: 'probe_failed', detail: errorMessage(error) };
    }
  }

  if (rawHn && SAFE_ID_RE.test(rawHn)) {
    try {
      const r = await client.executeQuery(
        `SELECT 1 AS one FROM patient WHERE hn = '${rawHn}' LIMIT 1`,
        bmsUrl,
        jwt,
        undefined,
        queryOptions,
      );
      if (r.data.length === 0) {
        return { ok: false, status: 'hn_unstable', detail: `hn=${rawHn} did not round-trip` };
      }
      return { ok: true, idField: 'hn', idValue: rawHn };
    } catch (error) {
      return { ok: false, status: 'probe_failed', detail: errorMessage(error) };
    }
  }

  return {
    ok: false,
    status: 'no_id_field',
    detail: `first row had no usable cid/hn (cid=${JSON.stringify(rawCid)}, hn=${JSON.stringify(rawHn)})`,
  };
}

export interface ImmediateSyncResult {
  synced: boolean;
  reason: 'ok' | 'cooldown' | 'in_progress' | 'no_config' | 'error';
  lastSyncAt: string | null;
  patientsCount?: number;
}

type ImmediateSyncJobStatus = 'idle' | 'queued' | 'running' | 'completed' | 'failed';

interface ImmediateSyncJobState {
  hospitalId: string;
  status: ImmediateSyncJobStatus;
  requestedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  result: ImmediateSyncResult | null;
  error: string | null;
  promise: Promise<void> | null;
}

export interface ImmediateSyncJobSnapshot {
  hospitalId: string;
  status: ImmediateSyncJobStatus;
  running: boolean;
  requestedAt: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  result: ImmediateSyncResult | null;
  error: string | null;
}

const syncJobGlobal = globalThis as unknown as {
  __kkLrmsImmediateSyncJobs?: Map<string, ImmediateSyncJobState>;
};
const immediateSyncJobs =
  syncJobGlobal.__kkLrmsImmediateSyncJobs ?? new Map<string, ImmediateSyncJobState>();
syncJobGlobal.__kkLrmsImmediateSyncJobs = immediateSyncJobs;

function snapshotImmediateSyncJob(
  state: ImmediateSyncJobState | undefined,
  hospitalId: string,
): ImmediateSyncJobSnapshot {
  if (!state) {
    return {
      hospitalId,
      status: 'idle',
      running: false,
      requestedAt: null,
      startedAt: null,
      finishedAt: null,
      result: null,
      error: null,
    };
  }

  return {
    hospitalId,
    status: state.status,
    running: state.status === 'queued' || state.status === 'running',
    requestedAt: state.requestedAt,
    startedAt: state.startedAt,
    finishedAt: state.finishedAt,
    result: state.result,
    error: state.error,
  };
}

export function getImmediateSyncJobStatus(hospitalId: string): ImmediateSyncJobSnapshot {
  return snapshotImmediateSyncJob(immediateSyncJobs.get(hospitalId), hospitalId);
}

export function startImmediateSyncJob(
  db: DatabaseAdapter,
  hospitalId: string,
  sseManager: SseManager,
): ImmediateSyncJobSnapshot {
  const existing = immediateSyncJobs.get(hospitalId);
  if (existing && (existing.status === 'queued' || existing.status === 'running')) {
    return snapshotImmediateSyncJob(existing, hospitalId);
  }

  const state: ImmediateSyncJobState = {
    hospitalId,
    status: 'queued',
    requestedAt: new Date().toISOString(),
    startedAt: null,
    finishedAt: null,
    result: null,
    error: null,
    promise: null,
  };
  immediateSyncJobs.set(hospitalId, state);

  state.promise = Promise.resolve()
    .then(async () => {
      state.status = 'running';
      state.startedAt = new Date().toISOString();
      const result = await requestImmediateSync(db, hospitalId, sseManager);
      state.result = result;
      state.status = result.reason === 'error' ? 'failed' : 'completed';
      state.finishedAt = new Date().toISOString();
      state.error = result.reason === 'error' ? 'sync failed' : null;
      sseManager.broadcast('sync-status', snapshotImmediateSyncJob(state, hospitalId));
    })
    .catch((error) => {
      state.status = 'failed';
      state.finishedAt = new Date().toISOString();
      state.error = errorMessage(error);
      logger.error('immediate_sync_job_failed', { hospitalId, error });
      sseManager.broadcast('sync-status', snapshotImmediateSyncJob(state, hospitalId));
    })
    .finally(() => {
      state.promise = null;
    });

  return snapshotImmediateSyncJob(state, hospitalId);
}

export interface PollHospitalOptions {
  marketplaceToken?: string | null;
  onStep?: (step: PollHospitalStep) => void;
  /** What kicked off this poll cycle. Recorded with the progress run so
   *  admins can tell scheduled background polls from immediate user-clicks
   *  and onboarding heartbeats. Defaults to 'scheduled'. */
  trigger?: SyncRunTrigger;
}

export type PollHospitalStepStatus = 'running' | 'success' | 'warning' | 'error' | 'info';

export interface PollHospitalStep {
  name: string;
  status: PollHospitalStepStatus;
  message: string;
  detail?: string;
  counts?: Record<string, number>;
}

export interface AncSyncStats {
  attempted: boolean;
  sourcePatientsRead: number;
  sourcePatientsMapped: number;
  servicesRead: number;
  servicesMapped: number;
  risksRead: number;
  risksMapped: number;
  classifyingRead: number;
  classifyingMapped: number;
  addressesRead: number;
  addressesMapped: number;
  patientsSynced: number;
  skippedReason: string | null;
  error: string | null;
}

export interface PollHospitalStats {
  activePatientsRead: number;
  activePatientsSynced: number;
  partographRowsRead: number;
  partographRowsUpserted: number;
  // Count of cached_patients rows auto-closed from ACTIVE to DISCHARGED
  // this cycle because HOSxP no longer returned them (confirm_discharge=Y).
  dischargedClosedOut?: number;
  anc: AncSyncStats;
}

function emptyAncSyncStats(): AncSyncStats {
  return {
    attempted: false,
    sourcePatientsRead: 0,
    sourcePatientsMapped: 0,
    servicesRead: 0,
    servicesMapped: 0,
    risksRead: 0,
    risksMapped: 0,
    classifyingRead: 0,
    classifyingMapped: 0,
    addressesRead: 0,
    addressesMapped: 0,
    patientsSynced: 0,
    skippedReason: null,
    error: null,
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function emitStep(options: PollHospitalOptions, step: PollHospitalStep): void {
  options.onStep?.(step);
}

function stringOrNull(value: unknown): string | null {
  if (value == null) return null;
  const s = String(value).trim();
  return s.length > 0 ? s : null;
}

function numberOrNull(value: unknown): number | null {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function intOrNull(value: unknown): number | null {
  const n = numberOrNull(value);
  return n == null ? null : Math.round(n);
}

function isValidCid13(value: string | null): value is string {
  return value != null && /^\d{13}$/.test(value);
}

function combineHosxpDateTime(dateValue: unknown, timeValue: unknown): string {
  const date = stringOrNull(dateValue);
  const time = stringOrNull(timeValue) ?? '00:00:00';
  if (!date) return new Date().toISOString();
  if (date.includes('T')) return date;
  return `${date}T${time}`;
}

function sqlDateDaysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

function activeAncWhereClause(): string {
  const postpartumCutoff = sqlDateDaysAgo(45);
  const lmpCutoff = sqlDateDaysAgo(330);
  // Keep this compatible with older HOSxP schemas. The Delphi webhook reads
  // person_anc by person_anc_id and does not depend on pa.anc_register_date;
  // several sites do not have that column. Active batch sync therefore uses
  // HOSxP's active ANC flags AND an EDC/LMP date window, so stale unfinished
  // records from old years do not appear as active pregnancies.
  return `(COALESCE(pa.discharge, 'N') <> 'Y'
      AND pa.labor_status_id = 1
      AND (
        (pa.edc IS NOT NULL AND pa.edc >= '${postpartumCutoff}')
        OR (pa.lmp IS NOT NULL AND pa.lmp >= '${lmpCutoff}')
      ))`;
}

function activeAncIdSubquery(): string {
  return `SELECT pa.person_anc_id FROM person_anc pa WHERE ${activeAncWhereClause()}`;
}

function activeAncPatientsSql(): string {
  return `
    SELECT pa.person_anc_id, pa.person_id,
           COALESCE(pt.hn, pe.cid, CONCAT('ANC', pa.person_anc_id)) AS hn,
           pe.pname, pe.fname, pe.lname, pe.cid,
           pe.birthdate AS birthday,
           pa.preg_no, pa.lmp, pa.edc,
           COALESCE(pa.lmp, pa.edc) AS anc_register_date
      FROM person_anc pa
      INNER JOIN person pe ON pe.person_id = pa.person_id
      LEFT JOIN (
        SELECT cid, MIN(hn) AS hn, MIN(chwpart) AS chwpart, MIN(amppart) AS amppart, MIN(tmbpart) AS tmbpart
          FROM patient
         WHERE LENGTH(cid) = 13
         GROUP BY cid
      ) pt ON pt.cid = pe.cid AND LENGTH(pe.cid) = 13
     WHERE ${activeAncWhereClause()}
     ORDER BY pa.person_anc_id DESC
     LIMIT 500`;
}

function activeAncServicesSql(): string {
  return `
    SELECT s.person_anc_service_id, s.person_anc_id,
           s.anc_service_date AS service_date,
           s.anc_service_number,
           s.pa_week, s.pa_day,
           NULL AS fundal_height, sc.bw, sc.bps, sc.bpd, sc.height,
           sc.baby_fetal_heart_sound AS fetal_heart_rate,
           bp.anc_baby_position_name AS baby_position,
           bl.anc_baby_lead_name AS baby_lead,
           s.pass_quality, NULL AS doctor_code
      FROM person_anc_service s
      LEFT JOIN person_anc_screen sc ON sc.person_anc_service_id = s.person_anc_service_id
      LEFT JOIN anc_baby_position bp ON bp.anc_baby_position_id = sc.anc_baby_position_id
      LEFT JOIN anc_baby_lead bl ON bl.anc_baby_lead_id = sc.anc_baby_lead_id
     WHERE s.person_anc_id IN (${activeAncIdSubquery()})
     ORDER BY s.person_anc_id, s.anc_service_number`;
}

function activeAncRisksSql(): string {
  return `
    SELECT par.anc_risk_id AS person_anc_risk_id, par.person_anc_id, par.anc_risk_id
      FROM person_anc_risk par
     WHERE par.person_anc_id IN (${activeAncIdSubquery()})`;
}

function activeAncClassifyingSql(): string {
  return `
    SELECT pac.person_anc_classifying_item_id AS person_anc_classifying_id, pac.person_anc_id,
           pac.person_anc_classifying_item_id, pac.check_value
      FROM person_anc_classifying pac
     WHERE pac.person_anc_id IN (${activeAncIdSubquery()})`;
}

function activeAncAddressesSql(): string {
  return `
    SELECT COALESCE(pt.hn, pe.cid, CONCAT('ANC', pa.person_anc_id)) AS hn,
           pt.chwpart, pt.amppart, pt.tmbpart
      FROM person_anc pa
      INNER JOIN person pe ON pe.person_id = pa.person_id
      LEFT JOIN (
        SELECT cid, MIN(hn) AS hn, MIN(chwpart) AS chwpart, MIN(amppart) AS amppart, MIN(tmbpart) AS tmbpart
          FROM patient
         WHERE LENGTH(cid) = 13
         GROUP BY cid
      ) pt ON pt.cid = pe.cid AND LENGTH(pe.cid) = 13
     WHERE ${activeAncWhereClause()}`;
}

function mapAncPatient(row: Record<string, unknown>): HosxpPersonAncRow | null {
  const personAncId = intOrNull(row.person_anc_id);
  const personId = intOrNull(row.person_id);
  const hn = stringOrNull(row.hn);
  if (personAncId == null || personId == null || !hn) return null;

  return {
    person_anc_id: personAncId,
    person_id: personId,
    hn,
    pname: stringOrNull(row.pname) ?? '',
    fname: stringOrNull(row.fname) ?? '',
    lname: stringOrNull(row.lname) ?? '',
    cid: stringOrNull(row.cid) ?? '',
    birthday: stringOrNull(row.birthday) ?? '',
    preg_no: intOrNull(row.preg_no) ?? 0,
    lmp: stringOrNull(row.lmp),
    edc: stringOrNull(row.edc),
    anc_register_date: stringOrNull(row.anc_register_date) ?? '',
  };
}

function mapAncService(row: Record<string, unknown>): HosxpAncServiceRow | null {
  const personAncServiceId = intOrNull(row.person_anc_service_id);
  const personAncId = intOrNull(row.person_anc_id);
  const serviceDate = stringOrNull(row.service_date);
  if (personAncServiceId == null || personAncId == null || !serviceDate) return null;

  return {
    person_anc_service_id: personAncServiceId,
    person_anc_id: personAncId,
    service_date: serviceDate,
    anc_service_number: intOrNull(row.anc_service_number) ?? 0,
    pa_week: intOrNull(row.pa_week),
    pa_day: intOrNull(row.pa_day),
    fundal_height: numberOrNull(row.fundal_height),
    bw: numberOrNull(row.bw),
    bps: intOrNull(row.bps),
    bpd: intOrNull(row.bpd),
    height: numberOrNull(row.height),
    fetal_heart_rate: intOrNull(row.fetal_heart_rate),
    baby_position: stringOrNull(row.baby_position),
    baby_lead: stringOrNull(row.baby_lead),
    pass_quality: stringOrNull(row.pass_quality),
    doctor_code: stringOrNull(row.doctor_code),
  };
}

function mapAncRisk(row: Record<string, unknown>): HosxpAncRiskRow | null {
  const riskId = intOrNull(row.person_anc_risk_id);
  const personAncId = intOrNull(row.person_anc_id);
  const ancRiskId = intOrNull(row.anc_risk_id);
  if (riskId == null || personAncId == null || ancRiskId == null) return null;
  return { person_anc_risk_id: riskId, person_anc_id: personAncId, anc_risk_id: ancRiskId };
}

function mapAncClassifying(row: Record<string, unknown>): HosxpAncClassifyingRow | null {
  const id = intOrNull(row.person_anc_classifying_id);
  const personAncId = intOrNull(row.person_anc_id);
  const itemId = intOrNull(row.person_anc_classifying_item_id);
  if (id == null || personAncId == null || itemId == null) return null;
  return {
    person_anc_classifying_id: id,
    person_anc_id: personAncId,
    person_anc_classifying_item_id: itemId,
    check_value: stringOrNull(row.check_value) ?? '',
  };
}

function mapAncAddress(row: Record<string, unknown>): HosxpPatientAddressRow | null {
  const hn = stringOrNull(row.hn);
  if (!hn) return null;
  return {
    hn,
    chwpart: stringOrNull(row.chwpart),
    amppart: stringOrNull(row.amppart),
    tmbpart: stringOrNull(row.tmbpart),
  };
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

  if (now - state.lastSyncAt < SYNC_COOLDOWN_MS) {
    return {
      synced: false,
      reason: 'cooldown',
      lastSyncAt: new Date(state.lastSyncAt).toISOString(),
    };
  }

  if (state.inProgress) {
    return {
      synced: false,
      reason: 'in_progress',
      lastSyncAt: state.lastSyncAt ? new Date(state.lastSyncAt).toISOString() : null,
    };
  }

  const configs = await db.query<{
    tunnel_url: string;
    session_jwt: string | null;
    session_expires_at: string | null;
    database_type: string | null;
    marketplace_token: string | null;
    last_authenticity_status: string | null;
    last_authenticity_check_at: string | null;
    hcode: string;
  }>(
    `SELECT hbc.tunnel_url, hbc.session_jwt, hbc.session_expires_at,
            hbc.database_type, hbc.marketplace_token,
            hbc.last_authenticity_status, hbc.last_authenticity_check_at,
            h.hcode
     FROM hospital_bms_config hbc
     JOIN hospitals h ON h.id = hbc.hospital_id
     WHERE hbc.hospital_id = ?`,
    [hospitalId],
  );

  if (configs.length === 0) {
    return { synced: false, reason: 'no_config', lastSyncAt: null };
  }

  const config = configs[0];

  // Suppress polling for hospitals that recently failed the authenticity probe
  // — we'd just re-fetch corrupt data otherwise. Re-onboarding clears this by
  // updating last_authenticity_check_at via a fresh probe.
  if (
    isAuthenticityFailureStatus(config.last_authenticity_status) &&
    isWithinAuthenticityCooldown(config.last_authenticity_check_at, config.last_authenticity_status)
  ) {
    logger.info('immediate_sync_skipped_authenticity_cooldown', {
      hospitalId,
      status: config.last_authenticity_status,
      checkedAt: config.last_authenticity_check_at,
    });
    void recordSkippedSyncRun(
      hospitalId,
      config.hcode,
      'immediate',
      config.last_authenticity_status ?? 'authenticity_cooldown',
      'Sync ถูกระงับ — รอ cooldown หลังตรวจสอบความถูกต้องไม่ผ่าน',
    );
    return { synced: false, reason: 'no_config', lastSyncAt: null };
  }

  state.inProgress = true;
  state.syncStartedAt = Date.now();

  try {
    const encryptionKey = process.env.ENCRYPTION_KEY ?? '';
    const validateUrl = process.env.BMS_VALIDATE_URL ?? 'https://hosxp.net/phapi/PasteJSON';
    let jwt = config.session_jwt;
    let bmsUrl = config.tunnel_url;
    let dbType = (config.database_type ?? 'postgresql') as DatabaseDialect;

    const jwtExpired = config.session_expires_at
      ? new Date(config.session_expires_at).getTime() < now
      : !jwt;

    if (!jwt || jwtExpired) {
      try {
        const client = new BmsSessionClient(config.tunnel_url);
        const sessionId = await client.getSessionId();
        const sessionConfig = await client.validateSession(sessionId, validateUrl);
        jwt = sessionConfig.jwt;
        bmsUrl = sessionConfig.bmsUrl;
        dbType = (await client.getDatabaseType(bmsUrl, jwt)) as DatabaseDialect;

        await db.execute(
          'UPDATE hospital_bms_config SET session_jwt = ?, database_type = ?, session_expires_at = ? WHERE hospital_id = ?',
          [jwt, dbType, sessionConfig.expiresAt.toISOString(), hospitalId],
        );
        state.lastJwtRefreshAt = now;
        logger.info('jwt_refreshed', { hospitalId });
      } catch {
        if (!jwt) {
          return { synced: false, reason: 'error', lastSyncAt: null };
        }
      }
    }

    const marketplaceToken = config.marketplace_token ? decryptSafe(config.marketplace_token) : '';

    await pollHospital(
      db,
      hospitalId,
      config.tunnel_url,
      bmsUrl,
      jwt,
      dbType,
      encryptionKey,
      sseManager,
      { marketplaceToken: marketplaceToken || null, trigger: 'immediate' },
    );

    state.lastSyncAt = Date.now();

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
    logger.error('immediate_sync_failed', { hospitalId, error });
    return { synced: false, reason: 'error', lastSyncAt: null };
  } finally {
    state.inProgress = false;
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
  options: PollHospitalOptions = {},
): Promise<PollHospitalStats> {
  const stats: PollHospitalStats = {
    activePatientsRead: 0,
    activePatientsSynced: 0,
    partographRowsRead: 0,
    partographRowsUpserted: 0,
    anc: emptyAncSyncStats(),
  };

  // Lifted from later in the function — we need hcode up front so the
  // progress run can record it (and we save a duplicate query later in the
  // try block by reusing this lookup).
  const hospitalRowsForRun = await db.query<{ hcode: string }>(
    'SELECT hcode FROM hospitals WHERE id = ?',
    [hospitalId],
  );
  const hcode = hospitalRowsForRun[0]?.hcode ?? '';

  // Per-cycle progress run. Steps from emitStep() get appended via the
  // wrapped onStep below. The run is finalized at every exit point —
  // success, authenticity-fail, error, or no-marketplace-token short-circuit.
  const trigger: SyncRunTrigger = options.trigger ?? 'scheduled';
  const runId = await startSyncRun(hospitalId, hcode, trigger);
  const callerOnStep = options.onStep;
  let hadWarningStep = false;
  options = {
    ...options,
    onStep: (step) => {
      if (step.status === 'warning' || step.status === 'error') {
        hadWarningStep = true;
      }
      callerOnStep?.(step);
      void appendSyncStep(hospitalId, runId, step);
    },
  };

  try {
    emitStep(options, {
      name: 'connect_client',
      status: 'running',
      message: 'Preparing BMS tunnel SQL client.',
      detail: `databaseType=${databaseType}`,
    });
    const client = new BmsSessionClient(tunnelUrl);
    emitStep(options, {
      name: 'connect_client',
      status: 'success',
      message: 'BMS tunnel SQL client is ready.',
    });

    // Fail fast when the marketplace token is absent — HOSxP would silently
    // randomize CID/HN columns, and the fingerprint probe below would catch
    // it anyway, but the explicit gate spares a wasted round-trip and makes
    // the admin UI message more actionable.
    if (!options.marketplaceToken) {
      await recordAuthenticityVerdict(
        db,
        hospitalId,
        'missing_marketplace_token',
        'hospital_bms_config has no marketplace_token; re-onboard from a real HOSxP launch to capture one',
      );
      logger.warn('sync_skipped_missing_marketplace_token', { hospitalId });
      emitStep(options, {
        name: 'authenticity_check',
        status: 'error',
        message: 'ไม่มี marketplace_token สำหรับโรงพยาบาลนี้ — กรุณา onboard ใหม่จาก HOSxP จริง',
      });
      void finalizeSyncRun(
        hospitalId,
        runId,
        'failed',
        'Sync ระงับ — ไม่มี marketplace_token',
        'missing_marketplace_token',
      );
      return stats;
    }

    const sql = getQuery(ACTIVE_LABOR_PATIENTS, databaseType);
    emitStep(options, {
      name: 'query_active_ipt',
      status: 'running',
      message:
        "Querying HOSxP active admissions where ipt.confirm_discharge = 'N' and ward.is_maternity_ward = 'Y'.",
    });
    const result = await client.executeQuery(sql, bmsUrl, jwt, undefined, {
      appIdentifier: APP_IDENTIFIER,
      marketplaceToken: options.marketplaceToken,
    });
    stats.activePatientsRead = result.data.length;
    emitStep(options, {
      name: 'query_active_ipt',
      status: 'success',
      message: `HOSxP returned ${result.data.length} active IPD rows.`,
      counts: { rows: result.data.length },
    });

    // Authenticity probe — re-look-up the first row's CID/HN. A randomized
    // (per-request) encryption from HOSxP makes this round-trip return zero
    // rows; a real plaintext value returns at least one. We bail with NO
    // writes so corrupt data never reaches cached_patients / cached_referrals.
    if (result.data.length > 0) {
      emitStep(options, {
        name: 'authenticity_check',
        status: 'running',
        message: 'Verifying upstream returned real CID/HN values (round-trip lookup).',
      });
      const firstRow = result.data[0] as Record<string, unknown>;
      const fp = await fingerprintFirstRow(client, bmsUrl, jwt, options.marketplaceToken, firstRow);
      if (!fp.ok) {
        await recordAuthenticityVerdict(db, hospitalId, fp.status, fp.detail);
        logger.warn('sync_aborted_data_unauthentic', {
          hospitalId,
          status: fp.status,
          detail: fp.detail,
        });
        emitStep(options, {
          name: 'authenticity_check',
          status: 'error',
          message: `ข้อมูลที่ได้จาก HOSxP ไม่ผ่านการตรวจสอบ (${fp.status}) — ระงับการ sync จนกว่าจะ onboard ใหม่`,
          detail: fp.detail,
        });
        throw new HospitalDataUnauthenticError(fp.status);
      }
      await recordAuthenticityVerdict(db, hospitalId, 'authentic', null);
      emitStep(options, {
        name: 'authenticity_check',
        status: 'success',
        message: `Authenticity OK (round-trip on ${fp.idField}).`,
      });
    } else {
      // No active patients to fingerprint — neither prove nor disprove. Don't
      // mark unauthentic; just skip recording a positive verdict so the
      // status reflects the last real probe result.
      emitStep(options, {
        name: 'authenticity_check',
        status: 'info',
        message: 'No active labor rows to fingerprint — authenticity unchanged.',
      });
    }

    emitStep(options, {
      name: 'read_local_active_patients',
      status: 'running',
      message: 'Reading existing active cached patients from KK-LRMS.',
    });
    const existing = await db.query<{ an: string }>(
      "SELECT an FROM cached_patients WHERE hospital_id = ? AND labor_status = 'ACTIVE'",
      [hospitalId],
    );
    const existingAns = existing.map((r) => r.an);
    emitStep(options, {
      name: 'read_local_active_patients',
      status: 'success',
      message: `Found ${existingAns.length} active cached patients before sync.`,
      counts: { rows: existingAns.length },
    });

    const patients: SyncPatientData[] = result.data.map((row) => {
      const rawCid = stringOrNull(row.cid);
      const cidForMatch = isValidCid13(rawCid) ? rawCid : null;
      const joinedName = [row.pname, row.fname, row.lname].filter(Boolean).join(' ').trim();
      const fullName = (stringOrNull(row.patient_name) ?? joinedName) || 'ไม่ระบุชื่อ';
      const age = row.birthday ? calculateAge(String(row.birthday)) : 0;
      const weightKg = numberOrNull(row.weight);
      const prePregnancyWeightKg = numberOrNull(row.pre_preg_weight);

      return {
        hn: String(row.hn ?? ''),
        an: String(row.an ?? ''),
        name: encrypt(fullName, encryptionKey),
        cid: cidForMatch ? encrypt(cidForMatch, encryptionKey) : null,
        cidHash: cidForMatch ? createHash('sha256').update(cidForMatch).digest('hex') : null,
        age,
        gravida: intOrNull(row.gravida ?? row.preg_number),
        para: intOrNull(row.para),
        abortion: intOrNull(row.abortion),
        livingChildren: intOrNull(row.living_children),
        pregNo: intOrNull(row.preg_no),
        gaWeeks: intOrNull(row.ga_weeks ?? row.ga),
        gaDay: intOrNull(row.ga_day),
        ancCount: intOrNull(row.anc_count),
        admitDate: combineHosxpDateTime(row.regdate, row.regtime),
        heightCm: intOrNull(row.height),
        weightKg,
        prePregnancyWeightKg,
        hematocritPct: numberOrNull(row.hct),
        bpSystolicAdmit: intOrNull(row.bp_sys_admit),
        bpDiastolicAdmit: intOrNull(row.bp_dia_admit),
        pulseAdmit: intOrNull(row.pulse_admit),
        rrAdmit: intOrNull(row.rr_admit),
        temperatureAdmit: numberOrNull(row.temp_admit),
        cervicalOpenCmAdmit: numberOrNull(row.cervical_open_size),
        effacementPctAdmit: numberOrNull(row.eff),
        stationAdmit: stringOrNull(row.station),
        laborStatus: 'ACTIVE',
        syncedAt: new Date().toISOString(),
      };
    });

    emitStep(options, {
      name: 'persist_ipt',
      status: 'running',
      message: `Mapping and upserting ${patients.length} active IPD rows into cached_patients.`,
      counts: { rows: patients.length },
    });
    const count = await upsertCachedPatients(db, hospitalId, patients);
    stats.activePatientsSynced = count;
    emitStep(options, {
      name: 'persist_ipt',
      status: 'success',
      message: `Upserted ${count} active patient rows.`,
      counts: { rows: count },
    });

    emitStep(options, {
      name: 'detect_transfers',
      status: 'running',
      message: 'Checking cross-hospital transfer candidates by CID hash.',
    });
    const transfers = await detectTransfers(db, hospitalId, patients);
    emitStep(options, {
      name: 'detect_transfers',
      status: transfers.length > 0 ? 'warning' : 'success',
      message:
        transfers.length > 0
          ? `Detected ${transfers.length} possible transfer rows.`
          : 'No transfer rows detected.',
      counts: { transfers: transfers.length },
    });

    // hcode was looked up at function entry and is reused here — the
    // earlier duplicate query was removed when progress recording was
    // added so the value flows through from the run setup.
    for (const transfer of transfers) {
      await db.execute(
        `UPDATE cached_patients SET labor_status = 'TRANSFERRED', updated_at = ?
         WHERE hospital_id = ? AND an = ?`,
        [new Date().toISOString(), transfer.fromHospitalId, transfer.fromAn],
      );

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

    // ─── Auto-discharge: close out ACTIVE patients HOSxP no longer returns ──
    // The HOSxP labor query (hosxp-queries.ts) filters by
    // `i.confirm_discharge = 'N'` — when a patient is discharged in HOSxP
    // they stop being returned. Without this diff step, our local cache
    // leaves them as labor_status='ACTIVE' forever, causing stale rows in
    // the LABOR WARD tab on /hospitals/[hcode] (admit dates 13+ days old).
    //
    // We exclude ANs already marked TRANSFERRED in the previous block so
    // cross-hospital transfers aren't mis-labeled as discharged.
    const currentAns = new Set(patients.map((p) => p.an));
    const transferredAns = new Set(
      transfers.filter((t) => t.fromHospitalId === hospitalId).map((t) => t.fromAn),
    );
    const dischargedAns = existingAns.filter(
      (an) => !currentAns.has(an) && !transferredAns.has(an),
    );
    if (dischargedAns.length > 0) {
      emitStep(options, {
        name: 'auto_discharge',
        status: 'running',
        message: `Closing out ${dischargedAns.length} patients no longer returned by HOSxP (confirm_discharge=Y upstream).`,
        counts: { discharged: dischargedAns.length },
      });
      const now = new Date().toISOString();
      // Per-row UPDATE — volume per cycle is small (typically <10).
      // Guards on labor_status='ACTIVE' so we never overwrite a row that
      // a parallel cycle just transitioned to DELIVERED/TRANSFERRED.
      for (const an of dischargedAns) {
        await db.execute(
          `UPDATE cached_patients
             SET labor_status = 'DISCHARGED', updated_at = ?
           WHERE hospital_id = ? AND an = ? AND labor_status = 'ACTIVE'`,
          [now, hospitalId, an],
        );
        sseManager.broadcast('patient-update', {
          type: 'patient_discharged',
          hcode,
          an,
        });
      }
      stats.dischargedClosedOut = dischargedAns.length;
      emitStep(options, {
        name: 'auto_discharge',
        status: 'success',
        message: `Closed out ${dischargedAns.length} discharged patients.`,
        counts: { discharged: dischargedAns.length },
      });
    } else {
      emitStep(options, {
        name: 'auto_discharge',
        status: 'success',
        message: 'No stale ACTIVE patients to close out — cache matches HOSxP.',
      });
    }

    emitStep(options, {
      name: 'calculate_cpd',
      status: 'running',
      message: 'Calculating CPD risk scores for active patients.',
    });
    await calculateAndStoreCpdScores(db, hospitalId, sseManager);
    emitStep(options, {
      name: 'calculate_cpd',
      status: 'success',
      message: 'CPD risk score calculation completed.',
    });

    // Pull partograph observations for currently-admitted patients.
    // Must run AFTER upsertCachedPatients() so AN -> patient_id lookup works.
    try {
      const partographSql = getQuery(PARTOGRAPH_OBSERVATIONS, databaseType);
      emitStep(options, {
        name: 'query_partograph',
        status: 'running',
        message: 'Querying HOSxP partograph observations for active admissions.',
      });
      const partographResult = await client.executeQuery(partographSql, bmsUrl, jwt, undefined, {
        appIdentifier: APP_IDENTIFIER,
        marketplaceToken: options.marketplaceToken,
      });
      stats.partographRowsRead = partographResult.data.length;
      emitStep(options, {
        name: 'query_partograph',
        status: 'success',
        message: `HOSxP returned ${partographResult.data.length} partograph rows.`,
        counts: { rows: partographResult.data.length },
      });

      if (partographResult.data.length > 0) {
        // Resolve AN -> patient_id once for the batch.
        const ans = Array.from(new Set(partographResult.data.map((r) => String(r.an))));
        const placeholders = ans.map(() => '?').join(',');
        const patientRows = await db.query<{ id: string; an: string }>(
          `SELECT id, an FROM cached_patients
             WHERE hospital_id = ? AND an IN (${placeholders})`,
          [hospitalId, ...ans],
        );
        const patientByAn = new Map(patientRows.map((p) => [p.an, p.id]));

        const rows: PartographRow[] = partographResult.data
          .map((row) => {
            const pid = patientByAn.get(String(row.an));
            if (!pid) return null;
            const r: PartographRow = {
              hospitalId,
              patientId: pid,
              sourceSystem: 'hosxp',
              sourcePk: String(row.ipt_labour_partograph_id),
              observeDatetime: String(row.observe_datetime),
              hourNo: row.hour_no != null ? Number(row.hour_no) : null,
              fetalHeartRate: row.fetal_heart_rate != null ? Number(row.fetal_heart_rate) : null,
              amnioticFluid: (row.amniotic_fluid as string | null) ?? null,
              amnioticTypeId:
                row.labour_amniotic_type_id != null ? Number(row.labour_amniotic_type_id) : null,
              amnioticTypeName: (row.amniotic_type_name as string | null) ?? null,
              moulding: (row.moulding as string | null) ?? null,
              cervicalDilationCm:
                row.cervical_dilation_cm != null ? Number(row.cervical_dilation_cm) : null,
              descentOfHead: (row.descent_of_head as string | null) ?? null,
              contractionPer10Min:
                row.contraction_per_10min != null ? Number(row.contraction_per_10min) : null,
              contractionDurationSec:
                row.contraction_duration_sec != null ? Number(row.contraction_duration_sec) : null,
              contractionStrength: (row.contraction_strength as string | null) ?? null,
              oxytocinUml: row.oxytocin_uml != null ? Number(row.oxytocin_uml) : null,
              oxytocinDropsMin:
                row.oxytocin_drops_min != null ? Number(row.oxytocin_drops_min) : null,
              drugsIvFluids: (row.drugs_iv_fluids as string | null) ?? null,
              pulse: row.pulse != null ? Number(row.pulse) : null,
              bpSystolic: row.bp_systolic != null ? Number(row.bp_systolic) : null,
              bpDiastolic: row.bp_diastolic != null ? Number(row.bp_diastolic) : null,
              temperature: row.temperature != null ? Number(row.temperature) : null,
              urineVolumeMl: row.urine_volume_ml != null ? Number(row.urine_volume_ml) : null,
              urineProtein: (row.urine_protein as string | null) ?? null,
              urineGlucose: (row.urine_glucose as string | null) ?? null,
              urineAcetone: (row.urine_acetone as string | null) ?? null,
              note: (row.note as string | null) ?? null,
              entryStaff: (row.entry_staff as string | null) ?? null,
              entryDatetime: row.entry_datetime != null ? String(row.entry_datetime) : null,
            };
            return r;
          })
          .filter((r): r is PartographRow => r !== null);

        const partographResultStats = await upsertPartographObservations(db, hospitalId, rows);
        stats.partographRowsUpserted = partographResultStats.upserted;
        emitStep(options, {
          name: 'persist_partograph',
          status: 'success',
          message: `Upserted ${partographResultStats.upserted} partograph observations.`,
          counts: {
            upserted: partographResultStats.upserted,
            severityChanges: partographResultStats.severityChanges.length,
          },
        });

        // Broadcast severity transitions only — not every observation.
        for (const sc of partographResultStats.severityChanges) {
          sseManager.broadcast('patient-update', {
            type: 'partograph_severity_changed',
            hcode,
            an: sc.an,
            severity: sc.to,
            alertCount: sc.alertCount,
          });
        }

        logger.info('partograph_sync_complete', {
          hospitalId,
          observationsUpserted: partographResultStats.upserted,
          patientsTouched: rows.length,
          severityChanges: partographResultStats.severityChanges.length,
        });
      }
    } catch (partographError) {
      emitStep(options, {
        name: 'query_partograph',
        status: 'warning',
        message: 'Partograph sync failed, but patient and ANC sync will continue.',
        detail: errorMessage(partographError),
      });
      // Partograph fetch failure should not abort the rest of the polling
      // cycle (patient list, CPD scores, transfers were already persisted).
      logger.error('partograph_sync_failed', {
        hospitalId,
        error: partographError,
      });
    }

    try {
      stats.anc.attempted = true;
      const queryOptions = {
        appIdentifier: APP_IDENTIFIER,
        marketplaceToken: options.marketplaceToken,
      };
      emitStep(options, {
        name: 'query_anc',
        status: 'running',
        message:
          "Querying active ANC from person_anc using discharge <> 'Y' + labor_status_id = 1 + EDC/LMP active date window.",
      });
      const [
        ancPatientsResult,
        ancServicesResult,
        ancRisksResult,
        ancClassifyingResult,
        ancAddressesResult,
      ] = await Promise.all([
        client.executeQuery(activeAncPatientsSql(), bmsUrl, jwt, undefined, queryOptions),
        client.executeQuery(activeAncServicesSql(), bmsUrl, jwt, undefined, queryOptions),
        client.executeQuery(activeAncRisksSql(), bmsUrl, jwt, undefined, queryOptions),
        client.executeQuery(activeAncClassifyingSql(), bmsUrl, jwt, undefined, queryOptions),
        client.executeQuery(activeAncAddressesSql(), bmsUrl, jwt, undefined, queryOptions),
      ]);
      stats.anc.sourcePatientsRead = ancPatientsResult.data.length;
      stats.anc.servicesRead = ancServicesResult.data.length;
      stats.anc.risksRead = ancRisksResult.data.length;
      stats.anc.classifyingRead = ancClassifyingResult.data.length;
      stats.anc.addressesRead = ancAddressesResult.data.length;
      emitStep(options, {
        name: 'query_anc',
        status: 'success',
        message: `HOSxP returned ${ancPatientsResult.data.length} ANC master rows and ${ancServicesResult.data.length} visit rows.`,
        counts: {
          ancRows: ancPatientsResult.data.length,
          visits: ancServicesResult.data.length,
          risks: ancRisksResult.data.length,
          classifying: ancClassifyingResult.data.length,
          addresses: ancAddressesResult.data.length,
        },
      });

      const ancPatients = ancPatientsResult.data
        .map(mapAncPatient)
        .filter((row): row is HosxpPersonAncRow => row !== null);
      const ancServices = ancServicesResult.data
        .map(mapAncService)
        .filter((row): row is HosxpAncServiceRow => row !== null);
      const ancRisks = ancRisksResult.data
        .map(mapAncRisk)
        .filter((row): row is HosxpAncRiskRow => row !== null);
      const ancClassifying = ancClassifyingResult.data
        .map(mapAncClassifying)
        .filter((row): row is HosxpAncClassifyingRow => row !== null);
      const ancAddresses = ancAddressesResult.data
        .map(mapAncAddress)
        .filter((row): row is HosxpPatientAddressRow => row !== null);
      stats.anc.sourcePatientsMapped = ancPatients.length;
      stats.anc.servicesMapped = ancServices.length;
      stats.anc.risksMapped = ancRisks.length;
      stats.anc.classifyingMapped = ancClassifying.length;
      stats.anc.addressesMapped = ancAddresses.length;
      emitStep(options, {
        name: 'map_anc',
        status: ancPatients.length > 0 ? 'success' : 'warning',
        message: `Mapped ${ancPatients.length}/${ancPatientsResult.data.length} ANC master rows and ${ancServices.length}/${ancServicesResult.data.length} visit rows.`,
        counts: {
          ancMapped: ancPatients.length,
          visitMapped: ancServices.length,
          riskMapped: ancRisks.length,
          classifyingMapped: ancClassifying.length,
        },
      });

      if (ancPatients.length > 0) {
        emitStep(options, {
          name: 'persist_anc',
          status: 'running',
          message: `Upserting ${ancPatients.length} ANC pregnancies and ${ancServices.length} ANC visits into KK-LRMS.`,
          counts: { pregnancies: ancPatients.length, visits: ancServices.length },
        });
        const ancSynced = await syncAncData(
          db,
          hospitalId,
          ancPatients,
          ancServices,
          ancRisks,
          ancClassifying,
          encryptionKey,
          ancAddresses,
        );
        stats.anc.patientsSynced = ancSynced;
        emitStep(options, {
          name: 'persist_anc',
          status: 'success',
          message: `Synced ${ancSynced} ANC pregnancies into maternal_journeys.`,
          counts: { pregnancies: ancSynced, visits: ancServices.length },
        });
        logger.info('anc_sync_complete', {
          hospitalId,
          patientsSynced: ancSynced,
          visitsRead: ancServices.length,
          risksRead: ancRisks.length,
          classifyingRead: ancClassifying.length,
        });
      } else {
        stats.anc.skippedReason =
          stats.anc.sourcePatientsRead === 0
            ? "HOSxP returned 0 active ANC rows. Filter requires discharge <> 'Y', labor_status_id = 1, and EDC >= today-45d or LMP >= today-330d."
            : 'HOSxP returned ANC rows, but no rows had required person_anc_id/person_id/HN-or-CID fields.';
        emitStep(options, {
          name: 'persist_anc',
          status: 'warning',
          message: 'ANC persist skipped.',
          detail: stats.anc.skippedReason,
        });
      }
    } catch (ancError) {
      // ANC sync is additive to labour monitoring. Keep the labour dashboard
      // fresh even if an older HOSxP schema lacks one of the ANC tables/columns.
      stats.anc.error = ancError instanceof Error ? ancError.message : String(ancError);
      emitStep(options, {
        name: 'query_anc',
        status: 'warning',
        message: 'ANC sync failed, but active patient sync can still complete.',
        detail: stats.anc.error,
      });
      logger.error('anc_sync_failed', {
        hospitalId,
        error: ancError,
      });
    }

    emitStep(options, {
      name: 'detect_admission_changes',
      status: 'running',
      message: 'Comparing HOSxP active admissions with the previous local active set.',
    });
    const changes = detectChanges(patients, existingAns);
    emitStep(options, {
      name: 'detect_admission_changes',
      status: 'success',
      message: `Detected ${changes.newAdmissions.length} new admissions and ${changes.discharges.length} discharges.`,
      counts: {
        newAdmissions: changes.newAdmissions.length,
        discharges: changes.discharges.length,
      },
    });

    for (const an of changes.newAdmissions) {
      sseManager.broadcast('patient-update', {
        type: 'new_admission',
        hcode,
        an,
      });
    }

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

    emitStep(options, {
      name: 'mark_hospital_online',
      status: 'running',
      message: 'Writing hospital ONLINE status and last_sync_at.',
    });
    await db.execute(
      "UPDATE hospitals SET connection_status = 'ONLINE', last_sync_at = ? WHERE id = ?",
      [new Date().toISOString(), hospitalId],
    );
    emitStep(options, {
      name: 'mark_hospital_online',
      status: 'success',
      message: 'Hospital marked ONLINE and last_sync_at updated.',
    });
    // Success path: 'partial' if any step warned/errored along the way
    // (e.g. ANC sub-query failed but main labor sync succeeded), else
    // 'success'. Operators care about this distinction to triage which
    // hospitals need attention even if data did flow.
    void finalizeSyncRun(
      hospitalId,
      runId,
      hadWarningStep ? 'partial' : 'success',
      hadWarningStep ? 'Sync เสร็จแต่มีบางขั้นตอนเตือน' : 'Sync เสร็จสมบูรณ์',
      null,
    );
    return stats;
  } catch (error) {
    // Authenticity-probe failure means the tunnel is up but returning junk —
    // don't flip connection_status to OFFLINE (that would mislead the dashboard
    // into showing a tunnel/network issue). The verdict was already persisted
    // on hospital_bms_config; the admin banner reads it from there.
    if (error instanceof HospitalDataUnauthenticError) {
      void finalizeSyncRun(
        hospitalId,
        runId,
        'failed',
        'Sync ถูกระงับ — ข้อมูลจาก HOSxP ไม่ผ่านการตรวจสอบความถูกต้อง',
        `authenticity:${error.status}`,
      );
      return stats;
    }
    emitStep(options, {
      name: 'poll_failed',
      status: 'error',
      message: 'Sync cycle stopped because a required step failed.',
      detail: errorMessage(error),
    });
    logger.error('polling_failed', { hospitalId, error });
    await db.execute("UPDATE hospitals SET connection_status = 'OFFLINE' WHERE id = ?", [
      hospitalId,
    ]);

    sseManager.broadcast('connection-status', {
      hcode,
      status: 'OFFLINE',
      lastSyncAt: new Date().toISOString(),
    });
    void finalizeSyncRun(hospitalId, runId, 'failed', 'Sync ล้มเหลว', errorMessage(error));
    throw error;
  }
}

export async function startPolling(db: DatabaseAdapter, sseManager: SseManager): Promise<void> {
  const encryptionKey = process.env.ENCRYPTION_KEY ?? '';
  const validateUrl = process.env.BMS_VALIDATE_URL ?? 'https://hosxp.net/phapi/PasteJSON';

  const configs = await db.query<{
    hospital_id: string;
    tunnel_url: string;
    session_jwt: string | null;
    database_type: string | null;
  }>(
    `SELECT hbc.hospital_id, hbc.tunnel_url, hbc.session_jwt, hbc.database_type
     FROM hospital_bms_config hbc`,
  );

  const numHospitals = configs.length;
  if (numHospitals === 0) {
    logger.info('polling_skipped_no_hospitals', {});
    return;
  }

  const POLLING_INTERVAL = 30000;
  const staggerMs = Math.floor(POLLING_INTERVAL / numHospitals);

  for (let i = 0; i < configs.length; i++) {
    const config = configs[i];
    const delay = i * staggerMs;

    setTimeout(() => {
      const interval = setInterval(async () => {
        const state = getSyncState(config.hospital_id);
        if (state.inProgress) return;

        try {
          state.inProgress = true;
          state.syncStartedAt = Date.now();

          let jwt = config.session_jwt;
          let bmsUrl = config.tunnel_url;
          let dbType = (config.database_type ?? 'postgresql') as DatabaseDialect;

          // is_active gate. Re-read per cycle so the toggle flip from
          // /admin takes effect within 30s without a restart. JOIN to
          // hospitals so we don't have to query twice.
          const freshConfig = await db.query<{
            session_jwt: string | null;
            session_expires_at: string | null;
            database_type: string | null;
            marketplace_token: string | null;
            last_authenticity_status: string | null;
            last_authenticity_check_at: string | null;
            is_active: boolean | number;
            hcode: string;
          }>(
            `SELECT hbc.session_jwt, hbc.session_expires_at, hbc.database_type,
                    hbc.marketplace_token, hbc.last_authenticity_status,
                    hbc.last_authenticity_check_at, h.is_active, h.hcode
             FROM hospital_bms_config hbc
             JOIN hospitals h ON h.id = hbc.hospital_id
             WHERE hbc.hospital_id = ?`,
            [config.hospital_id],
          );
          if (
            freshConfig.length > 0 &&
            freshConfig[0].is_active !== true &&
            freshConfig[0].is_active !== 1
          ) {
            logger.info('poll_cycle_skipped_hospital_inactive', {
              hospitalId: config.hospital_id,
            });
            return;
          }
          if (freshConfig.length > 0) {
            // Authenticity cooldown: skip the cycle entirely if a recent probe
            // failed. The hospital has to be re-onboarded to refresh the
            // marketplace_token before polling will resume.
            if (
              isAuthenticityFailureStatus(freshConfig[0].last_authenticity_status) &&
              isWithinAuthenticityCooldown(
                freshConfig[0].last_authenticity_check_at,
                freshConfig[0].last_authenticity_status,
              )
            ) {
              logger.info('poll_cycle_skipped_authenticity_cooldown', {
                hospitalId: config.hospital_id,
                status: freshConfig[0].last_authenticity_status,
                checkedAt: freshConfig[0].last_authenticity_check_at,
              });
              void recordSkippedSyncRun(
                config.hospital_id,
                freshConfig[0].hcode,
                'scheduled',
                freshConfig[0].last_authenticity_status ?? 'authenticity_cooldown',
                'Sync ถูกระงับ — รอ cooldown หลังตรวจสอบความถูกต้องไม่ผ่าน',
              );
              return;
            }
            jwt = freshConfig[0].session_jwt;
            dbType = (freshConfig[0].database_type ?? 'postgresql') as DatabaseDialect;

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

          const marketplaceToken = freshConfig[0]?.marketplace_token
            ? decryptSafe(freshConfig[0].marketplace_token)
            : '';

          await pollHospital(
            db,
            config.hospital_id,
            config.tunnel_url,
            bmsUrl,
            jwt!,
            dbType,
            encryptionKey,
            sseManager,
            { marketplaceToken: marketplaceToken || null, trigger: 'scheduled' },
          );
          state.lastSyncAt = Date.now();
        } catch (error) {
          logger.error('poll_cycle_failed', { hospitalId: config.hospital_id, error });
        } finally {
          state.inProgress = false;
        }
      }, POLLING_INTERVAL);

      pollingIntervals.set(config.hospital_id, interval);
    }, delay);
  }

  logger.info('polling_started', { numHospitals, staggerMs });
}

export function stopPolling(): void {
  for (const [, interval] of pollingIntervals) {
    clearInterval(interval);
  }
  pollingIntervals.clear();
  logger.info('polling_stopped', {});
}
