// GET /api/admin/provinces — all 77 Thai provinces (plus "00" ต่างประเทศ).
// Sourced from the `provinces` lookup seeded from MOPH registry.
import { NextResponse } from 'next/server';
import { getDatabase } from '@/db/connection';
import { ensureInit } from '@/lib/ensure-init';
import { requireAdmin } from '@/lib/admin-guard';
import { logger } from '@/lib/logger';

export async function GET() {
  try {
    const guard = await requireAdmin();
    if (guard instanceof NextResponse) return guard;

    await ensureInit();
    const db = await getDatabase();
    const rows = await db.query<{ province_code: string; province_name: string }>(
      `SELECT province_code, province_name FROM provinces
       WHERE province_code <> '00'
       ORDER BY province_name`,
    );
    return NextResponse.json({
      provinces: rows.map((r) => ({
        code: r.province_code,
        name: r.province_name,
      })),
    });
  } catch (error) {
    logger.error('admin_provinces_get_failed', { error });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
