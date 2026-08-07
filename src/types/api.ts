// T013: API response types per contracts/api-routes.md

import type { RiskLevel, ConnectionStatus, HospitalLevel, LaborStatus } from './domain';
import type {
  MaternalScreenLocalTier,
  MaternalEmergencyAcuity,
  SuspectedMaternalCondition,
  MaternalScreenMatch,
  MaternalScreenInput,
} from './maternal-screening';

// Dashboard
//
// syncStatus is orthogonal to connectionStatus:
//   connectionStatus = is the BMS tunnel reachable?
//   syncStatus       = is the sync pipeline writing real data right now?
//
// A hospital can be ONLINE + BLOCKED (tunnel responds, but
// authenticity-probe failed or admin purged it) — that's the case the map
// pin used to mislead operators about, before the orange BLOCKED dot.
export type DashboardSyncStatus = 'OK' | 'BLOCKED' | 'NEVER_SYNCED';

export interface DashboardHospital {
  hcode: string;
  name: string;
  level: HospitalLevel;
  connectionStatus: ConnectionStatus;
  lastSyncAt: string | null;
  provinceCode?: string | null;
  districtCode?: string | null;
  lat?: number | null;
  lon?: number | null;
  counts: {
    low: number;
    medium: number;
    high: number;
    total: number;
  };
  /** Pregnancy-stage registry size + high-risk subset, per current hospital.
   *  Surfaces upstream demand alongside labor floor numbers so coordinators
   *  can see who is *coming* without leaving the dashboard. */
  ancCounts: {
    total: number;
    hr3: number;
  };
  /** Partograph data quality: labor admissions in the PARTOGRAPH_QUALITY
   *  window vs how many have at least one partograph observation. */
  partographQuality: { laborRecent: number; withPartograph: number };
  syncStatus: DashboardSyncStatus;
  /** When syncStatus is BLOCKED, this carries the underlying reason
   *  (e.g. 'purged_pending_reonboard', 'missing_marketplace_token') so
   *  the UI can show an actionable tooltip. */
  syncBlockedReason: string | null;
}

export interface DashboardSummary {
  totalLow: number;
  totalMedium: number;
  totalHigh: number;
  totalActive: number;
}

export interface DashboardResponse {
  hospitals: DashboardHospital[];
  summary: DashboardSummary;
  updatedAt: string;
}

// Patient List
export interface PatientListItem {
  id: string;
  hn: string;
  an: string;
  name: string;
  age: number;
  gravida: number | null;
  gaWeeks: number | null;
  ancCount: number | null;
  admitDate: string;
  laborStatus: LaborStatus;
  cpdScore: {
    score: number;
    riskLevel: RiskLevel;
    recommendation: string | null;
  } | null;
  latestVitals: {
    maternalHr: number | null;
    fetalHr: string | null;
    sbp: number | null;
    dbp: number | null;
    measuredAt: string;
  } | null;
  latestCervix: {
    dilationCm: number;
    measuredAt: string;
  } | null;
  partographSeverity: CdssSeverity | null;
  partographAlertCount: number | null;
  // GC3: maternal labor-triage screening axes — a separate vocabulary from
  // partographSeverity/CdssSeverity above (never merge). Null when
  // MATERNAL_SCREEN_UI_ENABLED=false (server-side gate) or unassessed.
  maternalScreenLocalTier: MaternalScreenLocalTier | null;
  maternalScreenEmergencyAcuity: MaternalEmergencyAcuity | null;
  maternalScreenIsComplete: boolean | null;
  maternalScreenAssessedAt: string | null;
  syncedAt: string;
}

export interface Pagination {
  total: number;
  page: number;
  perPage: number;
  totalPages: number;
}

export interface PatientListResponse {
  patients: PatientListItem[];
  pagination: Pagination;
}

