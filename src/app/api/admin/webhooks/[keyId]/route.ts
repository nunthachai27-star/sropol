// DELETE /api/admin/webhooks/[keyId] — revoke an API key
import { NextRequest, NextResponse } from 'next/server';
import { getDatabase } from '@/db/connection';
import { ensureInit } from '@/lib/ensure-init';
import { requireAdmin } from '@/lib/admin-guard';
import { revokeApiKey } from '@/services/webhook';
import { logger } from '@/lib/logger';

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ keyId: string }> },
) {
  try {
    const guard = await requireAdmin();
    if (guard instanceof NextResponse) return guard;

    await ensureInit();
    const db = await getDatabase();
    const { keyId } = await params;

    // Verify key exists
    const existing = await db.query<{ id: string }>(
      'SELECT id FROM webhook_api_keys WHERE id = ?',
      [keyId],
    );

    if (existing.length === 0) {
      return NextResponse.json({ error: 'API key not found' }, { status: 404 });
    }

    await revokeApiKey(db, keyId);

    return NextResponse.json({
      success: true,
      message: 'API key revoked',
    });
  } catch (error) {
    logger.error('admin_webhooks_revoke_failed', { error });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
