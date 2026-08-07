// Maternal labor-triage screening — provisional local-tier + emergency-acuity
// rule set, transcribed as typed TS data (constitution IV: thresholds/rules
// live in config, never hardcoded in the service).
//
// STATUS: PROVISIONAL / UNAPPROVED. This module MIRRORS, field for field,
// two clinical fixtures and must never drift from them silently:
//   - docs/clinical/maternal-screen-rules-v1.yaml    (19 LOCAL_PDF_TIER rules)
//   - docs/clinical/maternal-screen-acuity-v1.yaml   (7 EMERGENCY_ACUITY rules)
// Both carry `status: PROVISIONAL_UNAPPROVED`, `approvedBy: null`,
// `approvedAt: null`. No rule here may drive a production alert (GC2). See
// docs/superpowers/plans/2026-07-16-maternal-screening.md for the binding
// Global Constraints (GC1-GC7).
//
// This is data + one small, mechanical, pure interpreter (`matchRule`) that
// transcribes each rule's `anyOf`/`allOf` YAML `logic` block. It is NOT the
// rule engine: evaluation order, hemorrhage-pattern assembly, evidence
// collection, highest-tier/acuity selection, completeness computation, and
// `suspectedConditions` dedup all belong to the pure engine
// (src/services/maternal-screening.ts, Task 3), which consumes
// `MATERNAL_SCREEN_RULES` and `matchRule` from here. This module assumes
// its `MaternalScreenInput` is ALREADY NORMALIZED (e.g. `proteinuriaGrade`
// spelling variants already resolved to the enum) — normalization is the
// engine's job, not this config's.

import type {
  MaternalScreenInput,
  MaternalScreenLocalTier,
  MaternalEmergencyAcuity,
  SuspectedMaternalCondition,
} from '@/types/maternal-screening';

/** Config-and-fixture version marker. Must equal both YAML fixtures' `ruleSetVersion`. */
export const MATERNAL_SCREEN_RULE_SET_VERSION = '0.1.0-provisional';

// ---------------------------------------------------------------------------
// Declarative rule logic (transcribed verbatim from each rule's YAML `logic`
// block). A single shared, pure, null-guarded interpreter (`matchRule`)
// evaluates every rule — chosen over 26 hand-written closures because a
// generic interpreter enforces the GC1 null-guard ONCE, centrally, instead
// of relying on 26 separate authors each remembering to null-check (the
// "less error-prone" choice the task calls for).
// ---------------------------------------------------------------------------

/** Comparison operators used by the YAML fixtures' `logic.field` conditions. */
export type MaternalScreenComparisonOperator = '==' | '!=' | '>' | '>=' | '<' | '<=' | 'in';

/** A single `{ field, operator, value }` leaf condition from the YAML `logic` block. */
export interface MaternalScreenFieldCondition {
  readonly field: keyof MaternalScreenInput;
  readonly operator: MaternalScreenComparisonOperator;
  readonly value: string | number | boolean | readonly string[];
}

/** `anyOf: [...]` — true when at least one child node matches. */
export interface MaternalScreenAnyOfNode {
  readonly anyOf: readonly MaternalScreenLogicNode[];
}

/** `allOf: [...]` — true when every child node matches. */
export interface MaternalScreenAllOfNode {
  readonly allOf: readonly MaternalScreenLogicNode[];
}

export type MaternalScreenLogicNode =
  MaternalScreenFieldCondition | MaternalScreenAnyOfNode | MaternalScreenAllOfNode;

function isAnyOfNode(node: MaternalScreenLogicNode): node is MaternalScreenAnyOfNode {
  return 'anyOf' in node;
}

function isAllOfNode(node: MaternalScreenLogicNode): node is MaternalScreenAllOfNode {
  return 'allOf' in node;
}

/**
 * "Not assessed" sentinel check shared by every operator except `!=`
 * (see `matchFieldCondition` below for why `!=` is the deliberate
 * exception).
 */
function isUnassessed(value: unknown): boolean {
  return (
    value === null ||
    value === undefined ||
    value === 'UNKNOWN' ||
    (typeof value === 'number' && Number.isNaN(value))
  );
}

