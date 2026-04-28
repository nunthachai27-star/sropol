// POST /api/onboarding/webhook-key
//
// Onboarding companion for the HOSxP webhook_setting auto-provisioner.
// When a user lands on `/` with a marketplace_token the client calls this
// route to mint a KK-LRMS webhook API key for their registered hospital,
// then pushes the key into HOSxP's `webhook_setting` table (module_id=3,
// setting_code='KK-LRMS') via BMS REST. This route does NOT touch HOSxP —
// it only provisions the KK-LRMS side.
//
// The hospital must already exist in the admin `hospitals` table. That's
// enforced upstream by the session guard (hospital-access-guard), but we
// also double-check here so a stale session can't silently fabricate keys.
import { NextResponse, type NextRequest } from 'next/server';
import { auth } from '@/lib/auth';
import { getDatabase } from '@/db/connection';
import { ensureInit } from '@/lib/ensure-init';
import { createApiKey } from '@/services/webhook';
import { logger } from '@/lib/logger';

interface Body {
  /** Optional override label — defaults to "HOSxP auto-provisioned". */
  label?: string;
}

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.hospitalCode) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }
  const hcode = session.user.hospitalCode;

  try {
    await ensureInit();
    const body = (await request.json().catch(() => ({}))) as Body;
    const db = await getDatabase();

    const rows = await db.query<{ id: string; name: string }>(
      'SELECT id, name FROM hospitals WHERE hcode = ?',
      [hcode],
    );
    if (rows.length === 0) {
      return NextResponse.json(
        { error: `hospital ${hcode} not registered — ask admin to add it first` },
        { status: 404 },
      );
    }
    const hospital = rows[0];

    const label = body.label?.trim() || 'HOSxP auto-provisioned';

    // Reuse-if-confirmed: only short-circuit when the hospital already has
    // an active auto-provisioned key that was successfully pushed to HOSxP
    // (`pushed_to_hosxp_at IS NOT NULL`). Unconfirmed keys from a previous
    // failed push are "orphans" — the local row has no raw value we can
    // recover, so the remote side can't be repaired with it. Auto-revoke
    // those so the next mint yields a fresh raw key that can be pushed.
    const activeRows = await db.query<{
      id: string;
      key_prefix: string;
      pushed_to_hosxp_at: string | null;
    }>(
      `SELECT id, key_prefix, pushed_to_hosxp_at FROM webhook_api_keys
        WHERE hospital_id = ?
          AND is_active = true
          AND (label = ? OR label = ?)
        ORDER BY created_at DESC`,
      [hospital.id, 'HOSxP auto-provisioned', 'HOSxP webhook_setting auto-provision'],
    );
    const confirmed = activeRows.find((r) => r.pushed_to_hosxp_at !== null);
    if (confirmed) {
      logger.info('onboarding_webhook_key_reused', {
        hcode,
        keyPrefix: confirmed.key_prefix,
      });
      return NextResponse.json({
        alreadyExists: true,
        id: confirmed.id,
        keyPrefix: confirmed.key_prefix,
        hcode,
        hospitalName: hospital.name,
      });
    }
    const orphans = activeRows.filter((r) => r.pushed_to_hosxp_at === null);
    if (orphans.length > 0) {
      const now = new Date().toISOString();
      for (const o of orphans) {
        await db.execute(
          'UPDATE webhook_api_keys SET is_active = false, revoked_at = ? WHERE id = ?',
          [now, o.id],
        );
      }
      logger.warn('onboarding_webhook_key_orphans_revoked', {
        hcode,
        count: orphans.length,
        keyPrefixes: orphans.map((o) => o.key_prefix),
      });
    }

    const { id, rawKey, keyPrefix } = await createApiKey(db, hospital.id, label);

    logger.info('onboarding_webhook_key_created', {
      hcode,
      keyPrefix,
      label,
    });

    return NextResponse.json({
      alreadyExists: false,
      id,
      apiKey: rawKey,
      keyPrefix,
      label,
      hcode,
      hospitalName: hospital.name,
    });
  } catch (error) {
    logger.error('onboarding_webhook_key_failed', { hcode, error });
    return NextResponse.json({ error: 'failed to create webhook key' }, { status: 500 });
  }
}
