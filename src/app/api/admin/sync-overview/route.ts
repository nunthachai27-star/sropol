// GET /api/admin/sync-overview — province-wide snapshot of every hospital's
// latest sync run. Joins the operational `hospitals` table with the
// per-hospital "latest run" pointer the polling pipeline writes to Redis
// via progress-store.ts. One row per active hospital, even if it's never
// been polled (so admins can see "still NEVER_SYNCED" hospitals too).
//
// Admin-gated by both the Edge middleware and the handler-level requireAdmin().
import { NextResponse } from 'next/server';
import { getDatabase } from '@/db/connection';
import { ensureInit } from '@/lib/ensure-init';
import { requireAdmin } from '@/lib/admin-guard';
import { logger } from '@/lib/logger';
import { getLatestSyncRun, type SyncProgressRun } from '@/services/sync/progress-store';
import { isSyncFailureStatus } from '@/config/sync-status';

interface HospitalRow {
  id: string;
  hcode: string;
  name: string;
  level: string;
  is_active: boolean;
  connection_status: string;
  last_sync_at: string | null;
  last_authenticity_status: string | null;
  last_authenticity_reason: string | null;
  last_authenticity_check_at: string | null;
  data_purged_at: string | null;
  has_bms_config: boolean | number | null;
}

export interface SyncOverviewEntry {
  hcode: string;
  name: string;
  level: string;
  isActive: boolean;
  connectionStatus: string;
  lastSyncAt: string | null;
  // Authenticity verdict from hospital_bms_config — orthogonal to run
  // outcome. A hospital can have its latest run = success but its
  // authenticity = blocked (e.g. operator hasn't reonboarded yet, run
  // was the failed attempt that wrote the verdict).
  authenticity: {
    status: string | null;
    reason: string | null;
    checkedAt: string | null;
    isFailure: boolean;
  };
  dataPurgedAt: string | null;
  hasBmsConfig: boolean;
  latestRun: SyncProgressRun | null;
}

export async function GET() {
  try {
    const guard = await requireAdmin();
    if (guard instanceof NextResponse) return guard;

    await ensureInit();
    const db = await getDatabase();

    const rows = await db.query<HospitalRow>(
      `SELECT h.id, h.hcode, h.name, h.level, h.is_active,
              h.connection_status, h.last_sync_at,
              hbc.last_authenticity_status, hbc.last_authenticity_reason,
              hbc.last_authenticity_check_at, hbc.data_purged_at,
              CASE WHEN hbc.id IS NULL THEN false ELSE true END AS has_bms_config
       FROM hospitals h
       LEFT JOIN hospital_bms_config hbc ON hbc.hospital_id = h.id
       WHERE h.is_active = true
       ORDER BY h.name`,
    );

    // Fetch latest run for each hospital in parallel — Redis SET-GET is
    // ~1 ms each, 26 hospitals = ~30 ms total. Sequential would be ~30 ms
    // anyway because cacheGetJson awaits a single op, but parallel is
    // future-proof for larger provinces.
    const entries: SyncOverviewEntry[] = await Promise.all(
      rows.map(async (h) => {
        const latest = await getLatestSyncRun(h.id);
        return {
          hcode: h.hcode,
          name: h.name,
          level: h.level,
          isActive: h.is_active,
          connectionStatus: h.connection_status,
          lastSyncAt: h.last_sync_at,
          authenticity: {
            status: h.last_authenticity_status,
            reason: h.last_authenticity_reason,
            checkedAt: h.last_authenticity_check_at,
            isFailure: isSyncFailureStatus(h.last_authenticity_status),
          },
          dataPurgedAt: h.data_purged_at,
          hasBmsConfig: h.has_bms_config === true || h.has_bms_config === 1,
          latestRun: latest,
        };
      }),
    );

    return NextResponse.json({
      hospitals: entries,
      total: entries.length,
      updatedAt: new Date().toISOString(),
    });
  } catch (error) {
    logger.error('admin_sync_overview_failed', { error });
    return NextResponse.json({ error: 'failed to load sync overview' }, { status: 500 });
  }
}
