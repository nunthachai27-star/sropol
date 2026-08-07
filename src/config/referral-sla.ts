// Referral service-level thresholds.
//
// Central knobs for how the provincial referral board classifies aging
// referrals — keep policy here, not hardcoded in services or UI
// (constitution IV). All durations are hours.
export const REFERRAL_SLA = {
  /** An INITIATED referral older than this is "overdue" — amber in the UI
   *  and counted in the OVERDUE KPI. */
  overdueAfterHours: 24,
  /** An INITIATED referral older than this is critical — red in the UI. */
  criticalAfterHours: 48,
  /** Active EMERGENCY referrals initiated within this window are pinned to
   *  the top of the queue regardless of newer routine rows. */
  emergencyPinHours: 48,
} as const;

/** Auto-arrive reconciliation (see referral.ts autoArriveReferrals):
 *  hospitals rarely send explicit status webhooks, so INITIATED referrals
 *  whose patient journey is now owned by the destination hospital are
 *  inferred to have arrived. Disable here if arrivals must only ever be
 *  confirmed explicitly. */
export const REFERRAL_AUTO_ARRIVE = {
  enabled: true,
} as const;

export type ReferralAgeClass = 'fresh' | 'overdue' | 'critical';

/** Apply the SLA to one referral. Only INITIATED referrals age — once the
 *  destination has responded (ACCEPTED/IN_TRANSIT/ARRIVED/REJECTED) the
 *  sending side no longer owns the delay. */
export function classifyReferralAge(
  initiatedAt: string,
  status: string,
  now: Date = new Date(),
): ReferralAgeClass {
  if (status !== 'INITIATED') return 'fresh';
  const hours = (now.getTime() - new Date(initiatedAt).getTime()) / 3600_000;
  if (hours >= REFERRAL_SLA.criticalAfterHours) return 'critical';
  if (hours >= REFERRAL_SLA.overdueAfterHours) return 'overdue';
  return 'fresh';
}

/** Resolve the SLA thresholds into ISO cutoff instants relative to `now`.
 *  Cutoffs are bound as SQL params so queries stay Postgres/SQLite portable. */
export function referralSlaCutoffs(now: Date): {
  overdueBefore: string;
  criticalBefore: string;
  emergencyPinAfter: string;
} {
  const hoursAgo = (h: number) => new Date(now.getTime() - h * 3600_000).toISOString();
  return {
    overdueBefore: hoursAgo(REFERRAL_SLA.overdueAfterHours),
    criticalBefore: hoursAgo(REFERRAL_SLA.criticalAfterHours),
    emergencyPinAfter: hoursAgo(REFERRAL_SLA.emergencyPinHours),
  };
}
