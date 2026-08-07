// Webhook service — processes inbound patient data from non-HOSxP hospitals
import { v4 as uuidv4 } from 'uuid';
import { createHash, randomBytes } from 'crypto';
import type { DatabaseAdapter } from '@/db/adapter';
import { encrypt, getEncryptionKey } from '@/lib/encryption';
import {
  upsertCachedPatients,
  detectChanges,
  detectTransfers,
  markPatientsDelivered,
  calculateAndStoreCpdScores,
  linkJourneyToLabor,
} from '@/services/sync';
import type { SyncPatientData } from '@/services/sync';
import { upsertPartographObservations, type PartographRow } from '@/services/sync/partograph';
import { SseManager } from '@/lib/sse';
import {
  getActiveJourneyByCid,
  getJourneyByHn,
  createJourney,
  transitionToDelivered,
} from '@/services/journey';
import { AncRiskLevel, ReferralStatus } from '@/types/domain';
import { classifyAncItems } from '@/config/anc-classifying-canon';
import { ANC_RISK_CONFIGS, ANC_RISK_LEVEL_ORDER } from '@/config/anc-risk-rules';
import { insertAncScreeningIfChanged } from '@/services/anc-screening';
import { logger } from '@/lib/logger';
import { CooperativeYielder } from '@/lib/event-loop';
import { diagnoseCid, describeCidFailure, isValidThaiCidChecksum } from '@/lib/cid';
import { isoDatesEqual, toIsoDate } from '@/lib/dates';
import { isMaternalScreenIngestEnabled, isMaternalScreenEventsEnabled } from '@/lib/feature-flags';
import { normalizeProteinuriaGrade } from '@/services/maternal-screening';
import {
  saveMaternalScreenAssessment,
  MaternalScreenStoreError,
} from '@/services/maternal-screening-store';
import { enqueueEmergencyAlert } from '@/services/risk-alert';
import { EMERGENCY_ACUITY_LABEL_TH } from '@/config/maternal-screen-display';
import {
  shouldEmitMaternalScreenTransition,
  buildMaternalScreenStateChangedEvent,
  type MaternalScreenPreviousSummary,
} from '@/services/maternal-screening-events';
import type {
  MaternalEmergencyAcuity,
  MaternalScreenInput,
  MaternalScreenLocalTier,
} from '@/types/maternal-screening';
import {
  MATERNAL_SCREEN_TRANSPORT_MAX_BYTES,
  MATERNAL_SCREEN_ASSESSED_AT_MAX_FUTURE_MS,
  MATERNAL_SCREEN_ISO_8601_PATTERN,
  MATERNAL_SCREEN_SOURCE_PK_MAX_LENGTH,
  MATERNAL_SCREEN_ASSESSED_BY_MAX_LENGTH,
  MATERNAL_SCREEN_NUMERIC_BOUNDS,
  MATERNAL_SCREEN_ADMISSION_CONTEXT_BOUNDS,
  MATERNAL_SCREEN_ENUM_VALUES,
} from '@/config/maternal-screen-ingest';

// ─── Webhook payload types ───

export interface WebhookPatientPayload {
  hn: string;
  an: string;
  name: string;
  cid: string; // เลขบัตรประชาชน 13 หลัก (required for cross-hospital matching)
  age: number;
  // Obstetric formula G_P_A_L. Sender SHOULD include all four when known so
  // the UI can render the full pill ("G3 P2 A0 L2") instead of just G.
  gravida?: number | null;
  para?: number | null;
  abortion?: number | null;
  living_children?: number | null;
  preg_no?: number | null; // current pregnancy number (ครรภ์ที่ X)
  ga_weeks?: number | null;
  ga_day?: number | null; // GA day-of-week precision: 38⁺⁴ → ga_weeks=38, ga_day=4
  anc_count?: number | null;
  admit_date: string; // ISO 8601
  height_cm?: number | null;
  weight_kg?: number | null;
  weight_diff_kg?: number | null;
  pre_pregnancy_weight_kg?: number | null; // First-ANC-visit BW; lets us derive weight_diff_kg
  fundal_height_cm?: number | null;
  us_weight_g?: number | null;
  hematocrit_pct?: number | null;
  // Admission vital signs (snapshot at ipt admission, not partograph).
  bp_systolic_admit?: number | null;
  bp_diastolic_admit?: number | null;
  pulse_admit?: number | null;
  rr_admit?: number | null;
  temperature_admit?: number | null;
  // Cervical exam at admission — drives transfer/triage decisions.
  cervical_open_cm_admit?: number | null;
  effacement_pct_admit?: number | null;
  station_admit?: string | null; // free-form (-3 / -2 / -1 / 0 / +1 / etc)
  labor_status?: string; // ACTIVE (default), DELIVERED
  action?: 'upsert' | 'delete'; // default: 'upsert'
  // OPTIONAL maternal labor-triage screening observations (Task 7, spec §9.1).
  // Legacy senders that omit it are 100% unaffected (GC7); it is only ever
  // read when isMaternalScreenIngestEnabled() is true. Evaluation is ALWAYS
  // server-side — there is deliberately no field for a client-supplied
  // tier/acuity/completeness (GC2).
  maternal_screening?: WebhookMaternalScreeningPayload | null;
}

/**
 * Transport shape (snake_case per spec §9.1) of one maternal screening
 * assessment riding on a labor patient payload. Booleans are three-state:
 * true (assessed, present) / false (assessed, absent) / null-or-absent (not
 * assessed — never coerced to a normal finding, GC1). Categorical fields
 * accept the enum members of `MaternalScreenInput` (case-insensitive);
 * `proteinuria_grade` additionally accepts the free-text dipstick spellings
 * recognized by `normalizeProteinuriaGrade`.
 *
 * Admission BP and GA are NOT part of this object: they are reused from the
 * SAME payload's `bp_systolic_admit` / `bp_diastolic_admit` /
 * `ga_weeks` / `ga_day` fields (same payload/assessment context only — never
 * stale cached vitals, spec §9.1).
 */
export interface WebhookMaternalScreeningPayload {
  /** Sender idempotency key — replays of the same key are no-ops. */
  source_pk?: string | null;
  /** ISO 8601 timestamp of the clinical assessment (required). */
  assessed_at: string;
  assessed_by?: string | null;
  /** Transport casing is `pih_diagnosed`; mapped to `piHDiagnosed` internally. */
  pih_diagnosed?: boolean | null;
  proteinuria_grade?: string | null;
  creatinine_mg_dl?: number | null;
  creatinine_baseline_mg_dl?: number | null;
  platelet_per_ul?: number | null;
  ast_iu_l?: number | null;
  alt_iu_l?: number | null;
  urine_output_ml_per_hour?: number | null;
  headache?: string | null;
  blurred_vision?: boolean | null;
  epigastric_pain?: boolean | null;
  pulmonary_edema?: boolean | null;
  right_upper_quadrant_pain?: boolean | null;
  vaginal_bleeding?: boolean | null;
  estimated_bleeding_ml?: number | null;
  bleeding_rate?: string | null;
  concealed_bleeding_suspected?: boolean | null;
  abdominal_or_back_pain?: boolean | null;
  uterine_tenderness?: boolean | null;
  frequent_contractions?: boolean | null;
  contraction_duration_exceeds_interval?: boolean | null;
  suprapubic_tenderness?: boolean | null;
  bandls_ring?: boolean | null;
  membranes_ruptured?: boolean | null;
  abnormal_presentation?: boolean | null;
  fetal_heart_rate_bpm?: number | null;
  fetal_tracing_pattern?: string | null;
  maternal_pulse_bpm?: number | null;
  respiratory_rate_per_min?: number | null;
  oxygen_saturation_pct?: number | null;
  consciousness?: string | null;
  shock_signs_present?: boolean | null;
  placenta_previa_excluded?: boolean | null;
  placenta_location_source?: string | null;
}

export type WebhookMode = 'incremental' | 'full_snapshot';

export interface WebhookPayload {
  hospitalCode: string; // Must match API key's hospital
  patients: WebhookPatientPayload[];
  mode?: WebhookMode; // default: 'incremental'
  // Optional authoritative complete active-AN set for discharge reconciliation.
  // When present, any cached ACTIVE patient whose AN is absent is closed out.
  // The browser push sends this because its `patients` upsert list may be
  // filtered (name-authenticity probe) or capped at 100 and so cannot double
  // as the active set. Takes precedence over mode-based discharge.
  activeAns?: string[];
}

export interface WebhookResult {
  patientsProcessed: number;
  newAdmissions: number;
  discharges: number;
  transfers: number;
  deleted: number;
  // Maternal screening ingest counters (Task 7). Present ONLY when
  // isMaternalScreenIngestEnabled() is true AND at least one patient in the
  // batch carried a `maternal_screening` object — legacy responses are
  // byte-identical otherwise (GC7). All values are PHI-free (no name/cid).
  /** Assessment rows persisted (created or corrected) in this batch. */
  maternalScreenAssessments?: number;
  /** Idempotent replays — same (source_system, source_pk) already stored. */
  maternalScreenDuplicates?: number;
  /** Actionable, PHI-free per-patient errors (`patients[i].maternal_screening…`).
   *  A failed screening never aborts the batch or the patient's own upsert. */
  maternalScreenIngestErrors?: string[];
}

// ─── ANC webhook payload ───

export interface WebhookVaccineGiven {
  type: 'TT' | 'DT' | 'TDAP' | 'INFLUENZA' | 'COVID';
  dose?: number | null;
  givenAtGa?: number | null;
}

export interface WebhookPsychosocialScreen {
  alcohol?: boolean;
  smoking?: boolean;
  illicitDrugs?: boolean;
  depressionPhq?: number;
  domesticViolence?: boolean;
}

export interface WebhookAncVisit {
  date: string;
  visitNumber: number;
  gaWeeks?: number;
  fundalHeightCm?: number;
  weightKg?: number;
  bpSystolic?: number;
  bpDiastolic?: number;
  fetalHr?: number;
  presentation?: string | null;
  engagement?: string | null;
  // WHO 2016 data elements (L2) — all optional.
  urineProtein?: string | null; // '-', 'trace', '+', '++', '+++'
  urineGlucose?: string | null;
  hbGDl?: number | null;
  hctPct?: number | null;
  ttDoseNo?: number | null;
  ironFolicGiven?: boolean | null;
  calciumGiven?: boolean | null;
  dangerSigns?: string[] | null;
  fetalMovementOk?: boolean | null;
  // RTCOG OB 66-029 (2566) additions — per-visit.
  vaccinesGiven?: WebhookVaccineGiven[] | null;
  urineKetone?: string | null;
  urineCultureResult?: string | null;
  iodineGiven?: boolean | null;
  multivitaminGiven?: boolean | null;
  vitaminDIu?: number | null;
  nstResult?: 'REACTIVE' | 'NON_REACTIVE' | 'PENDING' | null;
  bppScore?: number | null;
  umbilicalDopplerResult?: 'NORMAL' | 'ABNORMAL' | null;
  psychosocialScreen?: WebhookPsychosocialScreen | null;
}

