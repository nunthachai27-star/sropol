// GET /api/dashboard/referrals/[id] — full referral detail with lifecycle
// milestones and patient context. Thin handler over referral-list service.
import { NextResponse, type NextRequest } from 'next/server';
import { getDatabase } from '@/db/connection';
import { ensureInit } from '@/lib/ensure-init';
import { logger } from '@/lib/logger';
import { getReferralDetail } from '@/services/referral-list';
import type { ReferralDetailResponse } from '@/types/api';

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await ensureInit();
    const db = await getDatabase();
    const { id } = await params;

    const referral = await getReferralDetail(db, id);
    if (!referral) {
      return NextResponse.json(
        { error: { code: 'NOT_FOUND', message: 'ไม่พบรายการส่งต่อนี้', details: null } },
        { status: 404 },
      );
    }

    const response: ReferralDetailResponse = { referral };
    return NextResponse.json(response);
  } catch (error) {
    logger.error('dashboard_referral_detail_failed', { error });
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'เกิดข้อผิดพลาด กรุณาลองใหม่', details: null } },
      { status: 500 },
    );
  }
}
