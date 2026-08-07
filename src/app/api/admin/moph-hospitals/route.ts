// GET /api/admin/moph-hospitals?province=40 — MOPH hospital registry filtered
// by province. Used by the admin hospital picker to add a facility to the
// operational `hospitals` table.
import { NextResponse, type NextRequest } from 'next/server';
import { getDatabase } from '@/db/connection';
import { ensureInit } from '@/lib/ensure-init';
import { requireAdmin } from '@/lib/admin-guard';
import { logger } from '@/lib/logger';

export async function GET(request: NextRequest) {
  try {
    const guard = await requireAdmin();
    if (guard instanceof NextResponse) return guard;

    await ensureInit();
    const province = request.nextUrl.searchParams.get('province');
    const db = await getDatabase();

    const rows = await db.query<{
      hcode: string;
      name: string;
      hospital_type_id: number | null;
      bed_count: number | null;
      province_code: string | null;
      district_code: string | null;
      active_status: string | null;
    }>(
      province
        ? `SELECT hcode, name, hospital_type_id, bed_count, province_code, district_code, active_status
           FROM moph_hospitals WHERE province_code = ? ORDER BY hospital_type_id, name`
        : `SELECT hcode, name, hospital_type_id, bed_count, province_code, district_code, active_status
           FROM moph_hospitals ORDER BY province_code, name LIMIT 500`,
      province ? [province] : [],
    );

    return NextResponse.json({
      hospitals: rows.map((r) => ({
        hcode: r.hcode,
        name: r.name,
        hospitalTypeId: r.hospital_type_id,
        bedCount: r.bed_count,
        provinceCode: r.province_code,
        districtCode: r.district_code,
        activeStatus: r.active_status,
      })),
    });
  } catch (error) {
    logger.error('admin_moph_hospitals_get_failed', { error });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
