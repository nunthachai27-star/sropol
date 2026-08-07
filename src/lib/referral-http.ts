// Shared factory for the four referral transition routes (mirrors
// callTransitionRoute in src/lib/video-call-http.ts). Centralizes: session
// guard, hcode->id resolution, party authorization, error mapping.
import { NextResponse, type NextRequest } from 'next/server';
import type { Session } from 'next-auth';
import type { DatabaseAdapter } from '@/db/adapter';
import type { CachedReferral } from '@/types/domain';
import { getDatabase } from '@/db/connection';
import { ensureInit } from '@/lib/ensure-init';
import { requireReadWriteSession } from '@/lib/session-guard';
import { getHospitalIdByHcode } from '@/services/hospital-lookup';
import {
  assertReferralParty,
  ReferralAccessError,
  ReferralConflictError,
} from '@/services/referral';
import { isJsonContentType } from '@/lib/request-origin';
import { logger } from '@/lib/logger';

const UNSUPPORTED_CONTENT_TYPE_BODY = {
  error: {
    code: 'UNSUPPORTED_CONTENT_TYPE',
    message: 'ต้องส่งข้อมูลเป็น application/json เท่านั้น',
    details: null,
  },
};

export interface ReferralTransitionSpec {
  /** Which referral party may perform this transition. */
  side: 'from' | 'to';
  /** Body field that must be present (null = no required field). */
  requiredField: string | null;
  logEvent: string;
  run: (
    db: DatabaseAdapter,
    referralId: string,
    body: Record<string, unknown>,
    session: Session,
  ) => Promise<CachedReferral>;
}

export function referralTransitionRoute(spec: ReferralTransitionSpec) {
  return async function PATCH(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> },
  ): Promise<NextResponse> {
    try {
      await ensureInit();
      const guard = await requireReadWriteSession();
      if (guard instanceof NextResponse) return guard;
      const session = guard;

      // JSON-only handler: form content types are CSRF simple-request vectors.
      const contentType = request.headers.get('content-type');
      if (contentType !== null && !isJsonContentType(contentType)) {
        return NextResponse.json(UNSUPPORTED_CONTENT_TYPE_BODY, { status: 415 });
      }

      const { id } = await params;
      const body = ((await request.json().catch(() => ({}))) ?? {}) as Record<string, unknown>;
      if (spec.requiredField && !body[spec.requiredField]) {
        return NextResponse.json(
          {
            error: {
              code: 'VALIDATION_ERROR',
              message: `${spec.requiredField} จำเป็นต้องระบุ`,
              details: null,
            },
          },
          { status: 400 },
        );
      }

      const db = await getDatabase();
      const hospitalId = await getHospitalIdByHcode(db, session.user.hospitalCode);
      if (!hospitalId) {
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
      await assertReferralParty(db, id, hospitalId, spec.side);
      const referral = await spec.run(db, id, body, session);
      return NextResponse.json(referral);
    } catch (error) {
      if (error instanceof ReferralAccessError) {
        return NextResponse.json(
          { error: { code: error.code, message: error.message, details: null } },
          { status: error.code === 'NOT_FOUND' ? 404 : 403 },
        );
      }
      if (error instanceof ReferralConflictError) {
        return NextResponse.json(
          {
            error: {
              code: 'STATE_CONFLICT',
              message: error.message,
              details: { currentStatus: error.currentStatus },
            },
          },
          { status: 409 },
        );
      }
      logger.error(spec.logEvent, { error });
      return NextResponse.json(
        {
          error: { code: 'INTERNAL_ERROR', message: 'เกิดข้อผิดพลาด กรุณาลองใหม่', details: null },
        },
        { status: 500 },
      );
    }
  };
}
