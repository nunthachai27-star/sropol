// T095: POST /api/admin/hospitals/[hcode]/test-connection — test BMS connection
import { NextRequest, NextResponse } from 'next/server';
import { getDatabase } from '@/db/connection';
import { ensureInit } from '@/lib/ensure-init';
import { requireAdmin } from '@/lib/admin-guard';
import { BmsSessionClient } from '@/lib/bms-session';
import { getQuery, CHECK_TABLES, DATABASE_VERSION } from '@/config/hosxp-queries';
import type { DatabaseDialect } from '@/config/hosxp-queries';
import { logger } from '@/lib/logger';

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ hcode: string }> },
) {
  try {
    const guard = await requireAdmin();
    if (guard instanceof NextResponse) return guard;

    await ensureInit();
    const { hcode } = await params;
    const db = await getDatabase();

    // Get hospital's BMS config
    const configs = await db.query<{
      tunnel_url: string;
      session_jwt: string | null;
      database_type: string | null;
    }>(
      `SELECT hbc.tunnel_url, hbc.session_jwt, hbc.database_type
       FROM hospital_bms_config hbc
       JOIN hospitals h ON h.id = hbc.hospital_id
       WHERE h.hcode = ?`,
      [hcode],
    );

    if (configs.length === 0) {
      return NextResponse.json({ error: 'No BMS config found for this hospital' }, { status: 404 });
    }

    const config = configs[0];
    const client = new BmsSessionClient(config.tunnel_url);

    // Get or refresh session
    let jwt = config.session_jwt;
    let bmsUrl = config.tunnel_url;
    let dbType = (config.database_type ?? 'postgresql') as DatabaseDialect;

    if (!jwt) {
      const validateUrl = process.env.BMS_VALIDATE_URL ?? 'https://hosxp.net/phapi/PasteJSON';
      const sessionId = await client.getSessionId();
      const sessionConfig = await client.validateSession(sessionId, validateUrl);
      jwt = sessionConfig.jwt;
      bmsUrl = sessionConfig.bmsUrl;
      const detectedDbType = await client.getDatabaseType(bmsUrl, jwt);
      if (!detectedDbType) {
        return NextResponse.json({
          connected: false,
          error: 'Could not detect the HOSxP database type (connection or version query failed).',
        });
      }
      dbType = detectedDbType;
    }

    // Test: Get database version
    const versionSql = getQuery(DATABASE_VERSION, dbType);
    const versionResult = await client.executeQuery(versionSql, bmsUrl, jwt);
    const databaseVersion = versionResult.data[0]?.version ?? 'Unknown';

    // Test: Check key tables
    const tablesSql = getQuery(CHECK_TABLES, dbType);
    const tablesResult = await client.executeQuery(tablesSql, bmsUrl, jwt);
    const tablesFound = tablesResult.data.map((r) => String(r.table_name ?? r.tablename ?? ''));

    return NextResponse.json({
      connected: true,
      databaseType: dbType,
      databaseVersion: String(databaseVersion),
      tablesFound,
    });
  } catch (error) {
    logger.error('test_connection_failed', { error });
    return NextResponse.json({
      connected: false,
      error: error instanceof Error ? error.message : 'Connection failed',
    });
  }
}
