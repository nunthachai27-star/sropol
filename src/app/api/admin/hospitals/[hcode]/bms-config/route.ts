// T094: PUT /api/admin/hospitals/[hcode]/bms-config — save BMS tunnel config
import { NextRequest, NextResponse } from 'next/server';
import { getDatabase } from '@/db/connection';
import { ensureInit } from '@/lib/ensure-init';
import { requireAdmin } from '@/lib/admin-guard';
import { BmsSessionClient } from '@/lib/bms-session';
import { v4 as uuidv4 } from 'uuid';
import { logger } from '@/lib/logger';

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ hcode: string }> },
) {
  try {
    const guard = await requireAdmin();
    if (guard instanceof NextResponse) return guard;

    await ensureInit();
    const { hcode } = await params;
    const body = await request.json();
    const { tunnelUrl } = body;

    if (!tunnelUrl) {
      return NextResponse.json({ error: 'Tunnel URL is required' }, { status: 400 });
    }

    // Validate URL format
    try {
      new URL(tunnelUrl);
    } catch {
      return NextResponse.json({ error: 'Invalid URL format' }, { status: 400 });
    }

    const db = await getDatabase();

    // Get hospital ID
    const hospitals = await db.query<{ id: string }>('SELECT id FROM hospitals WHERE hcode = ?', [
      hcode,
    ]);

    if (hospitals.length === 0) {
      return NextResponse.json({ error: 'Hospital not found' }, { status: 404 });
    }

    const hospitalId = hospitals[0].id;
    const now = new Date().toISOString();

    // Try to validate the session
    let sessionValidated = false;
    let databaseType: string | null = null;
    let sessionJwt: string | null = null;
    let sessionExpiresAt: string | null = null;

    try {
      const client = new BmsSessionClient(tunnelUrl);
      const sessionId = await client.getSessionId();
      const validateUrl = process.env.BMS_VALIDATE_URL ?? 'https://hosxp.net/phapi/PasteJSON';
      const config = await client.validateSession(sessionId, validateUrl);
      sessionJwt = config.jwt;
      sessionExpiresAt = config.expiresAt.toISOString();
      databaseType = await client.getDatabaseType(config.bmsUrl, config.jwt);
      sessionValidated = true;
    } catch {
      // Session validation failed — still save the URL
    }

    // Upsert BMS config
    const existing = await db.query<{ id: string; database_type: string | null }>(
      'SELECT id, database_type FROM hospital_bms_config WHERE hospital_id = ?',
      [hospitalId],
    );

    // getDatabaseType returns null when detection fails (or was skipped
    // because session validation itself failed). Keep whatever dialect was
    // already persisted rather than overwriting a working value with null —
    // same guard applied to the other getDatabaseType call sites (C5).
    if (!databaseType && existing.length > 0) {
      databaseType = existing[0].database_type;
    }

    if (existing.length > 0) {
      await db.execute(
        `UPDATE hospital_bms_config SET tunnel_url = ?, session_jwt = ?, session_expires_at = ?, database_type = ?, updated_at = ? WHERE hospital_id = ?`,
        [tunnelUrl, sessionJwt, sessionExpiresAt, databaseType, now, hospitalId],
      );
    } else {
      await db.execute(
        `INSERT INTO hospital_bms_config (id, hospital_id, tunnel_url, session_jwt, session_expires_at, database_type, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [uuidv4(), hospitalId, tunnelUrl, sessionJwt, sessionExpiresAt, databaseType, now, now],
      );
    }

    return NextResponse.json({
      status: 'saved',
      sessionValidated,
      databaseType,
    });
  } catch (error) {
    logger.error('bms_config_update_failed', { error });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