export interface WebhookAncPatient {
  hn: string | null; // null for community ANC patients not registered in hospital patient table
  name: string;
  cid: string; // เลขบัตรประชาชน 13 หลัก (required for cross-hospital matching)
  birthday: string;
  pregNo: number;
  lmp?: string;
  edc?: string;
  riskLevel?: string;
  /** Checked person_anc_classifying item IDs (canonical catalog, identical
   *  at every hospital) — lets the server persist WHICH criteria fired,
   *  not just the level. Optional for legacy clients. */
  riskItemIds?: number[] | null;
  changwatCode?: string; // จังหวัด 2-digit (e.g. "40" = ขอนแก่น)
  amphurCode?: string; // อำเภอ 2-digit
  tambonCode?: string; // ตำบล 2-digit
  visits?: WebhookAncVisit[];
  // WHO 2016 journey-level data (L2).
  bloodGroup?: string | null; // A / B / AB / O
  rhFactor?: string | null; // POS / NEG
  hbsagResult?: string | null; // POS / NEG / PENDING
  vdrlResult?: string | null;
  hivResult?: string | null;
  ogttResult?: string | null; // NORMAL / ABNORMAL / PENDING
  termBirths?: number | null;
  pretermBirths?: number | null;
  abortions?: number | null;
  livingChildren?: number | null;
  pastMedicalHistory?: string | null;
  action?: 'upsert' | 'delete'; // default: 'upsert'
  // ─── RTCOG OB 66-029 (2566) journey-level additions ──────────────────
  mcvFl?: number | null;
  dcipResult?: 'POS' | 'NEG' | 'PENDING' | null;
  hbEResult?: 'POS' | 'NEG' | 'PENDING' | null;
  thalassemiaType?: 'HB_H' | 'BETA_THAL_MAJOR' | 'BETA_THAL_HB_E' | 'TRAIT' | 'NORMAL' | null;
  cervicalScreenType?: 'PAP' | 'HPV' | 'NONE' | null;
  cervicalScreenResult?: 'NORMAL' | 'ABNORMAL' | 'PENDING' | null;
  cervicalScreenDate?: string | null;
  aneuploidyMethod?: 'SERUM_T1' | 'QUAD_T2' | 'CFDNA' | 'NONE' | null;
  aneuploidyResult?: 'LOW_RISK' | 'HIGH_RISK' | 'PENDING' | null;
  gbsResult?: 'POS' | 'NEG' | 'PENDING' | null;
  gbsCollectedDate?: string | null;
  anatomyScanDate?: string | null;
  anatomyScanResult?: 'NORMAL' | 'ABNORMAL' | 'PENDING' | null;
  efwG?: number | null;
  datingMethod?: 'LMP' | 'US' | 'ART' | null;
  proteinuria24hMg?: number | null;
  creatinineMgDl?: number | null;
  priorPeDvt?: boolean | null;
  severeLungDisease?: boolean | null;
  alloimmunizationCde?: boolean | null;
  bariatricSurgeryHx?: boolean | null;
  teratogenExposure?: boolean | null;
  congenitalInfection?: boolean | null;
  gdmRiskFactors?: Array<
    'bmi_over_30' | 'first_degree_dm' | 'pcos' | 'prior_macrosomia' | 'steroid_use' | 'prior_igm'
  > | null;
}

export interface WebhookAncPayload {
  type: 'anc_data';
  hospitalCode: string;
  patients: WebhookAncPatient[];
}

/**
 * Result of {@link processAncWebhook}. Additive/non-breaking: both
 * `/api/webhooks/patient-data` (anc_data branch) and
 * `/api/sync/browser-push` (persist_anc step) surface every field of this
 * shape in their response JSON — see WHO containment T6 (ingestion
 * observability). `downgradesBlocked` and `visitConflicts` are ANOMALY
 * COUNTERS: non-zero means the ingest pipeline silently protected data
 * integrity and an operator should know. Both are logged via
 * `logger.warn('anc_ingest_anomalies', { hospitalId, downgradesBlocked,
 * visitConflicts })` on the browser-push path when either is > 0.
 */
export interface WebhookAncResult {
  patientsProcessed: number;
  created: number;
  updated: number;
  deleted: number;
  /**
   * Count of per-patient updates whose declared/derived level would have
   * LOWERED a known journey risk on missing evidence (empty items or
   * declared-only) and was blocked. See the WHO T4 downgrade guard below.
   */
  downgradesBlocked: number;
  /**
   * Count of incoming visits SKIPPED because their (journey, visit_date) is
   * already owned by ANOTHER hospital (or a NULL-hospital legacy row). One
   * hospital's payload may never overwrite or reattribute another
   * hospital's visit row — see the WHO T5 hospital-scoped visit writes
   * below.
   */
  visitConflicts: number;
  /**
   * Count of sender string fields DROPPED (stored as null) because they
   * exceeded their column width even after the widen-anc-result-columns
   * migration. Defense-in-depth for the 2026-07-14..16 prod incident where
   * one over-long value ("Non-reactive" > VARCHAR(10)) threw and silently
   * aborted a hospital's entire ANC bundle every sync cycle. Values are
   * never truncated — partial clinical text is worse than an explicit gap,
   * and the full value remains in the source EHR.
   */
  fieldOverflows: number;
}

// ─── Referral webhook payload ───

// CREATE — sent by sending hospital (รพ.ต้นทาง)
export interface WebhookReferralCreatePayload {
  type: 'referral';
  hospitalCode: string; // sender's HCODE (matches API key)
  referralId: string; // sender's referral ID (compound key)
  hn: string; // patient HN at sending hospital
  cid: string; // national ID (เลขบัตรประชาชน) — same across all hospitals
  name: string; // patient name (auto-encrypted)
  toHospitalCode: string; // destination hospital HCODE
  reason: string; // referral reason
  diagnosisCode?: string; // ICD-10 code
  urgencyLevel?: string; // ROUTINE | URGENT | EMERGENCY (default: ROUTINE)
  changwatCode?: string; // จังหวัด 2-digit (patient address for GIS)
  amphurCode?: string; // อำเภอ 2-digit
  tambonCode?: string; // ตำบล 2-digit
  action?: 'upsert' | 'delete'; // default: 'upsert'
}

// UPDATE — sent by receiving hospital (รพ.ปลายทาง)
export interface WebhookReferralUpdatePayload {
  type: 'referral_update';
  hospitalCode: string; // who is sending this update (matches API key)
  referralId: string; // original referral ID
  fromHospitalCode: string; // sending hospital HCODE (compound key)
  status: string; // ACCEPTED | IN_TRANSIT | ARRIVED | REJECTED
  reason?: string; // reason for status change
  rejectionReason?: string; // reason for rejection (REJECTED only)
  transportMode?: string; // ambulance, self, etc. (IN_TRANSIT only)
  arrivedAt?: string; // arrival datetime ISO 8601 (ARRIVED only)
  action?: 'update' | 'delete'; // default: 'update'
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
  // Required for action !== 'delete'; validator enforces this conditionally.
  observeDatetime?: string;
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
    'SELECT id, hospital_id FROM webhook_api_keys WHERE key_hash = ? AND is_active = true AND revoked_at IS NULL',
    [keyHash],
  );

  if (rows.length === 0) return null;

  // Update last_used_at
  await db.execute('UPDATE webhook_api_keys SET last_used_at = ? WHERE id = ?', [
    new Date().toISOString(),
    rows[0].id,
  ]);

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

export async function revokeApiKey(db: DatabaseAdapter, keyId: string): Promise<boolean> {
  const now = new Date().toISOString();
  await db.execute('UPDATE webhook_api_keys SET is_active = false, revoked_at = ? WHERE id = ?', [
    now,
    keyId,
  ]);
  return true;
}

export async function listApiKeys(
  db: DatabaseAdapter,
  hospitalId?: string,
): Promise<
  Array<{
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
  }>
> {
  const whereClause = hospitalId ? 'WHERE wak.hospital_id = ?' : '';
  const params = hospitalId ? [hospitalId] : [];

  const rows = await db.query<{
    id: string;
    hospital_id: string;
    hcode: string;
    hospital_name: string;
    key_prefix: string;
    label: string;
    is_active: number;
    last_used_at: string | null;
    created_at: string;
    revoked_at: string | null;
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
    if (!p.name || typeof p.name !== 'string')
      errors.push(`patients[${i}].name is required (string)`);
    const cidCheck = diagnoseCid(p.cid);
    if (!cidCheck.ok) {
      errors.push(`patients[${i}].cid ${describeCidFailure(cidCheck.failure)}`);
    }
    if (p.age == null || typeof p.age !== 'number')
      errors.push(`patients[${i}].age is required (number)`);
    if (!p.admit_date || typeof p.admit_date !== 'string') {
      errors.push(`patients[${i}].admit_date is required (ISO 8601 string)`);
    } else if (Number.isNaN(new Date(p.admit_date).getTime())) {
      // Reject "not-a-date" or "2026-13-45" before they reach the DB layer.
      errors.push(
        `patients[${i}].admit_date must be a valid ISO 8601 string (got "${p.admit_date}")`,
      );
    }
  }

  if (errors.length > 0) {
    return { valid: false, error: `Validation errors: ${errors.join('; ')}` };
  }

  // Validate mode field if provided
  if (obj.mode !== undefined && obj.mode !== 'incremental' && obj.mode !== 'full_snapshot') {
    return { valid: false, error: '"mode" must be "incremental" or "full_snapshot"' };
  }

  // Validate activeAns if provided — must be an array of strings (AN values).
  if (obj.activeAns !== undefined) {
    if (!Array.isArray(obj.activeAns) || obj.activeAns.some((a) => typeof a !== 'string')) {
      return { valid: false, error: '"activeAns" must be an array of strings' };
    }
  }

  return { valid: true, payload: obj as unknown as WebhookPayload };
}

// ─── Maternal screening transport validation + mapping (Task 7, spec §9.2) ───

/** Validated, normalized screening candidate — ready for the Task 6 store. */
export interface MaternalScreeningIngestCandidate {
  sourcePk: string | null;
  assessedAt: string;
  assessedBy: string | null;
  /** Fully mapped §6.1 input. Unassessed → null / 'UNKNOWN' (GC1). */
  input: MaternalScreenInput;
}

// Transport (snake_case) → MaternalScreenInput (camelCase) key maps for the
// three-state boolean and bounded numeric fields. Data-driven so the §6.1
// field list lives in ONE place per value kind (constitution I: no scattered
// per-field hardcoding).
//
// Exported (in addition to internal use above) so any other in-repo code
// that needs to speak this exact transport shape — currently only the
// dev-simulation maternal-screening profiles (Task H3) and their tests —
// derives it from THIS single source instead of hand-maintaining a second,
// driftable copy. This does not change the transport contract (GC-H2); it
// only makes the existing frozen contract visible for reuse/verification.
export const MS_BOOLEAN_FIELD_MAP = {
  // Boundary casing corrected per spec §9.1: transport `pih_diagnosed`.
  pih_diagnosed: 'piHDiagnosed',
  blurred_vision: 'blurredVision',
  epigastric_pain: 'epigastricPain',
  pulmonary_edema: 'pulmonaryEdema',
  right_upper_quadrant_pain: 'rightUpperQuadrantPain',
  vaginal_bleeding: 'vaginalBleeding',
  concealed_bleeding_suspected: 'concealedBleedingSuspected',
  abdominal_or_back_pain: 'abdominalOrBackPain',
  uterine_tenderness: 'uterineTenderness',
  frequent_contractions: 'frequentContractions',
  contraction_duration_exceeds_interval: 'contractionDurationExceedsInterval',
  suprapubic_tenderness: 'suprapubicTenderness',
  bandls_ring: 'bandlsRing',
  membranes_ruptured: 'membranesRuptured',
  abnormal_presentation: 'abnormalPresentation',
  shock_signs_present: 'shockSignsPresent',
  placenta_previa_excluded: 'placentaPreviaExcluded',
} as const satisfies Record<string, keyof MaternalScreenInput>;

export const MS_NUMERIC_FIELD_MAP = {
  creatinine_mg_dl: 'creatinineMgDl',
  creatinine_baseline_mg_dl: 'creatinineBaselineMgDl',
  platelet_per_ul: 'plateletPerUl',
  ast_iu_l: 'astIuL',
  alt_iu_l: 'altIuL',
  urine_output_ml_per_hour: 'urineOutputMlPerHour',
  estimated_bleeding_ml: 'estimatedBleedingMl',
  fetal_heart_rate_bpm: 'fetalHeartRateBpm',
  maternal_pulse_bpm: 'maternalPulseBpm',
  respiratory_rate_per_min: 'respiratoryRatePerMin',
  oxygen_saturation_pct: 'oxygenSaturationPct',
} as const satisfies Record<string, keyof MaternalScreenInput>;

/**
 * The COMPLETE allowlist of accepted `maternal_screening` transport keys,
 * assembled from the boolean + numeric field maps, the enum field names, and
 * the free-standing scalar keys. Any key outside this set is REJECTED at the
 * boundary rather than silently ignored: a typo like `shock_sign_present`
 * would otherwise leave `shockSignsPresent` null and drop a real EMERGENCY
 * finding with a 200 response and no operator trace (review IMPORTANT 2).
 * Derived from the maps so it can never drift out of sync with them.
 */
