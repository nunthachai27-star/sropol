// GET /api/dashboard/outcomes — neonatal outcomes board payload.
// Query: ?range=mtd|30d|all (default mtd — matches the UI's month labels)
//        ?hospital_id=<uuid> optional scope for KPIs/recent (facets ignore it)
import { NextResponse, type NextRequest } from 'next/server';
import { getDatabase } from '@/db/connection';
import { getOutcomes } from '@/services/newborn';
import { ensureInit } from '@/lib/ensure-init';
import { logger } from '@/lib/logger';

export async function GET(request: NextRequest) {
  try {
    await ensureInit();
    const db = await getDatabase();
    const searchParams = request.nextUrl.searchParams;

    const outcomes = await getOutcomes(db, {
      hospitalId: searchParams.get('hospital_id') ?? undefined,
      range: searchParams.get('range') ?? 'mtd',
    });
    return NextResponse.json(outcomes);
  } catch (error) {
    logger.error('outcomes_api_failed', { error });
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'เกิดข้อผิดพลาด กรุณาลองใหม่', details: null } },
      { status: 500 },
    );
  }
}
