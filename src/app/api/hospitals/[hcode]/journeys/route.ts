import { NextResponse, type NextRequest } from 'next/server';
import { getDatabase } from '@/db/connection';
import { ensureInit } from '@/lib/ensure-init';
import { logger } from '@/lib/logger';
import { decryptSafe } from '@/lib/encryption';
import type { JourneyListItem, JourneyListResponse } from '@/types/api';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ hcode: string }> },
) {
  try {
    await ensureInit();
    const { hcode } = await params;
    const db = await getDatabase();
    const searchParams = request.nextUrl.searchParams;
    const stage = searchParams.get('stage') ?? undefined;
    const riskLevel = searchParams.get('risk_level') ?? undefined;
    const page = parseInt(searchParams.get('page') ?? '1', 10);
    const perPage = parseInt(searchParams.get('per_page') ?? '20', 10);

    // Find hospital by hcode
    const hospitals = await db.query<{ id: string }>(
      `SELECT id FROM hospitals WHERE hcode = ?`,
      [hcode],
    );
    if (hospitals.length === 0) {
      return NextResponse.json(
        { error: { code: 'NOT_FOUND', message: 'ไม่พบโรงพยาบาล', details: null } },
        { status: 404 },
      );
    }
    const hospitalId = hospitals[0].id;

    let countSql = `SELECT COUNT(*) as total FROM maternal_journeys WHERE current_hospital_id = ?`;
    let dataSql = `SELECT mj.*, h.name as hospital_name, h.hcode FROM maternal_journeys mj JOIN hospitals h ON h.id = mj.hospital_id WHERE mj.current_hospital_id = ?`;
    const params2: unknown[] = [hospitalId];

    if (stage) {
      countSql += ` AND care_stage = ?`;
      dataSql += ` AND mj.care_stage = ?`;
      params2.push(stage);
    }
    if (riskLevel) {
      countSql += ` AND anc_risk_level = ?`;
      dataSql += ` AND mj.anc_risk_level = ?`;
      params2.push(riskLevel);
    }

    const countRows = await db.query<{ total: number }>(countSql, params2);
    const total = Number(countRows[0]?.total) || 0;

    dataSql += ` ORDER BY mj.created_at DESC LIMIT ? OFFSET ?`;
    const dataParams = [...params2, perPage, (page - 1) * perPage];
    const rows = await db.query<Record<string, unknown>>(dataSql, dataParams);

    const journeys: JourneyListItem[] = rows.map((r) => ({
      id: r.id as string,
      hn: r.hn as string,
      name: decryptSafe(r.name as string),
      age: r.age as number,
      gravida: r.gravida as number,
      para: r.para as number,
      gaWeeks: r.ga_weeks as number | null,
      lmp: r.lmp as string | null,
      edc: r.edc as string | null,
      careStage: r.care_stage as string,
      ancRiskLevel: r.anc_risk_level as string,
      ancVisitCount: r.anc_visit_count as number,
      lastAncDate: r.last_anc_date as string | null,
      hospitalName: r.hospital_name as string,
      hcode: r.hcode as string,
      registeredAt: r.registered_at as string,
    }));

    const response: JourneyListResponse = {
      journeys,
      pagination: { total, page, perPage, totalPages: Math.ceil(total / perPage) },
    };

    return NextResponse.json(response);
  } catch (error) {
    logger.error('hospital_journeys_api_failed', { error });
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'เกิดข้อผิดพลาด กรุณาลองใหม่', details: null } },
      { status: 500 },
    );
  }
}