/**
 * Evaluate one `{ field, operator, value }` leaf against already-normalized
 * input. GC1 ("a rule MUST NOT fire when a component it reads is
 * null/'UNKNOWN'") is enforced here, centrally, for every operator except
 * one deliberate, documented exception:
 *
 * `!=` is NOT null-guarded to false. The only `!=` condition in the v1
 * fixture is `APH-PREVIA-PATTERN`'s `{ field: abdominalOrBackPain,
 * operator: "!=", value: true }`. Its clinicalDecision (ref "7.5-11",
 * maternal-screen-rules-v1.yaml) explicitly requires this to fire "even
 * when pain status is unassessed" — placenta previa is classically
 * painless, so an unrecorded pain status must not suppress the suspected
 * pattern (under-flagging a *suspected*, non-diagnostic label from missing
 * data is the unsafe direction here, not the safe one). A plain strict
 * `!==` naturally yields this behavior (`null !== true` is `true`) without
 * any special-casing beyond skipping the blanket unassessed-guard.
 */
function matchFieldCondition(
  condition: MaternalScreenFieldCondition,
  input: MaternalScreenInput,
): boolean {
  const raw: unknown = input[condition.field];

  if (condition.operator === '!=') {
    return raw !== condition.value;
  }

  if (isUnassessed(raw)) return false;

  switch (condition.operator) {
    case '==':
      return raw === condition.value;
    case '>':
      return (
        typeof raw === 'number' && typeof condition.value === 'number' && raw > condition.value
      );
    case '>=':
      return (
        typeof raw === 'number' && typeof condition.value === 'number' && raw >= condition.value
      );
    case '<':
      return (
        typeof raw === 'number' && typeof condition.value === 'number' && raw < condition.value
      );
    case '<=':
      return (
        typeof raw === 'number' && typeof condition.value === 'number' && raw <= condition.value
      );
    case 'in':
      return (
        Array.isArray(condition.value) && (condition.value as readonly unknown[]).includes(raw)
      );
    default: {
      // Exhaustiveness guard — every MaternalScreenComparisonOperator is
      // handled above; this branch is unreachable at compile time.
      const exhaustiveCheck: never = condition.operator;
      throw new Error(`Unhandled maternal-screen comparison operator: ${String(exhaustiveCheck)}`);
    }
  }
}

function matchLogicNode(node: MaternalScreenLogicNode, input: MaternalScreenInput): boolean {
  if (isAnyOfNode(node)) return node.anyOf.some((child) => matchLogicNode(child, input));
  if (isAllOfNode(node)) return node.allOf.every((child) => matchLogicNode(child, input));
  return matchFieldCondition(node, input);
}

/** Fields common to every rule variant, regardless of `purpose`. */
interface MaternalScreenRuleBase {
  readonly id: string;
  readonly controllingSourceId: string;
  readonly supportingSourceIds: readonly string[];
  readonly logic: MaternalScreenLogicNode;
}

/**
 * A `LOCAL_PDF_TIER` rule: REQUIRES `condition` and `localTier`; FORBIDS
 * `emergencyAcuity` (`?: never`). The compiler now rejects a local-tier rule
 * that forgets `condition` (which would leak `undefined` into
 * `suspectedConditions` downstream) or that mistakenly carries an acuity —
 * GC3 enforced at compile time, not by convention.
 */
export interface LocalPdfTierRule extends MaternalScreenRuleBase {
  readonly purpose: 'LOCAL_PDF_TIER';
  readonly condition: SuspectedMaternalCondition;
  readonly localTier: Exclude<MaternalScreenLocalTier, 'NO_LOCAL_MATCH'>;
  readonly emergencyAcuity?: never;
}

/**
 * An `EMERGENCY_ACUITY` rule: REQUIRES `emergencyAcuity`; FORBIDS `condition`
 * and `localTier` (`?: never`). Instability findings have no
 * `SuspectedMaternalCondition` (GC3).
 */
export interface EmergencyAcuityRule extends MaternalScreenRuleBase {
  readonly purpose: 'EMERGENCY_ACUITY';
  readonly emergencyAcuity: Exclude<MaternalEmergencyAcuity, 'UNKNOWN'>;
  readonly condition?: never;
  readonly localTier?: never;
}

