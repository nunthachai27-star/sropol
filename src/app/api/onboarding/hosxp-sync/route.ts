import { NextResponse, type NextRequest } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import { auth } from '@/lib/auth';
import { ensureInit } from '@/lib/ensure-init';
import { getDatabase } from '@/db/connection';
import { BmsSessionClient } from '@/lib/bms-session';
import { APP_IDENTIFIER } from '@/lib/bms-browser-client';
import { SseManager } from '@/lib/sse';
import type { DatabaseDialect } from '@/config/hosxp-queries';
import {
  getOnboardingHosxpSyncStatus,
  startOnboardingHosxpSync,
} from '@/services/sync/onboarding-session';
import { logger } from '@/lib/logger';
import { EXEMPT_HCODES } from '@/lib/hospital-access-guard';
import { HospitalLevel, HospitalServiceType } from '@/types/domain';

interface Body {
  apiUrl?: unknown;
  bearerToken?: unknown;
  marketplaceToken?: unknown;
  databaseType?: unknown;
}

const EXEMPT_HOSPITAL_DEFAULTS: Record<string, { name: string }> = {
  '00000': { name: 'System (00000)' },
  '99999': { name: 'Provincial Admin (99999)' },
};

type HospitalRow = { id: string; is_active: boolean | number };

function normalizeDatabaseType(value: unknown): DatabaseDialect | null {
  return value === 'mysql' || value === 'postgresql' ? value : null;
}

async function detectDatabaseType(
  apiUrl: string,
  bearerToken: string,
  marketplaceToken?: string | null,
): Promise<DatabaseDialect> {
  try {
    const client = new BmsSessionClient(apiUrl);
    const result = await client.executeQuery(
      'SELECT version()',
      apiUrl,
      bearerToken,
      undefined,
      { appIdentifier: APP_IDENTIFIER, marketplaceToken },
    );
    const first = result.data[0] ?? {};
    const version = String(
      first['version()'] ?? first.version ?? Object.values(first)[0] ?? '',
    ).toLowerCase();
    return version.includes('postgresql') ? 'postgresql' : 'mysql';
  } catch (error) {
    logger.warn('onboarding_hosxp_sync_db_type_detect_failed', { error });
    return 'mysql';
  }
}

async function resolveOrCreateExemptHospital(
  db: Awaited<ReturnType<typeof getDatabase>>,
  hcode: string,
): Promise<{ hospitalId: string; createdOrReactivated: boolean } | NextResponse> {
  const now = new Date().toISOString();
  const hospitals = await db.query<HospitalRow>(
    'SELECT id, is_active FROM hospitals WHERE hcode = ?',
    [hcode],
  );

  if (hospitals.length === 0) {
    if (!EXEMPT_HCODES.has(hcode)) {
      return NextResponse.json(
        {
          error: 'hospital_not_registered',
          hcode,
          stage: 'resolve_hospital',
          detail:
            'This hospital code is not active in KK-LRMS. Add/activate it in Admin > Hospitals before automatic HOSxP sync can start.',
        },
        { status: 403 },
      );
    }

    const defaults = EXEMPT_HOSPITAL_DEFAULTS[hcode] ?? { name: `Exempt (${hcode})` };
    const hospitalId = uuidv4();
    await db.execute(
      `INSERT INTO hospitals (id, hcode, name, level, service_type, is_active,
        connection_status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        hospitalId,
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
    logger.warn('onboarding_hosxp_sync_exempt_hospital_auto_registered', {
      hcode,
      name: defaults.name,
    });
    return { hospitalId, createdOrReactivated: true };
  }

  if (!hospitals[0].is_active) {
    if (!EXEMPT_HCODES.has(hcode)) {
      return NextResponse.json(
        {
          error: 'hospital_not_registered',
          hcode,
          stage: 'resolve_hospital',
          detail:
            'This hospital code is not active in KK-LRMS. Add/activate it in Admin > Hospitals before automatic HOSxP sync can start.',
        },
        { status: 403 },
      );
    }

    await db.execute(
      'UPDATE hospitals SET is_active = ?, updated_at = ? WHERE id = ?',
      [true, now, hospitals[0].id],
    );
    logger.warn('onboarding_hosxp_sync_exempt_hospital_reactivated', {
      hcode,
      hospitalId: hospitals[0].id,
    });
    return { hospitalId: hospitals[0].id, createdOrReactivated: true };
  }

  return { hospitalId: hospitals[0].id, createdOrReactivated: false };
}

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.hospitalCode) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }

  try {
    await ensureInit();

    const body = (await request.json().catch(() => ({}))) as Body;
    const apiUrl = typeof body.apiUrl === 'string' ? body.apiUrl.trim().replace(/\/$/, '') : '';
    const bearerToken = typeof body.bearerToken === 'string' ? body.bearerToken.trim() : '';
    const marketplaceToken =
      typeof body.marketplaceToken === 'string' && body.marketplaceToken.trim()
        ? body.marketplaceToken.trim()
        : null;

    if (!apiUrl || !bearerToken) {
      return NextResponse.json(
        {
          error: 'missing_bms_session',
          stage: 'read_bms_session',
          detail:
            'The browser BMS session did not provide apiUrl and bearerToken. Open KK-LRMS from the HOSxP/BMS launcher with a valid session.',
        },
        { status: 400 },
      );
    }

    try {
      new URL(apiUrl);
    } catch {
      return NextResponse.json(
        {
          error: 'invalid_bms_url',
          stage: 'validate_bms_url',
          detail: `The BMS API URL is not a valid URL: ${apiUrl}`,
        },
        { status: 400 },
      );
    }

    const hcode = session.user.hospitalCode;
    const db = await getDatabase();
    const now = new Date().toISOString();
    const hospitalResolution = await resolveOrCreateExemptHospital(db, hcode);
    if (hospitalResolution instanceof NextResponse) return hospitalResolution;
    const hospitalId = hospitalResolution.hospitalId;

    const databaseType =
      normalizeDatabaseType(body.databaseType) ??
      (await detectDatabaseType(apiUrl, bearerToken, marketplaceToken));

    const sessionExpiresAt = new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString();
    const existingConfig = await db.query<{ id: string }>(
      'SELECT id FROM hospital_bms_config WHERE hospital_id = ?',
      [hospitalId],
    );

    if (existingConfig.length > 0) {
      await db.execute(
        `UPDATE hospital_bms_config
            SET tunnel_url = ?, session_jwt = ?, session_expires_at = ?,
                database_type = ?, updated_at = ?
          WHERE hospital_id = ?`,
        [apiUrl, bearerToken, sessionExpiresAt, databaseType, now, hospitalId],
      );
    } else {
      await db.execute(
        `INSERT INTO hospital_bms_config
           (id, hospital_id, tunnel_url, session_jwt, session_expires_at,
            database_type, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          uuidv4(),
          hospitalId,
          apiUrl,
          bearerToken,
          sessionExpiresAt,
          databaseType,
          now,
          now,
        ],
      );
    }

    const sync = await startOnboardingHosxpSync({
      db,
      hospitalId,
      hcode,
      bmsUrl: apiUrl,
      bearerToken,
      databaseType,
      marketplaceToken,
      sseManager: SseManager.getInstance(),
    });

    return NextResponse.json({
      ok: true,
      hcode,
      databaseType,
      ...sync,
    });
  } catch (error) {
    logger.error('onboarding_hosxp_sync_start_failed', { error });
    const detail = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      {
        error: 'failed_to_start_hosxp_sync',
        stage: 'start_background_sync',
        detail,
      },
      { status: 500 },
    );
  }
}

