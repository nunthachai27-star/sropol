// Maternal labor-triage screening — pure, deterministic rule engine
// (spec §7, docs/maternal-screen-plan.md; Task 3 of
// docs/superpowers/plans/2026-07-16-maternal-screening.md).
//
// STATUS: PROVISIONAL / UNAPPROVED, INERT. This module computes the four
// orthogonal screening axes from a single already-typed observation record.
// It drives NOTHING: no DB, no network, no UI, no alert. It has ZERO imports
// from src/db, src/app, or any UI module (GC constraint verified by the Task 3
// "engine has zero imports from db/api/ui" done-gate).
//
// It reads its thresholds and rule logic ENTIRELY from
// src/config/maternal-screen-rules.ts (constitution IV — no clinical numbers
// live here). The config mirrors, field for field, the two Phase 0 clinical
// fixtures (maternal-screen-rules-v1.yaml, maternal-screen-acuity-v1.yaml).
//
// Binding safety invariants enforced here:
//   GC1 — missing/UNKNOWN inputs never produce a normal/negative/reassuring
//         result. `emergencyAcuity` falls back to 'UNKNOWN' (never 'STABLE')
//         unless every stability-determination field is explicitly assessed.
//         `isComplete` is computed independently of severity, so a proven
//         LOCAL_SEVERE/EMERGENCY result coexists with `isComplete: false`.
//   GC3 — localTier / emergencyAcuity / suspectedConditions / isComplete stay
//         four separate fields; no CdssSeverity/AncRiskLevel token is emitted.
//   GC4 — highest proven result wins per axis (via the config rank maps); a
//         normal FHR/BP never downgrades a proven instability; concealed
//         bleeding is flaggable without visible bleeding (both encoded in the
//         config rules, honored here by returning EVERY fired match).
//
// The engine assumes ALREADY-NORMALIZED input (e.g. `proteinuriaGrade` is the
// `ProteinuriaGrade` enum, not a raw dipstick spelling). `evaluatedAt` is a
// caller-supplied ISO string — this module never calls `Date.now()`/`new
// Date()` so it stays pure and testable.

import {
  EMERGENCY_ACUITY_RANK,
  LOCAL_TIER_RANK,
  MANDATORY_SCREEN_FIELDS,
  MATERNAL_SCREEN_RULES,
  MATERNAL_SCREEN_RULE_SET_VERSION,
  STABILITY_DETERMINATION_FIELDS,
  matchRule,
  type MaternalScreenLogicNode,
  type MaternalScreenRule,
} from '@/config/maternal-screen-rules';
import type {
  MaternalEmergencyAcuity,
  MaternalScreenInput,
  MaternalScreenLocalTier,
  MaternalScreenMatch,
  MaternalScreenResult,
  ProteinuriaGrade,
  SuspectedMaternalCondition,
} from '@/types/maternal-screening';

// ---------------------------------------------------------------------------
// Proteinuria normalization (webhook/transport boundary helper — Task 7)
// ---------------------------------------------------------------------------

/**
 * Map an accepted raw dipstick-proteinuria spelling to the ordinal
 * `ProteinuriaGrade` enum. Unknown/blank/null/undefined ⇒ `'UNKNOWN'` (GC1 —
 * an unrecognized value is "not assessed", never silently `'NEGATIVE'`).
 *
 * This is a PURE boundary helper for the future webhook/browser-push ingest
 * (Task 7); `evaluateMaternalScreen` itself assumes input is already typed and
 * does NOT call this. Recognized forms (case/space/`+`-notation tolerant):
 *   - NEGATIVE: 'negative', 'neg', 'none', 'no', '0', '-', enum 'NEGATIVE',
 *     Thai 'ลบ' / 'ไม่พบ'
 *   - TRACE:    'trace', 'tr', enum 'TRACE', Thai 'ร่องรอย'
 *   - ONE_PLUS: '1+', '+', 'one plus', '1 plus', enum 'ONE_PLUS'
 *   - TWO_PLUS: '2+', '++', 'two plus', enum 'TWO_PLUS'
 *   - THREE_PLUS: '3+', '+++', 'three plus', enum 'THREE_PLUS'
 *   - FOUR_PLUS:  '4+', '++++', 'four plus', enum 'FOUR_PLUS'
 */
export function normalizeProteinuriaGrade(raw: string | null | undefined): ProteinuriaGrade {
  if (raw === null || raw === undefined) return 'UNKNOWN';

  const trimmed = raw.trim();
  if (trimmed === '') return 'UNKNOWN';

  const key = trimmed.toLowerCase();

  // '+'-only dipstick shorthand: count the plus signs (1..4). Handles '+',
  // '++', '+++', '++++' with no leading digit.
  if (/^\++$/.test(trimmed)) {
    const plusGrade = PLUS_COUNT_TO_GRADE[trimmed.length];
    if (plusGrade) return plusGrade;
  }

  const mapped = PROTEINURIA_SPELLINGS[key];
  return mapped ?? 'UNKNOWN';
}

