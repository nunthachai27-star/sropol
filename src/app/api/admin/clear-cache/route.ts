// POST /api/admin/clear-cache — clear all cached patient data (demo/stale)
import { NextResponse } from 'next/server';
import { getDatabase } from '@/db/connection';
import { ensureInit } from '@/lib/ensure-init';
import { requireAdmin } from '@/lib/admin-guard';
import { logger } from '@/lib/logger';
import { cacheDelPattern } from '@/lib/cache';

export async function POST() {
  try {
    const guard = await requireAdmin();
    if (guard instanceof NextResponse) return guard;

    await ensureInit();

    const db = await getDatabase();

    // Clear in dependency order (foreign keys)
    const cpdDeleted = await db.query<{ cnt: number }>('SELECT COUNT(*) as cnt FROM cpd_scores');
    await db.execute('DELETE FROM cpd_scores');

    const vitalsDeleted = await db.query<{ cnt: number }>(
      'SELECT COUNT(*) as cnt FROM cached_vital_signs',
    );
    await db.execute('DELETE FROM cached_vital_signs');

    const patientsDeleted = await db.query<{ cnt: number }>(
      'SELECT COUNT(*) as cnt FROM cached_patients',
    );
    await db.execute('DELETE FROM cached_patients');

    // Reset hospital connection statuses to UNKNOWN
    await db.execute("UPDATE hospitals SET connection_status = 'UNKNOWN', last_sync_at = NULL");
    const redisEntriesDeleted = await cacheDelPattern('cache:*');

    return NextResponse.json({
      success: true,
      cleared: {
        cpd_scores: cpdDeleted[0]?.cnt ?? 0,
        cached_vital_signs: vitalsDeleted[0]?.cnt ?? 0,
        cached_patients: patientsDeleted[0]?.cnt ?? 0,
        redis_cache_entries: redisEntriesDeleted,
      },
      message: 'All cached patient data cleared. Hospitals reset to UNKNOWN status.',
    });
  } catch (error) {
    logger.error('clear_cache_failed', { error });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
