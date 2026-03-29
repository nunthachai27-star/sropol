// GET /api/dashboard/referrals/list — paginated list of all referrals with hospital names
import { NextResponse, type NextRequest } from 'next/server';
import { getDatabase } from '@/db/connection';
import { ensureInit } from '@/lib/ensure-init';
import type { ReferralListItem, ReferralListResponse } from '@/types/api';

export async function GET(request: NextRequest) {
  try {
    await ensureInit();
    const db = await getDatabase();
    const searchParams = request.nextUrl.searchParams;
    const status = searchParams.get('status') ?? undefined;
    const page = parseInt(searchParams.get('page') ?? '1', 10);
    const perPage = parseInt(searchParams.get('per_page') ?? '20', 10);

    let countSql = `SELECT COUNT(*) as total FROM cached_referrals cr WHERE 1=1`;
    let dataSql = `
      SELECT cr.*,
        fh.name as from_hospital_name,
        th.name as to_hospital_name
      FROM cached_referrals cr
      LEFT JOIN hospitals fh ON fh.id = cr.from_hospital_id
      LEFT JOIN hospitals th ON th.id = cr.to_hospital_id
      WHERE 1=1`;
    const params: unknown[] = [];

    if (status) {
      countSql += ` AND cr.status = ?`;
      dataSql += ` AND cr.status = ?`;
      params.push(status);
    }

    const countRows = await db.query<{ total: number }>(countSql, params);
    const total = Number(countRows[0]?.total) || 0;

    dataSql += ` ORDER BY cr.initiated_at DESC LIMIT ? OFFSET ?`;
    const dataParams = [...params, perPage, (page - 1) * perPage];
    const rows = await db.query<Record<string, unknown>>(dataSql, dataParams);

    const referrals: ReferralListItem[] = rows.map((r) => ({
      id: r.id as string,
      fromHospital: (r.from_hospital_name as string) ?? 'ไม่ทราบ',
      toHospital: (r.to_hospital_name as string) ?? 'ไม่ทราบ',
      status: r.status as string,
      reason: r.reason as string,
      urgencyLevel: r.urgency_level as string,
      initiatedAt: r.initiated_at as string,
      arrivedAt: r.arrived_at as string | null,
    }));

    const response: ReferralListResponse = {
      referrals,
      pagination: {
        total,
        page,
        perPage,
        totalPages: Math.ceil(total / perPage),
      },
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error('Dashboard referrals list error:', error);
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'เกิดข้อผิดพลาด กรุณาลองใหม่', details: null } },
      { status: 500 },
    );
  }
}