const PLUS_COUNT_TO_GRADE: Readonly<Record<number, ProteinuriaGrade>> = {
  1: 'ONE_PLUS',
  2: 'TWO_PLUS',
  3: 'THREE_PLUS',
  4: 'FOUR_PLUS',
};

// Recognized spellings → enum. Keys are already lower-cased/trimmed. A bounded,
// data-driven lookup (not scattered hardcoded `if`s) so new accepted spellings
// are added in one place.
const PROTEINURIA_SPELLINGS: Readonly<Record<string, ProteinuriaGrade>> = {
  // NEGATIVE
  negative: 'NEGATIVE',
  neg: 'NEGATIVE',
  none: 'NEGATIVE',
  no: 'NEGATIVE',
  nil: 'NEGATIVE',
  absent: 'NEGATIVE',
  '0': 'NEGATIVE',
  '-': 'NEGATIVE',
  ลบ: 'NEGATIVE',
  ไม่พบ: 'NEGATIVE',
  // TRACE
  trace: 'TRACE',
  tr: 'TRACE',
  ร่องรอย: 'TRACE',
  // ONE_PLUS
  one_plus: 'ONE_PLUS',
  '1+': 'ONE_PLUS',
  '1 +': 'ONE_PLUS',
  'one plus': 'ONE_PLUS',
  '1 plus': 'ONE_PLUS',
  // TWO_PLUS
  two_plus: 'TWO_PLUS',
  '2+': 'TWO_PLUS',
  '2 +': 'TWO_PLUS',
  'two plus': 'TWO_PLUS',
  '2 plus': 'TWO_PLUS',
  // THREE_PLUS
  three_plus: 'THREE_PLUS',
  '3+': 'THREE_PLUS',
  '3 +': 'THREE_PLUS',
  'three plus': 'THREE_PLUS',
  '3 plus': 'THREE_PLUS',
  // FOUR_PLUS
  four_plus: 'FOUR_PLUS',
  '4+': 'FOUR_PLUS',
  '4 +': 'FOUR_PLUS',
  'four plus': 'FOUR_PLUS',
  '4 plus': 'FOUR_PLUS',
  // explicit not-assessed passthrough
  unknown: 'UNKNOWN',
};

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * "Not assessed" sentinel: `null`, `undefined`, or an enum's `'UNKNOWN'`
 * member. Shared by completeness and stability-determination so both apply the
 * SAME missing-data semantics as `matchRule`'s null-guard (GC1).
 */
function isFieldUnassessed(value: unknown): boolean {
  return (
    value === null ||
    value === undefined ||
    value === 'UNKNOWN' ||
    (typeof value === 'number' && Number.isNaN(value))
  );
}

/**
 * Collect the distinct input fields a rule's `logic` tree reads, in first-seen
 * order — this is the evidence a fired rule "consulted". Value snapshots are
 * attached by the caller from the live input.
 */
function collectLogicFields(
  node: MaternalScreenLogicNode,
  acc: Array<keyof MaternalScreenInput>,
): void {
  if ('anyOf' in node) {
    for (const child of node.anyOf) collectLogicFields(child, acc);
    return;
  }
  if ('allOf' in node) {
    for (const child of node.allOf) collectLogicFields(child, acc);
    return;
  }
  if (!acc.includes(node.field)) acc.push(node.field);
}