// Patient Detail
export interface PatientDetailResponse {
  patient: {
    id: string;
    hn: string;
    an: string;
    name: string;
    age: number;
    gravida: number | null;
    para: number | null;
    abortion: number | null;
    livingChildren: number | null;
    pregNo: number | null;
    gaWeeks: number | null;
    gaDay: number | null;
    ancCount: number | null;
    admitDate: string;
    heightCm: number | null;
    weightKg: number | null;
    weightDiffKg: number | null;
    prePregnancyWeightKg: number | null;
    fundalHeightCm: number | null;
    usWeightG: number | null;
    hematocritPct: number | null;
    bpSystolicAdmit: number | null;
    bpDiastolicAdmit: number | null;
    pulseAdmit: number | null;
    rrAdmit: number | null;
    temperatureAdmit: number | null;
    cervicalOpenCmAdmit: number | null;
    effacementPctAdmit: number | null;
    stationAdmit: string | null;
    laborStatus: LaborStatus;
    hospital: {
      hcode: string;
      name: string;
      level: HospitalLevel;
    };
    syncedAt: string;
  };
  cpdScore: {
    score: number;
    riskLevel: RiskLevel;
    recommendation: string | null;
    factors: {
      gravida: number | null;
      ancCount: number | null;
      gaWeeks: number | null;
      heightCm: number | null;
      weightDiffKg: number | null;
      fundalHeightCm: number | null;
      usWeightG: number | null;
      hematocritPct: number | null;
    };
    missingFactors: string[];
    calculatedAt: string;
  } | null;
  journeyContext?: {
    journeyId: string;
    careStage: string;
    ancRiskLevel: string;
    ancVisitCount: number;
    lastAncDate: string | null;
    lmp: string | null;
    edc: string | null;
    /** Transfer history for this pregnancy — same rows the referrals board
     *  shows, so the labor view carries the woman's referral context. */
    referrals: ReferralListItem[];
    /** Birth outcomes once delivered (from the newborn sync). */
    newborns: NewbornEntry[];
  } | null;
}

// Vital Signs
export interface VitalSignEntry {
  measuredAt: string;
  maternalHr: number | null;
  fetalHr: string | null;
  sbp: number | null;
  dbp: number | null;
  pphAmountMl: number | null;
}

export interface VitalSignsResponse {
  vitals: VitalSignEntry[];
}

// Partogram
export interface PartogramEntry {
  measuredAt: string;
  dilationCm: number;
  alertLineCm: number | null;
  actionLineCm: number | null;
}

export interface PartogramResponse {
  partogram: {
    startTime: string; // unchanged — admit_date
    entries: PartogramEntry[]; // EXISTING — back-compat for LaborProgressCard
    observations: PartographObservationDto[]; // NEW
    alerts: CdssAlertDto[]; // NEW
    severity: {
      highest: CdssSeverity | null;
      counts: { critical: number; alert: number; warn: number; info: number };
    };
    source: 'hosxp' | 'webhook' | 'mixed' | 'none';
    lastObservedAt: string | null;
  };
}

// Partograph CDSS (Clinical Decision Support) — ported from HOSxP Pascal
// PartographCDSSUnit.pas. See docs/plans/2026-04-19-partograph-support.md.
export type CdssSeverity = 'INFO' | 'WARN' | 'ALERT' | 'CRITICAL';
export type CdssSection =
  | 'FHR'
  | 'LIQUOR'
  | 'MOULDING'
  | 'CERVIX'
  | 'DESCENT'
  | 'CONTRACTIONS'
  | 'OXY'
  | 'PULSE'
  | 'BP'
  | 'TEMP'
  | 'URINE'
  | 'TIME';

export interface CdssAlertDto {
  severity: CdssSeverity;
  section: CdssSection;
  message: string;
  obsIndex: number;
}

