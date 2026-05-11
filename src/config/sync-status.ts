// Shared definition of which `hospital_bms_config.last_authenticity_status`
// values count as a BLOCKED sync verdict. Imported by both the dashboard
// (server-side, src/services/dashboard.ts) and the admin map (client-side,
// src/components/admin/AdminMapPane.tsx) so the corner status dot stays
// consistent across `/` and `/admin`.
//
// New failure statuses written by polling.ts must be added here AND in
// the dashboard's syncStatus precedence comment, otherwise admins will
// see GREEN dots for hospitals the dashboard considers BLOCKED.
export const SYNC_FAILURE_STATUSES: ReadonlySet<string> = new Set([
  'cid_unstable',
  'hn_unstable',
  'cid_invalid_checksum',
  'no_id_field',
  'probe_failed',
  'missing_marketplace_token',
  'purged_pending_reonboard',
  // Set when the browser-side name round-trip (hn + fname + lname) returns
  // zero rows — old HOSxP API servers anonymise PII display fields while
  // keeping CID stable, so the CID-only probe misses them.
  'name_unstable',
]);

export function isSyncFailureStatus(
  status: string | null | undefined,
): boolean {
  return Boolean(status && SYNC_FAILURE_STATUSES.has(status));
}
