// POST /api/auth/hospital-preflight — public, no auth required.
//
// Lets the login page differentiate "session ID invalid/expired" from
// "your hospital is not in the registered list". Both end up as a generic
// CredentialsSignin error from NextAuth, which makes for terrible UX —
// directors of unregistered hospitals see "session expired" and assume
// they need a new BMS session, when actually they need their hospital
// admin to register them.
//
// Flow:
//   1. login page calls this BEFORE signIn() with the BMS session ID
//   2. we validate against BMS, then run the hospital-access guard
//   3. response tells the login page exactly what to render
//        allowed=true        → proceed with signIn()
//        invalid_session     → "Session ID ไม่ถูกต้องหรือหมดอายุ"
//        not_registered      → "Your hospital is not registered. Contact admin."
//        deactivated         → "Your hospital has been deactivated. Contact admin."
import { NextResponse, type NextRequest } from 'next/server';
import { validateBmsSession } from '@/lib/auth-utils';
import { checkHospitalAccess } from '@/lib/hospital-access-guard';
import {
  buildVersionRejectionMessage,
  checkBmsApiVersion,
  MIN_BMS_API_VERSION,
} from '@/lib/bms-version';
import { logger } from '@/lib/logger';

export async function POST(request: NextRequest) {
  let body: { sessionId?: unknown };
  try {
    body = (await request.json()) as { sessionId?: unknown };
  } catch {
    return NextResponse.json({ ok: false, reason: 'invalid_request' }, { status: 400 });
  }

  const sessionId = typeof body.sessionId === 'string' ? body.sessionId.trim() : '';
  if (!sessionId) {
    return NextResponse.json({ ok: false, reason: 'invalid_request' }, { status: 400 });
  }

  const tunnelUrl = process.env.DEV_HOSPITAL_TUNNEL_URL ?? '';
  const identity = await validateBmsSession(sessionId, tunnelUrl);
  if (!identity) {
    return NextResponse.json({
      ok: false,
      reason: 'invalid_session',
      message: 'Session ID ไม่ถูกต้องหรือหมดอายุ',
    });
  }

  const access = await checkHospitalAccess({
    hospitalCode: identity.hospitalCode,
    role: identity.role,
  });

  if (!access.allowed) {
    logger.info('hospital_preflight_denied', {
      hospitalCode: identity.hospitalCode,
      hospitalName: identity.hospitalName,
      reason: access.reason,
    });
    const reasonShort =
      access.reason === 'denied_hospital_inactive' ? 'deactivated' : 'not_registered';
    return NextResponse.json({
      ok: false,
      reason: reasonShort,
      hospitalCode: identity.hospitalCode,
      hospitalName: identity.hospitalName,
      // Thai message for UI; the login page can also show this verbatim.
      message:
        reasonShort === 'deactivated'
          ? `โรงพยาบาล "${identity.hospitalName}" (${identity.hospitalCode}) ถูกปิดการใช้งาน — กรุณาติดต่อผู้ดูแลระบบ`
          : `โรงพยาบาล "${identity.hospitalName}" (${identity.hospitalCode}) ยังไม่ได้รับสิทธิ์ใช้งานระบบ — กรุณาติดต่อผู้ดูแลระบบเพื่อขอลงทะเบียน หากท่านคิดว่าเป็นความผิดพลาด`,
    });
  }

  // Gate onboarding on the per-hospital HOSxP API version. The user's tunnel
  // must expose `get_server_api_version` and report >= MIN_BMS_API_VERSION;
  // otherwise downstream features (partograph schema, /api/function calls
  // like `get_serialnumber`) won't behave as the rest of kk-lrms expects.
  //
  // Bearer for /api/function is the session code (UUID), NOT identity.jwt
  // (which holds `auth_key` and is used elsewhere as the marketplace-token).
  if (identity.tunnelUrl) {
    const versionCheck = await checkBmsApiVersion(identity.tunnelUrl, sessionId);
    // Block ONLY on a confirmed-too-old version. 'unreachable' / 'invalid_response'
    // mean we couldn't determine the version at all — typically an expired BMS
    // session (the bearer is the session UUID), a momentary tunnel outage, or an
    // account with no real HOSxP (e.g. the provincial-admin login). Treating those
    // as 'hosxp_too_old' locked users out and told them to "update HOSxP" when the
    // version was simply unknown. Fail open: let login proceed and let the
    // downstream sync paths surface any real connectivity/version problem.
    if (!versionCheck.ok && versionCheck.reason === 'too_old') {
      logger.info('hospital_preflight_hosxp_version_rejected', {
        hospitalCode: identity.hospitalCode,
        hospitalName: identity.hospitalName,
        version: versionCheck.version,
        versionNumber: versionCheck.versionNumber,
        reason: versionCheck.reason,
        httpStatus: versionCheck.httpStatus,
        minVersion: MIN_BMS_API_VERSION,
      });
      return NextResponse.json({
        ok: false,
        reason: 'hosxp_too_old',
        hospitalCode: identity.hospitalCode,
        hospitalName: identity.hospitalName,
        currentVersion: versionCheck.version,
        minVersion: MIN_BMS_API_VERSION,
        message: buildVersionRejectionMessage(versionCheck),
      });
    }
    if (!versionCheck.ok) {
      logger.warn('hospital_preflight_hosxp_version_indeterminate', {
        hospitalCode: identity.hospitalCode,
        hospitalName: identity.hospitalName,
        reason: versionCheck.reason,
        httpStatus: versionCheck.httpStatus,
      });
    }
  }

  return NextResponse.json({
    ok: true,
    hospitalCode: identity.hospitalCode,
    hospitalName: identity.hospitalName,
  });
}
