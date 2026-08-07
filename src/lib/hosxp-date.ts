// HOSxP date hygiene. Some sites store Buddhist-Era years (พ.ศ. = ค.ศ.+543)
// in DATE columns — e.g. birth_date '2556-11-03' at รพ.พล. One such row
// poisons any MAX(date)-based sync cutoff, so every HOSxP event date passes
// through here before it is cached.

/** Convert a leading Buddhist-Era year (>2400) to Gregorian; null-safe. */
export function normalizeHosxpDate(value: string | null | undefined): string | null {
  if (value == null) return null;
  const s = String(value).trim();
  if (s.length === 0) return null;
  const m = s.match(/^(\d{4})(.*)$/);
  if (!m) return s;
  const year = Number(m[1]);
  if (year > 2400) return String(year - 543) + m[2];
  return s;
}

/** True when a clinical event date is not in the future (1-day tolerance for
 *  timezone skew). Dates that are still implausible AFTER BE normalization
 *  must not enter the cache. */
export function isPlausibleEventDate(
  iso: string | null | undefined,
  now: Date = new Date(),
): boolean {
  if (!iso) return false;
  const ms = new Date(iso).getTime();
  if (!Number.isFinite(ms)) return false;
  return ms <= now.getTime() + 86_400_000;
}