/**
 * An `EXTERNAL_SAFETY` rule: an external corroboration purpose that is
 * neither a local PDF tier nor an emergency acuity (spec §7.1). No rule in
 * `MATERNAL_SCREEN_RULES` uses this purpose yet
 * (maternal-screen-rules-v1.yaml decision "7.5-15"), but the variant is
 * retained so the union stays exhaustive over `MaternalScreenRulePurpose`
 * and a future rule-set version can add one without a breaking type change.
 * `condition` is optional; the tier/acuity discriminators are FORBIDDEN.
 */
export interface ExternalSafetyRule extends MaternalScreenRuleBase {
  readonly purpose: 'EXTERNAL_SAFETY';
  readonly condition?: SuspectedMaternalCondition;
  readonly localTier?: never;
  readonly emergencyAcuity?: never;
}

/**
 * A single provisional rule, transcribed from one YAML `rules[]` entry,
 * modeled as a discriminated union keyed on `purpose` (GC3). The shared
 * `logic` tree + `matchRule()` interpreter live in the base; the per-purpose
 * variants pin down which of `condition`/`localTier`/`emergencyAcuity` are
 * required vs forbidden.
 */
export type MaternalScreenRule = LocalPdfTierRule | EmergencyAcuityRule | ExternalSafetyRule;

/**
 * Pure predicate: does `rule` match `input`? Shared by every rule — see the
 * module-level comment for why a single interpreter was chosen over 26
 * closures.
 */
export function matchRule(rule: MaternalScreenRule, input: MaternalScreenInput): boolean {
  return matchLogicNode(rule.logic, input);
}

// ---------------------------------------------------------------------------
// Rank maps (mirrors `localTierRank` / `emergencyAcuityRank` in the two YAML
// fixtures). Total over their enums and strictly ordered — used by the
// engine (Task 3) to select the single highest-matched value per axis while
// still returning every match (spec §7.2 step 7).
// ---------------------------------------------------------------------------

export const LOCAL_TIER_RANK: Readonly<Record<MaternalScreenLocalTier, number>> = {
  NO_LOCAL_MATCH: 0,
  LOCAL_MILD: 1,
  LOCAL_MODERATE: 2,
  LOCAL_SEVERE: 3,
};

export const EMERGENCY_ACUITY_RANK: Readonly<Record<MaternalEmergencyAcuity, number>> = {
  UNKNOWN: 0,
  STABLE: 1,
  URGENT: 2,
  EMERGENCY: 3,
};

// ---------------------------------------------------------------------------
// Mandatory fields (mirrors `mandatoryFields` / decision "T1-MANDATORY-
// FIELDS" in maternal-screen-rules-v1.yaml). EXACTLY these 11 fields — the
// clinical-cases fixture oracle (tests/fixtures/maternal-screen-clinical-
// cases.json) depends on this precise set. Do not add or drop fields here
// without updating the YAML fixture first.
//
// Deliberately excludes `bleedingRate`, `oxygenSaturationPct`, and
// `fetalTracingPattern` — those drive the SEPARATE, narrower
// `stabilityDeterminationFields` set in maternal-screen-acuity-v1.yaml used
// only to decide STABLE vs UNKNOWN emergency acuity (orthogonal to overall
// `isComplete`, spec §6.2).
// ---------------------------------------------------------------------------

export const MANDATORY_SCREEN_FIELDS: readonly (keyof MaternalScreenInput)[] = [
  'gaWeeks',
  'gaDays',
  'systolicBp',
  'diastolicBp',
  'proteinuriaGrade',
  'headache',
  'vaginalBleeding',
  'fetalHeartRateBpm',
  'maternalPulseBpm',
  'consciousness',
  'shockSignsPresent',
];

