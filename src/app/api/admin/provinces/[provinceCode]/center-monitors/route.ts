// GET/POST /api/admin/provinces/[provinceCode]/center-monitors
//
// Province-scoped MOPH center-monitor recipients (codex UI-placement rec: a
// dedicated MOPH Alerts tab, province = scope). Mirrors the consult-doctors
// route pattern (src/app/api/admin/hospitals/[hcode]/consult-doctors/route.ts)
// but scoped to provinceCode instead of hcode. Admin-gated via requireAdmin.
import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
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

interface CenterMonitorRow {
  id: string;
  province: string;
  cid: string;
  name: string;
  position: string | null;
  is_active: boolean | number;
  created_at: string;
  updated_at: string;
}

function toMonitor(row: CenterMonitorRow) {
  return {
    id: row.id,
    province: row.province,
    cid: row.cid,
    name: row.name,
    position: row.position,
    isActive: Boolean(row.is_active),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
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

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ provinceCode: string }> },
) {
  try {
    const guard = await requireAdmin();
    if (guard instanceof NextResponse) return guard;

    await ensureInit();
    const { provinceCode } = await params;
    const db = await getDatabase();
    const monitors = await db.query<CenterMonitorRow>(
      `SELECT id, province, cid, name, position, is_active, created_at, updated_at
       FROM moph_center_monitors
       WHERE province = ?
       ORDER BY is_active DESC, name, created_at`,
      [provinceCode],
    );

    return NextResponse.json({ monitors: monitors.map(toMonitor) });
  } catch (error) {
    logger.error('admin_center_monitors_list_failed', { error });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ provinceCode: string }> },
) {
  try {
    const guard = await requireAdmin();
    if (guard instanceof NextResponse) return guard;

    await ensureInit();
    const { provinceCode } = await params;
    const normalized = normalizePayload((await request.json()) as MonitorPayload);
    if ('error' in normalized) {
      return NextResponse.json({ error: normalized.error }, { status: 400 });
    }

    const db = await getDatabase();
    const duplicate = await db.query<{ id: string }>(
      `SELECT id FROM moph_center_monitors WHERE province = ? AND cid = ?`,
      [provinceCode, normalized.value.cid],
    );
    if (duplicate.length > 0) {
      return NextResponse.json(
        { error: 'center monitor with this cid already exists for this province' },
        { status: 409 },
      );
    }

    const now = new Date().toISOString();
    const id = uuidv4();
    await db.execute(
      `INSERT INTO moph_center_monitors
        (id, province, cid, name, position, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        provinceCode,
        normalized.value.cid,
        normalized.value.name,
        normalized.value.position,
        normalized.value.isActive,
        now,
        now,
      ],
    );

    return NextResponse.json(
      {
        monitor: {
          id,
          province: provinceCode,
          ...normalized.value,
          createdAt: now,
          updatedAt: now,
        },
      },
      { status: 201 },
    );
  } catch (error) {
    logger.error('admin_center_monitors_create_failed', { error });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
