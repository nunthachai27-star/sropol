// PUT/DELETE /api/admin/provinces/[provinceCode]/center-monitors/[monitorId]
//
// Edit / soft-delete a single province center-monitor recipient. Mirrors the
// consult-doctors item route (src/app/api/admin/hospitals/[hcode]/consult-
// doctors/[doctorId]/route.ts) but province-scoped. DELETE soft-deletes
// (is_active=false) to preserve alert-log FK integrity. Admin-gated.
import { NextRequest, NextResponse } from 'next/server';
import { getDatabase } from '@/db/connection';
import { ensureInit } from '@/lib/ensure-init';
import { requireAdmin } from '@/lib/admin-guard';
import { logger } from '@/lib/logger';

interface MonitorPayload {
  cid?: string;
  name?: string;
  position?: string | null;
  isActive?: boolean;
}

function normalizePayload(body: MonitorPayload) {
  const cid = body.cid?.trim() ?? '';
  const name = body.name?.trim() ?? '';
  const position = body.position?.trim() || null;

  if (!/^\d{13}$/.test(cid)) {
    return { error: 'cid must be a 13-digit number' };
  }
  if (!name) {
    return { error: 'name is required' };
  }

  return { value: { cid, name, position, isActive: body.isActive ?? true } };
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ provinceCode: string; monitorId: string }> },
) {
  try {
    const guard = await requireAdmin();
    if (guard instanceof NextResponse) return guard;

    await ensureInit();
    const { provinceCode, monitorId } = await params;
    const normalized = normalizePayload((await request.json()) as MonitorPayload);
    if ('error' in normalized) {
      return NextResponse.json({ error: normalized.error }, { status: 400 });
    }

    const db = await getDatabase();
    const existing = await db.query<{ id: string }>(
      `SELECT id FROM moph_center_monitors WHERE id = ? AND province = ?`,
      [monitorId, provinceCode],
    );
    if (existing.length === 0) {
      return NextResponse.json({ error: 'center monitor not found' }, { status: 404 });
    }

    const duplicate = await db.query<{ id: string }>(
      `SELECT id FROM moph_center_monitors
       WHERE province = ? AND cid = ? AND id <> ?`,
      [provinceCode, normalized.value.cid, monitorId],
    );
    if (duplicate.length > 0) {
      return NextResponse.json(
        { error: 'center monitor with this cid already exists for this province' },
        { status: 409 },
      );
    }

    const now = new Date().toISOString();
    await db.execute(
      `UPDATE moph_center_monitors
       SET cid = ?, name = ?, position = ?, is_active = ?, updated_at = ?
       WHERE id = ? AND province = ?`,
      [
        normalized.value.cid,
        normalized.value.name,
        normalized.value.position,
        normalized.value.isActive,
        now,
        monitorId,
        provinceCode,
      ],
    );

    return NextResponse.json({
      monitor: {
        id: monitorId,
        province: provinceCode,
        ...normalized.value,
        updatedAt: now,
      },
    });
  } catch (error) {
    logger.error('admin_center_monitor_update_failed', { error });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ provinceCode: string; monitorId: string }> },
) {
  try {
    const guard = await requireAdmin();
    if (guard instanceof NextResponse) return guard;

    await ensureInit();
    const { provinceCode, monitorId } = await params;
    const db = await getDatabase();
    const existing = await db.query<{ id: string }>(
      `SELECT id FROM moph_center_monitors WHERE id = ? AND province = ?`,
      [monitorId, provinceCode],
    );
    if (existing.length === 0) {
      return NextResponse.json({ error: 'center monitor not found' }, { status: 404 });
    }

    // Soft-delete (is_active=false) to preserve moph_alert_log FK/referential
    // integrity — a historical alert row's recipient should remain resolvable.
    await db.execute(
      `UPDATE moph_center_monitors SET is_active = ?, updated_at = ? WHERE id = ? AND province = ?`,
      [false, new Date().toISOString(), monitorId, provinceCode],
    );

    return NextResponse.json({ id: monitorId, deleted: true });
  } catch (error) {
    logger.error('admin_center_monitor_delete_failed', { error });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
