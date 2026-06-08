// T085: Auth utility functions — separated from NextAuth config for testability
import { UserRole } from '@/types/domain';
import { logger } from '@/lib/logger';
import { ADMIN_HCODES } from '@/lib/hospital-access-guard';

export function mapPositionToRole(position: string): UserRole {
  const lower = position.toLowerCase();
  if (lower.includes('director') || lower.includes('ผู้อำนวยการ')) {
    return UserRole.ADMIN;
  }
  if (lower.includes('doctor') || lower.includes('แพทย์') || lower.includes('สูติ')) {
    return UserRole.OBSTETRICIAN;
  }
  return UserRole.NURSE;
}

export interface BmsUserIdentity {
  name: string;
  /** เลขบัตรประชาชน 13 หลัก of the BMS user. Used by middleware to enforce
   *  the ADMIN_ALLOWED_CIDS allow-list — even when role=ADMIN (or when
   *  DEV_AUTH_BYPASS forces ADMIN), only CIDs on the list reach /admin. */
  userCid: string;
  role: UserRole;
  hospitalCode: string;
  hospitalName: string;
  tunnelUrl: string;
  databaseType: string;
  jwt: string;
  expiresAt: string;
}

async function fetchRealBmsIdentity(sessionId: string): Promise<BmsUserIdentity | null> {
  try {
    const validateUrl = process.env.BMS_VALIDATE_URL ?? 'https://hosxp.net/phapi/PasteJSON';

    // BMS PasteJSON API uses GET with Action=GET&code=<session-id>
    const response = await fetch(
      `${validateUrl}?Action=GET&code=${encodeURIComponent(sessionId)}`,
      { signal: AbortSignal.timeout(10000) },
    );

    if (!response.ok) return null;

    const data = await response.json();

    if (data.MessageCode !== 200 || !data.result?.user_info) return null;

    const userInfo = data.result.user_info;

    const hcode = userInfo.hospital_code ?? '';
    return {
      name: userInfo.name ?? 'Unknown',
      userCid: userInfo.user_cid ?? '',
      role: mapPositionToRole(userInfo.position ?? ''),
      hospitalCode: hcode,
      hospitalName: userInfo.location && userInfo.location !== 'server' ? userInfo.location : `รพ.${hcode}`,
      tunnelUrl: userInfo.bms_url ?? '',
      databaseType: (userInfo.bms_database_type ?? 'postgresql').toLowerCase(),
      jwt: data.result.auth_key ?? '',
      expiresAt: new Date(Date.now() + (data.result.expired_second ?? 28800) * 1000).toISOString(),
    };
  } catch {
    return null;
  }
}

export async function validateBmsSession(
  sessionId: string,
  _tunnelUrl: string,
): Promise<BmsUserIdentity | null> {
  const devBypass = process.env.DEV_AUTH_BYPASS === 'true';

  // Always try the real BMS session first so the navbar reflects the session's
  // actual hospital (hcode, name, tunnel). Under DEV_AUTH_BYPASS we still call
  // BMS, but force role → ADMIN so any session gets admin access in dev.
  const real = await fetchRealBmsIdentity(sessionId);

  if (real) {
    if (devBypass) {
      logger.info('auth_dev_bypass_with_real_identity', {
        sessionId,
        hcode: real.hospitalCode,
        role: 'ADMIN',
      });
      return { ...real, role: UserRole.ADMIN };
    }
    // Provincial-admin sandbox hcodes (default 99999) get ADMIN regardless of
    // the user's BMS position. See ADMIN_HCODES in hospital-access-guard.
    if (ADMIN_HCODES.has(real.hospitalCode)) {
      logger.info('auth_admin_hcode_promoted', {
        hcode: real.hospitalCode,
        position_role: real.role,
        role: 'ADMIN',
      });
      return { ...real, role: UserRole.ADMIN };
    }
    return real;
  }

  // BMS unreachable. Under DEV_AUTH_BYPASS fall back to hardcoded identity so
  // offline dev still works; in production, fail closed.
  if (devBypass) {
    logger.info('auth_dev_bypass_bms_unreachable', { sessionId, role: 'ADMIN' });
    return {
      name: 'Dev Admin (ผู้ดูแลระบบ)',
      // DEV_USER_CID lets a dev impersonate a real CID for testing the
      // ADMIN_ALLOWED_CIDS allow-list. Empty when not set, which means a
      // configured allow-list will reject offline-dev sessions — by design,
      // because we shouldn't auto-grant admin to a no-CID identity.
      userCid: process.env.DEV_USER_CID ?? '',
      role: UserRole.ADMIN,
      hospitalCode: '10670',
      hospitalName: 'รพ.ขอนแก่น',
      tunnelUrl: process.env.DEV_HOSPITAL_TUNNEL_URL ?? '',
      databaseType: 'postgresql',
      jwt: 'dev-jwt-token',
      expiresAt: new Date(Date.now() + 8 * 3600_000).toISOString(),
    };
  }

  return null;
}