export interface PartographObservationDto {
  id: string;
  observeDatetime: string;
  hourNo: number | null;
  fetalHeartRate: number | null;
  amnioticFluid: string | null;
  amnioticTypeName: string | null;
  moulding: string | null;
  cervicalDilationCm: number | null;
  descentOfHead: string | null;
  contractionPer10Min: number | null;
  contractionDurationSec: number | null;
  contractionStrength: string | null;
  oxytocinUml: number | null;
  oxytocinDropsMin: number | null;
  drugsIvFluids: string | null;
  pulse: number | null;
  bpSystolic: number | null;
  bpDiastolic: number | null;
  temperature: number | null;
  urineVolumeMl: number | null;
  urineProtein: string | null;
  urineGlucose: string | null;
  urineAcetone: string | null;
  note: string | null;
  entryStaff: string | null;
}

export interface SsePartographSeverityChangedEvent {
  type: 'partograph_severity_changed';
  hcode: string;
  an: string;
  severity: CdssSeverity | null;
  alertCount: number;
}

// Contractions
export interface ContractionEntry {
  measuredAt: string;
  intervalMin: number | null;
  durationSec: number | null;
  intensity: 'MILD' | 'MODERATE' | 'STRONG';
}

export interface ContractionsResponse {
  contractions: ContractionEntry[];
}

// High-Risk Patients
export interface HighRiskPatient {
  an: string;
  hn: string;
  name: string;
  age: number | null;
  gaWeeks: number | null;
  cpdScore: number;
  riskLevel: string;
  hospital: string;
  hcode: string;
  admitDate: string | null;
  lastVitalAt: string | null;
  partographSeverity: CdssSeverity | null;
  partographAlertCount: number | null;
  // GC3: maternal labor-triage screening axes — a separate vocabulary from
  // partographSeverity/CdssSeverity above (never merge). Null when
  // MATERNAL_SCREEN_UI_ENABLED=false (server-side gate) or unassessed.
  maternalScreenLocalTier: MaternalScreenLocalTier | null;
  maternalScreenEmergencyAcuity: MaternalEmergencyAcuity | null;
  maternalScreenIsComplete: boolean | null;
  maternalScreenAssessedAt: string | null;
}

export interface HighRiskPatientsResponse {
  patients: HighRiskPatient[];
}

// Error
export interface ErrorResponse {
  error: {
    code: string;
    message: string;
    details: unknown | null;
  };
}

// SSE Events
export interface SsePatientUpdateEvent {
  type: 'new_admission' | 'vital_update' | 'delivered';
  hcode: string;
  an: string;
  riskLevel?: RiskLevel;
}

export interface SseConnectionStatusEvent {
  hcode: string;
  status: ConnectionStatus;
  lastSyncAt: string;
}

export interface SseSyncCompleteEvent {
  hcode: string;
  patientsUpdated: number;
  timestamp: string;
}

export interface SseJourneyUpdateEvent {
  type: 'journey_update';
  hcode: string;
  journeyId: string;
  careStage: string;
  ancRiskLevel?: string;
}

export interface SseReferralUpdateEvent {
  type: 'referral_update';
  fromHcode: string;
  toHcode: string;
  referralId: string;
  status: string;
}

export interface SseNewbornUpdateEvent {
  type: 'newborn_update';
  hcode: string;
  journeyId: string;
  infantNumber: number;
  birthWeightG?: number;
}

// --- Maternal labor-triage screening (Task 8, spec §9.3/§10.4) ---
//
// PROVISIONAL / flag-gated (docs/superpowers/plans/2026-07-16-maternal-screening.md).
// GC3: `localTier`/`emergencyAcuity`/`suspectedConditions`/`isComplete` are a
// separate vocabulary from `CdssSeverity` (INFO/WARN/ALERT/CRITICAL, above)
// and `AncRiskLevel` (LOW/HR1/HR2/HR3, src/config/anc-risk-rules.ts) — never
// merged into either, never stored/displayed as `partographSeverity`.

/**
 * One immutable maternal-screen assessment row, shaped for the read API
 * (GET /api/patients/{an}/maternal-screenings). `supersedesId` is the
 * correction marker (GC6): non-null means this row is a correction of an
 * earlier assessment; the earlier row is never mutated, only referenced.
 */
