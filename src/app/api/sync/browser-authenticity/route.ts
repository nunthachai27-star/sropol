// POST /api/sync/browser-authenticity — receives the verdict of the
// browser-side name round-trip authenticity probe and persists it onto
// hospital_bms_config so the admin Sync Status tab and the dashboard /
// admin map both surface the BLOCKED state.
//
// This endpoint exists because the probe itself MUST run inside the
// user's tab (only the local 127.0.0.1:45011 gateway can re-query HOSxP
// reliably), but the verdict needs to live server-side so:
//   - the dashboard syncStatus derivation in services/dashboard.ts can
//     surface the BLOCKED badge even for tabs that aren't currently open,
//   - admins can review the failure reason on /admin → Sync Status,
//   - the existing isSyncFailureStatus() / SYNC_FAILURE_STATUSES wiring
//     in src/config/sync-status.ts picks it up uniformly.
//
// Auth model is the same as /api/sync/browser-push: NextAuth session,
// hospital is derived from the session (never the body), and read-only
// sessions are rejected.
import { NextResponse, type NextRequest } from 'next/server';
import { getDatabase } from '@/db/connection';
import { ensureInit } from '@/lib/ensure-init';
import { auth } from '@/lib/auth';
import { logger } from '@/lib/logger';
import {
  recordAuthenticityVerdict,
  type AuthenticityVerdict,
} from '@/services/sync/polling';

interface VerdictBody {
  status?: AuthenticityVerdict | string;
  reason?: string | null;
}

// Whitelist the verdicts the browser is allowed to report. The full
// AuthenticityVerdict union includes server-only statuses (e.g.
// missing_marketplace_token, cid_invalid_checksum) that don't apply to a
// browser-side name probe — reject those so a client can't spoof an
// arbitrary blocking verdict.
const ALLOWED_VERDICTS: ReadonlySet<AuthenticityVerdict> = new Set<AuthenticityVerdict>([
  'authentic',
  'name_unstable',
  'no_data',
]);

export async function POST(request: NextRequest) {
  try {
    await ensureInit();

    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (session.user.accessMode === 'readonly') {
      return NextResponse.json(
        { error: 'readonly_session_cannot_push' },
        { status: 403 },
      );
    }
    const hcode = session.user.hospitalCode ?? null;
    if (!hcode) {
      return NextResponse.json(
        { error: 'no_hospital_code_in_session' },
        { status: 400 },
      );
    }

    const body = (await request.json().catch(() => null)) as VerdictBody | null;
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
    }
    if (!body.status || !ALLOWED_VERDICTS.has(body.status as AuthenticityVerdict)) {
      return NextResponse.json(
        { error: 'unsupported_status', allowed: [...ALLOWED_VERDICTS] },
        { status: 400 },
      );
    }
    const reason =
      typeof body.reason === 'string' && body.reason.length > 0
        ? body.reason.slice(0, 500)
        : null;

    const db = await getDatabase();
    const rows = await db.query<{ id: string; is_active: boolean | number }>(
      'SELECT id, is_active FROM hospitals WHERE hcode = ?',
      [hcode],
    );
    if (rows.length === 0) {
      return NextResponse.json(
        { error: 'hospital_not_registered', hcode },
        { status: 403 },
      );
    }
    if (rows[0].is_active !== true && rows[0].is_active !== 1) {
      return NextResponse.json(
        { error: 'hospital_inactive', hcode },
        { status: 403 },
      );
    }
    const hospitalId = rows[0].id;

    await recordAuthenticityVerdict(
      db,
      hospitalId,
      body.status as AuthenticityVerdict,
      reason,
    );
    logger.info('browser_authenticity_verdict_recorded', {
      hcode,
      hospitalId,
      status: body.status,
      reason,
    });

    return NextResponse.json({ success: true, hcode, status: body.status });
  } catch (error) {
    logger.error('browser_authenticity_failed', { error });
    return NextResponse.json({ error: 'internal_error' }, { status: 500 });
  }
}
