// GET /api/hospitals/[hcode]/incoming-pregnancies
//
// From the hub's perspective: returns the count + list of pregnancies
// currently held at spoke hospitals whose capability rules
// (src/config/hospital-capabilities.ts) say they must be referred up
// (transitively) to this hub for delivery. Used by the hub's mission console.
//
// Query: ?min_ga=34 (default 34 weeks)

import { NextResponse, type NextRequest } from 'next/server';
import { getDatabase } from '@/db/connection';
import { ensureInit } from '@/lib/ensure-init';
import { logger } from '@/lib/logger';
import { getIncomingTermPregnancies } from '@/services/dashboard';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ hcode: string }> },
) {
  try {
    await ensureInit();
    const { hcode } = await params;
    const db = await getDatabase();

    const sp = request.nextUrl.searchParams;
    const minGaRaw = sp.get('min_ga');
    const minGaWeeks =
      minGaRaw != null && /^\d+$/.test(minGaRaw)
        ? Math.max(0, Math.min(45, parseInt(minGaRaw, 10)))
        : 34;

    // Confirm the hub exists. Returning 404 keeps the URL contract clean
    // (otherwise callers can't distinguish "unknown hcode" from "no incoming").
    const hospitals = await db.query<{ id: string }>(`SELECT id FROM hospitals WHERE hcode = ?`, [
      hcode,
    ]);
    if (hospitals.length === 0) {
      return NextResponse.json(
        { error: { code: 'NOT_FOUND', message: 'ไม่พบโรงพยาบาล', details: null } },
        { status: 404 },
      );
    }

    const result = await getIncomingTermPregnancies(db, hcode, minGaWeeks);
    return NextResponse.json(result);
  } catch (error) {
    logger.error('hospital_incoming_pregnancies_api_failed', { error });
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'เกิดข้อผิดพลาด กรุณาลองใหม่', details: null } },
      { status: 500 },
    );
  }
}