export interface MaternalScreenAssessmentDto {
  id: string;
  assessedAt: string;
  assessedBy: string | null;
  sourceSystem: string;
  sourcePk: string | null;
  localTier: MaternalScreenLocalTier;
  emergencyAcuity: MaternalEmergencyAcuity;
  isComplete: boolean;
  suspectedConditions: SuspectedMaternalCondition[];
  matches: MaternalScreenMatch[];
  missingRequiredFields: Array<keyof MaternalScreenInput>;
  ruleSetVersion: string;
  /** Raw normalized input snapshot (GC6 — immutable at write time). */
  input: MaternalScreenInput;
  supersedesId: string | null;
  createdAt: string;
}

/**
 * `latest` is the current non-superseded assessment (mirrors the
 * `cached_patients.maternal_screen_*` summary projection); `null` when the
 * admission has no assessments yet. `history` is every assessment for the
 * admission (including superseded rows, so the correction chain is
 * visible), newest first, paginated via `?limit=&cursor=`. `nextCursor` is
 * an opaque token — `null` when there is no further page.
 */
export interface MaternalScreenAssessmentsResponse {
  latest: MaternalScreenAssessmentDto | null;
  history: MaternalScreenAssessmentDto[];
  nextCursor: string | null;
  /** Server-computed from MATERNAL_SCREEN_UI_ENABLED; client renders the section only when true (GC-U3). */
  uiEnabled: boolean;
}

/**
 * One AN's cross-source screening summary, shaped for the ward bed-tile join
 * (Phase 6 Task H4, docs/superpowers/plans/2026-07-17-maternal-screening-hosxp.md
 * GC-H4). Mirrors the `cached_patients.maternal_screen_*` summary projection
 * (same fields as `getHighRiskPatients`/`getHospitalPatientList` in
 * src/services/dashboard.ts) but keyed by `an` instead of nested in a full
 * patient row, since the ward page's occupancy comes from LIVE HOSxP (BMS
 * Session), not this central-DB row.
 *
 * GC3: `localTier`/`emergencyAcuity`/`isComplete` are the same distinct
 * vocabulary as `MaternalScreenAssessmentDto` above — never collapsed into
 * `CdssSeverity` or `AncRiskLevel`.
 */
export interface MaternalScreenSummaryItem {
  an: string;
  localTier: MaternalScreenLocalTier | null;
  emergencyAcuity: MaternalEmergencyAcuity | null;
  isComplete: boolean | null;
  assessedAt: string | null;
}

/**
 * GET /api/hospitals/{hcode}/maternal-screen-summaries response (Task H4).
 * `uiEnabled` is server-computed from MATERNAL_SCREEN_UI_ENABLED (GC-H4/W1);
 * when false, `summaries` is always `[]` regardless of what's persisted, so
 * a stale client can never render a chip the flag says should be hidden.
 */
export interface MaternalScreenSummariesResponse {
  uiEnabled: boolean;
  summaries: MaternalScreenSummaryItem[];
}

/**
 * SSE state-change event (spec §10.4). Broadcast on the `patient-update`
 * channel, POST-COMMIT, ONLY for a meaningful transition (localTier changed
 * OR emergencyAcuity changed), ONLY when `isMaternalScreenEventsEnabled()`
 * (default OFF — GC2). `previousLocalTier`/`previousEmergencyAcuity` are
 * `null` when no prior assessment existed for this admission. PHI-free by
 * construction: no name/cid/free-text, only ids/enums/timestamps.
 */
export interface MaternalScreenStateChangedEvent {
  type: 'maternal_screen_state_changed';
  patientId: string;
  previousLocalTier: MaternalScreenLocalTier | null;
  localTier: MaternalScreenLocalTier;
  previousEmergencyAcuity: MaternalEmergencyAcuity | null;
  emergencyAcuity: MaternalEmergencyAcuity;
  isComplete: boolean;
  suspectedConditions: SuspectedMaternalCondition[];
  assessedAt: string;
}

