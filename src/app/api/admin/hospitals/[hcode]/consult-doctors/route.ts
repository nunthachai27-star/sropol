// GET/POST /api/admin/hospitals/[hcode]/consult-doctors
import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
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

interface ConsultDoctorRow {
  id: string;
  hospital_id: string;
  hcode: string;
  cid: string;
  name: string;
  position: string | null;
  phone_number: string | null;
  is_active: boolean | number;
  created_at: string;
  updated_at: string;
}

function toDoctor(row: ConsultDoctorRow) {
  return {
    id: row.id,
    hospitalId: row.hospital_id,
    hcode: row.hcode,
    cid: row.cid,
    name: row.name,
    position: row.position,
    phoneNumber: row.phone_number,
    isActive: Boolean(row.is_active),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
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

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ hcode: string }> },
) {
  try {
    const guard = await requireAdmin();
    if (guard instanceof NextResponse) return guard;

    await ensureInit();
    await ensureHospitalConsultDoctorsSchema();
    const { hcode } = await params;
    const hospitalId = await getHospitalId(hcode);
    if (!hospitalId) {
      return NextResponse.json({ error: 'hospital not found' }, { status: 404 });
    }

    const db = await getDatabase();
    const doctors = await db.query<ConsultDoctorRow>(
      `SELECT d.id, d.hospital_id, h.hcode, d.cid, d.name, d.position,
              d.phone_number, d.is_active, d.created_at, d.updated_at
       FROM hospital_consult_doctors d
       INNER JOIN hospitals h ON h.id = d.hospital_id
       WHERE d.hospital_id = ? AND d.is_active = ?
       ORDER BY d.name, d.created_at`,
      [hospitalId, true],
    );

    return NextResponse.json({ doctors: doctors.map(toDoctor) });
  } catch (error) {
    logger.error('admin_hospital_consult_doctors_list_failed', { error });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ hcode: string }> },
) {
  try {
    const guard = await requireAdmin();
    if (guard instanceof NextResponse) return guard;

    await ensureInit();
    await ensureHospitalConsultDoctorsSchema();
    const { hcode } = await params;
    const normalized = normalizePayload((await request.json()) as DoctorPayload);
    if ('error' in normalized) {
      return NextResponse.json({ error: normalized.error }, { status: 400 });
    }

    const hospitalId = await getHospitalId(hcode);
    if (!hospitalId) {
      return NextResponse.json({ error: 'hospital not found' }, { status: 404 });
    }

    const db = await getDatabase();
    const duplicate = await db.query<{ id: string }>(
      `SELECT id FROM hospital_consult_doctors
       WHERE hospital_id = ? AND cid = ? AND is_active = ?`,
      [hospitalId, normalized.value.cid, true],
    );
    if (duplicate.length > 0) {
      return NextResponse.json(
        { error: 'consult doctor cid already exists for this hospital' },
        { status: 409 },
      );
    }

    const now = new Date().toISOString();
    const id = uuidv4();
    await db.execute(
      `INSERT INTO hospital_consult_doctors
        (id, hospital_id, cid, name, position, phone_number, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        hospitalId,
        normalized.value.cid,
        normalized.value.name,
        normalized.value.position,
        normalized.value.phoneNumber,
        true,
        now,
        now,
      ],
    );

    return NextResponse.json(
      {
        doctor: {
          id,
          hospitalId,
          hcode,
          ...normalized.value,
          isActive: true,
          createdAt: now,
          updatedAt: now,
        },
      },
      { status: 201 },
    );
  } catch (error) {
    logger.error('admin_hospital_consult_doctors_create_failed', { error });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
