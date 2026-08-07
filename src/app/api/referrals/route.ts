// POST /api/referrals — initiate referral (source = session hospital).
// GET  /api/referrals — list own hospital's pending referrals.
import { NextResponse, type NextRequest } from 'next/server';
import { getDatabase } from '@/db/connection';
import { ensureInit } from '@/lib/ensure-init';
import { requireSession, requireReadWriteSession } from '@/lib/session-guard';
import { getHospitalIdByHcode } from '@/services/hospital-lookup';
import { initiateReferral, getPendingReferrals } from '@/services/referral';
import { isJsonContentType } from '@/lib/request-origin';
import { UrgencyLevel } from '@/types/domain';
import { logger } from '@/lib/logger';

export async function POST(request: NextRequest) {
  try {
    await ensureInit();
    const guard = await requireReadWriteSession();
    if (guard instanceof NextResponse) return guard;
    const session = guard;

    // JSON-only handler: form content types are CSRF simple-request vectors.
    const contentType = request.headers.get('content-type');
    if (contentType !== null && !isJsonContentType(contentType)) {
      return NextResponse.json(
        {
          error: {
            code: 'UNSUPPORTED_CONTENT_TYPE',
            message: 'ต้องส่งข้อมูลเป็น application/json เท่านั้น',
            details: null,
          },
        },
        { status: 415 },
      );
    }

    const body = (await request.json()) as Record<string, unknown>;
    const { journeyId, toHospitalId, reason, urgencyLevel } = body;

    if (!journeyId || !toHospitalId || !reason || !urgencyLevel) {
      return NextResponse.json(
        {
          error: {
            code: 'VALIDATION_ERROR',
            message: 'journeyId, toHospitalId, reason และ urgencyLevel จำเป็นต้องระบุ',
            details: null,
          },
        },
        { status: 400 },
      );
    }
    if (!Object.values(UrgencyLevel).includes(urgencyLevel as UrgencyLevel)) {
      return NextResponse.json(
        {
          error: {
            code: 'VALIDATION_ERROR',
            message: 'urgencyLevel ไม่ถูกต้อง ต้องเป็น ROUTINE, URGENT หรือ EMERGENCY',
            details: null,
          },
        },
        { status: 400 },
      );
    }

    const db = await getDatabase();
    const fromHospitalId = await getHospitalIdByHcode(db, session.user.hospitalCode);
    if (!fromHospitalId) {
      return NextResponse.json(
        {
          error: {
            code: 'HOSPITAL_NOT_REGISTERED',
            message: `โรงพยาบาล ${session.user.hospitalCode} ไม่ได้ลงทะเบียนในระบบ`,
            details: null,
          },
        },
        { status: 403 },
      );
    }

    // The journey must currently be at the session's hospital.
    const journeyRows = await db.query<{ current_hospital_id: string }>(
      'SELECT current_hospital_id FROM maternal_journeys WHERE id = ?',
      [String(journeyId)],
    );
    if (journeyRows.length === 0) {
      return NextResponse.json(
        {
          error: {
            code: 'JOURNEY_NOT_FOUND',
            message: 'ไม่พบข้อมูลการตั้งครรภ์ที่ระบุ',
            details: null,
          },
        },
        { status: 404 },
      );
    }
    if (journeyRows[0].current_hospital_id !== fromHospitalId) {
      return NextResponse.json(
        {
          error: {
            code: 'JOURNEY_NOT_AT_HOSPITAL',
            message: 'ผู้ป่วยรายนี้ไม่ได้อยู่ในความดูแลของโรงพยาบาลคุณ จึงไม่สามารถส่งต่อได้',
            details: null,
          },
        },
        { status: 403 },
      );
    }

    const referral = await initiateReferral(db, {
      journeyId: String(journeyId),
      fromHospitalId,
      toHospitalId: String(toHospitalId),
      reason: String(reason),
      diagnosisCode: body.diagnosisCode != null ? String(body.diagnosisCode) : undefined,
      urgencyLevel: urgencyLevel as UrgencyLevel,
      initiatedBy: session.user.name ?? session.user.id,
    });
    return NextResponse.json(referral, { status: 201 });
  } catch (error) {
    logger.error('referral_create_failed', { error });
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'เกิดข้อผิดพลาด กรุณาลองใหม่', details: null } },
      { status: 500 },
    );
  }
}

export async function GET(request: NextRequest) {
  try {
    await ensureInit();
    const guard = await requireSession();
    if (guard instanceof NextResponse) return guard;
    const session = guard;

    const { searchParams } = new URL(request.url);
    const dir = searchParams.get('dir');
    if (dir !== 'in' && dir !== 'out') {
      return NextResponse.json(
        { error: { code: 'VALIDATION_ERROR', message: 'dir ต้องเป็น in หรือ out', details: null } },
        { status: 400 },
      );
    }

    const db = await getDatabase();
    const hospitalId = await getHospitalIdByHcode(db, session.user.hospitalCode);
    if (!hospitalId) {
      return NextResponse.json([]); // unregistered hospital sees nothing
    }
    const referrals = await getPendingReferrals(db, hospitalId, dir);
    return NextResponse.json(referrals);
  } catch (error) {
    logger.error('referral_list_failed', { error });
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'เกิดข้อผิดพลาด กรุณาลองใหม่', details: null } },
      { status: 500 },
    );
  }
}
