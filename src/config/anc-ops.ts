// ANC operational thresholds for the provincial pregnancy board.
//
// Distinct from anc-freshness.ts (which gates what belongs in the registry at
// all): these knobs classify the *active* registry into working cohorts —
// due-soon, overdue, follow-up risk, visit-count quality, near-term — and are
// kept in config so policy is never hardcoded in services or UI
// (constitution IV). All durations are days unless noted.
export const ANC_OPS = {
  /** EDC within this many days (including already passed) counts as due soon. */
  dueSoonDays: 14,
  /** Last ANC visit older than this shows the amber follow-up warning. */
  followupWarnDays: 35,
  /** Last ANC visit older than this shows the red near-LTFU flag (the
   *  freshness gate drops the row entirely at ANC_LAST_VISIT_MAX_AGE_DAYS). */
  followupCriticalDays: 50,
  /** MOPH ANC quality: expected minimum visits… */
  minVisits: 5,
  /** …by this gestational age (weeks). */
  minVisitsGaWeeks: 32,
  /** Near-term cohort threshold (weeks) — matches the GA≥34 hospital hubs. */
  nearTermGaWeeks: 34,
  /** LTFU worklist looks back this far; older rows are considered closed. */
  ltfuWindowDays: 120,
  /** Teen pregnancy badge: age strictly below this. */
  teenAgeUnder: 20,
  /** Advanced maternal age badge: age at or above this. */
  advancedMaternalAgeMin: 35,
} as const;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Resolve the day thresholds into ISO instants relative to `now` so queries
 *  stay Postgres/SQLite portable (no DB date arithmetic). */
export function ancOpsCutoffs(now: Date = new Date()): {
  /** EDC on or before this is due soon. */
  dueSoonBefore: string;
  /** Last ANC strictly before this is stale (amber). */
  staleBefore: string;
  /** Last ANC strictly before this is near-LTFU (red). */
  criticalBefore: string;
  /** Oldest last ANC still shown on the LTFU worklist. */
  ltfuFloor: string;
} {
  return {
    dueSoonBefore: new Date(now.getTime() + ANC_OPS.dueSoonDays * DAY_MS).toISOString(),
    staleBefore: new Date(now.getTime() - ANC_OPS.followupWarnDays * DAY_MS).toISOString(),
    criticalBefore: new Date(now.getTime() - ANC_OPS.followupCriticalDays * DAY_MS).toISOString(),
    ltfuFloor: new Date(now.getTime() - ANC_OPS.ltfuWindowDays * DAY_MS).toISOString(),
  };
}

export type AncFollowupClass = 'ok' | 'warn' | 'critical';

/** Classify a last-ANC date against the follow-up thresholds. Null (no visit
 *  data synced) is treated as 'ok' — sync gaps must not read as alarms. */
export function classifyAncFollowup(
  lastAncDate: string | null | undefined,
  now: Date = new Date(),
): AncFollowupClass {
  if (!lastAncDate) return 'ok';
  const days = (now.getTime() - new Date(lastAncDate).getTime()) / DAY_MS;
  if (days >= ANC_OPS.followupCriticalDays) return 'critical';
  if (days >= ANC_OPS.followupWarnDays) return 'warn';
  return 'ok';
}

export type EdcDueClass = 'ok' | 'dueSoon' | 'overdue';

/** Classify an EDC against the due-soon window. */
export function classifyEdcDue(
  edc: string | null | undefined,
  now: Date = new Date(),
): EdcDueClass {
  if (!edc) return 'ok';
  const t = new Date(edc).getTime();
  if (t < now.getTime()) return 'overdue';
  if (t <= now.getTime() + ANC_OPS.dueSoonDays * DAY_MS) return 'dueSoon';
  return 'ok';
}
