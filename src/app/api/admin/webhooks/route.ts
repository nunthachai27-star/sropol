// GET /api/admin/webhooks — list all API keys
// POST /api/admin/webhooks — generate new API key for a hospital
import { NextRequest, NextResponse } from 'next/server';
import { getDatabase } from '@/db/connection';
import { ensureInit } from '@/lib/ensure-init';
import { requireAdmin } from '@/lib/admin-guard';
import { createApiKey, listApiKeys } from '@/services/webhook';
import { logger } from '@/lib/logger';

export async function GET() {
  try {
    const guard = await requireAdmin();
    if (guard instanceof NextResponse) return guard;

    await ensureInit();
    const db = await getDatabase();

    const keys = await listApiKeys(db);

    return NextResponse.json({
      keys: keys.map((k) => ({
        id: k.id,
        hospitalId: k.hospitalId,
        hcode: k.hcode,
        hospitalName: k.hospitalName,
        keyPrefix: k.keyPrefix,
        label: k.label,
        isActive: k.isActive,
        lastUsedAt: k.lastUsedAt,
        createdAt: k.createdAt,
        revokedAt: k.revokedAt,
      })),
    });
  } catch (error) {
    logger.error('admin_webhooks_list_failed', { error });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const guard = await requireAdmin();
    if (guard instanceof NextResponse) return guard;

    await ensureInit();
    const db = await getDatabase();

    const body = await request.json().catch(() => null);
    if (!body || !body.hcode || !body.label) {
      return NextResponse.json(
        { error: 'Required fields: hcode (string), label (string)' },
        { status: 400 },
      );
    }

    // Look up hospital by hcode
    const hospitals = await db.query<{ id: string; name: string }>(
      'SELECT id, name FROM hospitals WHERE hcode = ?',
      [body.hcode],
    );

    if (hospitals.length === 0) {
      return NextResponse.json(
        { error: `Hospital with hcode "${body.hcode}" not found. Register the hospital first.` },
        { status: 404 },
      );
    }

    const hospitalId = hospitals[0].id;
    const result = await createApiKey(db, hospitalId, body.label);

    return NextResponse.json(
      {
        id: result.id,
        apiKey: result.rawKey,
        keyPrefix: result.keyPrefix,
        hospitalName: hospitals[0].name,
        hcode: body.hcode,
        label: body.label,
        message: 'API key created. Save this key — it will not be shown again.',
      },
      { status: 201 },
    );
  } catch (error) {
    logger.error('admin_webhooks_create_failed', { error });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