export const MS_KNOWN_TRANSPORT_KEYS: ReadonlySet<string> = new Set<string>([
  'source_pk',
  'assessed_at',
  'assessed_by',
  'proteinuria_grade',
  ...Object.keys(MS_BOOLEAN_FIELD_MAP),
  ...Object.keys(MS_NUMERIC_FIELD_MAP),
  ...Object.keys(MATERNAL_SCREEN_ENUM_VALUES),
]);

/**
 * GC6 / PDPA: validation errors echo the offending sender value so they stay
 * actionable, but a misrouted free-text value (e.g. a patient name landing in
 * an enum field) must not flow verbatim into the webhook response and the
 * `maternal_screen_webhook_ingest_rejected` server log. Echoes of unbounded
 * sender values are therefore truncated to a short prefix (length reported so
 * the sender can still find the culprit). `assessed_by`/`source_pk` keep
 * their existing length-only echoes (no value at all).
 */
const MS_ECHO_MAX_CHARS = 40;
function echoForError(value: unknown): string {
  const rendered = JSON.stringify(value) ?? String(value);
  return rendered.length <= MS_ECHO_MAX_CHARS
    ? rendered
    : `${rendered.slice(0, MS_ECHO_MAX_CHARS)}… (truncated, ${rendered.length} chars)`;
}

/**
 * Validate one patient's OPTIONAL `maternal_screening` transport object
 * (spec §9.2) and map it to a normalized `MaternalScreenInput` (spec §6.1).
 *
 * - Field errors use the repo's standard `patients[i].field message` shape.
 * - Any error rejects the WHOLE screening object (never a partial summary
 *   update); the patient's own upsert and the rest of the batch are the
 *   caller's concern and are NOT affected by a rejection here.
 * - Admission BP / GA are reused from the SAME payload only (spec §9.1) —
 *   their provenance is this payload's admission snapshot, timestamped by the
 *   payload's own `admit_date`/`assessed_at` context; they are validated here
 *   (only when a screening rides along) because they become clinical inputs.
 * - GC1: absent/null/blank → null or 'UNKNOWN'; nothing is ever invented.
 * - GC2: there is no way to pass a tier/acuity/completeness through this.
 */
export function validateMaternalScreeningTransport(
  patient: WebhookPatientPayload,
  label: string,
  now: Date = new Date(),
): { ok: true; candidate: MaternalScreeningIngestCandidate } | { ok: false; errors: string[] } {
  const ms = patient.maternal_screening;
  const prefix = `${label}.maternal_screening`;

  if (ms == null || typeof ms !== 'object' || Array.isArray(ms)) {
    return { ok: false, errors: [`${prefix} must be a JSON object`] };
  }

  // Max transport size (spec §9.2), measured on the serialized object.
  const serializedBytes = Buffer.byteLength(JSON.stringify(ms), 'utf8');
  if (serializedBytes > MATERNAL_SCREEN_TRANSPORT_MAX_BYTES) {
    return {
      ok: false,
      errors: [
        `${prefix} exceeds the maximum size of ${MATERNAL_SCREEN_TRANSPORT_MAX_BYTES} bytes (got ${serializedBytes}) — remove unexpected fields`,
      ],
    };
  }

  const raw = ms as unknown as Record<string, unknown>;
  const errors: string[] = [];

  // Unknown-key allowlist (review IMPORTANT 2): reject any key outside the
  // known transport set BEFORE mapping, so a misspelled field (e.g.
  // `shock_sign_present`) surfaces as an actionable error instead of silently
  // dropping the finding it was meant to carry.
  const unknownKeys = Object.keys(raw).filter((k) => !MS_KNOWN_TRANSPORT_KEYS.has(k));
  if (unknownKeys.length > 0) {
    errors.push(
      `${prefix} has unrecognized field(s): ${unknownKeys.join(', ')} — check for typos; only documented maternal_screening keys are accepted (spec §9.1)`,
    );
  }

  // assessed_at — required, STRICT ISO-8601 instant with a bounded future
  // tolerance. `new Date()` alone accepts locale strings ("07/16/2026") and
  // 2-digit years that shift under server-local time and corrupt the
  // ORDER BY assessed_at DESC projection (review MINOR 3) — so require the
  // offset-qualified ISO pattern first.
  let assessedAt = '';
  const rawAssessedAt = raw.assessed_at;
  if (typeof rawAssessedAt !== 'string' || !MATERNAL_SCREEN_ISO_8601_PATTERN.test(rawAssessedAt)) {
    errors.push(
      `${prefix}.assessed_at is required and must be a strict ISO 8601 instant (YYYY-MM-DDTHH:MM(:SS(.sss)?)? with a Z or ±HH:MM offset; got ${echoForError(rawAssessedAt)})`,
    );
  } else if (Number.isNaN(new Date(rawAssessedAt).getTime())) {
    // Pattern-valid but an impossible calendar value (e.g. month 13, day 45).
    errors.push(`${prefix}.assessed_at is not a real calendar date/time (got "${rawAssessedAt}")`);
  } else if (
    new Date(rawAssessedAt).getTime() >
    now.getTime() + MATERNAL_SCREEN_ASSESSED_AT_MAX_FUTURE_MS
  ) {
    errors.push(
      `${prefix}.assessed_at is more than ${MATERNAL_SCREEN_ASSESSED_AT_MAX_FUTURE_MS / 3_600_000} hours in the future (got "${rawAssessedAt}") — check the sender clock/timezone offset`,
    );
  } else {
    assessedAt = rawAssessedAt;
  }

  // source_pk — optional idempotency key. Over-length is REJECTED (never
  // truncated or nulled: that would silently change idempotency semantics).
  let sourcePk: string | null = null;
  if (raw.source_pk !== undefined && raw.source_pk !== null) {
    if (typeof raw.source_pk !== 'string') {
      errors.push(`${prefix}.source_pk must be a string or null`);
    } else if (raw.source_pk.length > MATERNAL_SCREEN_SOURCE_PK_MAX_LENGTH) {
      errors.push(
        `${prefix}.source_pk must be at most ${MATERNAL_SCREEN_SOURCE_PK_MAX_LENGTH} characters (got ${raw.source_pk.length}) — it is the idempotency key and cannot be truncated`,
      );
    } else {
      sourcePk = raw.source_pk;
    }
  }

  let assessedBy: string | null = null;
  if (raw.assessed_by !== undefined && raw.assessed_by !== null) {
    if (typeof raw.assessed_by !== 'string') {
      errors.push(`${prefix}.assessed_by must be a string or null`);
    } else if (raw.assessed_by.length > MATERNAL_SCREEN_ASSESSED_BY_MAX_LENGTH) {
      errors.push(
        `${prefix}.assessed_by must be at most ${MATERNAL_SCREEN_ASSESSED_BY_MAX_LENGTH} characters (got ${raw.assessed_by.length})`,
      );
    } else {
      assessedBy = raw.assessed_by;
    }
  }

  // Three-state booleans: true / false / null-or-absent. Anything else
  // (strings, 0/1) is rejected — coercion would fabricate an assessment (GC1).
  const bool = (field: keyof typeof MS_BOOLEAN_FIELD_MAP): boolean | null => {
    const v = raw[field];
    if (v === undefined || v === null) return null;
    if (typeof v !== 'boolean') {
      errors.push(
        `${prefix}.${field} must be true, false, or null (three-state assessed/absent/not-assessed; got ${echoForError(v)})`,
      );
      return null;
    }
    return v;
  };

  // Bounded numerics: reject impossible values, keep clinically-extreme ones
  // (bounds documented in src/config/maternal-screen-ingest.ts).
  const num = (field: keyof typeof MS_NUMERIC_FIELD_MAP): number | null => {
    const v = raw[field];
    if (v === undefined || v === null) return null;
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      errors.push(`${prefix}.${field} must be a finite number or null (got ${echoForError(v)})`);
      return null;
    }
    const bounds = MATERNAL_SCREEN_NUMERIC_BOUNDS[field];
    if (bounds && (v < bounds.min || v > bounds.max)) {
      errors.push(
        `${prefix}.${field} ${v} is outside the physiologically possible range ${bounds.min}–${bounds.max} — send null when not assessed`,
      );
      return null;
    }
    return v;
  };

  // Categorical enums: case-insensitive membership or rejection; absent /
  // null / blank → 'UNKNOWN' (not assessed — GC1). Every allowed set contains
  // 'UNKNOWN', so the cast below is safe.
  const en = <T extends string>(
    field: keyof typeof MATERNAL_SCREEN_ENUM_VALUES,
    allowed: readonly T[],
  ): T => {
    const v = raw[field];
    if (v === undefined || v === null) return 'UNKNOWN' as T;
    if (typeof v !== 'string') {
      errors.push(`${prefix}.${field} must be a string or null (got ${echoForError(v)})`);
      return 'UNKNOWN' as T;
    }
    const trimmed = v.trim();
    if (trimmed === '') return 'UNKNOWN' as T;
    const norm = trimmed.toUpperCase() as T;
    if (!allowed.includes(norm)) {
      errors.push(
        `${prefix}.${field} must be one of ${allowed.join('|')} or null (got ${echoForError(v)})`,
      );
      return 'UNKNOWN' as T;
    }
    return norm;
  };

  // proteinuria_grade: free-text dipstick spellings via the shared
  // normalizer; unrecognized spellings are 'UNKNOWN' by design (GC1), only a
  // non-string type is rejected.
  let proteinuriaGrade: MaternalScreenInput['proteinuriaGrade'] = 'UNKNOWN';
  if (
    raw.proteinuria_grade !== undefined &&
    raw.proteinuria_grade !== null &&
    typeof raw.proteinuria_grade !== 'string'
  ) {
    errors.push(`${prefix}.proteinuria_grade must be a string or null`);
  } else {
    proteinuriaGrade = normalizeProteinuriaGrade(
      raw.proteinuria_grade as string | null | undefined,
    );
  }

  // Same-payload admission context (spec §9.1): GA and admission BP are
  // reused ONLY from this payload — never stale cached vitals. Validated here
  // (not in validatePayload) so legacy payloads without a screening keep
  // their existing, unvalidated behavior (GC7).
  const admissionNum = (
    field: 'ga_weeks' | 'ga_day' | 'bp_systolic_admit' | 'bp_diastolic_admit',
  ): number | null => {
    const v = patient[field];
    if (v === undefined || v === null) return null;
    const bounds = MATERNAL_SCREEN_ADMISSION_CONTEXT_BOUNDS[field];
    if (typeof v !== 'number' || !Number.isFinite(v) || v < bounds.min || v > bounds.max) {
      errors.push(
        `${label}.${field} must be a number between ${bounds.min} and ${bounds.max} to be reused as a screening input (got ${echoForError(v)}) — fix the value or send null`,
      );
      return null;
    }
    return v;
  };

  const placentaPreviaExcluded = bool('placenta_previa_excluded');
  const placentaLocationSource = en(
    'placenta_location_source',
    MATERNAL_SCREEN_ENUM_VALUES.placenta_location_source,
  );
  // Spec §9.1: previa exclusion is never accepted without approved provenance
  // (and the always-required assessed_at timestamp). It must not be able to
  // downgrade a bleeding patient's safety posture on the sender's say-so.
  if (placentaPreviaExcluded === true && placentaLocationSource === 'UNKNOWN') {
    errors.push(
      `${prefix}.placenta_previa_excluded=true requires placenta_location_source ULTRASOUND or OTHER_DOCUMENTED — previa exclusion is not accepted without documented provenance`,
    );
  }

  const input: MaternalScreenInput = {
    gaWeeks: admissionNum('ga_weeks'),
    gaDays: admissionNum('ga_day'),
    piHDiagnosed: bool('pih_diagnosed'),
    systolicBp: admissionNum('bp_systolic_admit'),
    diastolicBp: admissionNum('bp_diastolic_admit'),
    proteinuriaGrade,
    creatinineMgDl: num('creatinine_mg_dl'),
    creatinineBaselineMgDl: num('creatinine_baseline_mg_dl'),
    plateletPerUl: num('platelet_per_ul'),
    astIuL: num('ast_iu_l'),
    altIuL: num('alt_iu_l'),
    urineOutputMlPerHour: num('urine_output_ml_per_hour'),
    headache: en('headache', MATERNAL_SCREEN_ENUM_VALUES.headache),
    blurredVision: bool('blurred_vision'),
    epigastricPain: bool('epigastric_pain'),
    pulmonaryEdema: bool('pulmonary_edema'),
    rightUpperQuadrantPain: bool('right_upper_quadrant_pain'),
    vaginalBleeding: bool('vaginal_bleeding'),
    estimatedBleedingMl: num('estimated_bleeding_ml'),
    bleedingRate: en('bleeding_rate', MATERNAL_SCREEN_ENUM_VALUES.bleeding_rate),
    concealedBleedingSuspected: bool('concealed_bleeding_suspected'),
    abdominalOrBackPain: bool('abdominal_or_back_pain'),
    uterineTenderness: bool('uterine_tenderness'),
    frequentContractions: bool('frequent_contractions'),
    contractionDurationExceedsInterval: bool('contraction_duration_exceeds_interval'),
    suprapubicTenderness: bool('suprapubic_tenderness'),
    bandlsRing: bool('bandls_ring'),
    membranesRuptured: bool('membranes_ruptured'),
    abnormalPresentation: bool('abnormal_presentation'),
    fetalHeartRateBpm: num('fetal_heart_rate_bpm'),
    fetalTracingPattern: en(
      'fetal_tracing_pattern',
      MATERNAL_SCREEN_ENUM_VALUES.fetal_tracing_pattern,
    ),
    maternalPulseBpm: num('maternal_pulse_bpm'),
    respiratoryRatePerMin: num('respiratory_rate_per_min'),
    oxygenSaturationPct: num('oxygen_saturation_pct'),
    consciousness: en('consciousness', MATERNAL_SCREEN_ENUM_VALUES.consciousness),
    shockSignsPresent: bool('shock_signs_present'),
    placentaPreviaExcluded,
    placentaLocationSource,
  };

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, candidate: { sourcePk, assessedAt, assessedBy, input } };
}

