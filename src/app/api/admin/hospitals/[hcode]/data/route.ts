// DELETE /api/admin/hospitals/[hcode]/data — purge cached clinical /
// operational data for a single hospital so it can be re-onboarded clean.
//
// Wipes:  cpd_scores, cached_vital_signs, cached_partograph_observations,
//         cached_anc_visits, cached_anc_risks, cached_newborns,
//         cached_referrals (any side), cached_patients, maternal_journeys
//         (where hospital_id or current_hospital_id matches).
// Keeps:  hospitals row, hospital_bms_config, hospital_consult_doctors,
//         webhook_api_keys, audit_logs.
//
// Also stops any in-flight onboarding HOSxP sync job and resets the
// hospital's connection_status / last_sync_at so the dashboard shows
// "not yet synced" instead of stale numbers.
//
// Admin-gated via middleware (/api/admin/* requires role=ADMIN +
// ADMIN_ALLOWED_CIDS); body must echo back the hcode as a typed
// confirmation token (defense-in-depth against accidental DELETE).
import { NextResponse, type NextRequest } from 'next/server';
import { getDatabase } from '@/db/connection';
import { ensureInit } from '@/lib/ensure-init';
import { requireAdmin } from '@/lib/admin-guard';
import { logger } from '@/lib/logger';
import { stopOnboardingHosxpSync } from '@/services/sync/onboarding-session';

interface DeleteBody {
  confirmHcode?: unknown;
}

const COUNT_QUERIES: Array<{ key: string; sql: string; placeholders: 1 | 2 | 3 }> = [
  {
    key: 'cpd_scores',
    placeholders: 1,
    sql: `SELECT COUNT(*) AS cnt FROM cpd_scores
        WHERE patient_id IN (SELECT id FROM cached_patients WHERE hospital_id = ?)`,
  },
  {
    key: 'cached_vital_signs',
    placeholders: 1,
    sql: `SELECT COUNT(*) AS cnt FROM cached_vital_signs
        WHERE patient_id IN (SELECT id FROM cached_patients WHERE hospital_id = ?)`,
  },
  {
    key: 'cached_partograph_observations',
    placeholders: 1,
    sql: 'SELECT COUNT(*) AS cnt FROM cached_partograph_observations WHERE hospital_id = ?',
  },
  {
    key: 'cached_anc_visits',
    placeholders: 3,
    sql: `SELECT COUNT(*) AS cnt FROM cached_anc_visits
        WHERE hospital_id = ?
           OR journey_id IN (SELECT id FROM maternal_journeys
                              WHERE hospital_id = ? OR current_hospital_id = ?)`,
  },
  {
    key: 'cached_anc_risks',
    placeholders: 2,
    sql: `SELECT COUNT(*) AS cnt FROM cached_anc_risks
        WHERE journey_id IN (SELECT id FROM maternal_journeys
                              WHERE hospital_id = ? OR current_hospital_id = ?)`,
  },
  {
    key: 'cached_newborns',
    placeholders: 2,
    sql: `SELECT COUNT(*) AS cnt FROM cached_newborns
        WHERE journey_id IN (SELECT id FROM maternal_journeys
                              WHERE hospital_id = ? OR current_hospital_id = ?)`,
  },
  {
    key: 'cached_referrals',
    placeholders: 2,
    sql: 'SELECT COUNT(*) AS cnt FROM cached_referrals WHERE from_hospital_id = ? OR to_hospital_id = ?',
  },
  {
    key: 'cached_patients',
    placeholders: 1,
    sql: 'SELECT COUNT(*) AS cnt FROM cached_patients WHERE hospital_id = ?',
  },
  {
    key: 'maternal_journeys',
    placeholders: 2,
    sql: 'SELECT COUNT(*) AS cnt FROM maternal_journeys WHERE hospital_id = ? OR current_hospital_id = ?',
  },
];

