// T012: KK-LRMS domain types and enums

// MoPH service-plan levels.
//
// The first block (A_S..F3) is the LEGACY classification still applied to
// hospitals outside Khon Kaen that haven't been reclassified under SAP.
//
// The second block is the SAP framework ratified by อ.ก.พ. มติ 3/2568
// (20 พ.ค. 2568) — see the August 2025 PHO Khon Kaen circular forwarded
// from MoPH สธ ๐๒๐๗.๑๑/ว ๒๐๖๘๙. 904 health-service units across all 12
// regions were reclassified; KK_HOSPITALS in src/config/hospitals.ts is
// updated accordingly.
//
// DB column hospitals.level is varchar(10) so all values fit. The `S_C`
// short code stands for "S เงื่อนไข" (S with development conditions
// pending — see hospitals.development_condition for the specific
// requirements).
export enum HospitalLevel {
  // Legacy
  A_S = 'A_S',
  M1 = 'M1',
  M2 = 'M2',
  F1 = 'F1',
  F2 = 'F2',
  F3 = 'F3',
  // SAP (อ.ก.พ. 3/2568)
  P_PLUS = 'P+',
  P = 'P',
  A_PLUS = 'A+',
  A = 'A',
  S_PLUS = 'S+',
  S = 'S',
  S_C = 'S_C',
  M = 'M',
  F = 'F',
}

// Service-role classification for the kk-lrms maternity network.
// Orthogonal to MOPH `HospitalLevel`: a single F2 district hospital may or
// may not run a maternity ward; the service_type column captures that.
// Drives:
//   - dashboard filter: "who can receive a referred labor case" =
//     PROVINCIAL_HUB ∪ DISTRICT_WITH_MATERNITY
//   - map tile: NO_MATERNITY pins render in a muted palette
//   - admin UI: sync and partograph are only meaningful for maternity sites
export enum HospitalServiceType {
  PROVINCIAL_HUB = 'PROVINCIAL_HUB',
  DISTRICT_WITH_MATERNITY = 'DISTRICT_WITH_MATERNITY',
  DISTRICT_NO_MATERNITY = 'DISTRICT_NO_MATERNITY',
}

export enum ConnectionStatus {
  ONLINE = 'ONLINE',
  OFFLINE = 'OFFLINE',
  UNKNOWN = 'UNKNOWN',
}

export enum LaborStatus {
  ACTIVE = 'ACTIVE',
  DELIVERED = 'DELIVERED',
  TRANSFERRED = 'TRANSFERRED',
}

export enum RiskLevel {
  LOW = 'LOW',
  MEDIUM = 'MEDIUM',
  HIGH = 'HIGH',
}

export enum UserRole {
  OBSTETRICIAN = 'OBSTETRICIAN',
  NURSE = 'NURSE',
  ADMIN = 'ADMIN',
}

