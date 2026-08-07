import { NextResponse, type NextRequest } from 'next/server';
import { getDatabase } from '@/db/connection';
import { auth } from '@/lib/auth';
import { tryLogAccess } from '@/services/audit';
import { auditActorFromSession } from '@/lib/audit-actor';
import { ensureInit } from '@/lib/ensure-init';
import { logger } from '@/lib/logger';
import { listJourneys } from '@/services/journey-list';

export async function GET(request: NextRequest) {
  try {
    await ensureInit();
    const db = await getDatabase();
    const searchParams = request.nextUrl.searchParams;

    const result = await listJourneys(db, {
      stage: searchParams.get('stage') ?? undefined,
      riskLevel: searchParams.get('risk_level') ?? undefined,
      hospitalId: searchParams.get('hospital_id') ?? undefined,
      q: searchParams.get('q') ?? undefined,
      cohort: searchParams.get('cohort') ?? undefined,
      sort: searchParams.get('sort') ?? undefined,
      page: parseInt(searchParams.get('page') ?? '1', 10),
      perPage: parseInt(searchParams.get('per_page') ?? '20', 10),
    });

    // PDPA access log — fire-and-forget (tryLogAccess never throws).
    const session = await auth();
    if (session?.user) {
      await tryLogAccess(db, {
        ...auditActorFromSession(session),
        action: 'VIEW_JOURNEY_LIST',
        resourceType: 'JOURNEY_LIST',
      });
    }

    return NextResponse.json(result);
  } catch (error) {
    logger.error('journeys_api_failed', { error });
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'เกิดข้อผิดพลาด กรุณาลองใหม่', details: null } },
      { status: 500 },
    );
  }
}
