// GET /api/admin/hospitals — admin hospital list with BMS config
// POST /api/admin/hospitals — register a new hospital (by hcode from MOPH registry)
import { NextResponse, type NextRequest } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import { getDatabase } from '@/db/connection';
import { ensureInit } from '@/lib/ensure-init';
import { requireAdmin } from '@/lib/admin-guard';
import { logger } from '@/lib/logger';
import { HospitalLevel, HospitalServiceType } from '@/types/domain';

const VALID_LEVELS = new Set<string>(Object.values(HospitalLevel));

function hasActiveBmsSession(sessionJwt: string | null, sessionExpiresAt: string | null) {
  if (!sessionJwt || !sessionExpiresAt) return false;
  const expiresAt = new Date(sessionExpiresAt).getTime();
  return Number.isFinite(expiresAt) && expiresAt > Date.now();
}

export async function GET() {
  try {
    const guard = await requireAdmin();
    if (guard instanceof NextResponse) return guard;

    await ensureInit();
    const db = await getDatabase();

    const hospitals = await db.query<{
      hcode: string;
      name: string;
      level: string;
      service_type: string | null;
      province_code: string | null;
      district_code: string | null;
      lat: string | number | null;
      lon: string | number | null;
      is_active: boolean;
      connection_status: string;
      last_sync_at: string | null;
      tunnel_url: string | null;
      session_jwt: string | null;
      session_expires_at: string | null;
      database_type: string | null;
      marketplace_token: string | null;
      last_authenticity_status: string | null;
      last_authenticity_check_at: string | null;
      last_authenticity_reason: string | null;
    }>(
      // Include deactivated rows so the admin can find and re-enable them
      // (or fully purge their data). is_active is returned as a column so
      // the UI can render a "ปิดใช้งาน" badge and mute the row. The DELETE
      // handler flips is_active rather than dropping the row (FK constraints
      // from 6 child tables block hard delete), so without showing them the
      // admin had no way to manage a hospital after a soft-delete.
      // Active rows sort first; inactive rows fall to the bottom.
      `SELECT h.hcode, h.name, h.level, h.service_type, h.province_code, h.district_code,
              h.lat, h.lon, h.is_active, h.connection_status, h.last_sync_at,
              hbc.tunnel_url, hbc.session_jwt, hbc.session_expires_at, hbc.database_type,
              hbc.marketplace_token, hbc.last_authenticity_status,
              hbc.last_authenticity_check_at, hbc.last_authenticity_reason
       FROM hospitals h
       LEFT JOIN hospital_bms_config hbc ON hbc.hospital_id = h.id
       ORDER BY h.is_active DESC, h.name`,
    );

    return NextResponse.json({
      hospitals: hospitals.map((h) => {
        // PGlite NUMERIC columns surface as strings; coerce before returning so
        // clients don't have to redo this at render time.
        const lat = h.lat === null ? null : Number(h.lat);
        const lon = h.lon === null ? null : Number(h.lon);
        return {
          hcode: h.hcode,
          name: h.name,
          level: h.level,
          serviceType: h.service_type,
          provinceCode: h.province_code,
          districtCode: h.district_code,
          lat: lat !== null && Number.isFinite(lat) ? lat : null,
          lon: lon !== null && Number.isFinite(lon) ? lon : null,
          isActive: h.is_active,
          connectionStatus: h.connection_status,
          lastSyncAt: h.last_sync_at,
          bmsConfig: h.tunnel_url
            ? {
                tunnelUrl: h.tunnel_url,
                hasSession: hasActiveBmsSession(h.session_jwt, h.session_expires_at),
                sessionExpiresAt: h.session_expires_at,
                databaseType: h.database_type,
                hasMarketplaceToken: Boolean(h.marketplace_token),
                authenticity: {
                  // 'authentic' | 'cid_unstable' | 'hn_unstable' |
                  // 'no_id_field' | 'probe_failed' |
                  // 'missing_marketplace_token' | 'no_data' | null
                  status: h.last_authenticity_status,
                  checkedAt: h.last_authenticity_check_at,
                  reason: h.last_authenticity_reason,
                },
              }
            : null,
        };
      }),
    });
  } catch (error) {
    logger.error('admin_hospitals_api_failed', { error });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

interface CreateHospitalBody {
  hcode?: string;
  name?: string;
  level?: string;
  serviceType?: string | null;
  provinceCode?: string | null;
  districtCode?: string | null;
  lat?: number | null;
  lon?: number | null;
  isActive?: boolean;
}

const VALID_SERVICE_TYPES = new Set<string>(Object.values(HospitalServiceType));

export async function POST(request: NextRequest) {
  try {
    const guard = await requireAdmin();
    if (guard instanceof NextResponse) return guard;

    await ensureInit();
    const body = (await request.json()) as CreateHospitalBody;

    const hcode = body.hcode?.trim();
    const name = body.name?.trim();
    const level = body.level?.trim();
    if (!hcode || !/^\d{5}$/.test(hcode)) {
      return NextResponse.json({ error: 'hcode must be a 5-digit MOPH code' }, { status: 400 });
    }
    if (!name) {
      return NextResponse.json({ error: 'name is required' }, { status: 400 });
    }
    if (!level || !VALID_LEVELS.has(level)) {
      return NextResponse.json(
        { error: `level must be one of ${[...VALID_LEVELS].join(', ')}` },
        { status: 400 },
      );
    }
    if (body.serviceType && !VALID_SERVICE_TYPES.has(body.serviceType)) {
      return NextResponse.json(
        { error: `serviceType must be one of ${[...VALID_SERVICE_TYPES].join(', ')}` },
        { status: 400 },
      );
    }

    const db = await getDatabase();
    const existing = await db.query<{ id: string }>('SELECT id FROM hospitals WHERE hcode = ?', [
      hcode,
    ]);
    if (existing.length > 0) {
      return NextResponse.json({ error: 'hospital already registered' }, { status: 409 });
    }

    const now = new Date().toISOString();
    await db.execute(
      `INSERT INTO hospitals (id, hcode, name, level, service_type, province_code,
        district_code, lat, lon, is_active, connection_status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        uuidv4(),
        hcode,
        name,
        level,
        body.serviceType ?? HospitalServiceType.DISTRICT_WITH_MATERNITY,
        body.provinceCode ?? null,
        body.districtCode ?? null,
        body.lat ?? null,
        body.lon ?? null,
        body.isActive ?? true,
        'UNKNOWN',
        now,
        now,
      ],
    );

    return NextResponse.json({ hcode, name, level }, { status: 201 });
  } catch (error) {
    logger.error('admin_hospitals_create_failed', { error });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
