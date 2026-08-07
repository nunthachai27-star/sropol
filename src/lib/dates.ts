// Shared date utilities.
//
// The pg driver returns `timestamp with time zone` columns as Date objects
// even though the codebase's TypeScript types claim `string | null`. Many
// comparisons (most notably ANC pregnancy-overlap detection in webhook.ts
// and services/sync/anc.ts) end up comparing a HOSxP date string like
// "2026-01-12" to a Date — `!==` is always true, which spuriously triggers
// new-pregnancy creation on every sync cycle.
//
// Use `toIsoDate()` to normalize either side to a "YYYY-MM-DD" string before
// comparing. It treats null/undefined/empty/invalid input as null so callers
// can short-circuit cleanly with `&&`.

export function toIsoDate(value: string | Date | null | undefined): string | null {
  if (value == null) return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    // `lmp`/`edc` are declared `datetime` in schema-sync, which maps to
    // TIMESTAMPTZ on Postgres. A naive "YYYY-MM-DD" string written into that
    // column is interpreted as midnight in the HOST timezone (Asia/Bangkok,
    // +07) and stored as an earlier UTC instant (e.g. "2025-05-01" becomes
    // 2025-04-30T17:00:00Z). Reading the calendar day back via UTC getters
    // (toISOString) would return the day BEFORE the one that was written.
    // Local getters recover the host-midnight the value was written at.
    const y = value.getFullYear();
    const m = String(value.getMonth() + 1).padStart(2, '0');
    const d = String(value.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  if (typeof value !== 'string') return null;
  const s = value.trim();
  if (!s) return null;
  // Cheap path: already in YYYY-MM-DD form, accept verbatim.
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

/**
 * Normalize a pg TIMESTAMPTZ value (Date object) or ISO string to a full
 * ISO-8601 string. Service mappers MUST use this (not bare `as string`
 * casts) when a query row feeds an API field declared `string` — pg returns
 * Date objects, and server-side string methods on them crash (the
 * `/api/hospitals/[hcode]/patients` `.localeCompare` 500 was this bug).
 * Null-safe; unparseable input returns null instead of throwing.
 */
export function toIsoString(value: string | Date | null | undefined): string | null {
  if (value == null) return null;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

export function isoDatesEqual(
  a: string | Date | null | undefined,
  b: string | Date | null | undefined,
): boolean {
  const aa = toIsoDate(a);
  const bb = toIsoDate(b);
  if (aa == null || bb == null) return false;
  return aa === bb;
}
