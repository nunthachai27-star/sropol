// T013: API response types per contracts/api-routes.md

import type { RiskLevel, ConnectionStatus, HospitalLevel, LaborStatus } from './domain';

// Dashboard
export interface DashboardHospital {
  hcode: string;
  name: string;
  level: HospitalLevel;
  connectionStatus: ConnectionStatus;
  lastSyncAt: string | null;
  counts: {
    low: number;
    medium: number;
    high: number;
    total: number;
  };
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
    gaWeeks: number | null;
    ancCount: number | null;
    admitDate: string;
    heightCm: number | null;
    weightKg: number | null;
    weightDiffKg: number | null;
    fundalHeightCm: number | null;
    usWeightG: number | null;
    hematocritPct: number | null;
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
    startTime: string;
    entries: PartogramEntry[];
  };
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
  };
  ancVisits: AncVisitEntry[];
  latestRisk: AncRiskEntry | null;
  referrals: ReferralListItem[];
  newborns: NewbornEntry[];
}

export interface AncVisitEntry {
  visitDate: string;
  visitNumber: number;
  gaWeeks: number | null;
  fundalHeightCm: number | null;
  weightKg: number | null;
  bpSystolic: number | null;
  bpDiastolic: number | null;
  fetalHr: number | null;
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
