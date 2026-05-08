// T013: API response types per contracts/api-routes.md

import type { RiskLevel, ConnectionStatus, HospitalLevel, LaborStatus } from './domain';

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
    startTime: string;                            // unchanged — admit_date
    entries: PartogramEntry[];                    // EXISTING — back-compat for LaborProgressCard
    observations: PartographObservationDto[];     // NEW
    alerts: CdssAlertDto[];                       // NEW
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
  | 'FHR' | 'LIQUOR' | 'MOULDING' | 'CERVIX' | 'DESCENT'
  | 'CONTRACTIONS' | 'OXY' | 'PULSE' | 'BP' | 'TEMP' | 'URINE' | 'TIME';

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

export interface JourneyListResponse {
  journeys: JourneyListItem[];
  pagination: Pagination;
}

export interface JourneyDetailResponse {
  journey: JourneyListItem & {
    currentHospitalName: string;
    currentHcode: string;
    /** Latest known maternal height in cm (from linked labor record, if any). */
    heightCm: number | null;
    // WHO 2016 journey-level data (L2). All optional.
    bloodGroup: string | null;                 // A / B / AB / O
    rhFactor: string | null;                   // POS / NEG
    hbsagResult: string | null;                // POS / NEG / PENDING
    vdrlResult: string | null;
    hivResult: string | null;
    ogttResult: string | null;                 // NORMAL / ABNORMAL / PENDING
    termBirths: number | null;
    pretermBirths: number | null;
    abortions: number | null;
    livingChildren: number | null;
    pastMedicalHistory: string | null;
    // RTCOG OB 66-029 (2566) additions — journey-level.
    mcvFl: number | null;
    dcipResult: 'POS' | 'NEG' | 'PENDING' | null;
    hbEResult: 'POS' | 'NEG' | 'PENDING' | null;
    thalassemiaType:
      | 'HB_H'
      | 'BETA_THAL_MAJOR'
      | 'BETA_THAL_HB_E'
      | 'TRAIT'
      | 'NORMAL'
      | null;
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
  };
  ancVisits: AncVisitEntry[];
  latestRisk: AncRiskEntry | null;
  referrals: ReferralListItem[];
  newborns: NewbornEntry[];
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
  urineProtein: string | null;                 // '-', 'trace', '+', '++', '+++'
  urineGlucose: string | null;
  hbGDl: number | null;
  hctPct: number | null;
  ttDoseNo: number | null;                     // tetanus toxoid dose number at this visit (0-5)
  ironFolicGiven: boolean | null;
  calciumGiven: boolean | null;
  dangerSigns: string[] | null;                // e.g. ['bleeding','severe_headache','reduced_fm']
  fetalMovementOk: boolean | null;             // T3 only
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
  fromHospital: string;
  toHospital: string;
  status: string;
  reason: string;
  urgencyLevel: string;
  initiatedAt: string;
  arrivedAt: string | null;
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
  lbwRate: number;
  lowApgarCount: number;
  avgBirthWeightG: number;
}

export interface DashboardStageKPIs {
  pregnancy: { total: number; low: number; hr1: number; hr2: number; hr3: number };
  labor: { total: number; low: number; medium: number; high: number };
  delivered: { total: number; normal: number; lowApgar: number; lbw: number };
}

export interface DashboardAlerts {
  referralAlerts: number;
  overdueAnc: number;
  inTransitReferrals: number;
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

export interface ReferralListResponse {
  referrals: ReferralListItem[];
  pagination: Pagination;
}

export interface ReferralDetailResponse {
  referral: ReferralListItem & {
    diagnosisCode: string | null;
    rejectionReason: string | null;
    transportMode: string | null;
    acceptedAt: string | null;
    departedAt: string | null;
    rejectedAt: string | null;
    journeyId: string;
  };
}