async function readCounts(
  db: Awaited<ReturnType<typeof getDatabase>>,
  hospitalId: string,
): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const q of COUNT_QUERIES) {
    const params = Array.from({ length: q.placeholders }, () => hospitalId);
    const rs = await db.query<{ cnt: number | string }>(q.sql, params);
    const raw = rs[0]?.cnt ?? 0;
    counts[q.key] = typeof raw === 'string' ? Number(raw) : raw;
  }
  return counts;
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ hcode: string }> },
) {
  try {
    const guard = await requireAdmin();
    if (guard instanceof NextResponse) return guard;

    await ensureInit();
    const { hcode } = await params;
    const db = await getDatabase();
    const rows = await db.query<{ id: string }>('SELECT id FROM hospitals WHERE hcode = ?', [
      hcode,
    ]);
    if (rows.length === 0) {
      return NextResponse.json({ error: 'hospital_not_found' }, { status: 404 });
    }
    const hospitalId = rows[0].id;
    const counts = await readCounts(db, hospitalId);
    const totalRows = Object.values(counts).reduce((a, b) => a + b, 0);
    return NextResponse.json({ ok: true, hcode, hospitalId, counts, totalRows });
  } catch (error) {
    logger.error('admin_hospital_data_count_failed', { error });
    return NextResponse.json(
      {
        error: 'failed_to_count_hospital_data',
        detail: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ hcode: string }> },
) {
  try {
    const guard = await requireAdmin();
    if (guard instanceof NextResponse) return guard;

    await ensureInit();
    const { hcode } = await params;

    const body = (await request.json().catch(() => ({}))) as DeleteBody;
    const confirm = typeof body.confirmHcode === 'string' ? body.confirmHcode.trim() : '';
    if (confirm !== hcode) {
      return NextResponse.json(
        {
          error: 'confirmation_mismatch',
          detail: 'Request body must contain { confirmHcode: "<hcode>" } matching the URL hcode',
        },
        { status: 400 },
      );
    }

    const db = await getDatabase();
    const rows = await db.query<{ id: string }>('SELECT id FROM hospitals WHERE hcode = ?', [
      hcode,
    ]);
    if (rows.length === 0) {
      return NextResponse.json({ error: 'hospital_not_found' }, { status: 404 });
    }
    const hospitalId = rows[0].id;

    // Stop any in-flight onboarding sync so it can't write rows back into
    // tables we're about to wipe. Best-effort — returns false when no job
    // is running.
    const stopped = stopOnboardingHosxpSync(hospitalId);

    // Snapshot counts BEFORE delete so the response can show what was wiped.
    const counts = await readCounts(db, hospitalId);

    // Run deletes in FK-safe order — children first, then parents.
    await db.execute(
      `DELETE FROM cpd_scores
        WHERE patient_id IN (SELECT id FROM cached_patients WHERE hospital_id = ?)`,
      [hospitalId],
    );
    await db.execute(
      `DELETE FROM cached_vital_signs
        WHERE patient_id IN (SELECT id FROM cached_patients WHERE hospital_id = ?)`,
      [hospitalId],
    );
    await db.execute('DELETE FROM cached_partograph_observations WHERE hospital_id = ?', [
      hospitalId,
    ]);
    await db.execute(
      `DELETE FROM cached_anc_visits
        WHERE hospital_id = ?
           OR journey_id IN (SELECT id FROM maternal_journeys
                              WHERE hospital_id = ? OR current_hospital_id = ?)`,
      [hospitalId, hospitalId, hospitalId],
    );
    await db.execute(
      `DELETE FROM cached_anc_risks
        WHERE journey_id IN (SELECT id FROM maternal_journeys
                              WHERE hospital_id = ? OR current_hospital_id = ?)`,
      [hospitalId, hospitalId],
    );
    await db.execute(
      `DELETE FROM cached_newborns
        WHERE journey_id IN (SELECT id FROM maternal_journeys
                              WHERE hospital_id = ? OR current_hospital_id = ?)`,
      [hospitalId, hospitalId],
    );
    await db.execute(
      'DELETE FROM cached_referrals WHERE from_hospital_id = ? OR to_hospital_id = ?',
      [hospitalId, hospitalId],
    );
    // cached_patients references maternal_journeys.id, so it must go before
    // maternal_journeys to satisfy the FK.
    await db.execute('DELETE FROM cached_patients WHERE hospital_id = ?', [hospitalId]);
    await db.execute(
      'DELETE FROM maternal_journeys WHERE hospital_id = ? OR current_hospital_id = ?',
      [hospitalId, hospitalId],
    );

    // Reset header so the dashboard shows "not yet synced" instead of stale
    // last-sync timestamps that no longer correspond to any cached rows.
    const purgedAt = new Date().toISOString();
    await db.execute(
      `UPDATE hospitals
          SET connection_status = 'UNKNOWN',
              last_sync_at = NULL,
              updated_at = ?
        WHERE id = ?`,
      [purgedAt, hospitalId],
    );

    // Block every sync path from re-ingesting until an admin explicitly
    // re-onboards the hospital. Without this, the user's open admin tab
    // (running useOnboardHosxpSync) reposts to /api/onboarding/hosxp-sync
    // every 30s and the data we just deleted reappears within seconds.
    // Also blank session_jwt so any cached server session is forced to
    // re-validate via a fresh onboarding flow, not a heartbeat tick.
    await db.execute(
      `UPDATE hospital_bms_config
          SET data_purged_at = ?, session_jwt = NULL,
              session_expires_at = NULL,
              last_authenticity_status = 'purged_pending_reonboard',
              last_authenticity_reason = 'admin purged hospital data — sync suspended until re-onboarding',
              last_authenticity_check_at = ?,
              updated_at = ?
        WHERE hospital_id = ?`,
      [purgedAt, purgedAt, purgedAt, hospitalId],
    );

    const totalRowsDeleted = Object.values(counts).reduce((a, b) => a + b, 0);

    logger.info('admin_hospital_data_purged', {
      hcode,
      hospitalId,
      stoppedSync: stopped,
      counts,
      totalRowsDeleted,
    });

    return NextResponse.json({
      ok: true,
      hcode,
      hospitalId,
      stoppedSync: stopped,
      counts,
      totalRowsDeleted,
    });
  } catch (error) {
    logger.error('admin_hospital_data_purge_failed', { error });
    return NextResponse.json(
      {
        error: 'failed_to_purge_hospital_data',
        detail: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}
