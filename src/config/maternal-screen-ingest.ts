// Maternal screening webhook-ingest transport constraints (Task 7, spec §9.2).
//
// Centralized here (constitution IV / GC5: thresholds and rule constants live
// in src/config/, never scattered through service code) so the webhook
// validator, future browser-push senders, and docs all read ONE table.
//
// Bound philosophy (spec §9.2): reject IMPOSSIBLE values (negative BP,
// SpO2 > 100) without rejecting clinically-extreme-but-possible ones
// (SBP 240 in a hypertensive crisis, platelets 5 000/µL in severe
// thrombocytopenia, AST > 10 000 IU/L in fulminant hepatic necrosis).
// Lower bounds above zero exist ONLY where a zero is physically impossible in
// a living patient and is therefore almost certainly a sender's
// "0-means-missing" sentinel — accepting it would fabricate an assessed value
// from missing data (GC1). Senders must transmit null for "not assessed".
import type { HeadacheSeverity, MaternalScreenInput } from '@/types/maternal-screening';

/** Max serialized size of one `maternal_screening` transport object. The
 *  object is ~40 scalar fields; anything past this is malformed or abusive. */
export const MATERNAL_SCREEN_TRANSPORT_MAX_BYTES = 16 * 1024;

/**
 * Strict ISO-8601 date-time pattern for `assessed_at` (spec §9.2). `new Date()`
 * happily parses locale strings ("07/16/2026") and 2-digit years, which then
 * get reinterpreted in server-local time and perturb the
 * `ORDER BY assessed_at DESC` latest-summary projection. We therefore require a
 * full ISO-8601 instant: `YYYY-MM-DDTHH:MM(:SS(.sss)?)?` plus a `Z` or
 * `±HH:MM` offset (offset mandatory — a bare local time is ambiguous across
 * hospital timezones). Callers must send a UTC/offset-qualified timestamp.
 */
export const MATERNAL_SCREEN_ISO_8601_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}:\d{2})$/;

/** `assessed_at` may lead the server clock by at most this much (covers
 *  hospital clock skew and a botched +07:00 offset) — anything further in the
 *  future is rejected as implausible (spec §9.2 future-time tolerance). */
export const MATERNAL_SCREEN_ASSESSED_AT_MAX_FUTURE_MS = 24 * 60 * 60 * 1000;

/** Idempotency key / actor-identity transport widths — mirror the column
 *  widths in src/db/tables/maternal-screening-assessments.ts. Enforced as a
 *  REJECTION at the boundary (not a silent fit-to-null) because truncating or
 *  dropping `source_pk` would silently change idempotency semantics. */
export const MATERNAL_SCREEN_SOURCE_PK_MAX_LENGTH = 150;
export const MATERNAL_SCREEN_ASSESSED_BY_MAX_LENGTH = 150;

export interface NumericBound {
  min: number;
  max: number;
}

/**
 * Plausibility bounds for `maternal_screening.*` numeric fields
 * (transport snake_case keys).
 */
export const MATERNAL_SCREEN_NUMERIC_BOUNDS: Readonly<Record<string, NumericBound>> = {
  // Serum creatinine: measurable floor ~0.1 mg/dL; dialysis-level extremes
  // stay well under 100. A zero is a missing-value sentinel, never a lab result.
  creatinine_mg_dl: { min: 0.05, max: 100 },
  creatinine_baseline_mg_dl: { min: 0.05, max: 100 },
  // Platelets per µL: 5 000 (severe thrombocytopenia) MUST pass; a zero/near-
  // zero count is a sentinel; extreme thrombocytosis tops out well under 5M.
  platelet_per_ul: { min: 500, max: 5_000_000 },
  // Transaminases: fulminant necrosis can exceed 10 000 IU/L; zero is a sentinel.
  ast_iu_l: { min: 1, max: 50_000 },
  alt_iu_l: { min: 1, max: 50_000 },
  // 0 mL/h = anuria — a real, clinically critical finding. Keep it.
  urine_output_ml_per_hour: { min: 0, max: 5_000 },
  // 0 mL = assessed, no visible loss. Massive obstetric hemorrhage < 20 L.
  estimated_bleeding_ml: { min: 0, max: 20_000 },
  // 0 bpm = assessed absent fetal heartbeat (demise) — a real finding.
  fetal_heart_rate_bpm: { min: 0, max: 350 },
  // 0 bpm = maternal arrest — a real (emergency) finding.
  maternal_pulse_bpm: { min: 0, max: 350 },
  respiratory_rate_per_min: { min: 0, max: 150 },
  // SpO2 is a percentage; > 100 is physically impossible (spec §9.2 example).
  oxygen_saturation_pct: { min: 0, max: 100 },
};

/**
 * Plausibility bounds for the SAME-PAYLOAD admission-context fields reused as
 * screening inputs (spec §9.1: "Admission BP and GA can be reused only from
 * the same payload/assessment context"). Only enforced when the payload
 * carries a `maternal_screening` object — legacy payloads without one are
 * untouched (GC7). Keys are `WebhookPatientPayload` field names.
 */
export const MATERNAL_SCREEN_ADMISSION_CONTEXT_BOUNDS: Readonly<Record<string, NumericBound>> = {
  ga_weeks: { min: 4, max: 45 },
  ga_day: { min: 0, max: 6 },
  // Negative BP is impossible (spec §9.2 example); a systolic of 0 is an
  // arrest/sentinel ambiguity we reject at the screening boundary — the
  // screening object's own vitals (pulse, consciousness, shock signs) carry
  // arrest findings. SBP 240 (hypertensive crisis) MUST pass.
  bp_systolic_admit: { min: 30, max: 400 },
  // DBP 0 (absent Korotkoff V) is a documented finding in pregnancy — allowed.
  bp_diastolic_admit: { min: 0, max: 350 },
};

/**
 * Allowed transport values for the categorical screening fields (matched
 * case-insensitively after trimming; absent/null maps to 'UNKNOWN' — GC1:
 * missing is "not assessed", never invented). `proteinuria_grade` is NOT
 * listed here — free-text dipstick spellings go through
 * `normalizeProteinuriaGrade` (unrecognized ⇒ 'UNKNOWN' by design).
 */
export const MATERNAL_SCREEN_ENUM_VALUES = {
  headache: ['NONE', 'MILD', 'SEVERE', 'UNKNOWN'] as readonly HeadacheSeverity[],
  bleeding_rate: [
    'SPOTTING',
    'LIGHT',
    'MODERATE',
    'HEAVY',
    'UNKNOWN',
  ] as readonly MaternalScreenInput['bleedingRate'][],
  fetal_tracing_pattern: [
    'REASSURING',
    'NON_REASSURING',
    'SINUSOIDAL',
    'UNKNOWN',
  ] as readonly MaternalScreenInput['fetalTracingPattern'][],
  consciousness: [
    'ALERT',
    'VOICE',
    'PAIN',
    'UNRESPONSIVE',
    'UNKNOWN',
  ] as readonly MaternalScreenInput['consciousness'][],
  placenta_location_source: [
    'ULTRASOUND',
    'OTHER_DOCUMENTED',
    'UNKNOWN',
  ] as readonly MaternalScreenInput['placentaLocationSource'][],
} as const;
