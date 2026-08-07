// Test helper: build checksum-valid Thai national IDs for fixtures.
//
// The ANC webhook / sync paths now reject CIDs that fail the official ก.พ.
// checksum (src/lib/cid.ts `isValidThaiCidChecksum`). Fabricated fixtures like
// '1234567890001' fail that guard, so fixtures must be generated with the
// correct 13th check digit. Keep distinct patients on distinct 12-digit
// prefixes and the CIDs stay distinct.

/** Append the correct 13th check digit to a 12-digit prefix. */
export function makeValidCid(prefix12: string): string {
  if (!/^[0-9]{12}$/.test(prefix12)) {
    throw new Error(`makeValidCid expects a 12-digit prefix, got "${prefix12}"`);
  }
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    sum += Number(prefix12[i]) * (13 - i);
  }
  const check = (11 - (sum % 11)) % 10;
  return prefix12 + String(check);
}

/** Deterministic valid CID from a small integer seed (0..999999999999). */
export function validCidFromSeed(seed: number): string {
  return makeValidCid(String(seed).padStart(12, '0'));
}
