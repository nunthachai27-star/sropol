import { NextResponse, type NextRequest } from 'next/server';
import { getDatabase } from '@/db/connection';
import { ensureInit } from '@/lib/ensure-init';
import { logger } from '@/lib/logger';
import { decryptSafe } from '@/lib/encryption';
import type { JourneyListItem, JourneyListResponse } from '@/types/api';

export async function GET(request: NextRequest) {
  try {
    await ensureInit();
    const db = await getDatabase();
    const searchParams = request.nextUrl.searchParams;
    const stage = searchParams.get('stage') ?? undefined;
    const riskLevel = searchParams.get('risk_level') ?? undefined;
    const hospitalId = searchParams.get('hospital_id') ?? undefined;
    const page = parseInt(searchParams.get('page') ?? '1', 10);
    const perPage = parseInt(searchParams.get('per_page') ?? '20', 10);

    let countSql = `SELECT COUNT(*) as total FROM maternal_journeys mj JOIN hospitals h ON h.id = mj.hospital_id WHERE 1=1`;
    let dataSql = `SELECT mj.*, h.name as hospital_name, h.hcode FROM maternal_journeys mj JOIN hospitals h ON h.id = mj.hospital_id WHERE 1=1`;
    const params: unknown[] = [];

    if (stage) {
      countSql += ` AND mj.care_stage = ?`;
      dataSql += ` AND mj.care_stage = ?`;
      params.push(stage);
      // Freshness gates — see hospitals/[hcode]/journeys/route.ts for full
      // rationale. Excludes stale PREGNANCY rows (delivered/lost to follow-up
      // but never transitioned). EDC 2010–2019 cases were inflating counts.
      if (stage === 'PREGNANCY') {
        // JS-computed ISO cutoffs instead of `NOW() - INTERVAL …` — edc /
        // last_anc_date are ISO-8601 TEXT in existing deployments, so the
        // timestamptz comparison throws on Postgres (and NOW() is non-portable
        // to SQLite). ISO strings compare lexicographically = chronologically.
        const edcCutoff = new Date(Date.now() - 14 * 86_400_000).toISOString();
        const lastAncCutoff = new Date(Date.now() - 60 * 86_400_000).toISOString();
        const freshClause = `
          AND (mj.ga_weeks IS NULL OR mj.ga_weeks <= 42)
          AND (mj.edc IS NULL OR mj.edc >= ?)
          AND (mj.last_anc_date IS NULL OR mj.last_anc_date >= ?)`;
        countSql += freshClause;
        dataSql += freshClause;
        params.push(edcCutoff, lastAncCutoff);
      }
    }
    if (riskLevel) {
      countSql += ` AND mj.anc_risk_level = ?`;
      dataSql += ` AND mj.anc_risk_level = ?`;
      params.push(riskLevel);
    }
    if (hospitalId) {
      countSql += ` AND mj.current_hospital_id = ?`;
      dataSql += ` AND mj.current_hospital_id = ?`;
      params.push(hospitalId);
    }

    const countRows = await db.query<{ total: number }>(countSql, params);
    const total = Number(countRows[0]?.total) || 0;

    dataSql += ` ORDER BY mj.created_at DESC LIMIT ? OFFSET ?`;
    const dataParams = [...params, perPage, (page - 1) * perPage];
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
      pagination: {
        total,
        page,
        perPage,
        totalPages: Math.ceil(total / perPage),
      },
    };

    return NextResponse.json(response);
  } catch (error) {
    logger.error('journeys_api_failed', { error });
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'เกิดข้อผิดพลาด กรุณาลองใหม่', details: null } },
      { status: 500 },
    );
  }
}
