// T087: POST /api/auth/bms-session — pre-validate BMS session
import { NextRequest, NextResponse } from 'next/server';
import { validateBmsSession } from '@/lib/auth-utils';
import { promoteRoleByAllowedCid } from '@/lib/admin-access';
import { logger } from '@/lib/logger';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { sessionId } = body;

    if (!sessionId) {
      return NextResponse.json({ error: 'Session ID is required' }, { status: 400 });
    }

    const tunnelUrl = process.env.DEV_HOSPITAL_TUNNEL_URL ?? '';
    const identity = await validateBmsSession(sessionId, tunnelUrl);

    if (!identity) {
      return NextResponse.json({ error: 'Session ID ไม่ถูกต้องหรือหมดอายุ' }, { status: 401 });
    }

    return NextResponse.json({
      user: {
        name: identity.name,
        // Same ADMIN_ALLOWED_CIDS promotion the BMS authorize() applies, so
        // the pre-validated role matches the session signIn() will create.
        role: promoteRoleByAllowedCid(identity.role, {
          userCid: identity.userCid,
          accessMode: 'readwrite',
        }),
        hospitalCode: identity.hospitalCode,
      },
      expiresAt: identity.expiresAt,
    });
  } catch (error) {
    logger.error('bms_session_validation_failed', { error });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