// --- Maternal Journey API Types ---

export interface JourneyListItem {
  id: string;
  hn: string;
  name: string;
  age: number;
  gravida: number;
  para: number;
  gaWeeks: number | null;
  lmp: string | null;
  edc: string | null;
  careStage: string;
  ancRiskLevel: string;
  ancVisitCount: number;
  lastAncDate: string | null;
  hospitalName: string;
  hcode: string;
  registeredAt: string;
}

/** DB-wide ANC risk-level breakdown for the journeys KPI strip. */
export interface JourneyRiskCounts {
  low: number;
  hr1: number;
  hr2: number;
  hr3: number;
  total: number;
}

/** Operational cohort totals for the province ANC board — computed over the
 *  gated PREGNANCY set, independent of the risk/q/cohort filters. Thresholds
 *  live in src/config/anc-ops.ts. */
export interface AncOpsCounts {
  /** EDC within dueSoonDays (including already passed). */
  dueSoon: number;
  /** EDC already passed (still inside the freshness grace window). */
  overdueEdc: number;
  /** Last ANC older than followupWarnDays but still inside the 60d gate. */
  ancStale: number;
  /** Fewer than minVisits ANC visits at GA ≥ minVisitsGaWeeks. */
  lowVisits: number;
  /** GA ≥ nearTermGaWeeks. */
  nearTerm: number;
  /** Lost to follow-up: last ANC beyond the 60d gate, within ltfuWindowDays. */
  ltfu: number;
}

export interface JourneyHospitalFacet {
  id: string;
  name: string;
  count: number;
}

export interface JourneyListResponse {
  journeys: JourneyListItem[];
  pagination: Pagination;
  /**
   * DB-wide totals by ANC risk level over the stage+freshness(+hospital)
   * filtered set — independent of pagination, the risk_level filter, and the
   * `q` search. Present on GET /api/journeys and the per-hospital journeys
   * endpoint so KPI strips show true totals, never capped-row lengths.
   */
  counts?: JourneyRiskCounts;
  /** Present on GET /api/journeys when stage=PREGNANCY; see AncOpsCounts. */
  opsCounts?: AncOpsCounts;
  /** Hospitals in the gated set with counts — feeds the hospital filter. */
  hospitalCounts?: JourneyHospitalFacet[];
}

