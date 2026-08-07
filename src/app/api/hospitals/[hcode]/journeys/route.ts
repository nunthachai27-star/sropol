import { NextResponse, type NextRequest } from 'next/server';
import { getDatabase } from '@/db/connection';
import { auth } from '@/lib/auth';
import { tryLogAccess } from '@/services/audit';
import { auditActorFromSession } from '@/lib/audit-actor';
import { ensureInit } from '@/lib/ensure-init';
import { logger } from '@/lib/logger';
import { listHospitalJourneys } from '@/services/journey-list';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ hcode: string }> },
) {
  try {
    await ensureInit();
    const { hcode } = await params;
    const db = await getDatabase();
    const searchParams = request.nextUrl.searchParams;

    const result = await listHospitalJourneys(db, hcode, {
      stage: searchParams.get('stage') ?? undefined,
      riskLevel: searchParams.get('risk_level') ?? undefined,
      page: parseInt(searchParams.get('page') ?? '1', 10),
      perPage: parseInt(searchParams.get('per_page') ?? '20', 10),
    });

    if (result === null) {
      return NextResponse.json(
        { error: { code: 'NOT_FOUND', message: 'ไม่พบโรงพยาบาล', details: null } },
        { status: 404 },
      );
    }

    // PDPA access log — fire-and-forget (tryLogAccess never throws).
    const session = await auth();
    if (session?.user) {
      await tryLogAccess(db, {
        ...auditActorFromSession(session),
        action: 'VIEW_HOSPITAL_JOURNEYS',
        resourceType: 'HOSPITAL',
        resourceId: hcode,
      });
    }

    return NextResponse.json(result);
  } catch (error) {
    logger.error('hospital_journeys_api_failed', { error });
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'เกิดข้อผิดพลาด กรุณาลองใหม่', details: null } },
      { status: 500 },
    );
  }
}
