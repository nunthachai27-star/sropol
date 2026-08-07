// GET /api/admin/hospitals/[hcode]/sync-progress — returns recent sync
// runs (step trail + outcome) for one hospital, sourced from the Redis
// progress store written by pollHospital(). Admin-gated by middleware.
//
// Query params:
//   limit  number — default 20, capped at 100
//   latest "true" — return only the most recent run (cheaper read path)
import { NextResponse, type NextRequest } from 'next/server';
import { getDatabase } from '@/db/connection';
import { ensureInit } from '@/lib/ensure-init';
import { requireAdmin } from '@/lib/admin-guard';
import { logger } from '@/lib/logger';
import { getLatestSyncRun, listSyncRuns } from '@/services/sync/progress-store';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ hcode: string }> },
) {
  try {
    const guard = await requireAdmin();
    if (guard instanceof NextResponse) return guard;

    await ensureInit();
    const { hcode } = await params;
    const sp = request.nextUrl.searchParams;
    const onlyLatest = sp.get('latest') === 'true';
    const limit = Math.min(Math.max(parseInt(sp.get('limit') ?? '20', 10) || 20, 1), 100);

    const db = await getDatabase();
    const rows = await db.query<{ id: string }>('SELECT id FROM hospitals WHERE hcode = ?', [
      hcode,
    ]);
    if (rows.length === 0) {
      return NextResponse.json(
        { error: { code: 'NOT_FOUND', message: 'ไม่พบโรงพยาบาล' } },
        { status: 404 },
      );
    }
    const hospitalId = rows[0].id;

    if (onlyLatest) {
      const latest = await getLatestSyncRun(hospitalId);
      return NextResponse.json({ hcode, latest, runs: [] });
    }

    const runs = await listSyncRuns(hospitalId, limit);
    return NextResponse.json({
      hcode,
      latest: runs[0] ?? null,
      runs,
    });
  } catch (error) {
    logger.error('admin_sync_progress_failed', { error });
    return NextResponse.json(
      {
        error: {
          code: 'INTERNAL_ERROR',
          message: 'ไม่สามารถอ่านประวัติ sync ได้',
        },
      },
      { status: 500 },
    );
  }
}
