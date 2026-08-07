// ANC (antenatal care) freshness gates for the PREGNANCY-stage registry.
//
// These thresholds exclude stale rows that were migrated/loaded with
// care_stage = 'PREGNANCY' but whose owners have already delivered or were
// lost to follow-up. Without them the ANC list surfaced pregnancies with EDC
// from 2010–2019, inflating every count. The gates are applied ONLY to the
// PREGNANCY stage — LABOR / DELIVERED rows are never gated.
//
// Consumed by src/services/journey-list.ts (listJourneys / listHospitalJourneys)
// and, transitively, by GET /api/journeys and GET /api/hospitals/[hcode]/journeys.
//
// Cutoffs are resolved to absolute timestamps in application code
// (see ancFreshnessCutoffs) and bound as SQL parameters, so the identical
// logic runs on Postgres (production) and SQLite (unit tests) without any
// DB-specific date arithmetic (NOW() / INTERVAL).

/**
 * Maximum gestational age, in weeks. `ga_weeks` above this is post-term and
 * biologically implies the pregnancy has already ended.
 */
export const ANC_MAX_GA_WEEKS = 42;

/**
 * How many days past the estimated delivery date (EDC) a pregnancy may fall
 * before it is treated as delivered and dropped from the active registry.
 */
export const ANC_EDC_MAX_PAST_DAYS = 14;

/**
 * Maximum age, in days, of the last ANC visit before the woman is considered
 * lost to follow-up at this hospital.
 */
export const ANC_LAST_VISIT_MAX_AGE_DAYS = 60;

const DAY_MS = 24 * 60 * 60 * 1000;

export interface AncFreshnessCutoffs {
  /** ISO timestamp — an EDC on or after this is still considered active. */
  edcOnOrAfter: string;
  /** ISO timestamp — a last-ANC date on or after this is still considered active. */
  lastAncOnOrAfter: string;
}

/**
 * Resolve the absolute cutoff timestamps for the EDC and last-ANC gates,
 * relative to `now`. Pure and deterministic so it can be unit-tested and so
 * a request computes both gates against a single, consistent clock reading.
 */
export function ancFreshnessCutoffs(now: Date = new Date()): AncFreshnessCutoffs {
  return {
    edcOnOrAfter: new Date(now.getTime() - ANC_EDC_MAX_PAST_DAYS * DAY_MS).toISOString(),
    lastAncOnOrAfter: new Date(now.getTime() - ANC_LAST_VISIT_MAX_AGE_DAYS * DAY_MS).toISOString(),
  };
}
