// GET /api/dashboard/referrals/insights — corridors, 7-day volume, and
// destination hospitals for the referral board. Thin handler over the
// referral-list service.
import { NextResponse } from 'next/server';
import { getDatabase } from '@/db/connection';
import { ensureInit } from '@/lib/ensure-init';
import { logger } from '@/lib/logger';
import { getReferralInsights } from '@/services/referral-list';

export async function GET() {
  try {
    await ensureInit();
    const db = await getDatabase();
    const response = await getReferralInsights(db);
    return NextResponse.json(response);
  } catch (error) {
    logger.error('dashboard_referral_insights_failed', { error });
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'เกิดข้อผิดพลาด กรุณาลองใหม่', details: null } },
      { status: 500 },
    );
  }
}
