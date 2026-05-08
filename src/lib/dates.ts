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
    return value.toISOString().slice(0, 10);
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

export function isoDatesEqual(
  a: string | Date | null | undefined,
  b: string | Date | null | undefined,
): boolean {
  const aa = toIsoDate(a);
  const bb = toIsoDate(b);
  if (aa == null || bb == null) return false;
  return aa === bb;
}
