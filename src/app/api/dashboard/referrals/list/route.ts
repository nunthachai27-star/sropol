// GET /api/dashboard/referrals/list — paginated provincial referral board.
// Thin handler: parse params → referral-list service → NextResponse.
import { NextResponse, type NextRequest } from 'next/server';
import { getDatabase } from '@/db/connection';
import { ensureInit } from '@/lib/ensure-init';
import { logger } from '@/lib/logger';
import { listReferrals } from '@/services/referral-list';

export async function GET(request: NextRequest) {
  try {
    await ensureInit();
    const db = await getDatabase();
    const searchParams = request.nextUrl.searchParams;

    const response = await listReferrals(db, {
      status: searchParams.get('status') ?? undefined,
      urgency: searchParams.get('urgency') ?? undefined,
      fromHospitalId: searchParams.get('from_hospital_id') ?? undefined,
      toHospitalId: searchParams.get('to_hospital_id') ?? undefined,
      range: searchParams.get('range') ?? undefined,
      q: searchParams.get('q') ?? undefined,
      overdue: searchParams.get('overdue') === '1',
      page: parseInt(searchParams.get('page') ?? '1', 10),
      perPage: parseInt(searchParams.get('per_page') ?? '20', 10),
    });

    return NextResponse.json(response);
  } catch (error) {
    logger.error('dashboard_referrals_list_failed', { error });
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'เกิดข้อผิดพลาด กรุณาลองใหม่', details: null } },
      { status: 500 },
    );
  }
}