export interface Hospital {
  id: string;
  hcode: string;
  name: string;
  level: HospitalLevel;
  isActive: boolean;
  lastSyncAt: Date | null;
  connectionStatus: ConnectionStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface HospitalBmsConfig {
  id: string;
  hospitalId: string;
  tunnelUrl: string;
  sessionId: string | null;
  sessionJwt: string | null;
  sessionExpiresAt: Date | null;
  databaseType: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CachedPatient {
  id: string;
  hospitalId: string;
  hn: string;
  an: string;
  name: string;
  cid: string | null;
  cidHash: string | null;
  age: number;
  gravida: number | null;
  para: number | null;
  abortion: number | null;
  livingChildren: number | null;
  pregNo: number | null;
  gaWeeks: number | null;
  gaDay: number | null;
  ancCount: number | null;
  admitDate: Date;
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
  deliveredAt: Date | null;
  syncedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface CachedVitalSign {
  id: string;
  patientId: string;
  measuredAt: Date;
  maternalHr: number | null;
  fetalHr: string | null;
  sbp: number | null;
  dbp: number | null;
  cervixCm: number | null;
  effacementPct: number | null;
  station: string | null;
  hct: number | null;
  pphAmountMl: number | null;
  syncedAt: Date;
  createdAt: Date;
}

export interface CpdScore {
  id: string;
  patientId: string;
  score: number;
  riskLevel: RiskLevel;
  recommendation: string | null;
  factorGravida: number | null;
  factorAncCount: number | null;
  factorGaWeeks: number | null;
  factorHeightCm: number | null;
  factorWeightDiff: number | null;
  factorFundalHt: number | null;
  factorUsWeight: number | null;
  factorHematocrit: number | null;
  missingFactors: string[];
  calculatedAt: Date;
  createdAt: Date;
}

export interface CpdFactors {
  gravida: number;
  ancCount: number;
  gaWeeks: number;
  heightCm: number;
  weightDiffKg: number;
  fundalHeightCm: number;
  usWeightG: number;
  hematocritPct: number;
}

export interface User {
  id: string;
  bmsUserName: string;
  bmsHospitalCode: string | null;
  bmsPosition: string | null;
  role: UserRole;
  isActive: boolean;
  lastLoginAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface AuditLog {
  id: string;
  userId: string;
  action: string;
  resourceType: string;
  resourceId: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
}

// --- Maternal Journey Continuum (Pregnancy → Labor → Newborn) ---

export enum CareStage {
  PREGNANCY = 'PREGNANCY',
  LABOR = 'LABOR',
  DELIVERED = 'DELIVERED',
  POSTPARTUM = 'POSTPARTUM',
}

export enum AncRiskLevel {
  LOW = 'LOW',
  HR1 = 'HR1',
  HR2 = 'HR2',
  HR3 = 'HR3',
}

export enum ReferralStatus {
  INITIATED = 'INITIATED',
  ACCEPTED = 'ACCEPTED',
  REJECTED = 'REJECTED',
  IN_TRANSIT = 'IN_TRANSIT',
  ARRIVED = 'ARRIVED',
  /** Closed by data cleanup: no arrival evidence within the matching window.
   *  Terminal; never set by the live state machine, only by operator scripts. */
  EXPIRED = 'EXPIRED',
}

export enum UrgencyLevel {
  ROUTINE = 'ROUTINE',
  URGENT = 'URGENT',
  EMERGENCY = 'EMERGENCY',
}

export interface MaternalJourney {
  id: string;
  hospitalId: string;
  currentHospitalId: string;
  hn: string;
  personAncId: number | null;
  name: string;
  cid: string; // encrypted CID (เลขบัตรประชาชน)
  cidHash: string; // SHA-256 hash — primary patient key across hospitals
  age: number;
  gravida: number;
  para: number;
  lmp: string | null;
  edc: string | null;
  careStage: CareStage;
  ancRiskLevel: AncRiskLevel;
  ancVisitCount: number;
  lastAncDate: string | null;
  gaWeeks: number | null;
  changwatCode: string | null; // จังหวัด (2-digit Thai province code)
  amphurCode: string | null; // อำเภอ (2-digit Thai district code)
  tambonCode: string | null; // ตำบล (2-digit Thai sub-district code)
  registeredAt: Date;
  stageChangedAt: Date;
  syncedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface CachedAncVisit {
  id: string;
  journeyId: string;
  visitDate: string;
  visitNumber: number;
  gaWeeks: number | null;
  gaDays: number | null;
  fundalHeightCm: number | null;
  weightKg: number | null;
  bpSystolic: number | null;
  bpDiastolic: number | null;
  fetalHr: number | null;
  presentation: string | null;
  engagement: string | null;
  passQuality: boolean | null;
  providerCode: string | null;
  syncedAt: Date;
  createdAt: Date;
}

export interface CachedAncRisk {
  id: string;
  journeyId: string;
  riskLevel: AncRiskLevel;
  triggeredRules: string[];
  riskFactors: Record<string, unknown>;
  recommendedFacility: string | null;
  recommendedProvider: string | null;
  screenedAt: Date;
  createdAt: Date;
}

export interface CachedReferral {
  id: string;
  journeyId: string;
  referNumber: string | null;
  fromHospitalId: string;
  toHospitalId: string;
  status: ReferralStatus;
  reason: string;
  diagnosisCode: string | null;
  urgencyLevel: UrgencyLevel;
  rejectionReason: string | null;
  suggestedAlternativeId: string | null;
  transportMode: string | null;
  initiatedAt: Date;
  acceptedAt: Date | null;
  departedAt: Date | null;
  arrivedAt: Date | null;
  rejectedAt: Date | null;
  initiatedBy: string | null;
  acceptedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CachedNewborn {
  id: string;
  journeyId: string;
  infantNumber: number;
  sex: string | null;
  birthWeightG: number | null;
  bodyLengthCm: number | null;
  headCircumCm: number | null;
  temperature: number | null;
  heartRate: number | null;
  respiratoryRate: number | null;
  apgar1min: number | null;
  apgar5min: number | null;
  apgar10min: number | null;
  resuscitation: Record<string, boolean>;
  vaccinations: Record<string, boolean>;
  infantIcd10: string | null;
  infantHn: string | null;
  infantAn: string | null;
  dischargeStatus: string | null;
  bornAt: Date;
  syncedAt: Date;
  createdAt: Date;
}
