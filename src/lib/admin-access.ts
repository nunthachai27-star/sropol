// W6: THE single source of truth for "is this identity allowed into /admin".
//
// Both the Edge middleware (src/middleware.ts) and the Node-side route guard
// (src/lib/admin-guard.ts) call isAdminAuthorized so the role / CID / readonly
// rule can never diverge between the two enforcement layers.
//
// Edge-runtime constraint: this file is imported into the middleware bundle, so
// it MUST stay pure — no `crypto`, DB, fs, logger, or any Node-only import.
// Same split rationale as auth.config.ts vs auth.ts. `process.env` reads are
// fine on the Edge for statically-known vars (middleware already reads
// ADMIN_ALLOWED_CIDS / NODE_ENV).
import { UserRole } from '@/types/domain';

export interface AdminIdentity {
  role?: UserRole | string | null;
  userCid?: string | null;
  /** ProviderID sessions are 'readonly'; BMS sessions are 'readwrite'. */
  accessMode?: 'readwrite' | 'readonly' | string | null;
}

/**
 * Parse the ADMIN_ALLOWED_CIDS env var into a trimmed, non-empty CID list.
 * The default arg is evaluated per-call, so tests can inject values without
 * mutating process.env.
 */
export function parseAdminAllowedCids(
  raw: string | undefined = process.env.ADMIN_ALLOWED_CIDS,
): string[] {
  return (raw ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Login-time role promotion: the ADMIN_ALLOWED_CIDS list is not only a
 * restriction on position-derived ADMINs — it is also a GRANT. A readwrite
 * (BMS) session whose CID is on the list gets ADMIN regardless of what
 * mapPositionToRole derived from the BMS position string, because the
 * operator-controlled allow-list is a stronger signal of intent than a
 * free-text position. Promotion fails closed: it requires an explicit
 * accessMode === 'readwrite' — readonly (ProviderID) sessions and identities
 * with no accessMode are never promoted, and an empty list grants nobody.
 */
export function promoteRoleByAllowedCid(
  role: UserRole,
  identity: Pick<AdminIdentity, 'userCid' | 'accessMode'>,
  allowedCids: string[] = parseAdminAllowedCids(),
): UserRole {
  if (identity.accessMode !== 'readwrite') return role;
  const cid = identity.userCid ?? '';
  if (cid && allowedCids.includes(cid)) return UserRole.ADMIN;
  return role;
}

/**
 * The /admin authorization rule. Three gates, all must pass:
 *   1. role === 'ADMIN'  (BMS-derived; may be promoted by DEV_AUTH_BYPASS).
 *   2. accessMode !== 'readonly'  (ProviderID read-only sessions never admin).
 *   3. when the allow-list is non-empty, userCid must be on it; when it is
 *      EMPTY, production fails closed (no CID-authorized administrators) and
 *      only outside production does the role-only gate survive, for local
 *      dev/test back-compat.
 *
 * Gate 1 is normally satisfied either by the BMS position ("director" /
 * "ผู้อำนวยการ") or by promoteRoleByAllowedCid above, which grants ADMIN at BMS
 * sign-in to CIDs on the same allow-list.
 *
 * The CID gate exists because (a) mapPositionToRole grants ADMIN to any BMS
 * position containing "director"/"ผู้อำนวยการ", and (b) DEV_AUTH_BYPASS promotes
 * everyone to ADMIN — neither is acceptable as the sole gate for production
 * /admin access. The allow-list short-circuits both.
 */
export function isAdminAuthorized(
  identity: AdminIdentity,
  allowedCids: string[] = parseAdminAllowedCids(),
  isProduction: boolean = process.env.NODE_ENV === 'production',
): boolean {
  if (identity.role !== UserRole.ADMIN) return false;
  if (identity.accessMode === 'readonly') return false;
  if (allowedCids.length === 0) {
    // Fail closed: production with no allow-list has NO CID-authorized
    // administrators. The role-only gate survives only outside production.
    return !isProduction;
  }
  const cid = identity.userCid ?? '';
  return Boolean(cid) && allowedCids.includes(cid);
}
