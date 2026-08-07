// PUT/DELETE /api/admin/hospitals/[hcode]/consult-doctors/[doctorId]
import { NextRequest, NextResponse } from 'next/server';
import { getDatabase } from '@/db/connection';
import { ensureInit } from '@/lib/ensure-init';
import { requireAdmin } from '@/lib/admin-guard';
import { ensureHospitalConsultDoctorsSchema } from '@/lib/hospital-consult-doctors-schema';
import { logger } from '@/lib/logger';

interface DoctorPayload {
  cid?: string;
  name?: string;
  position?: string | null;
  phoneNumber?: string | null;
}

function normalizePayload(body: DoctorPayload) {
  const cid = body.cid?.trim() ?? '';
  const name = body.name?.trim() ?? '';
  const position = body.position?.trim() || null;
  const phoneNumber = body.phoneNumber?.trim() || null;

  if (!/^\d{13}$/.test(cid)) {
    return { error: 'cid must be a 13-digit number' };
  }
  if (!name) {
    return { error: 'name is required' };
  }

  return { value: { cid, name, position, phoneNumber } };
}

async function getHospitalId(hcode: string) {
  const db = await getDatabase();
  const rows = await db.query<{ id: string }>(
    'SELECT id FROM hospitals WHERE hcode = ? AND is_active = ?',
    [hcode, true],
  );
  return rows[0]?.id ?? null;
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ hcode: string; doctorId: string }> },
) {
  try {
    const guard = await requireAdmin();
    if (guard instanceof NextResponse) return guard;

    await ensureInit();
    await ensureHospitalConsultDoctorsSchema();
    const { hcode, doctorId } = await params;
    const normalized = normalizePayload((await request.json()) as DoctorPayload);
    if ('error' in normalized) {
      return NextResponse.json({ error: normalized.error }, { status: 400 });
    }

    const hospitalId = await getHospitalId(hcode);
    if (!hospitalId) {
      return NextResponse.json({ error: 'hospital not found' }, { status: 404 });
    }

    const db = await getDatabase();
    const existing = await db.query<{ id: string }>(
      `SELECT id FROM hospital_consult_doctors
       WHERE id = ? AND hospital_id = ? AND is_active = ?`,
      [doctorId, hospitalId, true],
    );
    if (existing.length === 0) {
      return NextResponse.json({ error: 'consult doctor not found' }, { status: 404 });
    }

    const duplicate = await db.query<{ id: string }>(
      `SELECT id FROM hospital_consult_doctors
       WHERE hospital_id = ? AND cid = ? AND id <> ? AND is_active = ?`,
      [hospitalId, normalized.value.cid, doctorId, true],
    );
    if (duplicate.length > 0) {
      return NextResponse.json(
        { error: 'consult doctor cid already exists for this hospital' },
        { status: 409 },
      );
    }

    const now = new Date().toISOString();
    await db.execute(
      `UPDATE hospital_consult_doctors
       SET cid = ?, name = ?, position = ?, phone_number = ?, updated_at = ?
       WHERE id = ? AND hospital_id = ?`,
      [
        normalized.value.cid,
        normalized.value.name,
        normalized.value.position,
        normalized.value.phoneNumber,
        now,
        doctorId,
        hospitalId,
      ],
    );

    return NextResponse.json({
      doctor: {
        id: doctorId,
        hospitalId,
        hcode,
        ...normalized.value,
        isActive: true,
        updatedAt: now,
      },
    });
  } catch (error) {
    logger.error('admin_hospital_consult_doctor_update_failed', { error });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ hcode: string; doctorId: string }> },
) {
  try {
    const guard = await requireAdmin();
    if (guard instanceof NextResponse) return guard;

    await ensureInit();
    await ensureHospitalConsultDoctorsSchema();
    const { hcode, doctorId } = await params;
    const hospitalId = await getHospitalId(hcode);
    if (!hospitalId) {
      return NextResponse.json({ error: 'hospital not found' }, { status: 404 });
    }

    const db = await getDatabase();
    const existing = await db.query<{ id: string }>(
      `SELECT id FROM hospital_consult_doctors
       WHERE id = ? AND hospital_id = ? AND is_active = ?`,
      [doctorId, hospitalId, true],
    );
    if (existing.length === 0) {
      return NextResponse.json({ error: 'consult doctor not found' }, { status: 404 });
    }

    await db.execute(
      `UPDATE hospital_consult_doctors
       SET is_active = ?, updated_at = ?
       WHERE id = ? AND hospital_id = ?`,
      [false, new Date().toISOString(), doctorId, hospitalId],
    );

    return NextResponse.json({ id: doctorId, deleted: true });
  } catch (error) {
    logger.error('admin_hospital_consult_doctor_delete_failed', { error });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
