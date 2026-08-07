// Maternal labor-triage screening — pure domain types (spec §6,
// docs/maternal-screen-plan.md).
//
// STATUS: PROVISIONAL / UNAPPROVED. These types describe the shape of an
// inert, shadow-mode-only feature (see
// docs/superpowers/plans/2026-07-16-maternal-screening.md, Global
// Constraints GC1-GC3). No value produced from these types may drive a
// production alert until a clinical owner signs the Phase 0 decision tables
// in docs/clinical/maternal-screen-rules-v1.yaml and
// docs/clinical/maternal-screen-acuity-v1.yaml.
//
// Nullable booleans throughout this file follow a three-state
// "assessed-true / assessed-false / not-assessed" convention:
//   - `true`  — assessed and present
//   - `false` — assessed and absent
//   - `null`  — not assessed / not available
// A `null` (or an enum's 'UNKNOWN' member) must NEVER be treated as a
// negative/normal finding (GC1) — this mirrors, in spirit, the `Severity`
// discriminated-union pattern at src/services/anc-clinical.ts:28 (where a
// missing component yields 'unknown', never 'normal'). It deliberately does
// NOT reuse that same token set: `localTier`, `emergencyAcuity`,
// `suspectedConditions`, and `isComplete` are a distinct vocabulary from ANC
// (`AncRiskLevel`: LOW/HR1/HR2/HR3) and partograph
// (`CdssSeverity`: INFO/WARN/ALERT/CRITICAL) severity (GC3).

/** Local PDF-tier preeclampsia screening classification (spec §6.1, §7). */
export type MaternalScreenLocalTier =
  'LOCAL_MILD' | 'LOCAL_MODERATE' | 'LOCAL_SEVERE' | 'NO_LOCAL_MATCH';

/**
 * Immediate maternal/fetal instability, computed independently of
 * `localTier` and independently of suspected cause / visible blood volume
 * (GC4). `'UNKNOWN'` is a distinct, non-normal state — it must never be
 * conflated with `'STABLE'` when stability-determination fields are
 * unassessed (GC1).
 */
export type MaternalEmergencyAcuity = 'STABLE' | 'URGENT' | 'EMERGENCY' | 'UNKNOWN';

/**
 * Normalized dipstick proteinuria ordinal. `'UNKNOWN'` covers
 * unrecognized/blank/not-assessed input (GC1) — the pure engine (Task 3)
 * normalizes accepted source spellings (e.g. `'1+'`, `'trace'`, Thai) into
 * this enum before rule evaluation; this type assumes normalization already
 * happened.
 */
export type ProteinuriaGrade =
  'NEGATIVE' | 'TRACE' | 'ONE_PLUS' | 'TWO_PLUS' | 'THREE_PLUS' | 'FOUR_PLUS' | 'UNKNOWN';

export type HeadacheSeverity = 'NONE' | 'MILD' | 'SEVERE' | 'UNKNOWN';

/**
 * Raw, already-normalized screening observations (spec §6.1). Nullable
 * booleans/numbers are "not assessed" when `null`; the categorical fields
 * below are non-optional discriminants (defaulting to an explicit
 * `'UNKNOWN'` member instead of `null`) because they are consumed directly
 * by rule `logic` field-conditions (see src/config/maternal-screen-rules.ts)
 * and a bare `null` there would defeat exhaustive enum matching.
 */
export interface MaternalScreenInput {
  gaWeeks: number | null;
  gaDays: number | null;
  piHDiagnosed: boolean | null;

  systolicBp: number | null;
  diastolicBp: number | null;
  proteinuriaGrade: ProteinuriaGrade;
  creatinineMgDl: number | null;
  creatinineBaselineMgDl: number | null;
  plateletPerUl: number | null;
  astIuL: number | null;
  altIuL: number | null;
  urineOutputMlPerHour: number | null;

  headache: HeadacheSeverity;
  blurredVision: boolean | null;
  epigastricPain: boolean | null;
  pulmonaryEdema: boolean | null;
  rightUpperQuadrantPain: boolean | null;

  vaginalBleeding: boolean | null;
  estimatedBleedingMl: number | null;
  bleedingRate: 'SPOTTING' | 'LIGHT' | 'MODERATE' | 'HEAVY' | 'UNKNOWN';
  concealedBleedingSuspected: boolean | null;
  abdominalOrBackPain: boolean | null;
  uterineTenderness: boolean | null;
  frequentContractions: boolean | null;
  contractionDurationExceedsInterval: boolean | null;
  suprapubicTenderness: boolean | null;
  bandlsRing: boolean | null;
  membranesRuptured: boolean | null;
  abnormalPresentation: boolean | null;
  fetalHeartRateBpm: number | null;
  fetalTracingPattern: 'REASSURING' | 'NON_REASSURING' | 'SINUSOIDAL' | 'UNKNOWN';

  maternalPulseBpm: number | null;
  respiratoryRatePerMin: number | null;
  oxygenSaturationPct: number | null;
  consciousness: 'ALERT' | 'VOICE' | 'PAIN' | 'UNRESPONSIVE' | 'UNKNOWN';
  shockSignsPresent: boolean | null;