// ---------------------------------------------------------------------------
// Stability-determination fields (mirrors `stabilityDeterminationFields` /
// decision "T1-ACUITY-DETERMINATION" in maternal-screen-acuity-v1.yaml).
// EXACTLY these 6 fields, in YAML order — the ONLY fields consulted to decide
// STABLE vs UNKNOWN emergency acuity when no EMERGENCY_ACUITY rule fires.
//
// This list is deliberately SEPARATE from (and narrower than)
// MANDATORY_SCREEN_FIELDS above: `emergencyAcuity` completeness is orthogonal
// to the overall `MaternalScreenResult.isComplete` (spec §6.2), so a case can
// be `emergencyAcuity: STABLE` while `isComplete: false` and vice versa.
//
// The pure engine (src/services/maternal-screening.ts, Task 3) reads this
// list rather than hardcoding the field names (constitution IV). STABLE
// requires every field here to be explicitly assessed (non-null,
// non-'UNKNOWN'); otherwise the acuity is UNKNOWN, NEVER STABLE by default
// from missing data (GC1). Do not add or drop fields here without updating
// the YAML fixture first — the config test asserts parity.
// ---------------------------------------------------------------------------

export const STABILITY_DETERMINATION_FIELDS: readonly (keyof MaternalScreenInput)[] = [
  'shockSignsPresent',
  'consciousness',
  'oxygenSaturationPct',
  'maternalPulseBpm',
  'bleedingRate',
  'fetalTracingPattern',
];

// ---------------------------------------------------------------------------
// Rules — 19 LOCAL_PDF_TIER rules (maternal-screen-rules-v1.yaml) followed
// by 7 EMERGENCY_ACUITY rules (maternal-screen-acuity-v1.yaml). IDs, sources,
// and `logic` are transcribed verbatim; see the YAML files' `clinicalDecision`
// blocks for the full rationale behind each threshold/operator.
// ---------------------------------------------------------------------------