export interface JourneyDetailResponse {
  journey: JourneyListItem & {
    currentHospitalName: string;
    currentHcode: string;
    /** Latest known maternal height in cm (from linked labor record, if any). */
    heightCm: number | null;
    // WHO 2016 journey-level data (L2). All optional.
    bloodGroup: string | null; // A / B / AB / O
    rhFactor: string | null; // POS / NEG
    hbsagResult: string | null; // POS / NEG / PENDING
    vdrlResult: string | null;
    hivResult: string | null;
    ogttResult: string | null; // NORMAL / ABNORMAL / PENDING
    termBirths: number | null;
    pretermBirths: number | null;
    abortions: number | null;
    livingChildren: number | null;
    pastMedicalHistory: string | null;
    // RTCOG OB 66-029 (2566) additions — journey-level.
    mcvFl: number | null;
    dcipResult: 'POS' | 'NEG' | 'PENDING' | null;
    hbEResult: 'POS' | 'NEG' | 'PENDING' | null;
    thalassemiaType: 'HB_H' | 'BETA_THAL_MAJOR' | 'BETA_THAL_HB_E' | 'TRAIT' | 'NORMAL' | null;
    cervicalScreenType: 'PAP' | 'HPV' | 'NONE' | null;
    cervicalScreenResult: 'NORMAL' | 'ABNORMAL' | 'PENDING' | null;
    cervicalScreenDate: string | null;
    aneuploidyMethod: 'SERUM_T1' | 'QUAD_T2' | 'CFDNA' | 'NONE' | null;
    aneuploidyResult: 'LOW_RISK' | 'HIGH_RISK' | 'PENDING' | null;
    gbsResult: 'POS' | 'NEG' | 'PENDING' | null;
    gbsCollectedDate: string | null;
    anatomyScanDate: string | null;
    anatomyScanResult: 'NORMAL' | 'ABNORMAL' | 'PENDING' | null;
    efwG: number | null;
    datingMethod: 'LMP' | 'US' | 'ART' | null;
    proteinuria24hMg: number | null;
    creatinineMgDl: number | null;
    priorPeDvt: boolean | null;
    severeLungDisease: boolean | null;
    alloimmunizationCde: boolean | null;
    bariatricSurgeryHx: boolean | null;
    teratogenExposure: boolean | null;
    congenitalInfection: boolean | null;
    gdmRiskFactors: string[] | null;
    /** When this journey row was last written by the HOSxP sync/webhook. */
    syncedAt: string | null;
  };
  ancVisits: AncVisitEntry[];
  latestRisk: AncRiskEntry | null;
  /**
   * Completeness of the latest ANC risk screening — WHO containment T6.
   * Parsed from `cached_anc_risks.risk_factors` (JSONB), written only by
   * the POLLING path (T3: `{missingRequired, assessmentIncomplete}`).
   * Null when there is no screening row, the JSON is unparseable, or it's
   * a legacy/webhook-sourced row that doesn't carry this shape (webhook
   * evidence is items-based, e.g. `{itemIds: [...]}` — expected, not a bug).
   * The UI MUST render an amber marker beside the risk chip whenever
   * `incomplete` is true so an incomplete LOW never displays as a bare
   * confirmed-LOW chip (spec containment item 5).
   */
  ancAssessment: AncAssessmentCompleteness | null;
  referrals: ReferralListItem[];
  newborns: NewbornEntry[];
  /** Latest linked labor admission (cached_patients) — enables the
   *  cross-link to /patients/[hcode]-[an]. Null until admitted. */
  laborAdmission: {
    an: string;
    hcode: string;
    laborStatus: string;
    admitDate: string;
  } | null;
}

/** See {@link JourneyDetailResponse.ancAssessment}. */
export interface AncAssessmentCompleteness {
  incomplete: boolean;
  missingRequired: string[];
}

export interface AncVisitEntry {
  visitDate: string;
  visitNumber: number;
  /** Hospital where this visit was recorded. Null for legacy rows that
   *  predate per-visit hospital tracking and weren't backfillable. */
  hospitalName: string | null;
  hcode: string | null;
  gaWeeks: number | null;
  fundalHeightCm: number | null;
  weightKg: number | null;
  bpSystolic: number | null;
  bpDiastolic: number | null;
  fetalHr: number | null;
  /** Cephalic / breech / transverse etc. (raw HOSxP baby_position code). */
  presentation: string | null;
  /** Engaged / floating — raw HOSxP baby_lead code. */
  engagement: string | null;
  /** MoPH MCH quality flag — whether this visit passed quality criteria. */
  passQuality: boolean | null;
  // WHO 2016 ANC data elements (L2) — all optional, per-visit.
  urineProtein: string | null; // '-', 'trace', '+', '++', '+++'
  urineGlucose: string | null;
  hbGDl: number | null;
  hctPct: number | null;
  ttDoseNo: number | null; // tetanus toxoid dose number at this visit (0-5)
  ironFolicGiven: boolean | null;
  calciumGiven: boolean | null;
  dangerSigns: string[] | null; // e.g. ['bleeding','severe_headache','reduced_fm']
  fetalMovementOk: boolean | null; // T3 only
  // RTCOG OB 66-029 (2566) additions — per-visit.
  vaccinesGiven: Array<{
    type: 'TT' | 'DT' | 'TDAP' | 'INFLUENZA' | 'COVID';
    dose?: number | null;
    givenAtGa?: number | null;
  }> | null;
  urineKetone: string | null;
  urineCultureResult: string | null;
  iodineGiven: boolean | null;
  multivitaminGiven: boolean | null;
  vitaminDIu: number | null;
  nstResult: 'REACTIVE' | 'NON_REACTIVE' | 'PENDING' | null;
  bppScore: number | null;
  umbilicalDopplerResult: 'NORMAL' | 'ABNORMAL' | null;
  psychosocialScreen: {
    alcohol?: boolean;
    smoking?: boolean;
    illicitDrugs?: boolean;
    depressionPhq?: number;
    domesticViolence?: boolean;
  } | null;
}