/** Build the discriminated `MaternalScreenMatch` for a fired rule. */
function buildMatch(rule: MaternalScreenRule, input: MaternalScreenInput): MaternalScreenMatch {
  const fields: Array<keyof MaternalScreenInput> = [];
  collectLogicFields(rule.logic, fields);
  const evidence = fields.map((field) => ({ field, value: input[field] }));

  const base = {
    ruleId: rule.id,
    controllingSourceId: rule.controllingSourceId,
    supportingSourceIds: [...rule.supportingSourceIds],
    evidence,
  };

  switch (rule.purpose) {
    case 'LOCAL_PDF_TIER':
      return {
        ...base,
        purpose: 'LOCAL_PDF_TIER',
        localTier: rule.localTier,
        condition: rule.condition,
      };
    case 'EMERGENCY_ACUITY':
      return {
        ...base,
        purpose: 'EMERGENCY_ACUITY',
        emergencyAcuity: rule.emergencyAcuity,
      };
    case 'EXTERNAL_SAFETY':
      return {
        ...base,
        purpose: 'EXTERNAL_SAFETY',
        ...(rule.condition !== undefined ? { condition: rule.condition } : {}),
      };
    default: {
      // Exhaustiveness guard — every MaternalScreenRulePurpose is handled.
      const exhaustiveCheck: never = rule;
      throw new Error(
        `Unhandled maternal-screen rule purpose: ${String((exhaustiveCheck as { purpose?: unknown }).purpose)}`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Evaluate a single already-normalized screening record into the four
 * orthogonal axes (spec §6.2, §7.2). Pure and deterministic: same input +
 * `evaluatedAt` always yields the same result.
 *
 * Evaluation order (spec §7.2):
 *   (b) run EVERY config rule via `matchRule`, collecting fired matches with
 *       their evidence;
 *   (c) `localTier` = highest-ranked fired LOCAL_PDF_TIER match (none ⇒
 *       NO_LOCAL_MATCH);
 *   (d) `emergencyAcuity` = highest-ranked fired EMERGENCY_ACUITY match,
 *       computed INDEPENDENTLY of localTier and of visible blood volume; if no
 *       acuity rule fires, STABLE only when every
 *       STABILITY_DETERMINATION_FIELDS value is assessed, else UNKNOWN (GC1);
 *   (e) `suspectedConditions` = de-duplicated `condition`s from fired matches;
 *   (f) `missingRequiredFields` = MANDATORY_SCREEN_FIELDS that are
 *       null/'UNKNOWN', computed INDEPENDENTLY of severity; `isComplete` = that
 *       list is empty;
 *   (g) return ALL matches, plus ruleSetVersion + evaluatedAt.
 */
export function evaluateMaternalScreen(
  input: MaternalScreenInput,
  evaluatedAt: string,
): MaternalScreenResult {
  // (b) Run every rule; keep the fired ones in config declaration order.
  const matches: MaternalScreenMatch[] = [];
  for (const rule of MATERNAL_SCREEN_RULES) {
    if (matchRule(rule, input)) {
      matches.push(buildMatch(rule, input));
    }
  }

  // (c) Highest-ranked local PDF tier; NO_LOCAL_MATCH when none fired.
  let localTier: MaternalScreenLocalTier = 'NO_LOCAL_MATCH';
  for (const match of matches) {
    if (match.purpose !== 'LOCAL_PDF_TIER') continue;
    if (LOCAL_TIER_RANK[match.localTier] > LOCAL_TIER_RANK[localTier]) {
      localTier = match.localTier;
    }
  }

  // (d) Emergency acuity — independent of localTier and visible blood volume.
  const emergencyAcuity = selectEmergencyAcuity(matches, input);

  // (e) De-duplicated suspected conditions, preserving first-seen order.
  const suspectedConditions: SuspectedMaternalCondition[] = [];
  for (const match of matches) {
    const condition = match.condition;
    if (condition !== undefined && !suspectedConditions.includes(condition)) {
      suspectedConditions.push(condition);
    }
  }

  // (f) Completeness — orthogonal to severity (GC1). A proven severe/emergency
  // result may coexist with a non-empty missing list.
  const missingRequiredFields = MANDATORY_SCREEN_FIELDS.filter((field) =>
    isFieldUnassessed(input[field]),
  );
  const isComplete = missingRequiredFields.length === 0;

  // (g)
  return {
    localTier,
    emergencyAcuity,
    isComplete,
    suspectedConditions,
    matches,
    missingRequiredFields: [...missingRequiredFields],
    ruleSetVersion: MATERNAL_SCREEN_RULE_SET_VERSION,
    evaluatedAt,
  };
}

/**
 * Emergency-acuity determination mirroring maternal-screen-acuity-v1.yaml's
 * T1-ACUITY-DETERMINATION algorithm:
 *   1. If any EMERGENCY_ACUITY rule fired, return the highest-ranked matched
 *      acuity (EMERGENCY beats URGENT).
 *   2. Otherwise STABLE only when EVERY stability-determination field is
 *      explicitly assessed (non-null, non-'UNKNOWN').
 *   3. Otherwise UNKNOWN — NEVER STABLE by default from missing data (GC1).
 */
function selectEmergencyAcuity(
  matches: readonly MaternalScreenMatch[],
  input: MaternalScreenInput,
): MaternalEmergencyAcuity {
  let fired: MaternalEmergencyAcuity | null = null;
  for (const match of matches) {
    if (match.purpose !== 'EMERGENCY_ACUITY') continue;
    if (
      fired === null ||
      EMERGENCY_ACUITY_RANK[match.emergencyAcuity] > EMERGENCY_ACUITY_RANK[fired]
    ) {
      fired = match.emergencyAcuity;
    }
  }
  if (fired !== null) return fired;

  const allStabilityFieldsAssessed = STABILITY_DETERMINATION_FIELDS.every(
    (field) => !isFieldUnassessed(input[field]),
  );
  return allStabilityFieldsAssessed ? 'STABLE' : 'UNKNOWN';
}