// Per-patient CID checks for ANC. A bad CID here corrupts cross-hospital
// matching just like the labor path — a phantom maternal_journey gets created
// because cidHash never collides with the real one. Old hospital-side clients
// occasionally send the encrypted blob from HOSxP (when marketplace_token
// was missing), or a 12-digit truncation, so reject both cleanly.
export function validateAncPayload(body: unknown): {
  valid: boolean;
  error?: string;
  payload?: WebhookAncPayload;
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
  if (obj.patients.length > 500) {
    return { valid: false, error: '"patients" array must not exceed 500 items per request' };
  }

  const errors: string[] = [];
  for (let i = 0; i < obj.patients.length; i++) {
    const p = obj.patients[i] as Record<string, unknown>;
    if (!p.name || typeof p.name !== 'string')
      errors.push(`patients[${i}].name is required (string)`);
    const cidCheck = diagnoseCid(p.cid);
    if (!cidCheck.ok) {
      errors.push(`patients[${i}].cid ${describeCidFailure(cidCheck.failure)}`);
    }
    // hn is nullable for community ANC patients (see WebhookAncPatient.hn doc)
    if (p.hn !== null && p.hn !== undefined && typeof p.hn !== 'string') {
      errors.push(`patients[${i}].hn must be string or null`);
    }
    if (p.pregNo == null || typeof p.pregNo !== 'number') {
      errors.push(`patients[${i}].pregNo is required (number)`);
    }
    if (p.riskLevel !== undefined && p.riskLevel !== null) {
      if (
        typeof p.riskLevel !== 'string' ||
        !(Object.values(AncRiskLevel) as string[]).includes(p.riskLevel)
      ) {
        errors.push(`patients[${i}].riskLevel must be one of LOW|HR1|HR2|HR3`);
      }
    }
    if (p.riskItemIds !== undefined && p.riskItemIds !== null) {
      if (
        !Array.isArray(p.riskItemIds) ||
        p.riskItemIds.some((x) => typeof x !== 'number' || !Number.isInteger(x))
      ) {
        errors.push(`patients[${i}].riskItemIds must be an array of integer item IDs`);
      }
    }
    for (const field of ['lmp', 'edc', 'birthday'] as const) {
      const v = p[field];
      if (v !== undefined && v !== null && (typeof v !== 'string' || Number.isNaN(Date.parse(v)))) {
        errors.push(`patients[${i}].${field} must be an ISO date string`);
      }
    }
  }

  if (errors.length > 0) {
    return { valid: false, error: `Validation errors: ${errors.join('; ')}` };
  }
  return { valid: true, payload: obj as unknown as WebhookAncPayload };
}

// CID guard for the referral CREATE webhook. The route handler already
// checks that `cid` is a non-empty string; this elevates it to the same
// 13-digit standard the labor + ANC paths enforce, so an old client can't
// poison the cross-hospital cidHash by posting a malformed referral.
export function validateReferralCid(
  value: unknown,
): { ok: true; cid: string } | { ok: false; message: string } {
  const result = diagnoseCid(value);
  if (result.ok) return { ok: true, cid: result.cid };
  return { ok: false, message: `cid ${describeCidFailure(result.failure)}` };
}

// ─── Main webhook processing ───

