// Shared relative-time formatter. Used by the provincial dashboard's
// hospital list and the hospital console roster.
//
// `lang: 'short'`  → ASCII ("5m" / "2h" / "3d"), best for narrow columns.
// `lang: 'th'`     → Thai ("5 นาที" / "2 ชม." / "3 วัน"), human-facing copy.
export function formatRelativeAge(
  iso: string | null,
  lang: 'short' | 'th' = 'th',
): string {
  if (!iso) return '—';
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(ms / 60000);
  const hrs = Math.floor(mins / 60);
  const days = Math.floor(hrs / 24);
  if (lang === 'short') {
    if (mins < 60) return `${Math.max(1, mins)}m`;
    if (hrs < 24) return `${hrs}h`;
    return `${days}d`;
  }
  if (mins < 60) return `${Math.max(1, mins)} นาที`;
  if (hrs < 24) return `${hrs} ชม.`;
  return `${days} วัน`;
}