export const MATERNAL_SCREEN_RULES: readonly MaternalScreenRule[] = [
  // --- Preeclampsia: clinical/symptom domain (severe column) --------------
  {
    id: 'PE-HEADACHE-IN-LOCAL-SEVERE-COLUMN',
    purpose: 'LOCAL_PDF_TIER',
    controllingSourceId: 'LOCAL_PDF',
    supportingSourceIds: ['SRC-ACOG-PREECLAMPSIA-FAQ'],
    condition: 'PREECLAMPSIA',
    localTier: 'LOCAL_SEVERE',
    logic: { anyOf: [{ field: 'headache', operator: '==', value: 'SEVERE' }] },
  },
  {
    id: 'PE-HEADACHE-MODERATE-TOLERABLE',
    purpose: 'LOCAL_PDF_TIER',
    controllingSourceId: 'LOCAL_PDF',
    supportingSourceIds: ['SRC-ACOG-PREECLAMPSIA-FAQ'],
    condition: 'PREECLAMPSIA',
    localTier: 'LOCAL_MODERATE',
    logic: { anyOf: [{ field: 'headache', operator: '==', value: 'MILD' }] },
  },
  {
    id: 'PE-BLURRED-VISION-IN-LOCAL-SEVERE-COLUMN',
    purpose: 'LOCAL_PDF_TIER',
    controllingSourceId: 'LOCAL_PDF',
    supportingSourceIds: ['SRC-ACOG-PREECLAMPSIA-FAQ'],
    condition: 'PREECLAMPSIA',
    localTier: 'LOCAL_SEVERE',
    logic: { anyOf: [{ field: 'blurredVision', operator: '==', value: true }] },
  },
  {
    id: 'PE-EPIGASTRIC-PAIN-IN-LOCAL-SEVERE-COLUMN',
    purpose: 'LOCAL_PDF_TIER',
    controllingSourceId: 'LOCAL_PDF',
    supportingSourceIds: ['SRC-ACOG-PREECLAMPSIA-FAQ', 'SRC-ACOG-DISTRICT-IV-HTN'],
    condition: 'PREECLAMPSIA',
    localTier: 'LOCAL_SEVERE',
    logic: { anyOf: [{ field: 'epigastricPain', operator: '==', value: true }] },
  },
  {
    id: 'PE-PULMONARY-EDEMA-IN-LOCAL-SEVERE-COLUMN',
    purpose: 'LOCAL_PDF_TIER',
    controllingSourceId: 'LOCAL_PDF',
    supportingSourceIds: ['SRC-ACOG-PREECLAMPSIA-FAQ'],
    condition: 'PREECLAMPSIA',
    localTier: 'LOCAL_SEVERE',
    logic: { anyOf: [{ field: 'pulmonaryEdema', operator: '==', value: true }] },
  },

  // --- Preeclampsia: blood-pressure domain ---------------------------------
  {
    id: 'PE-BP-MILD-140',
    purpose: 'LOCAL_PDF_TIER',
    controllingSourceId: 'LOCAL_PDF',
    supportingSourceIds: ['SRC-NICE-NG133'],
    condition: 'PREECLAMPSIA',
    localTier: 'LOCAL_MILD',
    logic: {
      anyOf: [
        { field: 'systolicBp', operator: '>=', value: 140 },
        { field: 'diastolicBp', operator: '>=', value: 90 },
      ],
    },
  },
  {
    id: 'PE-BP-MODERATE-SBP-150',
    purpose: 'LOCAL_PDF_TIER',
    controllingSourceId: 'LOCAL_PDF',
    supportingSourceIds: ['SRC-NICE-NG133'],
    condition: 'PREECLAMPSIA',
    localTier: 'LOCAL_MODERATE',
    logic: { anyOf: [{ field: 'systolicBp', operator: '>=', value: 150 }] },
  },
  {
    id: 'PE-BP-MODERATE-DBP-100',
    purpose: 'LOCAL_PDF_TIER',
    controllingSourceId: 'LOCAL_PDF',
    supportingSourceIds: ['SRC-NICE-NG133'],
    condition: 'PREECLAMPSIA',
    localTier: 'LOCAL_MODERATE',
    logic: { anyOf: [{ field: 'diastolicBp', operator: '>=', value: 100 }] },
  },
  {
    id: 'PE-BP-SEVERE-SBP-160',
    purpose: 'LOCAL_PDF_TIER',
    controllingSourceId: 'LOCAL_PDF',
    supportingSourceIds: ['SRC-NICE-NG133', 'SRC-ACOG-DISTRICT-IV-HTN'],
    condition: 'PREECLAMPSIA',
    localTier: 'LOCAL_SEVERE',
    logic: { anyOf: [{ field: 'systolicBp', operator: '>=', value: 160 }] },
  },
  {
    id: 'PE-BP-SEVERE-DBP-110',
    purpose: 'LOCAL_PDF_TIER',
    controllingSourceId: 'LOCAL_PDF',
    supportingSourceIds: ['SRC-NICE-NG133', 'SRC-ACOG-DISTRICT-IV-HTN'],
    condition: 'PREECLAMPSIA',
    localTier: 'LOCAL_SEVERE',
    logic: { anyOf: [{ field: 'diastolicBp', operator: '>=', value: 110 }] },
  },

  // --- Preeclampsia: laboratory domain -------------------------------------
  {
    id: 'PE-LAB-SEVERE-CREATININE-1_1',
    purpose: 'LOCAL_PDF_TIER',
    controllingSourceId: 'LOCAL_PDF',
    supportingSourceIds: ['SRC-ACOG-DISTRICT-IV-HTN', 'SRC-NICE-NG133'],
    condition: 'PREECLAMPSIA',
    localTier: 'LOCAL_SEVERE',
    logic: { anyOf: [{ field: 'creatinineMgDl', operator: '>', value: 1.1 }] },
  },
  {
    id: 'PE-LAB-SEVERE-PLATELET-100K',
    purpose: 'LOCAL_PDF_TIER',
    controllingSourceId: 'LOCAL_PDF',
    supportingSourceIds: ['SRC-ACOG-DISTRICT-IV-HTN'],
    condition: 'PREECLAMPSIA',
    localTier: 'LOCAL_SEVERE',
    logic: { anyOf: [{ field: 'plateletPerUl', operator: '<', value: 100000 }] },
  },
  {
    id: 'PE-PROT-MILD-1PLUS',
    purpose: 'LOCAL_PDF_TIER',
    controllingSourceId: 'LOCAL_PDF',
    supportingSourceIds: ['SRC-NICE-NG133'],
    condition: 'PREECLAMPSIA',
    localTier: 'LOCAL_MILD',
    logic: { anyOf: [{ field: 'proteinuriaGrade', operator: '==', value: 'ONE_PLUS' }] },
  },
  {
    id: 'PE-PROT-SEVERE-2TO3PLUS',
    purpose: 'LOCAL_PDF_TIER',
    controllingSourceId: 'LOCAL_PDF',
    supportingSourceIds: ['SRC-NICE-NG133'],
    condition: 'PREECLAMPSIA',
    localTier: 'LOCAL_SEVERE',
    logic: {
      anyOf: [
        {
          field: 'proteinuriaGrade',
          operator: 'in',
          value: ['TWO_PLUS', 'THREE_PLUS', 'FOUR_PLUS'],
        },
      ],
    },
  },

  // --- Antepartum hemorrhage ------------------------------------------------
  {
    id: 'APH-GA26-VAGINAL-BLEEDING',
    purpose: 'LOCAL_PDF_TIER',
    controllingSourceId: 'LOCAL_PDF',
    supportingSourceIds: ['SRC-RCOG-GTG63-APH', 'SRC-WHO-EMERGENCY-VAGINAL-BLEEDING'],
    condition: 'ANTEPARTUM_HEMORRHAGE',
    localTier: 'LOCAL_SEVERE',
    logic: {
      allOf: [
        { field: 'gaWeeks', operator: '>=', value: 26 },
        { field: 'vaginalBleeding', operator: '==', value: true },
      ],
    },
  },
  {
    id: 'APH-ABRUPTIO-PATTERN',
    purpose: 'LOCAL_PDF_TIER',
    controllingSourceId: 'LOCAL_PDF',
    supportingSourceIds: ['SRC-ACOG-BLEEDING-FAQ', 'SRC-WHO-EMERGENCY-VAGINAL-BLEEDING'],
    condition: 'ABRUPTIO_PLACENTAE',
    localTier: 'LOCAL_SEVERE',
    logic: {
      anyOf: [
        {
          allOf: [
            { field: 'vaginalBleeding', operator: '==', value: true },
            {
              anyOf: [
                { field: 'abdominalOrBackPain', operator: '==', value: true },
                { field: 'uterineTenderness', operator: '==', value: true },
                { field: 'frequentContractions', operator: '==', value: true },
                {
                  field: 'fetalTracingPattern',
                  operator: 'in',
                  value: ['NON_REASSURING', 'SINUSOIDAL'],
                },
                { field: 'fetalHeartRateBpm', operator: '<', value: 110 },
                { field: 'fetalHeartRateBpm', operator: '>', value: 160 },
              ],
            },
          ],
        },
        {
          allOf: [
            { field: 'concealedBleedingSuspected', operator: '==', value: true },
            {
              anyOf: [
                { field: 'abdominalOrBackPain', operator: '==', value: true },
                { field: 'uterineTenderness', operator: '==', value: true },
                { field: 'frequentContractions', operator: '==', value: true },
              ],
            },
          ],
        },
      ],
    },
  },
  {
    id: 'APH-PREVIA-PATTERN',
    purpose: 'LOCAL_PDF_TIER',
    controllingSourceId: 'LOCAL_PDF',
    supportingSourceIds: ['SRC-ACOG-BLEEDING-FAQ', 'SRC-RCOG-GTG63-APH'],
    condition: 'PLACENTA_PREVIA',
    localTier: 'LOCAL_SEVERE',
    logic: {
      allOf: [
        { field: 'vaginalBleeding', operator: '==', value: true },
        { field: 'abdominalOrBackPain', operator: '!=', value: true },
      ],
    },
  },
  {
    id: 'APH-RUPTURE-UTERUS-PATTERN',
    purpose: 'LOCAL_PDF_TIER',
    controllingSourceId: 'LOCAL_PDF',
    supportingSourceIds: ['SRC-WHO-EMERGENCY-VAGINAL-BLEEDING'],
    condition: 'UTERINE_RUPTURE',
    localTier: 'LOCAL_SEVERE',
    logic: {
      anyOf: [
        { field: 'contractionDurationExceedsInterval', operator: '==', value: true },
        { field: 'suprapubicTenderness', operator: '==', value: true },
        { field: 'bandlsRing', operator: '==', value: true },
      ],
    },
  },
  {
    id: 'APH-VASA-PREVIA-PATTERN',
    purpose: 'LOCAL_PDF_TIER',
    controllingSourceId: 'LOCAL_PDF',
    supportingSourceIds: ['SRC-SMFM-CONSULT-37-VASA-PREVIA'],
    condition: 'VASA_PREVIA',
    localTier: 'LOCAL_SEVERE',
    logic: {
      allOf: [
        { field: 'vaginalBleeding', operator: '==', value: true },
        { field: 'membranesRuptured', operator: '==', value: true },
        { field: 'fetalTracingPattern', operator: 'in', value: ['SINUSOIDAL', 'NON_REASSURING'] },
      ],
    },
  },

  // --- Emergency acuity (maternal-screen-acuity-v1.yaml) -------------------
  {
    id: 'EA-SHOCK-SIGNS-EMERGENCY',
    purpose: 'EMERGENCY_ACUITY',
    controllingSourceId: 'SRC-WHO-EMERGENCY-VAGINAL-BLEEDING',
    supportingSourceIds: [],
    emergencyAcuity: 'EMERGENCY',
    logic: { anyOf: [{ field: 'shockSignsPresent', operator: '==', value: true }] },
  },
  {
    id: 'EA-CONSCIOUSNESS-DEPRESSED-EMERGENCY',
    purpose: 'EMERGENCY_ACUITY',
    controllingSourceId: 'SRC-WHO-EMERGENCY-VAGINAL-BLEEDING',
    supportingSourceIds: [],
    emergencyAcuity: 'EMERGENCY',
    logic: { anyOf: [{ field: 'consciousness', operator: 'in', value: ['PAIN', 'UNRESPONSIVE'] }] },
  },
  {
    id: 'EA-BLEEDING-HEAVY-EMERGENCY',
    purpose: 'EMERGENCY_ACUITY',
    controllingSourceId: 'SRC-WHO-EMERGENCY-VAGINAL-BLEEDING',
    supportingSourceIds: ['SRC-ACOG-BLEEDING-FAQ'],
    emergencyAcuity: 'EMERGENCY',
    logic: { anyOf: [{ field: 'bleedingRate', operator: '==', value: 'HEAVY' }] },
  },
  {
    id: 'EA-FETAL-SINUSOIDAL-EMERGENCY',
    purpose: 'EMERGENCY_ACUITY',
    controllingSourceId: 'SRC-SMFM-CONSULT-37-VASA-PREVIA',
    supportingSourceIds: [],
    emergencyAcuity: 'EMERGENCY',
    logic: { anyOf: [{ field: 'fetalTracingPattern', operator: '==', value: 'SINUSOIDAL' }] },
  },
  {
    id: 'EA-OXYGEN-SAT-LOW-URGENT',
    purpose: 'EMERGENCY_ACUITY',
    controllingSourceId: 'SRC-WHO-EMERGENCY-VAGINAL-BLEEDING',
    supportingSourceIds: [],
    emergencyAcuity: 'URGENT',
    logic: { anyOf: [{ field: 'oxygenSaturationPct', operator: '<', value: 95 }] },
  },
  {
    id: 'EA-PULSE-HIGH-URGENT',
    purpose: 'EMERGENCY_ACUITY',
    controllingSourceId: 'SRC-WHO-EMERGENCY-VAGINAL-BLEEDING',
    supportingSourceIds: [],
    emergencyAcuity: 'URGENT',
    logic: { anyOf: [{ field: 'maternalPulseBpm', operator: '>', value: 120 }] },
  },
  {
    id: 'EA-FETAL-NON-REASSURING-URGENT',
    purpose: 'EMERGENCY_ACUITY',
    controllingSourceId: 'SRC-WHO-EMERGENCY-VAGINAL-BLEEDING',
    supportingSourceIds: ['SRC-SMFM-CONSULT-37-VASA-PREVIA'],
    emergencyAcuity: 'URGENT',
    logic: { anyOf: [{ field: 'fetalTracingPattern', operator: '==', value: 'NON_REASSURING' }] },
  },
];