export async function processWebhookPayload(
  db: DatabaseAdapter,
  hospitalId: string,
  payload: WebhookPayload,
  sseManager: SseManager,
): Promise<WebhookResult> {
  const encryptionKey = getEncryptionKey();
  // Bounded cooperative yielding (2026-07-17 page-latency incident): this
  // runs on the ONE serving event loop, so every ~25ms of per-patient work
  // hands control back so concurrent HTTP requests interleave. Ticks go at
  // the TOP of each outer per-patient iteration, always OUTSIDE any
  // db.transaction body (a yield inside a tx would lengthen its lock hold).
  const yielder = new CooperativeYielder();

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

  // Handle deletes first — remove patients marked for deletion. All
  // patient-owned tables (cpd_scores, cached_vital_signs,
  // cached_partograph_observations) and the patient row commit or roll back
  // together; a partial delete must never survive a failure.
  const toDelete = payload.patients.filter((p) => p.action === 'delete');
  let deletedCount = 0;
  for (const p of toDelete) {
    await yielder.tick(); // before entering the per-patient transaction
    await db.transaction(async (tx) => {
      for (const table of ['cpd_scores', 'cached_vital_signs', 'cached_partograph_observations']) {
        await tx.execute(
          `DELETE FROM ${table} WHERE patient_id IN (SELECT id FROM cached_patients WHERE hospital_id = ? AND an = ?)`,
          [hospitalId, p.an],
        );
      }
      await tx.execute(`DELETE FROM cached_patients WHERE hospital_id = ? AND an = ?`, [
        hospitalId,
        p.an,
      ]);
    });
    deletedCount++;
  }

  // Transform remaining patients (upsert) to SyncPatientData. A `for` loop
  // rather than `.map` so the per-patient AES work (name + cid encryption,
  // SHA-256) can tick the yielder — mechanical conversion, identical output
  // array (page-stall fix part 2).
  const toUpsert = payload.patients.filter((p) => p.action !== 'delete');
  const patients: SyncPatientData[] = [];
  for (const p of toUpsert) {
    await yielder.tick();
    const encryptedName = encrypt(p.name, encryptionKey);
    const encryptedCid = p.cid ? encrypt(p.cid, encryptionKey) : null;
    const cidHash = p.cid ? createHash('sha256').update(p.cid).digest('hex') : null;

    patients.push({
      hn: p.hn,
      an: p.an,
      name: encryptedName,
      cid: encryptedCid,
      cidHash,
      age: p.age,
      gravida: p.gravida ?? null,
      para: p.para ?? null,
      abortion: p.abortion ?? null,
      livingChildren: p.living_children ?? null,
      pregNo: p.preg_no ?? null,
      gaWeeks: p.ga_weeks ?? null,
      gaDay: p.ga_day ?? null,
      ancCount: p.anc_count ?? null,
      admitDate: p.admit_date,
      heightCm: p.height_cm ?? null,
      weightKg: p.weight_kg ?? null,
      weightDiffKg: p.weight_diff_kg ?? null,
      prePregnancyWeightKg: p.pre_pregnancy_weight_kg ?? null,
      fundalHeightCm: p.fundal_height_cm ?? null,
      usWeightG: p.us_weight_g ?? null,
      hematocritPct: p.hematocrit_pct ?? null,
      bpSystolicAdmit: p.bp_systolic_admit ?? null,
      bpDiastolicAdmit: p.bp_diastolic_admit ?? null,
      pulseAdmit: p.pulse_admit ?? null,
      rrAdmit: p.rr_admit ?? null,
      temperatureAdmit: p.temperature_admit ?? null,
      cervicalOpenCmAdmit: p.cervical_open_cm_admit ?? null,
      effacementPctAdmit: p.effacement_pct_admit ?? null,
      stationAdmit: p.station_admit ?? null,
      laborStatus: p.labor_status ?? 'ACTIVE',
      syncedAt: new Date().toISOString(),
    });
  }

  // Upsert patients (reuse existing sync pipeline)
  await upsertCachedPatients(db, hospitalId, patients);

  // Link each ACTIVE labor admission to its maternal journey and transition
  // PREGNANCY -> LABOR (walk-ins get a LABOR journey). linkJourneyToLabor is
  // the single service-layer entry point: cid-hash-first + HN-fallback
  // lookup, stage guard (DELIVERED journeys are never regressed), FK write.
  // One transaction per patient (spec 3.1): the journey_id link and the
  // stage transition (or walk-in creation) commit together.
  for (const p of patients) {
    await yielder.tick();
    if ((p.laborStatus ?? 'ACTIVE') !== 'ACTIVE') continue;
    const rows = await db.query<{ id: string }>(
      'SELECT id FROM cached_patients WHERE hospital_id = ? AND an = ?',
      [hospitalId, p.an],
    );
    if (rows.length === 0) continue;
    await db.transaction((tx) =>
      linkJourneyToLabor(tx, hospitalId, p.hn, rows[0].id, p.cidHash ?? null, p.cid ?? null),
    );
  }

  // ─── Maternal screening ingest (Task 7 — flag-gated, GC2/GC6/GC7) ───
  // Runs AFTER the cached_patients upsert + journey link so the assessment
  // attaches to the just-upserted admission row (labor_admission_id) and its
  // journey. When the flag is OFF the object is ignored entirely: no
  // validation, no evaluation, no write — legacy behavior is untouched (GC7).
  // Evaluation is ALWAYS server-side inside the Task 6 store (GC2); the store
  // writes the assessment row + summary atomically and emits NO events
  // (Task 8 owns events). A failure for one patient never aborts the batch or
  // touches other patients' data.
  const screeningResult = { saved: 0, duplicates: 0, errors: [] as string[] };
  let screeningCarriers = 0;
  if (isMaternalScreenIngestEnabled()) {
    for (let i = 0; i < payload.patients.length; i++) {
      await yielder.tick();
      const p = payload.patients[i];
      if (p.maternal_screening == null) continue;
      screeningCarriers++;
      const label = `patients[${i}]`;
      // A screening riding a delete cannot attach to a surviving admission —
      // make the drop operator-visible instead of a silent `continue`
      // (review MINOR 5).
      if (p.action === 'delete') {
        screeningResult.errors.push(
          `${label}.maternal_screening: ignored because the patient is marked action:'delete' — screening cannot attach to a deleted admission; send it on an upsert`,
        );
        continue;
      }
      try {
        const validated = validateMaternalScreeningTransport(p, label);
        if (!validated.ok) {
          // Validation rejections are PHI-free `patients[i].field` strings —
          // surface them to the server log so an operator sees a dropped
          // assessment on ANY path, including browser-push (review IMPORTANT 1b).
          screeningResult.errors.push(...validated.errors);
          logger.warn('maternal_screen_webhook_ingest_rejected', {
            hospitalId,
            errors: validated.errors,
          });
          continue;
        }
        const admissionRows = await db.query<{
          id: string;
          journey_id: string | null;
          // Previous summary axes — read BEFORE the save so the post-commit
          // transition check (Task 8) has a "before" to compare against.
          // null means "no assessment existed yet" (GC1: never a stable
          // finding), matching MaternalScreenPreviousSummary's contract.
          maternal_screen_local_tier: string | null;
          maternal_screen_emergency_acuity: string | null;
        }>(
          `SELECT id, journey_id, maternal_screen_local_tier, maternal_screen_emergency_acuity
             FROM cached_patients WHERE hospital_id = ? AND an = ?`,
          [hospitalId, p.an],
        );
        if (admissionRows.length === 0) {
          screeningResult.errors.push(
            `${label}.maternal_screening: no labor admission row exists for this AN after upsert — assessment not stored; resend once the admission is accepted`,
          );
          logger.warn('maternal_screen_webhook_ingest_rejected', {
            hospitalId,
            errors: ['no labor admission row for AN after upsert'],
          });
          continue;
        }
        const admission = admissionRows[0];
        const previousSummary: MaternalScreenPreviousSummary = {
          localTier: admission.maternal_screen_local_tier as MaternalScreenLocalTier | null,
          emergencyAcuity:
            admission.maternal_screen_emergency_acuity as MaternalEmergencyAcuity | null,
        };
        const saveResult = await saveMaternalScreenAssessment(db, {
          hospitalId,
          laborAdmissionId: admission.id,
          journeyId: admission.journey_id,
          sourceSystem: 'WEBHOOK',
          sourcePk: validated.candidate.sourcePk,
          assessedAt: validated.candidate.assessedAt,
          assessedBy: validated.candidate.assessedBy,
          input: validated.candidate.input,
          evaluatedAt: new Date().toISOString(),
        });
        if (saveResult.status === 'duplicate') screeningResult.duplicates++;
        else screeningResult.saved++;

        // ─── Task 8: gated, POST-COMMIT state-change broadcast ───
        // saveMaternalScreenAssessment has already committed by the time it
        // returns (GC6) — the store itself is event-free by design. The
        // transition is decided on the store's PROJECTED post-save summary
        // (saveResult.summary — the latest-by-assessed_at row), NEVER on the
        // incoming assessment's own result: a backfilled OLDER assessment
        // that does not become latest leaves the summary unchanged, and
        // announcing the incoming (e.g. downgraded) tier would contradict
        // the persisted summary and the read API's `latest`. Never
        // broadcasts on a 'duplicate' replay (idempotent no-op, no summary
        // on the result), never when the flag is off (default — GC2), and
        // never when the projected summary did not actually transition
        // (shouldEmitMaternalScreenTransition on projected before/after —
        // this also prevents a concurrent double-save from emitting twice
        // for the same final state).
        const projected = saveResult.summary;
        if (
          isMaternalScreenEventsEnabled() &&
          (saveResult.status === 'created' || saveResult.status === 'corrected') &&
          projected?.localTier != null &&
          projected.emergencyAcuity != null &&
          shouldEmitMaternalScreenTransition(previousSummary, {
            localTier: projected.localTier,
            emergencyAcuity: projected.emergencyAcuity,
          })
        ) {
          sseManager.broadcast(
            'patient-update',
            buildMaternalScreenStateChangedEvent({
              patientId: admission.id,
              previous: previousSummary,
              // PROJECTED values throughout — the event must mirror what the
              // summary/read API now say, not the row that happened to arrive.
              localTier: projected.localTier,
              emergencyAcuity: projected.emergencyAcuity,
              isComplete: projected.isComplete ?? false,
              suspectedConditions: projected.suspectedConditions,
              assessedAt: projected.assessedAt ?? validated.candidate.assessedAt,
            }),
          );

          // MOPH Prompt EMERGENCY alert enqueue (codex #2 EMERGENCY producer).
          // Fires only on a real transition into EMERGENCY/URGENT acuity (not
          // STABLE/UNKNOWN). Best-effort: a failure never breaks screening.
          // ruleId = emerg_<acuity> so distinct levels co-fire (codex #5); the
          // drain (browser-push path) is the only LINE I/O site.
          const acuity = projected.emergencyAcuity;
          if (acuity === 'EMERGENCY' || acuity === 'URGENT') {
            try {
              const hosp = await db.query<{ name: string; province_code: string | null }>(
                'SELECT name, province_code FROM hospitals WHERE id = ?',
                [hospitalId],
              );
              await enqueueEmergencyAlert(db, {
                hospitalId,
                originHcode: hcode,
                hospitalName: hosp[0]?.name ?? hcode,
                province: hosp[0]?.province_code ?? '',
                caseRef: admission.journey_id
                  ? `LABOR-${admission.journey_id}`
                  : `LABOR-AN-${p.an}`,
                localDate: new Date().toLocaleDateString('en-CA', {
                  timeZone: 'Asia/Bangkok',
                }),
                patientName: typeof p.name === 'string' ? p.name : null,
                confirmUrl: null,
                acuityLabel: EMERGENCY_ACUITY_LABEL_TH[acuity],
                ruleId: `emerg_${acuity.toLowerCase()}`,
              });
            } catch (e) {
              // Alerting is best-effort — never let it break maternal screening.
              logger.warn('moph_alert_emergency_enqueue_failed', {
                hospitalId,
                an: p.an,
                acuity,
                error: e,
              });
            }
          }
        }
      } catch (err) {
        // Store errors are PHI-free by contract (ids/codes only — never
        // name/cid/free text), so their message is safe and actionable.
        const detail =
          err instanceof MaternalScreenStoreError
            ? `${err.code}: ${err.message}`
            : 'assessment write failed and was rolled back — nothing persisted for this patient; the rest of the batch is unaffected';
        screeningResult.errors.push(`${label}.maternal_screening: ${detail}`);
        logger.error('maternal_screen_webhook_ingest_failed', {
          hospitalId,
          code: err instanceof MaternalScreenStoreError ? err.code : 'WRITE_FAILED',
        });
      }
    }
  }

  // Detect transfers
  const transfers = await detectTransfers(db, hospitalId, patients);
  for (const transfer of transfers) {
    await db.execute(
      `UPDATE cached_patients SET labor_status = 'TRANSFERRED', updated_at = ?
       WHERE hospital_id = ? AND an = ?`,
      [new Date().toISOString(), transfer.fromHospitalId, transfer.fromAn],
    );

    const fromRows = await db.query<{ hcode: string }>('SELECT hcode FROM hospitals WHERE id = ?', [
      transfer.fromHospitalId,
    ]);
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

  // Reconcile discharges: close out cached ACTIVE patients the source's
  // authoritative active set no longer contains. Two ways a caller declares it:
  //   • activeAns — explicit complete AN list. The browser push uses this
  //     because its `patients` upsert list may be filtered (name-authenticity
  //     probe) or capped at 100, so it cannot double as the active set.
  //   • mode === 'full_snapshot' — the `patients` array IS the complete set
  //     (non-HOSxP webhook senders).
  // Incremental pushes with no activeAns reconcile nothing (legacy behavior).
  // markPatientsDelivered guards on labor_status='ACTIVE', so TRANSFERRED and
  // already-closed rows are never clobbered.
  const mode = payload.mode ?? 'incremental';
  const authoritativeActiveAns =
    payload.activeAns !== undefined
      ? payload.activeAns
      : mode === 'full_snapshot'
        ? patients.map((p) => p.an)
        : null;
  let dischargeCount = 0;
  if (authoritativeActiveAns !== null) {
    const activeSet = new Set(authoritativeActiveAns);
    const toDischarge = existingAns.filter((an) => !activeSet.has(an));
    if (toDischarge.length > 0) {
      // Distinguish transfers from deliveries: a reconciled patient whose
      // cid_hash is ACTIVE at another hospital was transferred out, not
      // delivered. Mark those TRANSFERRED (matching detectTransfers) so the
      // sending hospital's board + delivery stats stay correct; close the rest
      // out as DELIVERED.
      const phAn = toDischarge.map(() => '?').join(',');
      const cidRows = await db.query<{ an: string; cid_hash: string | null }>(
        `SELECT an, cid_hash FROM cached_patients
          WHERE hospital_id = ? AND an IN (${phAn})`,
        [hospitalId, ...toDischarge],
      );
      const cidHashByAn = new Map(cidRows.map((r) => [r.an, r.cid_hash]));
      const cidHashes = cidRows.map((r) => r.cid_hash).filter((h): h is string => !!h);
      let activeElsewhere = new Set<string>();
      if (cidHashes.length > 0) {
        const phCid = cidHashes.map(() => '?').join(',');
        const others = await db.query<{ cid_hash: string }>(
          `SELECT DISTINCT cid_hash FROM cached_patients
            WHERE hospital_id <> ? AND labor_status = 'ACTIVE'
              AND cid_hash IN (${phCid})`,
          [hospitalId, ...cidHashes],
        );
        activeElsewhere = new Set(others.map((r) => r.cid_hash));
      }

      const transferredOut: string[] = [];
      const deliveredOut: string[] = [];
      for (const an of toDischarge) {
        const ch = cidHashByAn.get(an);
        if (ch && activeElsewhere.has(ch)) transferredOut.push(an);
        else deliveredOut.push(an);
      }

      if (transferredOut.length > 0) {
        const ts = new Date().toISOString();
        for (const an of transferredOut) {
          await db.execute(
            `UPDATE cached_patients SET labor_status = 'TRANSFERRED', updated_at = ?
               WHERE hospital_id = ? AND an = ? AND labor_status = 'ACTIVE'`,
            [ts, hospitalId, an],
          );
        }
      }
      if (deliveredOut.length > 0) {
        await markPatientsDelivered(db, hospitalId, deliveredOut);
        for (const an of deliveredOut) {
          sseManager.broadcast('patient-update', {
            type: 'patient_discharged',
            hcode,
            an,
          });
        }
      }
      dischargeCount = toDischarge.length;
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
    // Screening counters appear ONLY when the ingest flag is on AND at least
    // one patient carried a maternal_screening object — legacy responses stay
    // byte-identical (GC7).
    ...(screeningCarriers > 0
      ? {
          maternalScreenAssessments: screeningResult.saved,
          maternalScreenDuplicates: screeningResult.duplicates,
          maternalScreenIngestErrors: screeningResult.errors,
        }
      : {}),
  };
}

// ─── ANC webhook processing ───

// Persist one risk-screening observation per CHANGE in classification —
// level + checked-item labels — so the journey detail can show which
// provincial criteria fired and when. Unchanged classifications are not
// re-inserted (the webhook pushes every few minutes; without the dedupe
// this table would grow one row per woman per push).
function maxRiskLevel(a: AncRiskLevel, b: AncRiskLevel): AncRiskLevel {
  return ANC_RISK_LEVEL_ORDER[a] >= ANC_RISK_LEVEL_ORDER[b] ? a : b;
}

/**
 * Canonical ANC risk (2026-07-13 clinical rule): the item-derived severity is
 * authoritative and a declared level may only RAISE it, never lower it.
 * Returns null for legacy payloads carrying neither usable signal.
 */
export function resolveCanonicalAncRisk(
  declaredLevel: string | undefined,
  riskItemIds: number[] | null | undefined,
): AncRiskLevel | null {
  const declared =
    declaredLevel && (Object.values(AncRiskLevel) as string[]).includes(declaredLevel)
      ? (declaredLevel as AncRiskLevel)
      : null;
  if (!Array.isArray(riskItemIds)) return declared;
  const derived = classifyAncItems(riskItemIds).level as AncRiskLevel;
  if (declared && ANC_RISK_LEVEL_ORDER[declared] < ANC_RISK_LEVEL_ORDER[derived]) {
    logger.warn('anc_declared_risk_understated', { declared, derived });
  }
  return declared ? maxRiskLevel(declared, derived) : derived;
}

async function recordAncRiskScreening(
  db: DatabaseAdapter,
  journeyId: string,
  level: AncRiskLevel,
  itemIds: number[],
): Promise<void> {
  const derived = classifyAncItems(itemIds);
  const config = ANC_RISK_CONFIGS[level];
  await insertAncScreeningIfChanged(db, journeyId, {
    level,
    triggeredRulesJson: JSON.stringify(derived.labels),
    riskFactorsJson: JSON.stringify({ itemIds }),
    recommendedFacility: config?.facilityTh ?? null,
    recommendedProvider: config?.providerTh ?? null,
  });
}

export async function processAncWebhook(
  db: DatabaseAdapter,
  hospitalId: string,
  payload: WebhookAncPayload,
  sseManager: SseManager,
): Promise<WebhookAncResult> {
  const encryptionKey = getEncryptionKey();
  // Bounded cooperative yielding (2026-07-17 page-latency incident): ANC
  // bundles run hundreds of pregnancies × classification × per-field AES on
  // the ONE serving event loop; without yields, page TTFB spiked 3-7s during
  // push bursts. Tick at the TOP of the per-pregnancy iteration — OUTSIDE
  // the per-patient transactions below (never yield inside a tx).
  const yielder = new CooperativeYielder();

  const hospitalRows = await db.query<{ hcode: string }>(
    'SELECT hcode FROM hospitals WHERE id = ?',
    [hospitalId],
  );
  const hcode = hospitalRows[0]?.hcode ?? '';

  let created = 0;
  let updated = 0;
  let deleted = 0;
  let downgradesBlocked = 0;
  let visitConflicts = 0;
  let fieldOverflows = 0;

  // Defense-in-depth against "value too long for type character varying(N)":
  // a sender string exceeding its column is dropped (null) for THAT FIELD
  // only, counted, and logged non-PHI (never the value itself) — it must
  // never abort the patient or the hospital's whole bundle. Widths mirror
  // src/db/tables/ + migrations/widen-anc-result-columns.ts.
  const fitOrNull = (
    value: string | null | undefined,
    max: number,
    field: string,
  ): string | null => {
    if (value == null) return null;
    if (value.length <= max) return value;
    fieldOverflows++;
    logger.warn('anc_field_length_overflow', { hospitalId, field, length: value.length, max });
    return null;
  };
  let skippedInvalidCidChecksum = 0;

  for (const patient of payload.patients) {
    await yielder.tick();
    // Per-row Thai-CID checksum gate. validateAncPayload (called by both
    // /api/webhooks/patient-data and /api/sync/browser-push) only enforces
    // 13-digit format; old HOSxP versions can still emit 13-digit-but-fake
    // CIDs that pass format but fail the official ก.พ. checksum (observed at
    // hcode 10996: ~148 rows). Mirrors the equivalent guard in
    // services/sync/anc.ts so both ingestion paths skip the same bad rows
    // instead of corrupting cidHash → blocking cross-hospital matching.
    if (patient.action !== 'delete' && !isValidThaiCidChecksum(patient.cid)) {
      skippedInvalidCidChecksum++;
      const cidHashPrefix = createHash('sha256')
        .update(patient.cid ?? '')
        .digest('hex')
        .slice(0, 8);
      logger.warn('anc_webhook_skipped_invalid_cid_checksum', {
        hospitalId,
        hcode,
        hn: patient.hn,
        cidHashPrefix,
      });
      continue;
    }
    // Compute CID hash for lookup
    const patientCidHash = createHash('sha256').update(patient.cid).digest('hex');

    // Handle delete action — soft delete by setting care_stage to CANCELLED
    if (patient.action === 'delete') {
      const existing =
        (await getActiveJourneyByCid(db, patientCidHash)) ??
        (patient.hn ? await getJourneyByHn(db, patient.hn, hospitalId) : null);
      if (existing) {
        // Delete related records first — one transaction so a mid-sequence
        // failure never leaves an orphaned cached_anc_risks/newborns/referrals
        // row pointing at a journey that no longer exists.
        await db.transaction(async (tx) => {
          await tx.execute(`DELETE FROM cached_anc_visits WHERE journey_id = ?`, [existing.id]);
          await tx.execute(`DELETE FROM cached_anc_risks WHERE journey_id = ?`, [existing.id]);
          await tx.execute(`DELETE FROM cached_newborns WHERE journey_id = ?`, [existing.id]);
          await tx.execute(`DELETE FROM cached_referrals WHERE journey_id = ?`, [existing.id]);
          await tx.execute(`UPDATE cached_patients SET journey_id = NULL WHERE journey_id = ?`, [
            existing.id,
          ]);
          await tx.execute(`DELETE FROM maternal_journeys WHERE id = ?`, [existing.id]);
        });
        deleted++;
        // No per-journey broadcast — the coalesced bulk journey_update after
        // the loop covers deletes via its `deleted` count (2026-07-17
        // dashboard incident: per-row events × every tab = 79 req/s).
      }
      continue;
    }

    const encryptedName = encrypt(patient.name, encryptionKey);
    const encryptedCid = encrypt(patient.cid, encryptionKey);
    const cidHash = patientCidHash;

    // Primary lookup by CID (cross-hospital), fallback to HN+hospital (skip if HN is null)
    const patientHn = patient.hn;
    const cidMatch = await getActiveJourneyByCid(db, cidHash);

    // CID-collision guard (2026-07-19 ghost-journey incident): when TWO
    // different women at the SAME hospital share one CID (data-entry error /
    // placeholder), each one's push finds the OTHER's active journey via the
    // CID lookup, sees a different pregNo/lmp, declares "new pregnancy",
    // DELIVERS the other's journey and creates a fresh one — the pair then
    // ghost-delivers each other every sync cycle (~1,760 ghost DELIVERED
    // journeys per identity observed in production). Same hospital + same
    // CID + DIFFERENT HN is that collision signature (one hospital does not
    // issue one woman two HNs); a different-HOSPITAL journey is legitimate
    // cross-hospital continuity (referrals) and stays untouched. On
    // collision: route this patient to her own HN's journey and never roll
    // over the CID-matched one.
    const cidCollision =
      cidMatch != null &&
      patientHn != null &&
      cidMatch.hn !== '' &&
      cidMatch.hn !== patientHn &&
      cidMatch.hospitalId === hospitalId;
    if (cidCollision) {
      logger.warn('anc_cid_collision', {
        hospitalId,
        cidHashPrefix: cidHash.slice(0, 8),
        journeyHn: cidMatch.hn,
        patientHn,
      });
    }
    const existing =
      cidMatch != null && !cidCollision
        ? cidMatch
        : patientHn != null
          ? await getJourneyByHn(db, patientHn, hospitalId)
          : null;

    // Detect if incoming data is a NEW pregnancy vs update to existing.
    // The pg driver returns lmp as a Date (the column is `timestamp with
    // time zone`) even though the journey type claims string|null, so a
    // raw `!==` between the HOSxP-side string ("2026-01-12") and the
    // Date object compared identity — always true — and synthesised a new
    // pregnancy on every cycle. isoDatesEqual normalises both sides to
    // "YYYY-MM-DD" and compares as strings.
    const isNewPregnancy =
      existing &&
      (patient.pregNo > existing.gravida ||
        (patient.lmp != null && existing.lmp != null && !isoDatesEqual(patient.lmp, existing.lmp)));
    const existingIsActive =
      existing && (existing.careStage === 'PREGNANCY' || existing.careStage === 'LABOR');

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

    // Canonical severity — computed once and applied consistently to the
    // journey write, the SSE broadcast, and the risk-screening record below.
    const canonicalRisk = resolveCanonicalAncRisk(patient.riskLevel, patient.riskItemIds);

    // Downgrade guard (WHO containment T4): on the LIVE production ANC path,
    // missing evidence must NEVER lower a previously-known journey risk.
    // "Missing evidence" is either an empty riskItemIds array (a transient
    // HOSxP query returning zero classifying rows — the primary prod bug) or a
    // legacy declared-only payload (no riskItemIds at all). Only POSITIVE
    // current evidence — a non-empty riskItemIds array — may lower today's
    // level. Decided here where the existing journey is known so the journey
    // write, the SSE broadcast, and the screening append all agree on the level
    // actually persisted. Journey CREATION is unaffected (no prior level to
    // protect). Mirrors the polling-path guard in services/sync/anc.ts, but
    // keyed on evidence presence rather than assessment completeness.
    let downgradeBlockReason: 'empty_items' | 'declared_only' | null = null;
    if (
      !shouldCreateNew &&
      existing &&
      canonicalRisk &&
      ANC_RISK_LEVEL_ORDER[canonicalRisk] < ANC_RISK_LEVEL_ORDER[existing.ancRiskLevel]
    ) {
      if (!Array.isArray(patient.riskItemIds)) {
        downgradeBlockReason = 'declared_only';
      } else if (patient.riskItemIds.length === 0) {
        downgradeBlockReason = 'empty_items';
      }
      // non-empty riskItemIds → positive evidence; lowering is allowed (no block)
      if (downgradeBlockReason) {
        downgradesBlocked++;
        logger.warn('anc_risk_downgrade_blocked', {
          hospitalId,
          journeyId: existing.id,
          from: existing.ancRiskLevel,
          to: canonicalRisk,
          reason: downgradeBlockReason,
        });
      }
    }
    // The level actually persisted for THIS update: a blocked downgrade keeps
    // the existing journey level; everything else follows canonical resolution.
    const persistedRisk = downgradeBlockReason && existing ? existing.ancRiskLevel : canonicalRisk;

    // ONE transaction per patient (specs 3.2 + 3.3): journey update-or-create
    // (including pregnancy rollover), location update, and the risk screening
    // commit or roll back together. SSE is coalesced: ONE bulk journey_update
    // fires after the whole loop (see end of function) — per-pregnancy events
    // at 300+ pregnancies/push amplified into ~79 req/s of dashboard refetch
    // across connected tabs (2026-07-17 incident).
    const journeyId = await db.transaction(async (tx) => {
      let id: string;
      if (!shouldCreateNew && existing) {
        // Update existing journey with latest data (same pregnancy)
        const now = new Date().toISOString();
        await tx.execute(
          `UPDATE maternal_journeys SET name = ?, cid = ?, cid_hash = ?, lmp = ?, edc = ?, anc_risk_level = ?, synced_at = ?, updated_at = ? WHERE id = ?`,
          [
            encryptedName,
            encryptedCid,
            cidHash,
            patient.lmp ?? existing.lmp,
            patient.edc ?? existing.edc,
            persistedRisk ?? existing.ancRiskLevel,
            now,
            now,
            existing.id,
          ],
        );
        id = existing.id;
        updated++;
      } else {
        // If the prior journey is still PREGNANCY/LABOR for this hospital,
        // close it before inserting the new pregnancy. Same reasoning as in
        // services/sync/anc.ts: a new preg_no on the same HN means the old
        // pregnancy ended in HOSxP, and without this transition the unique
        // partial index uq_mj_hospital_hn_active rejects the INSERT below
        // and the webhook returns a 500 to HOSxP.
        // Rollover atomicity: closing the old pregnancy and creating the new
        // one commit together — a crash can never leave zero active journeys.
        if (isNewPregnancy && existingIsActive && existing) {
          await transitionToDelivered(tx, existing.id);
        }
        // Create new journey (first pregnancy, or new pregnancy after previous)
        const age = patient.birthday
          ? Math.floor(
              (Date.now() - new Date(patient.birthday).getTime()) / (365.25 * 24 * 60 * 60 * 1000),
            )
          : 0;
        const journey = await createJourney(tx, {
          hospitalId,
          hn: patientHn ?? '', // null for community ANC patients not in hospital patient table
          personAncId: null,
          name: encryptedName,
          cid: encryptedCid,
          cidHash,
          age,
          gravida: patient.pregNo,
          para: 0,
          lmp: patient.lmp ?? null,
          edc: patient.edc ?? null,
          ancRiskLevel: canonicalRisk ?? AncRiskLevel.LOW,
        });
        id = journey.id;
        created++;
      }

      // Update patient location (province/district/sub-district) if provided
      if (patient.changwatCode || patient.amphurCode || patient.tambonCode) {
        const now3 = new Date().toISOString();
        await tx.execute(
          `UPDATE maternal_journeys SET changwat_code = ?, amphur_code = ?, tambon_code = ?, updated_at = ? WHERE id = ?`,
          [
            patient.changwatCode ?? null,
            patient.amphurCode ?? null,
            patient.tambonCode ?? null,
            now3,
            id,
          ],
        );
      }

      // Persist the risk screening (level + which criteria fired) when the
      // client sends the checked classifying items. Legacy payloads without
      // riskItemIds keep the old level-only behavior. A blocked downgrade must
      // NOT append its (lower) screening row — that would reintroduce the
      // journey-vs-latest-screening mismatch the reconciliation report flags.
      // (`canonicalRisk` stays in the guard — it is type-load-bearing, narrowing
      //  the null case for the recordAncRiskScreening call below.)
      if (Array.isArray(patient.riskItemIds) && canonicalRisk && !downgradeBlockReason) {
        await recordAncRiskScreening(tx, id, canonicalRisk, patient.riskItemIds);
      }

      return id;
    });

    // Persist ANC visit records — HOSPITAL-SCOPED replace (WHO containment T5).
    // The journey is shared cross-hospital via cid_hash, so an UNSCOPED delete
    // let hospital B's push erase hospital A's visit rows and re-stamp them
    // hospital B. Now: (1) delete ONLY this hospital's rows, (2) skip incoming
    // visits whose date collides with a row owned by another hospital (never
    // overwrite — that is the provincial history), (3) roll the summary up from
    // a DB aggregate over ALL surviving rows (all hospitals). The whole
    // replace + roll-up is ONE transaction so a mid-loop failure can never
    // leave a partial delete (prior rows are restored on rollback).
    if (patient.visits && patient.visits.length > 0) {
      const incomingVisits = patient.visits;
      await db.transaction(async (tx) => {
        // Scope strictly to the authenticated pushing hospital. Rows with
        // hospital_id IS NULL (legacy, normally backfilled at startup from
        // journey.current_hospital_id) are NEVER deleted by this path —
        // they are treated as another hospital's rows for conflict purposes.
        await tx.execute(`DELETE FROM cached_anc_visits WHERE journey_id = ? AND hospital_id = ?`, [
          journeyId,
          hospitalId,
        ]);

        // Surviving rows = other hospitals' rows + NULL-hospital rows. Map
        // their calendar day → owning hospital so an incoming same-day visit
        // is rejected (conflict), not overwritten. Concurrent-writer race
        // beyond this in-transaction pre-check is accepted residual risk for
        // containment — there is one pusher per hospital.
        const survivors = await tx.query<{ visit_date: string | Date; hospital_id: string | null }>(
          `SELECT visit_date, hospital_id FROM cached_anc_visits WHERE journey_id = ?`,
          [journeyId],
        );
        const claimedByOther = new Map<string, string | null>();
        for (const row of survivors) {
          const key = toIsoDate(row.visit_date);
          if (key) claimedByOther.set(key, row.hospital_id);
        }

        const visitNow = new Date().toISOString();
        const insertedDays = new Set<string>();
        for (const visit of incomingVisits) {
          const day = toIsoDate(visit.date);
          if (day && claimedByOther.has(day)) {
            // Same-day cross-hospital conflict — skip, count, log. No visit
            // date, no PHI — only journey + hospital identifiers.
            visitConflicts++;
            logger.warn('anc_cross_hospital_visit_conflict', {
              journeyId,
              hospitalId,
              conflictingHospitalId: claimedByOther.get(day) ?? null,
            });
            continue;
          }
          // Guard the unique (journey_id, visit_date) index against a
          // payload that repeats a date: keep the first, skip the rest, so a
          // duplicate never aborts (and rolls back) the whole transaction.
          if (day && insertedDays.has(day)) continue;
          if (day) insertedDays.add(day);
          await tx.execute(
            `INSERT INTO cached_anc_visits
             (id, journey_id, hospital_id, visit_date, visit_number, ga_weeks,
              fundal_height_cm, weight_kg, bp_systolic, bp_diastolic,
              fetal_hr, presentation, engagement,
              urine_protein, urine_glucose, hb_g_dl, hct_pct,
              tt_dose_no, iron_folic_given, calcium_given,
              danger_signs_json, fetal_movement_ok,
              vaccines_given_json, urine_ketone, urine_culture_result,
              iodine_given, multivitamin_given, vitamin_d_iu,
              nst_result, bpp_score, umbilical_doppler_result,
              psychosocial_screen_json,
              synced_at, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                     ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              // hospital_id is the webhook's authenticated hospital — visits
              // arrive in the payload of THAT hospital's webhook, so attribute
              // each visit to it. Cross-hospital ANC for referred patients is
              // captured because the receiving hospital's webhook reports it.
              uuidv4(),
              journeyId,
              hospitalId,
              visit.date,
              visit.visitNumber,
              visit.gaWeeks ?? null,
              visit.fundalHeightCm ?? null,
              visit.weightKg ?? null,
              visit.bpSystolic ?? null,
              visit.bpDiastolic ?? null,
              visit.fetalHr ?? null,
              fitOrNull(visit.presentation, 50, 'presentation'),
              fitOrNull(visit.engagement, 50, 'engagement'),
              fitOrNull(visit.urineProtein, 50, 'urine_protein'),
              fitOrNull(visit.urineGlucose, 50, 'urine_glucose'),
              visit.hbGDl ?? null,
              visit.hctPct ?? null,
              visit.ttDoseNo ?? null,
              // Postgres is strict on boolean columns — must be true/false,
              // not 1/0. SQLite is lenient; we normalize here for both paths.
              visit.ironFolicGiven == null ? null : Boolean(visit.ironFolicGiven),
              visit.calciumGiven == null ? null : Boolean(visit.calciumGiven),
              visit.dangerSigns ? JSON.stringify(visit.dangerSigns) : null,
              visit.fetalMovementOk == null ? null : Boolean(visit.fetalMovementOk),
              // RTCOG OB 66-029 per-visit additions.
              visit.vaccinesGiven ? JSON.stringify(visit.vaccinesGiven) : null,
              fitOrNull(visit.urineKetone, 50, 'urine_ketone'),
              fitOrNull(visit.urineCultureResult, 50, 'urine_culture_result'),
              visit.iodineGiven == null ? null : Boolean(visit.iodineGiven),
              visit.multivitaminGiven == null ? null : Boolean(visit.multivitaminGiven),
              visit.vitaminDIu ?? null,
              fitOrNull(visit.nstResult, 20, 'nst_result'),
              visit.bppScore ?? null,
              fitOrNull(visit.umbilicalDopplerResult, 20, 'umbilical_doppler_result'),
              visit.psychosocialScreen ? JSON.stringify(visit.psychosocialScreen) : null,
              visitNow,
              visitNow,
            ],
          );
        }

        // Summary roll-up = DB aggregate over ALL of the journey's surviving
        // visits (every hospital — this is the provincial history), not the
        // payload's own count (spec §7.6 rule 11): anc_visit_count = COUNT(*),
        // last_anc_date = MAX(visit_date). Done as SQL subqueries so the
        // TIMESTAMPTZ date never round-trips through JS. ga_weeks is still a
        // COALESCE hint from the payload's last visit (highest visit_number,
        // then latest date) so an incremental push keeps a prior GA.
        const sorted = [...incomingVisits].sort((a, b) => {
          const bn = (b.visitNumber ?? 0) - (a.visitNumber ?? 0);
          if (bn !== 0) return bn;
          return (b.date ?? '').localeCompare(a.date ?? '');
        });
        const lastVisit = sorted[0];
        await tx.execute(
          `UPDATE maternal_journeys
              SET anc_visit_count = (SELECT COUNT(*) FROM cached_anc_visits WHERE journey_id = ?),
                  last_anc_date = (SELECT MAX(visit_date) FROM cached_anc_visits WHERE journey_id = ?),
                  ga_weeks = COALESCE(?, ga_weeks),
                  updated_at = ?
            WHERE id = ?`,
          [journeyId, journeyId, lastVisit?.gaWeeks ?? null, visitNow, journeyId],
        );
      });
    }

    // Persist journey-level WHO ANC data (labs, obstetric history, PMH).
    // Only touches provided fields — COALESCE preserves any prior value so an
    // incremental update doesn't wipe labs recorded earlier.
    const hasJourneyExt =
      patient.bloodGroup !== undefined ||
      patient.rhFactor !== undefined ||
      patient.hbsagResult !== undefined ||
      patient.vdrlResult !== undefined ||
      patient.hivResult !== undefined ||
      patient.ogttResult !== undefined ||
      patient.termBirths !== undefined ||
      patient.pretermBirths !== undefined ||
      patient.abortions !== undefined ||
      patient.livingChildren !== undefined ||
      patient.pastMedicalHistory !== undefined;
    if (hasJourneyExt) {
      const nowExt = new Date().toISOString();
      await db.execute(
        `UPDATE maternal_journeys SET
           blood_group = COALESCE(?, blood_group),
           rh_factor = COALESCE(?, rh_factor),
           hbsag_result = COALESCE(?, hbsag_result),
           vdrl_result = COALESCE(?, vdrl_result),
           hiv_result = COALESCE(?, hiv_result),
           ogtt_result = COALESCE(?, ogtt_result),
           term_births = COALESCE(?, term_births),
           preterm_births = COALESCE(?, preterm_births),
           abortions = COALESCE(?, abortions),
           living_children = COALESCE(?, living_children),
           past_medical_history = COALESCE(?, past_medical_history),
           updated_at = ?
         WHERE id = ?`,
        [
          fitOrNull(patient.bloodGroup, 10, 'blood_group'),
          fitOrNull(patient.rhFactor, 10, 'rh_factor'),
          fitOrNull(patient.hbsagResult, 50, 'hbsag_result'),
          fitOrNull(patient.vdrlResult, 50, 'vdrl_result'),
          fitOrNull(patient.hivResult, 50, 'hiv_result'),
          fitOrNull(patient.ogttResult, 50, 'ogtt_result'),
          patient.termBirths ?? null,
          patient.pretermBirths ?? null,
          patient.abortions ?? null,
          patient.livingChildren ?? null,
          patient.pastMedicalHistory ?? null,
          nowExt,
          journeyId,
        ],
      );
    }

    // ── RTCOG OB 66-029 journey-level extensions ───────────────────────
    // Kept in a second UPDATE so the existing block stays readable and any
    // future RTCOG revisions only churn this one. Same COALESCE strategy:
    // an undefined/null field preserves whatever's already there.
    const hasRtcogExt =
      patient.mcvFl !== undefined ||
      patient.dcipResult !== undefined ||
      patient.hbEResult !== undefined ||
      patient.thalassemiaType !== undefined ||
      patient.cervicalScreenType !== undefined ||
      patient.cervicalScreenResult !== undefined ||
      patient.cervicalScreenDate !== undefined ||
      patient.aneuploidyMethod !== undefined ||
      patient.aneuploidyResult !== undefined ||
      patient.gbsResult !== undefined ||
      patient.gbsCollectedDate !== undefined ||
      patient.anatomyScanDate !== undefined ||
      patient.anatomyScanResult !== undefined ||
      patient.efwG !== undefined ||
      patient.datingMethod !== undefined ||
      patient.proteinuria24hMg !== undefined ||
      patient.creatinineMgDl !== undefined ||
      patient.priorPeDvt !== undefined ||
      patient.severeLungDisease !== undefined ||
      patient.alloimmunizationCde !== undefined ||
      patient.bariatricSurgeryHx !== undefined ||
      patient.teratogenExposure !== undefined ||
      patient.congenitalInfection !== undefined ||
      patient.gdmRiskFactors !== undefined;
    if (hasRtcogExt) {
      const nowRt = new Date().toISOString();
      await db.execute(
        `UPDATE maternal_journeys SET
           mcv_fl = COALESCE(?, mcv_fl),
           dcip_result = COALESCE(?, dcip_result),
           hb_e_result = COALESCE(?, hb_e_result),
           thalassemia_type = COALESCE(?, thalassemia_type),
           cervical_screen_type = COALESCE(?, cervical_screen_type),
           cervical_screen_result = COALESCE(?, cervical_screen_result),
           cervical_screen_date = COALESCE(?, cervical_screen_date),
           aneuploidy_method = COALESCE(?, aneuploidy_method),
           aneuploidy_result = COALESCE(?, aneuploidy_result),
           gbs_result = COALESCE(?, gbs_result),
           gbs_collected_date = COALESCE(?, gbs_collected_date),
           anatomy_scan_date = COALESCE(?, anatomy_scan_date),
           anatomy_scan_result = COALESCE(?, anatomy_scan_result),
           efw_g = COALESCE(?, efw_g),
           dating_method = COALESCE(?, dating_method),
           proteinuria_24h_mg = COALESCE(?, proteinuria_24h_mg),
           creatinine_mg_dl = COALESCE(?, creatinine_mg_dl),
           prior_pe_dvt = COALESCE(?, prior_pe_dvt),
           severe_lung_disease = COALESCE(?, severe_lung_disease),
           alloimmunization_cde = COALESCE(?, alloimmunization_cde),
           bariatric_surgery_hx = COALESCE(?, bariatric_surgery_hx),
           teratogen_exposure = COALESCE(?, teratogen_exposure),
           congenital_infection = COALESCE(?, congenital_infection),
           gdm_risk_factors_json = COALESCE(?, gdm_risk_factors_json),
           updated_at = ?
         WHERE id = ?`,
        [
          patient.mcvFl ?? null,
          fitOrNull(patient.dcipResult, 10, 'dcip_result'),
          fitOrNull(patient.hbEResult, 10, 'hb_e_result'),
          fitOrNull(patient.thalassemiaType, 20, 'thalassemia_type'),
          fitOrNull(patient.cervicalScreenType, 10, 'cervical_screen_type'),
          fitOrNull(patient.cervicalScreenResult, 20, 'cervical_screen_result'),
          patient.cervicalScreenDate ?? null,
          fitOrNull(patient.aneuploidyMethod, 20, 'aneuploidy_method'),
          fitOrNull(patient.aneuploidyResult, 20, 'aneuploidy_result'),
          fitOrNull(patient.gbsResult, 10, 'gbs_result'),
          patient.gbsCollectedDate ?? null,
          patient.anatomyScanDate ?? null,
          fitOrNull(patient.anatomyScanResult, 20, 'anatomy_scan_result'),
          patient.efwG ?? null,
          fitOrNull(patient.datingMethod, 10, 'dating_method'),
          patient.proteinuria24hMg ?? null,
          patient.creatinineMgDl ?? null,
          patient.priorPeDvt == null ? null : Boolean(patient.priorPeDvt),
          patient.severeLungDisease == null ? null : Boolean(patient.severeLungDisease),
          patient.alloimmunizationCde == null ? null : Boolean(patient.alloimmunizationCde),
          patient.bariatricSurgeryHx == null ? null : Boolean(patient.bariatricSurgeryHx),
          patient.teratogenExposure == null ? null : Boolean(patient.teratogenExposure),
          patient.congenitalInfection == null ? null : Boolean(patient.congenitalInfection),
          patient.gdmRiskFactors ? JSON.stringify(patient.gdmRiskFactors) : null,
          nowRt,
          journeyId,
        ],
      );
    }
  }

  await db.execute(
    "UPDATE hospitals SET connection_status = 'ONLINE', last_sync_at = ? WHERE id = ?",
    [new Date().toISOString(), hospitalId],
  );

  if (skippedInvalidCidChecksum > 0) {
    logger.info('anc_webhook_run_summary', {
      hospitalId,
      hcode,
      received: payload.patients.length,
      created,
      updated,
      deleted,
      skippedInvalidCidChecksum,
    });
  }

  // ONE coalesced broadcast per ANC ingest call (2026-07-17 dashboard
  // incident: a per-pregnancy journey_update at 300+ pregnancies/push made
  // every open tab refetch per event — ~79 req/s from four sessions).
  // Clients treat any patient-update as "revalidate", so a single bulk
  // event with counts carries the same refresh signal at 1/300th the rate.
  // All per-patient transactions above have committed by this point.
  if (created + updated + deleted > 0) {
    sseManager.broadcast('patient-update', {
      type: 'journey_update',
      hcode,
      bulk: true,
      created,
      updated,
      deleted,
    });
  }

  return {
    // Skipped checksum-invalid rows shouldn't count as "processed" — the
    // Sync Log header reads "Upserted N pregnancies" off this and would
    // otherwise overstate progress for hospitals like 10996 with bad CIDs.
    patientsProcessed: payload.patients.length - skippedInvalidCidChecksum,
    created,
    updated,
    deleted,
    downgradesBlocked,
    visitConflicts,
    fieldOverflows,
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
  const existingJourney =
    (await getActiveJourneyByCid(db, cidHash)) ??
    (await getJourneyByHn(db, payload.hn, hospitalId));

  // Also check if patient has active labor data (cached_patients)
  const laborRecord = await db.query<{
    id: string;
    journey_id: string | null;
    labor_status: string;
  }>(
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
      [
        journeyId,
        hospitalId,
        hospitalId,
        payload.hn,
        encryptedName,
        encryptedCid,
        cidHash,
        now,
        now,
        now,
        now,
        now,
      ],
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
      [
        payload.changwatCode ?? null,
        payload.amphurCode ?? null,
        payload.tambonCode ?? null,
        nowLoc,
        journeyId,
      ],
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
      [
        id,
        journeyId,
        payload.referralId,
        hospitalId,
        toHospital.id,
        payload.reason,
        payload.diagnosisCode ?? null,
        urgency,
        now,
        now,
        now,
      ],
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

export class WebhookReferralError extends Error {
  constructor(
    public readonly code:
      'REFERRAL_NOT_FOUND' | 'INVALID_REFERRAL_STATUS' | 'INVALID_REFERRAL_ACTION',
    message: string,
  ) {
    super(message);
    this.name = 'WebhookReferralError';
  }
}

// Single status whitelist derived from the domain enum (constitution IV —
// INITIATED is never a valid inbound update).
export const REFERRAL_UPDATE_STATUSES: ReadonlySet<string> = new Set([
  ReferralStatus.ACCEPTED,
  ReferralStatus.REJECTED,
  ReferralStatus.IN_TRANSIT,
  ReferralStatus.ARRIVED,
]);

// UPDATE referral status — sent by receiving hospital (รพ.ปลายทาง). Status
// transitions are destination-only; deletes may come from either party.
// Ownership violations return the same non-disclosing REFERRAL_NOT_FOUND as
// a nonexistent referral so third parties can't probe which hospitals a
// referral is between.
export async function processReferralUpdate(
  db: DatabaseAdapter,
  authenticatedHospitalId: string,
  payload: WebhookReferralUpdatePayload,
  sseManager: SseManager,
): Promise<WebhookReferralResult> {
  const action = payload.action ?? 'update';
  if (action !== 'update' && action !== 'delete') {
    throw new WebhookReferralError(
      'INVALID_REFERRAL_ACTION',
      `action "${payload.action}" ไม่ถูกต้อง`,
    );
  }
  if (action === 'update' && !REFERRAL_UPDATE_STATUSES.has(payload.status)) {
    throw new WebhookReferralError(
      'INVALID_REFERRAL_STATUS',
      `status "${payload.status}" ไม่ถูกต้อง`,
    );
  }

  // Resolve the sending hospital (fromHospitalCode) for compound key lookup
  const fromHospital = await resolveHospitalByHcode(db, payload.fromHospitalCode);
  if (!fromHospital) {
    throw new WebhookReferralError('REFERRAL_NOT_FOUND', 'ไม่พบใบส่งต่อที่ระบุ');
  }

  const fromHcode = fromHospital.hcode;

  // Handle delete — compound key: fromHospitalCode + referralId
  if (action === 'delete') {
    const delRows = await db.query<{ to_hospital_id: string }>(
      `SELECT to_hospital_id FROM cached_referrals WHERE from_hospital_id = ? AND refer_number = ?`,
      [fromHospital.id, payload.referralId],
    );
    if (
      delRows.length === 0 ||
      (authenticatedHospitalId !== fromHospital.id &&
        authenticatedHospitalId !== delRows[0].to_hospital_id)
    ) {
      throw new WebhookReferralError('REFERRAL_NOT_FOUND', 'ไม่พบใบส่งต่อที่ระบุ');
    }
    const toHcode =
      (
        await db.query<{ hcode: string }>('SELECT hcode FROM hospitals WHERE id = ?', [
          delRows[0].to_hospital_id,
        ])
      )[0]?.hcode ?? '';

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

  if (existing.length === 0 || existing[0].to_hospital_id !== authenticatedHospitalId) {
    throw new WebhookReferralError('REFERRAL_NOT_FOUND', 'ไม่พบใบส่งต่อที่ระบุ');
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

// Resolves AN -> patient_id for the hospital, fans the rows through the
// shared T17 upsert (which also recomputes severity), and broadcasts only
// severity transitions over SSE. DRY: the per-AN lookup and SSE pattern
// mirror the polling.ts integration so both ingestion paths stay aligned.
export async function processPartographWebhook(
  db: DatabaseAdapter,
  hospitalId: string,
  payload: WebhookPartographPayload,
  sseManager: SseManager,
): Promise<WebhookPartographResult> {
  // Bounded cooperative yielding (page-stall fix part 2): backfill pushes can
  // carry large observation batches; tick the per-observation transform loop
  // below so it never monopolizes the serving event loop. NOTE: the heavier
  // per-row upsert + per-patient 32-rule CDSS analysis runs inside ONE batch
  // db.transaction in upsertPartographObservations — never yield there.
  const yielder = new CooperativeYielder();
  const hospitalRows = await db.query<{ hcode: string }>(
    'SELECT hcode FROM hospitals WHERE id = ?',
    [hospitalId],
  );
  const hcode = hospitalRows[0]?.hcode ?? '';

  const ans = Array.from(new Set(payload.observations.map((o) => o.an)));
  const placeholders = ans.map(() => '?').join(',');
  const patientRows = ans.length
    ? await db.query<{ id: string; an: string }>(
        `SELECT id, an FROM cached_patients
           WHERE hospital_id = ? AND an IN (${placeholders})`,
        [hospitalId, ...ans],
      )
    : [];
  const byAn = new Map(patientRows.map((p) => [p.an, p.id]));

  const skipped: WebhookPartographResult['observationsSkipped'] = [];
  const rows: PartographRow[] = [];
  for (const o of payload.observations) {
    await yielder.tick();
    const pid = byAn.get(o.an);
    if (!pid) {
      skipped.push({
        an: o.an,
        externalObservationId: o.externalObservationId,
        reason: 'patient_not_found',
      });
      continue;
    }
    rows.push({
      hospitalId,
      patientId: pid,
      sourceSystem: 'webhook',
      sourcePk: o.externalObservationId,
      // Required for upsert path; delete path ignores it (T17 only consults
      // hospitalId/sourceSystem/sourcePk to locate the row).
      observeDatetime: o.observeDatetime ?? '',
      hourNo: o.hourNo ?? null,
      fetalHeartRate: o.fetalHeartRate ?? null,
      amnioticFluid: o.amnioticFluid ?? null,
      amnioticTypeId: o.amnioticTypeId ?? null,
      // Sender-resolved string used as label (no FK lookup against HOSxP).
      amnioticTypeName: o.amnioticFluid ?? null,
      moulding: o.moulding ?? null,
      cervicalDilationCm: o.cervicalDilationCm ?? null,
      descentOfHead: o.descentOfHead ?? null,
      contractionPer10Min: o.contractionPer10Min ?? null,
      contractionDurationSec: o.contractionDurationSec ?? null,
      contractionStrength: o.contractionStrength ?? null,
      oxytocinUml: o.oxytocinUml ?? null,
      oxytocinDropsMin: o.oxytocinDropsMin ?? null,
      drugsIvFluids: o.drugsIvFluids ?? null,
      pulse: o.pulse ?? null,
      bpSystolic: o.bpSystolic ?? null,
      bpDiastolic: o.bpDiastolic ?? null,
      temperature: o.temperature ?? null,
      urineVolumeMl: o.urineVolumeMl ?? null,
      urineProtein: o.urineProtein ?? null,
      urineGlucose: o.urineGlucose ?? null,
      urineAcetone: o.urineAcetone ?? null,
      note: o.note ?? null,
      entryStaff: o.entryStaff ?? null,
      entryDatetime: o.entryDatetime ?? null,
      action: o.action,
    });
  }

  const result = await upsertPartographObservations(db, hospitalId, rows);

  // Severity transitions only — not every observation.
  for (const sc of result.severityChanges) {
    sseManager.broadcast('patient-update', {
      type: 'partograph_severity_changed',
      hcode,
      an: sc.an,
      severity: sc.to,
      alertCount: sc.alertCount,
    });
  }

  await db.execute(
    "UPDATE hospitals SET connection_status = 'ONLINE', last_sync_at = ? WHERE id = ?",
    [new Date().toISOString(), hospitalId],
  );

  return {
    observationsAccepted: result.upserted + result.deleted,
    observationsSkipped: skipped,
  };
}