export interface AncRiskEntry {
  riskLevel: string;
  triggeredRules: string[];
  screenedAt: string;
  recommendedFacility: string | null;
}

export interface ReferralListItem {
  id: string;
  journeyId: string;
  referNumber: string | null;
  fromHospital: string;
  toHospital: string;
  status: string;
  reason: string;
  diagnosisCode: string | null;
  urgencyLevel: string;
  initiatedAt: string;
  arrivedAt: string | null;
}

/** Global status breakdown for the referrals KPI strip — computed with a
 *  GROUP BY over the full (non-status-filtered) set, never the current page. */
export interface ReferralStatusCounts {
  initiated: number;
  accepted: number;
  inTransit: number;
  arrived: number;
  rejected: number;
  total: number;
}

export interface NewbornEntry {
  infantNumber: number;
  sex: string | null;
  birthWeightG: number | null;
  apgar1min: number | null;
  apgar5min: number | null;
  bornAt: string;
}

export interface NewbornKPIsResponse {
  totalBirths: number;
  lbwCount: number;
  /** Percentage 0–100 of births under 2,500 g. */
  lbwRate: number;
  lowApgarCount: number;
  avgBirthWeightG: number;
}

export interface OutcomeTrendPoint {
  /** Bangkok calendar month, YYYY-MM. */
  month: string;
  births: number;
  lbw: number;
}

export interface OutcomeHospitalRow {
  id: string;
  hcode: string;
  name: string;
  births: number;
  lbw: number;
  lowApgar: number;
}

export interface RecentBirthEntry {
  id: string;
  journeyId: string;
  /** Decrypted at the API boundary; mask at render (maskName). */
  motherName: string;
  hospitalName: string;
  infantNumber: number;
  sex: string | null;
  birthWeightG: number | null;
  apgar1min: number | null;
  apgar5min: number | null;
  resuscitated: boolean;
  bornAt: string;
}

/** Full payload for the /outcomes board — KPI fields stay at the root for
 *  back-compat with the original NewbornKPIsResponse shape. */
export interface OutcomesResponse extends NewbornKPIsResponse {
  /** Births with infant_number > 1 (multiple-gestation deliveries). */
  multiples: number;
  /** Births with any resuscitation intervention flag set. */
  resuscitated: number;
  /** Last six Bangkok months, oldest first — always all-range. */
  trend: OutcomeTrendPoint[];
  /** Per-hospital breakdown over the selected range (facet — ignores the
   *  hospital filter). */
  byHospital: OutcomeHospitalRow[];
  /** Most recent births (max 20) within the selected range/hospital. */
  recent: RecentBirthEntry[];
}

export interface DashboardStageKPIs {
  pregnancy: { total: number; low: number; hr1: number; hr2: number; hr3: number };
  labor: { total: number; low: number; medium: number; high: number };
  delivered: { total: number; normal: number; lowApgar: number; lbw: number };
}

export interface DashboardAlerts {
  /** Actionable referrals: INITIATED past REFERRAL_SLA.overdueAfterHours,
   *  plus active EMERGENCY referrals — NOT every pending row (that number
   *  never moved and trained users to ignore the ribbon). */
  referralAlerts: number;
  /** Gated ANC registry rows past ANC_OPS.followupWarnDays since the last
   *  visit — the same rule the pregnancies board uses. */
  overdueAnc: number;
  /** Gated pregnancies with EDC within ANC_OPS.dueSoonDays (incl. passed).
   *  Replaces the permanently-zero in-transit referral count. */
  dueSoon: number;
}

