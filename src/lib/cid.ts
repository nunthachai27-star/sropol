// Thai national ID (เลขบัตรประชาชน) format + checksum helpers.
//
// Used wherever an inbound CID must be sanity-checked before we hash it for
// cross-hospital matching (cidHash → maternal_journeys). A malformed CID that
// slips through silently breaks transfer detection in production: two
// hospitals end up with different cidHashes for the same person, so the
// journey never merges.
//
// Old hospital-side clients of KK-LRMS sometimes send:
//   - empty / null cid
//   - 12- or 14-character strings
//   - the encrypted blob from HOSxP when marketplace_token was missing
//   - a placeholder like "0000000000000" or whitespace-padded value
//
// `isValidCid13` is the cheap regex check (matches the rest of the codebase).
// `isValidThaiCidChecksum` adds the official ก.พ. checksum so the strictest
// path can reject 13-digit-but-fake values like "1234567890123".

const DIGITS_13 = /^\d{13}$/;

export function isValidCid13(value: unknown): value is string {
  return typeof value === 'string' && DIGITS_13.test(value);
}

/**
 * Validates the official Thai national-ID checksum.
 *
 *   Σ (digit[i] × (13 − i))  for i in 0..11
 *   checkDigit = (11 − (sum mod 11)) mod 10
 *   must equal digit[12]
 *
 * Returns false for anything that fails `isValidCid13` first, so callers can
 * use this as a single guard.
 */
export function isValidThaiCidChecksum(value: unknown): value is string {
  if (!isValidCid13(value)) return false;
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    sum += Number(value[i]) * (13 - i);
  }
  const checkDigit = (11 - (sum % 11)) % 10;
  return checkDigit === Number(value[12]);
}

export type CidValidationFailure =
  | { kind: 'missing' }
  | { kind: 'not_string' }
  | { kind: 'wrong_length'; length: number }
  | { kind: 'non_digits'; sample: string }
  | { kind: 'checksum_mismatch'; cid: string };

/**
 * Diagnose-style validator: returns the specific failure reason instead of
 * just a boolean. Useful for webhook error responses where the sender needs
 * to know *why* their CID was rejected so they can fix the upstream code.
 */
export function diagnoseCid(
  value: unknown,
  options: { requireChecksum?: boolean } = {},
): { ok: true; cid: string } | { ok: false; failure: CidValidationFailure } {
  if (value === null || value === undefined || value === '') {
    return { ok: false, failure: { kind: 'missing' } };
  }
  if (typeof value !== 'string') {
    return { ok: false, failure: { kind: 'not_string' } };
  }
  if (value.length !== 13) {
    return { ok: false, failure: { kind: 'wrong_length', length: value.length } };
  }
  if (!DIGITS_13.test(value)) {
    // Truncate the sample so encrypted blobs don't bloat logs / responses.
    return {
      ok: false,
      failure: { kind: 'non_digits', sample: value.slice(0, 8) + '…' },
    };
  }
  if (options.requireChecksum && !isValidThaiCidChecksum(value)) {
    return { ok: false, failure: { kind: 'checksum_mismatch', cid: value } };
  }
  return { ok: true, cid: value };
}

export function describeCidFailure(failure: CidValidationFailure): string {
  switch (failure.kind) {
    case 'missing':
      return 'CID is required';
    case 'not_string':
      return 'CID must be a string';
    case 'wrong_length':
      return `CID must be exactly 13 digits (got length ${failure.length})`;
    case 'non_digits':
      return `CID must contain only digits (received "${failure.sample}" — looks encrypted/masked)`;
    case 'checksum_mismatch':
      return `CID "${failure.cid}" failed the Thai national-ID checksum — value looks fabricated`;
  }
}