  placentaPreviaExcluded: boolean | null;
  placentaLocationSource: 'ULTRASOUND' | 'OTHER_DOCUMENTED' | 'UNKNOWN';
}

/** Non-diagnostic, "suspected" etiologic pattern labels (spec §6.2, GC4). */
export type SuspectedMaternalCondition =
  | 'PREECLAMPSIA'
  | 'ANTEPARTUM_HEMORRHAGE'
  | 'ABRUPTIO_PLACENTAE'
  | 'PLACENTA_PREVIA'
  | 'UTERINE_RUPTURE'
  | 'VASA_PREVIA';

/**
 * Rule purpose taxonomy (spec §7.1). `'EXTERNAL_SAFETY'` has no rule in the
 * v1 fixture yet (maternal-screen-rules-v1.yaml clinicalDecision ref
 * "7.5-15" records this as an intentional scope limitation, not a defect)
 * but is retained here so a future rule-set version can add one without a
 * breaking type change.
 */
export type MaternalScreenRulePurpose = 'LOCAL_PDF_TIER' | 'EXTERNAL_SAFETY' | 'EMERGENCY_ACUITY';

/** Fields common to every match variant, regardless of `purpose`. */
interface MaternalScreenMatchBase {
  ruleId: string;
  controllingSourceId: string;
  supportingSourceIds: string[];
  evidence: Array<{ field: keyof MaternalScreenInput; value: unknown }>;
}

/**
 * A `LOCAL_PDF_TIER` match: REQUIRES `condition` and `localTier`; FORBIDS
 * `emergencyAcuity` (`?: never`). This is the compile-time enforcement of
 * GC3 — the type system now rejects a local-tier match that omits its
 * `condition` (which would otherwise leak `undefined` into
 * `suspectedConditions`) or that carries an emergency acuity.
 */
export interface LocalPdfTierMatch extends MaternalScreenMatchBase {
  purpose: 'LOCAL_PDF_TIER';
  localTier: Exclude<MaternalScreenLocalTier, 'NO_LOCAL_MATCH'>;
  condition: SuspectedMaternalCondition;
  emergencyAcuity?: never;
}

/**
 * An `EMERGENCY_ACUITY` match: REQUIRES `emergencyAcuity`; FORBIDS
 * `condition` and `localTier` (`?: never`). Instability findings (shock,
 * depressed consciousness, heavy bleeding, sinusoidal/non-reassuring
 * tracing, low SpO2, tachycardia) do NOT map to any
 * `SuspectedMaternalCondition`; forcing one on would fabricate an etiologic
 * diagnosis label for a pure stability finding (GC3).
 */
export interface EmergencyAcuityMatch extends MaternalScreenMatchBase {
  purpose: 'EMERGENCY_ACUITY';
  emergencyAcuity: Exclude<MaternalEmergencyAcuity, 'UNKNOWN'>;
  condition?: never;
  localTier?: never;
}

/**
 * An `EXTERNAL_SAFETY` match: an external corroboration/challenge that is
 * neither a local PDF tier nor an emergency acuity (spec §7.1). No rule in
 * the v1 fixture emits one yet (maternal-screen-rules-v1.yaml decision
 * "7.5-15" records this as an intentional scope limitation), but the variant
 * is retained so a future rule-set version can add one without a breaking
 * type change. `condition` is optional; the tier/acuity discriminators are
 * FORBIDDEN (`?: never`).
 */
export interface ExternalSafetyMatch extends MaternalScreenMatchBase {
  purpose: 'EXTERNAL_SAFETY';
  condition?: SuspectedMaternalCondition;
  localTier?: never;
  emergencyAcuity?: never;
}

/**
 * A single matched rule with its evidence (spec §6.2), modeled as a
 * discriminated union keyed on `purpose` so that GC3 ("separate concepts;
 * localTier/emergencyAcuity/suspectedConditions/isComplete never collapse
 * into each other") is enforced at compile time, not merely by convention.
 */
export type MaternalScreenMatch = LocalPdfTierMatch | EmergencyAcuityMatch | ExternalSafetyMatch;

/**
 * Result of evaluating a `MaternalScreenInput` (spec §6.2). `isComplete` is
 * ORTHOGONAL to `localTier`/`emergencyAcuity` (GC1): a proven
 * `LOCAL_SEVERE`/`EMERGENCY` result may coexist with `isComplete: false` and
 * a non-empty `missingRequiredFields`. `localTier`, `emergencyAcuity`,
 * `suspectedConditions`, and `isComplete` are separate concepts and MUST NOT
 * be merged into one overloaded severity enum, nor stored/displayed as
 * `CdssSeverity` (INFO/WARN/ALERT/CRITICAL, `src/types/api.ts:219`) or
 * `AncRiskLevel` (LOW/HR1/HR2/HR3, `src/config/anc-risk-rules.ts`) (GC3).
 */
export interface MaternalScreenResult {
  localTier: MaternalScreenLocalTier;
  emergencyAcuity: MaternalEmergencyAcuity;
  isComplete: boolean;
  suspectedConditions: SuspectedMaternalCondition[];
  matches: MaternalScreenMatch[];
  missingRequiredFields: Array<keyof MaternalScreenInput>;
  ruleSetVersion: string;
  evaluatedAt: string;
}
