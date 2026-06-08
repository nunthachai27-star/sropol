// POST /api/admin/hospitals/[hcode]/clear-purge — admin-only, clears the
// data_purged_at + last_authenticity_status flags so the next user from
// that hospital opening / can re-trigger an onboarding sync with their
// own marketplace_token. The actual sync still requires real HOSxP
// credentials — this endpoint just removes the server-side block.
//
// Why a separate endpoint instead of letting /admin POST to
// /api/onboarding/hosxp-sync with confirmReonboard=true: the admin's
// browser only carries credentials for THEIR own hospital. A
// province-level admin viewing a purged remote hospital can't supply
// the correct apiUrl / bearerToken / marketplaceToken for that other
// hospital, so the standard onboarding endpoint would 400. This flag-
// only clear lets the admin unblock from anywhere; the real sync
// happens server-side on the next cycle once a user from the affected
// hospital opens KK-LRMS.
//
// Admin-gated by middleware (/api/admin/* requires role=ADMIN +
// ADMIN_ALLOWED_CIDS).
import { NextResponse, type NextRequest } from 'next/server';
import { getDatabase } from '@/db/connection';
import { ensureInit } from '@/lib/ensure-init';
import { logger } from '@/lib/logger';

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ hcode: string }> },
) {
  try {
    await ensureInit();
    const { hcode } = await params;
    const db = await getDatabase();

    const hospitalRows = await db.query<{ id: string }>(
      'SELECT id FROM hospitals WHERE hcode = ?',
      [hcode],
    );
    if (hospitalRows.length === 0) {
      return NextResponse.json({ error: 'hospital_not_found' }, { status: 404 });
    }
    const hospitalId = hospitalRows[0].id;

    const now = new Date().toISOString();
    await db.execute(
      `UPDATE hospital_bms_config
          SET data_purged_at = NULL,
              last_authenticity_status = NULL,
              last_authenticity_reason = NULL,
              last_authenticity_check_at = NULL,
              updated_at = ?
        WHERE hospital_id = ?`,
      [now, hospitalId],
    );

    logger.info('admin_hospital_sync_block_cleared', { hcode, hospitalId });

    return NextResponse.json({
      ok: true,
      hcode,
      hospitalId,
      message:
        'Sync block cleared. The next time a user from this hospital opens SR-LRMS, the onboarding sync will run and re-ingest data with their marketplace_token.',
    });
  } catch (error) {
    logger.error('admin_hospital_clear_purge_failed', { error });
    return NextResponse.json(
      {
        error: 'failed_to_clear_purge',
        detail: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}
