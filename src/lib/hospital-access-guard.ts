// Gate that decides whether an authenticated identity (BMS or ProviderID) is
// allowed to hold a KK-LRMS session at all. Called from the NextAuth authorize
// callback — if the gate denies, the login is rejected (authorize returns
// null) and the user never gets a JWT.
//
// Policy (in order):
//   1. EXEMPT_HCODES → always allowed regardless of auth method or role.
//        '00000' reserved system-level account
//        '99999' reserved provincial/admin testing account
//      These are also honored by /api/onboarding/* to auto-register webhook
//      keys + HOSxP sync. Do NOT add real organization codes here — use
//      READONLY_LOGIN_HCODES instead. Cross-province administrators MUST
//      use one of these hcodes; the role-based ADMIN bypass that previously
//      sat above this rule was removed because mapPositionToRole() promotes
//      any user whose position contains "director"/"ผู้อำนวยการ" to ADMIN.
//   2. READONLY_LOGIN_HCODES (env-driven) → allowed only when the caller
//      passes accessMode='readonly'. Used for non-hospital MOPH units
//      (provincial / regional health offices, สสจ., เขตสุขภาพ) whose staff
//      need to view dashboards via ProviderID but MUST NOT trigger webhook
//      onboarding or HOSxP sync. The onboarding routes only honor
//      EXEMPT_HCODES, and the readonly middleware (middleware.ts:85-100)
//      already 403s any non-GET on /api/admin · /api/onboarding ·
//      /api/sync/trigger · /api/referrals · /api/hospital/audit-log, so
//      these sessions are structurally read-only.
//   3. Hcode must match an active row in the operational `hospitals` table.
//      A hospital removed or deactivated by an admin (via /admin ·
//      โรงพยาบาล) cannot issue new sessions. Role does NOT influence this
//      check — even ADMIN users from unregistered hospitals are denied.
//
// The check runs once per login, not per request. Existing sessions whose
// hospital is removed remain valid until JWT expiry (session.maxAge, 8 h).
import type { DatabaseAdapter } from '@/db/adapter';
import { UserRole } from '@/types/domain';
import { logger } from '@/lib/logger';

// `getDatabase` / `ensureInit` pull the full sync service graph (which uses
// Node `crypto`) and cannot be statically imported here: this module is
// reachable from `auth.ts` → `middleware.ts`, which runs on the Edge runtime.
// Deferring the import keeps middleware Edge-safe while still letting the
// authorize callback (Node runtime) resolve the live DB.
async function resolveDefaultDb(): Promise<DatabaseAdapter> {
  const { ensureInit } = await import('@/lib/ensure-init');
  const { getDatabase } = await import('@/db/connection');
  await ensureInit();
  return getDatabase();
}

function parseHcodeSet(
  envValue: string | undefined,
  builtin: readonly string[] = [],
): ReadonlySet<string> {
  const fromEnv = (envValue ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return new Set([...builtin, ...fromEnv]);
}

export const EXEMPT_HCODES: ReadonlySet<string> = parseHcodeSet(undefined, ['00000', '99999']);

// Hospital codes whose BMS sessions are granted ADMIN role regardless of the
// user's BMS position. 99999 is the provincial-admin sandbox hcode. Override /
// extend via the ADMIN_HCODES env var (comma-separated). The middleware's
// ADMIN_ALLOWED_CIDS allow-list still applies on top when it is non-empty.
export const ADMIN_HCODES: ReadonlySet<string> = parseHcodeSet(process.env.ADMIN_HCODES, ['99999']);

export const READONLY_LOGIN_HCODES: ReadonlySet<string> = parseHcodeSet(
  process.env.READONLY_LOGIN_HCODES,
);

export interface HospitalAccessInput {
  hospitalCode: string;
  role: UserRole | string;
  /** When 'readonly', READONLY_LOGIN_HCODES is consulted in addition to
   *  EXEMPT_HCODES + the registry. Omit (or pass 'readwrite') for BMS
   *  sessions so PHO/regional units can't sneak in via a write-capable
   *  auth method. */
  accessMode?: 'readonly' | 'readwrite';
}

export type HospitalAccessReason =
  | 'allowed_exempt'
  | 'allowed_readonly_unit'
  | 'allowed_registered'
  | 'denied_hospital_not_registered'
  | 'denied_hospital_inactive';

export interface HospitalAccessResult {
  allowed: boolean;
  reason: HospitalAccessReason;
}

/**
 * Returns the access decision plus the reason. ADMIN role no longer bypasses
 * the registry check — the only bypass is the EXEMPT_HCODES set. The optional
 * `db` parameter lets tests inject a pre-built adapter without bootstrapping
 * the global `ensureInit()` singleton — production callers omit it.
 */
export async function checkHospitalAccess(
  input: HospitalAccessInput,
  db?: DatabaseAdapter,
): Promise<HospitalAccessResult> {
  if (EXEMPT_HCODES.has(input.hospitalCode)) {
    return { allowed: true, reason: 'allowed_exempt' };
  }

  if (
    input.accessMode === 'readonly' &&
    READONLY_LOGIN_HCODES.has(input.hospitalCode)
  ) {
    return { allowed: true, reason: 'allowed_readonly_unit' };
  }

  const adapter = db ?? (await resolveDefaultDb());

  // Distinguish "no row" from "row exists but inactive" so the login page can
  // show a different message: not-registered vs. deactivated-by-admin.
  const rows = await adapter.query<{ is_active: boolean }>(
    'SELECT is_active FROM hospitals WHERE hcode = ?',
    [input.hospitalCode],
  );
  if (rows.length === 0) {
    return { allowed: false, reason: 'denied_hospital_not_registered' };
  }
  if (!rows[0].is_active) {
    return { allowed: false, reason: 'denied_hospital_inactive' };
  }
  return { allowed: true, reason: 'allowed_registered' };
}

/** Back-compat boolean wrapper. New code should call checkHospitalAccess. */
export async function isHospitalAccessAllowed(
  input: HospitalAccessInput,
  db?: DatabaseAdapter,
): Promise<boolean> {
  const result = await checkHospitalAccess(input, db);
  return result.allowed;
}

/** Convenience wrapper that logs the rejection reason for observability. */
export async function assertHospitalAccess(
  input: HospitalAccessInput,
  db?: DatabaseAdapter,
): Promise<HospitalAccessResult> {
  const result = await checkHospitalAccess(input, db);
  if (!result.allowed) {
    logger.warn('hospital_access_denied', {
      hospitalCode: input.hospitalCode,
      role: input.role,
      reason: result.reason,
    });
  }
  return result;
}
