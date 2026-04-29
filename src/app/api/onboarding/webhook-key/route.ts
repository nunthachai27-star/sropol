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
import { v4 as uuidv4 } from 'uuid';
import { auth } from '@/lib/auth';
import { getDatabase } from '@/db/connection';
import { ensureInit } from '@/lib/ensure-init';
import { createApiKey } from '@/services/webhook';
import { EXEMPT_HCODES } from '@/lib/hospital-access-guard';
import { HospitalLevel, HospitalServiceType } from '@/types/domain';
import { logger } from '@/lib/logger';

interface Body {
  /** Optional override label — defaults to "HOSxP auto-provisioned". */
  label?: string;
}

// Display names for the system-reserved hcodes that bypass the registry
// gate (see hospital-access-guard.EXEMPT_HCODES). Auto-registered on first
// onboarding so the webhook-key flow doesn't 404 on these well-known codes.
const EXEMPT_HOSPITAL_DEFAULTS: Record<string, { name: string }> = {
  '00000': { name: 'System (00000)' },
  '99999': { name: 'Provincial Admin (99999)' },
};

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
    let hospital: { id: string; name: string };
    if (rows.length === 0) {
      // EXEMPT hcodes (00000 / 99999) are system/admin sandboxes that bypass
      // the login registry gate. They aren't seeded by HospitalSeeder and
      // wouldn't appear in the MoPH master picker in /admin, so without
      // auto-registration here the webhook-key flow 404s and the HOSxP
      // webhook_setting push fails. Auto-create a minimal active row on
      // first onboarding so subsequent runs hit the normal "row exists" path.
      if (!EXEMPT_HCODES.has(hcode)) {
        return NextResponse.json(
          { error: `hospital ${hcode} not registered — ask admin to add it first` },
          { status: 404 },
        );
      }
      const defaults = EXEMPT_HOSPITAL_DEFAULTS[hcode] ?? { name: `Exempt (${hcode})` };
      const newId = uuidv4();
      const now = new Date().toISOString();
      await db.execute(
        `INSERT INTO hospitals (id, hcode, name, level, service_type, is_active,
          connection_status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          newId,
          hcode,
          defaults.name,
          HospitalLevel.F2,
          HospitalServiceType.DISTRICT_NO_MATERNITY,
          true,
          'UNKNOWN',
          now,
          now,
        ],
      );
      logger.warn('onboarding_exempt_hospital_auto_registered', {
        hcode,
        name: defaults.name,
      });
      hospital = { id: newId, name: defaults.name };
    } else {
      hospital = rows[0];
    }

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