export async function GET() {
  const session = await auth();
  if (!session?.user?.hospitalCode) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }

  try {
    await ensureInit();
    const hcode = session.user.hospitalCode;
    const db = await getDatabase();
    const hospitals = await db.query<{
      id: string;
      connection_status: string | null;
      last_sync_at: string | null;
    }>(
      'SELECT id, connection_status, last_sync_at FROM hospitals WHERE hcode = ?',
      [hcode],
    );

    if (hospitals.length === 0) {
      return NextResponse.json({
        ok: true,
        hcode,
        running: false,
        phase: 'stopped',
        detail: EXEMPT_HCODES.has(hcode)
          ? 'Hospital row has not been auto-created yet. Reload the dashboard to start onboarding sync.'
          : 'Hospital is not registered in KK-LRMS.',
      });
    }

    const hospital = hospitals[0];
    const runtime = getOnboardingHosxpSyncStatus(hospital.id);
    const activeRows = await db.query<{ cnt: number }>(
      "SELECT COUNT(*) AS cnt FROM cached_patients WHERE hospital_id = ? AND labor_status = 'ACTIVE'",
      [hospital.id],
    );
    const cachedRows = await db.query<{ cnt: number; latest_synced_at: string | null }>(
      'SELECT COUNT(*) AS cnt, MAX(synced_at) AS latest_synced_at FROM cached_patients WHERE hospital_id = ?',
      [hospital.id],
    );
    const ancRows = await db.query<{ cnt: number; latest_synced_at: string | null }>(
      `SELECT COUNT(*) AS cnt, MAX(synced_at) AS latest_synced_at
         FROM maternal_journeys
        WHERE hospital_id = ? AND care_stage = 'PREGNANCY'`,
      [hospital.id],
    );
    const referralRows = await db.query<{
      outgoing_active: number;
      incoming_active: number;
      total_active: number;
    }>(
      `SELECT
         COALESCE(SUM(CASE WHEN from_hospital_id = ? THEN 1 ELSE 0 END), 0) AS outgoing_active,
         COALESCE(SUM(CASE WHEN to_hospital_id = ? THEN 1 ELSE 0 END), 0) AS incoming_active,
         COUNT(*) AS total_active
       FROM cached_referrals
       WHERE (from_hospital_id = ? OR to_hospital_id = ?)
         AND status NOT IN ('ARRIVED', 'REJECTED')`,
      [hospital.id, hospital.id, hospital.id, hospital.id],
    );

    return NextResponse.json({
      ok: true,
      hcode,
      hospitalId: hospital.id,
      connectionStatus: hospital.connection_status,
      hospitalLastSyncAt: hospital.last_sync_at,
      activePatients: activeRows[0]?.cnt ?? 0,
      cachedPatients: cachedRows[0]?.cnt ?? 0,
      latestPatientSyncedAt: cachedRows[0]?.latest_synced_at ?? null,
      activeAncJourneys: ancRows[0]?.cnt ?? 0,
      latestAncSyncedAt: ancRows[0]?.latest_synced_at ?? null,
      activeReferrals: referralRows[0]?.total_active ?? 0,
      outgoingReferrals: referralRows[0]?.outgoing_active ?? 0,
      incomingReferrals: referralRows[0]?.incoming_active ?? 0,
      ...runtime,
    });
  } catch (error) {
    logger.error('onboarding_hosxp_sync_status_failed', { error });
    return NextResponse.json(
      {
        error: 'failed_to_read_hosxp_sync_status',
        detail: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}
