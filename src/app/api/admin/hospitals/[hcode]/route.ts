// PUT /api/admin/hospitals/[hcode] — update a registered hospital
// DELETE /api/admin/hospitals/[hcode] — deactivate (soft-delete) a hospital
import { NextResponse, type NextRequest } from 'next/server';
import { getDatabase } from '@/db/connection';
import { ensureInit } from '@/lib/ensure-init';
import { requireAdmin } from '@/lib/admin-guard';
import { logger } from '@/lib/logger';
import { HospitalLevel, HospitalServiceType } from '@/types/domain';

const VALID_LEVELS = new Set<string>(Object.values(HospitalLevel));
const VALID_SERVICE_TYPES = new Set<string>(Object.values(HospitalServiceType));

interface UpdateHospitalBody {
  name?: string;
  level?: string;
  serviceType?: string | null;
  provinceCode?: string | null;
  districtCode?: string | null;
  lat?: number | null;
  lon?: number | null;
  isActive?: boolean;
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ hcode: string }> },
) {
  try {
    const guard = await requireAdmin();
    if (guard instanceof NextResponse) return guard;

    await ensureInit();
    const { hcode } = await params;
    const body = (await request.json()) as UpdateHospitalBody;

    if (body.level !== undefined && !VALID_LEVELS.has(body.level)) {
      return NextResponse.json(
        { error: `level must be one of ${[...VALID_LEVELS].join(', ')}` },
        { status: 400 },
      );
    }
    if (
      body.serviceType !== undefined &&
      body.serviceType !== null &&
      !VALID_SERVICE_TYPES.has(body.serviceType)
    ) {
      return NextResponse.json(
        { error: `serviceType must be one of ${[...VALID_SERVICE_TYPES].join(', ')}` },
        { status: 400 },
      );
    }

    const db = await getDatabase();
    const existing = await db.query<{ id: string }>('SELECT id FROM hospitals WHERE hcode = ?', [
      hcode,
    ]);
    if (existing.length === 0) {
      return NextResponse.json({ error: 'hospital not found' }, { status: 404 });
    }

    const updates: string[] = [];
    const vals: unknown[] = [];
    if (body.name !== undefined) {
      updates.push('name = ?');
      vals.push(body.name);
    }
    if (body.level !== undefined) {
      updates.push('level = ?');
      vals.push(body.level);
    }
    if (body.serviceType !== undefined) {
      updates.push('service_type = ?');
      vals.push(body.serviceType);
    }
    if (body.provinceCode !== undefined) {
      updates.push('province_code = ?');
      vals.push(body.provinceCode);
    }
    if (body.districtCode !== undefined) {
      updates.push('district_code = ?');
      vals.push(body.districtCode);
    }
    if (body.lat !== undefined) {
      updates.push('lat = ?');
      vals.push(body.lat);
    }
    if (body.lon !== undefined) {
      updates.push('lon = ?');
      vals.push(body.lon);
    }
    if (body.isActive !== undefined) {
      updates.push('is_active = ?');
      vals.push(body.isActive);
    }
    if (updates.length === 0) {
      return NextResponse.json({ error: 'no fields to update' }, { status: 400 });
    }
    updates.push('updated_at = ?');
    vals.push(new Date().toISOString());
    vals.push(hcode);

    await db.execute(`UPDATE hospitals SET ${updates.join(', ')} WHERE hcode = ?`, vals);

    return NextResponse.json({ hcode, updated: true });
  } catch (error) {
    logger.error('admin_hospital_update_failed', { error });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ hcode: string }> },
) {
  try {
    const guard = await requireAdmin();
    if (guard instanceof NextResponse) return guard;

    await ensureInit();
    const { hcode } = await params;
    const db = await getDatabase();

    const existing = await db.query<{ id: string }>('SELECT id FROM hospitals WHERE hcode = ?', [
      hcode,
    ]);
    if (existing.length === 0) {
      return NextResponse.json({ error: 'hospital not found' }, { status: 404 });
    }

    // Soft-delete — flip is_active=false so cached patient/journey/referral
    // rows that reference this hospital via FK keep their linkage intact.
    // Hard DELETE is blocked by FK constraints from 6 child tables; preserving
    // history matches the file-header intent ("deactivate / soft-delete") and
    // keeps audit trails usable. To resurrect, PUT { isActive: true }.
    await db.execute('UPDATE hospitals SET is_active = ?, updated_at = ? WHERE hcode = ?', [
      false,
      new Date().toISOString(),
      hcode,
    ]);

    return NextResponse.json({ hcode, deactivated: true });
  } catch (error) {
    logger.error('admin_hospital_delete_failed', { error });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