/** Cross-board headline numbers for the dashboard — the same figures the
 *  pregnancies/referrals boards show, so the landing page and the drill-down
 *  pages can never disagree. */
export interface DashboardContinuum {
  anc: { total: number; hr3: number; dueSoon: number };
  referrals: { today: number; last7d: number };
}

export interface ShiftStats {
  /** Human-readable Thai shift label (e.g. "เวรบ่าย 15:00-22:00"). */
  label: string;
  /** ISO timestamp for the start of this shift window. */
  windowStart: string;
  /** ISO timestamp for the end of this shift window (= now() if current shift). */
  windowEnd: string;
  admissions: number;
  delivered: number;
  referred: number;
}

export interface DashboardTrends {
  /** Admission counts for each of the last 24 hourly buckets.
   *  `admissions24h[0]` is the hour that started 24h ago, `admissions24h[23]`
   *  is the hour currently in progress. */
  admissions24h: number[];
  /** Total admissions since start of today (Asia/Bangkok). */
  admissionsToday: number;
  /** Mean admissions per day over the 7 days before today. */
  admissions7dAvg: number;
  /** Count of patients admitted in the last 24h, grouped by their current risk tier. */
  newByRisk24h: { high: number; medium: number; low: number; total: number };
  currentShift: ShiftStats;
  previousShift: ShiftStats;
}

/** Referral row enriched with patient context from the linked maternal
 *  journey — what the provincial referral board renders. Patient name is
 *  decrypted at the API boundary (decryptSafe) and masked at render
 *  (maskName), matching the journey list convention. */
export interface ProvincialReferralListItem extends ReferralListItem {
  patientName: string;
  hn: string;
  gaWeeks: number | null;
  ancRiskLevel: string;
}

/** Fixed-window operational KPIs for the referral board. Always computed over
 *  the whole table (never the filtered view) — see referral-list.ts. */
export interface ReferralOpsCounts {
  /** Initiated since Bangkok midnight. */
  today: number;
  /** Initiated in the last 7 days. */
  last7d: number;
  /** EMERGENCY urgency and not yet ARRIVED/REJECTED. */
  emergencyActive: number;
  /** Linked journey has a non-LOW ANC risk level. */
  highRisk: number;
  /** Still INITIATED past REFERRAL_SLA.overdueAfterHours. */
  overdue: number;
}

export interface ReferralListResponse {
  referrals: ProvincialReferralListItem[];
  pagination: Pagination;
  statusCounts: ReferralStatusCounts;
  opsCounts: ReferralOpsCounts;
}

/** Full referral for the detail dialog — list row fields plus every
 *  lifecycle milestone and the rejection context. */
export type ReferralDetail = ProvincialReferralListItem & {
  rejectionReason: string | null;
  transportMode: string | null;
  acceptedAt: string | null;
  departedAt: string | null;
  rejectedAt: string | null;
  /** Name of the hospital suggested as an alternative on rejection. */
  suggestedAlternativeHospital: string | null;
};

export interface ReferralDetailResponse {
  referral: ReferralDetail;
}

/** Aggregate view for the referral board's insights panel. */
export interface ReferralInsightsResponse {
  /** Busiest from→to hospital pairs, descending, capped at 6. */
  corridors: Array<{
    fromHospitalId: string;
    fromHospital: string;
    toHospitalId: string;
    toHospital: string;
    count: number;
  }>;
  /** Referral volume per Bangkok day, oldest of the 7 days first. */
  daily: Array<{ date: string; count: number }>;
  /** Destination hospitals with counts — feeds the TO filter dropdown. */
  destinations: Array<{ id: string; name: string; count: number }>;
}
