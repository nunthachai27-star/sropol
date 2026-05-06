// PDPA-aware display masks for patient identifiers.
//
// Decryption already happens at the API boundary (decryptSafe) so the client
// receives plaintext name + CID. These helpers run on the plaintext at the
// moment of render so screenshots, screen-shares, and shoulder-surfing don't
// leak full identifiers.
//
// Use from any component that displays a patient name or CID. If a future
// detail page needs to show the unmasked value (e.g. an authenticated nurse
// confirming identity), wrap the helper with a reveal toggle there — do
// NOT remove the mask call site.

const CID_RE = /^\d{13}$/;

/**
 * Mask a 13-digit Thai national-ID for display.
 *
 *   "3320500282121" → "3XXXXXXXX2121"   (1 visible + 8 masked + 4 visible)
 *
 * Returns the input untouched if it's not a 13-digit string — short
 * placeholder values ("-", "ไม่ระบุ", "") pass through so callers don't
 * have to add their own guard.
 */
export function maskCid(value: string | null | undefined): string {
  if (!value) return '';
  const trimmed = value.trim();
  if (!CID_RE.test(trimmed)) return trimmed;
  return `${trimmed.slice(0, 1)}${'X'.repeat(8)}${trimmed.slice(-4)}`;
}

const THAI_TITLES = new Set([
  'นาย',
  'นาง',
  'น.ส.',
  'นางสาว',
  'นพ.',
  'พญ.',
  'ด.ช.',
  'ด.ญ.',
  'ดร.',
  'mr',
  'mr.',
  'mrs',
  'mrs.',
  'ms',
  'ms.',
  'miss',
]);

function isTitle(token: string): boolean {
  return THAI_TITLES.has(token.toLowerCase());
}

/**
 * Mask a patient name for display.
 *
 * Convention used across KK-LRMS dashboards:
 *   - Honorific title (นาย/นาง/นพ./พญ./...) is kept as-is when present.
 *   - First name (the first non-title token) is kept as-is — operators
 *     need it to recognise patients in clinical conversation, and PDPA
 *     guidance allows first-name display.
 *   - Last name is abbreviated to its first character + ".".
 *
 * Examples:
 *   "ชัยพร สุรเตมีย์กุล"        → "ชัยพร ส."
 *   "นาย ชัยพร สุรเตมีย์กุล"   → "นาย ชัยพร ส."
 *   "Mary Jane Watson"          → "Mary Jane W."
 *
 * Returns short placeholders unchanged so callers can pass empty / sentinel
 * values without an extra guard.
 */
export function maskName(value: string | null | undefined): string {
  if (!value) return '';
  const trimmed = value.trim();
  if (!trimmed) return '';
  // Don't mask UI placeholder strings.
  if (trimmed === '-' || trimmed === 'ไม่ทราบชื่อ' || trimmed === 'ไม่ระบุ') {
    return trimmed;
  }
  const tokens = trimmed.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return '';
  if (tokens.length === 1) {
    // Single-word name — keep as-is. Probably a fname-only record.
    return tokens[0];
  }
  const last = tokens[tokens.length - 1];
  const head = tokens.slice(0, -1);
  // Strip trailing punctuation so "สุรเตมีย์กุล." doesn't double-dot.
  const lastChar = Array.from(last)[0] ?? '';
  return `${head.join(' ')} ${lastChar}.`;
}

/**
 * More aggressive variant for low-trust contexts (kiosk, public displays).
 * Both first and last names are abbreviated to their first character.
 *
 *   "นาย ชัยพร สุรเตมีย์กุล"   → "นาย ช. ส."
 */
export function maskNameStrict(value: string | null | undefined): string {
  if (!value) return '';
  const trimmed = value.trim();
  if (!trimmed) return '';
  const tokens = trimmed.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return '';
  return tokens
    .map((t) => {
      if (isTitle(t)) return t;
      const first = Array.from(t)[0] ?? '';
      return `${first}.`;
    })
    .join(' ');
}
