// POST /api/onboarding/confirm-push
//
// Called by the onboarding hook after a webhook_setting row has been
// successfully INSERTed or UPDATEd on HOSxP. Stamps `pushed_to_hosxp_at` on
// the local webhook_api_keys row so the next reuse-check in
// /api/onboarding/webhook-key can tell confirmed keys from orphans (minted
// locally but never accepted by HOSxP's BMS gateway).
//
// Identifies the key by prefix — prefixes are 8 chars of the raw key, and
// pairs with hospital_id for safety so a stale client can't stamp a sibling
// hospital's row.
import { NextResponse, type NextRequest } from 'next/server';
import { auth } from '@/lib/auth';
import { getDatabase } from '@/db/connection';
import { ensureInit } from '@/lib/ensure-init';
import { logger } from '@/lib/logger';

interface Body {
  keyPrefix?: string;
}

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.hospitalCode) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }
  const hcode = session.user.hospitalCode;

  const body = (await request.json().catch(() => ({}))) as Body;
  const keyPrefix = typeof body.keyPrefix === 'string' ? body.keyPrefix.trim() : '';
  if (!keyPrefix) {
    return NextResponse.json({ error: 'keyPrefix required' }, { status: 400 });
  }

  try {
    await ensureInit();
    const db = await getDatabase();

    const hRows = await db.query<{ id: string }>(
      'SELECT id FROM hospitals WHERE hcode = ?',
      [hcode],
    );
    if (hRows.length === 0) {
      return NextResponse.json({ error: 'hospital not found' }, { status: 404 });
    }

    const now = new Date().toISOString();
    await db.execute(
      `UPDATE webhook_api_keys
          SET pushed_to_hosxp_at = ?
        WHERE hospital_id = ?
          AND key_prefix = ?
          AND is_active = true`,
      [now, hRows[0].id, keyPrefix],
    );

    logger.info('onboarding_webhook_key_confirmed', { hcode, keyPrefix });
    return NextResponse.json({ ok: true });
  } catch (error) {
    logger.error('onboarding_confirm_push_failed', { hcode, keyPrefix, error });
    return NextResponse.json({ error: 'confirm failed' }, { status: 500 });
  }
}
