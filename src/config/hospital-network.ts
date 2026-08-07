// Hospital network board policy — /hospitals directory.
//
// Two knobs live here (constitution IV: policy in config, not components):
//   1. Sync freshness classification — how old a hospital's last HOSxP sync
//      may be before the board flags it. connection_status only says the
//      transport is up; freshness says the *data* is current.
//   2. Combined-workload weighting — the roster sort and map pin sizing need
//      one activity number spanning both the labor floor (acute, small
//      counts) and the ANC registry (chronic, hundreds of women).
export const SYNC_HEALTH = {
  /** Last sync older than this (minutes) is stale — amber. */
  staleAfterMinutes: 60,
  /** Last sync older than this (hours) is critical — red. */
  criticalAfterHours: 24,
} as const;

export type SyncHealthClass = 'ok' | 'stale' | 'critical' | 'never' | 'blocked';

/** Classify one hospital's data freshness. BLOCKED (auth/purge) always wins;
 *  an OK status without any recorded sync is still 'never'. */
export function classifySyncHealth(
  syncStatus: string,
  lastSyncAt: string | null | undefined,
  now: Date = new Date(),
): SyncHealthClass {
  if (syncStatus === 'BLOCKED') return 'blocked';
  if (syncStatus === 'NEVER_SYNCED' || !lastSyncAt) return 'never';
  const mins = (now.getTime() - new Date(lastSyncAt).getTime()) / 60_000;
  if (mins >= SYNC_HEALTH.criticalAfterHours * 60) return 'critical';
  if (mins >= SYNC_HEALTH.staleAfterMinutes) return 'stale';
  return 'ok';
}

// ─── Stale labor admissions ─────────────────────────────────────────────────
// Some wards let patients leave without completing the HOSxP discharge entry
// (dchdate stays NULL, confirm_discharge stays 'N'), so HOSxP keeps reporting
// them as admitted forever — the น้ำพอง case, 2026-07-09.
export const STALE_ADMISSION = {
  /** ACTIVE admissions older than this (no discharge entry) are dropped from
   *  the browser sync's active set, letting the server's reconciliation
   *  close them as DELIVERED through the normal discharge flow. */
  autoCloseAfterDays: 7,
  /** Ward-list chip prompting a HOSxP discharge-entry check appears after
   *  this many days admitted. */
  checkDischargeAfterDays: 4,
} as const;

/**
 * True when an HOSxP admission row is administratively dead: no discharge
 * date entered, yet admitted longer than the auto-close threshold. Rows with
 * a dchdate map to DELIVERED normally and are never "stale".
 */
export function isStaleAdmission(
  regdate: string | null,
  dchdate: unknown,
  now: Date = new Date(),
): boolean {
  if (dchdate) return false;
  if (!regdate) return false;
  const days = (now.getTime() - new Date(regdate).getTime()) / 86_400_000;
  return days >= STALE_ADMISSION.autoCloseAfterDays;
}

// ─── Partograph data quality ────────────────────────────────────────────────
// Of labor admissions in the window, how many were charted with at least one
// partograph observation. Some hospitals skip charting entirely — the admin
// team tracks this per hospital on /hospitals.
export const PARTOGRAPH_QUALITY = {
  /** Admissions newer than this many days count toward coverage. */
  windowDays: 30,
  /** Coverage below this percentage renders amber. */
  warnBelowPct: 60,
  /** Coverage below this percentage renders red. */
  criticalBelowPct: 30,
  /** Grace period after admission before an uncharted ACTIVE patient gets
   *  the NO PARTO nudge chip on the ward list. */
  noChartNudgeHours: 4,
} as const;

export type PartographCoverageClass = 'ok' | 'warn' | 'critical' | 'none';

export function classifyPartographCoverage(
  laborRecent: number,
  withPartograph: number,
): PartographCoverageClass {
  if (laborRecent <= 0) return 'none';
  const pct = (withPartograph / laborRecent) * 100;
  if (pct < PARTOGRAPH_QUALITY.criticalBelowPct) return 'critical';
  if (pct < PARTOGRAPH_QUALITY.warnBelowPct) return 'warn';
  return 'ok';
}

/**
 * Ward-list nudge: true when an ACTIVE admission has never been charted
 * (partograph_alert_count is NULL — the sync writes 0 once observations
 * exist) and the post-admission grace window has passed.
 */
export function needsPartographNudge(
  admitDate: string | null,
  partographAlertCount: number | null | undefined,
  now: Date = new Date(),
): boolean {
  if (partographAlertCount != null) return false;
  if (!admitDate) return false;
  const hours = (now.getTime() - new Date(admitDate).getTime()) / 3600_000;
  return hours >= PARTOGRAPH_QUALITY.noChartNudgeHours;
}

/** One ANC-registry woman counts this much of one active labor patient when
 *  sizing pins / ranking rosters. 0.1 keeps a 200-woman ANC hospital roughly
 *  on par with a 20-bed labor ward. */
export const ANC_WORKLOAD_WEIGHT = 0.1;

export function combinedWorkload(labor: { total: number }, anc: { total: number }): number {
  return labor.total + anc.total * ANC_WORKLOAD_WEIGHT;
}
