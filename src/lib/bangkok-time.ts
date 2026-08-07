// Shared Asia/Bangkok (UTC+7, no DST) time helpers.
//
// Extracted from src/services/dashboard.ts so other services (referral list,
// KPI windows) can reuse the same day-boundary semantics instead of
// duplicating timezone math.

/** Returns the start of the current month in Asia/Bangkok, expressed as UTC. */
export function bangkokStartOfMonth(now: Date = new Date()): Date {
  const shifted = new Date(now.getTime() + 7 * 3600 * 1000);
  const shiftedFirstUtc = new Date(Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), 1));
  return new Date(shiftedFirstUtc.getTime() - 7 * 3600 * 1000);
}

/** Bangkok calendar month key (YYYY-MM) for an instant. */
export function bangkokMonthKey(iso: string | Date): string {
  const t = typeof iso === 'string' ? new Date(iso).getTime() : iso.getTime();
  return new Date(t + 7 * 3600 * 1000).toISOString().slice(0, 7);
}

/** Returns the start of today in Asia/Bangkok, expressed as UTC. */
export function bangkokStartOfToday(now: Date = new Date()): Date {
  // Bangkok is UTC+7, no DST. Compute by shifting now() forward 7h, taking
  // the UTC date at that shifted point, and then shifting back.
  const shifted = new Date(now.getTime() + 7 * 3600 * 1000);
  const shiftedMidnightUtc = new Date(
    Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate()),
  );
  return new Date(shiftedMidnightUtc.getTime() - 7 * 3600 * 1000);
}
