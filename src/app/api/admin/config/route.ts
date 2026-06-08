// GET/PUT /api/admin/config — singleton key/value configuration.
// Known key: `active_province_code` (MOPH 2-digit province code scoping
// dashboard/map/sync). Empty DB returns DEFAULT_PROVINCE_CODE (Surin, 32).
import { NextResponse, type NextRequest } from 'next/server';
import { getDatabase } from '@/db/connection';
import { ensureInit } from '@/lib/ensure-init';
import { logger } from '@/lib/logger';
import { DEFAULT_PROVINCE_CODE } from '@/config/province';

const DEFAULT_ACTIVE_PROVINCE_CODE = DEFAULT_PROVINCE_CODE;

async function readConfig(): Promise<Record<string, string | null>> {
  const db = await getDatabase();
  const rows = await db.query<{ key: string; value: string | null }>(
    'SELECT key, value FROM system_config',
  );
  const map: Record<string, string | null> = {};
  for (const r of rows) map[r.key] = r.value;
  if (!map.active_province_code) {
    map.active_province_code = DEFAULT_ACTIVE_PROVINCE_CODE;
  }
  return map;
}

export async function GET() {
  try {
    await ensureInit();
    const config = await readConfig();
    return NextResponse.json({ config });
  } catch (error) {
    logger.error('admin_config_get_failed', { error });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

interface UpdateConfigBody {
  activeProvinceCode?: string;
}

export async function PUT(request: NextRequest) {
  try {
    await ensureInit();
    const body = (await request.json()) as UpdateConfigBody;

    const updates: Array<[string, string]> = [];
    if (body.activeProvinceCode !== undefined) {
      if (!/^\d{2}$/.test(body.activeProvinceCode)) {
        return NextResponse.json(
          { error: 'activeProvinceCode must be a 2-digit MOPH code' },
          { status: 400 },
        );
      }
      updates.push(['active_province_code', body.activeProvinceCode]);
    }

    if (updates.length === 0) {
      return NextResponse.json({ error: 'no fields to update' }, { status: 400 });
    }

    const db = await getDatabase();
    const now = new Date().toISOString();
    for (const [key, value] of updates) {
      const existing = await db.query<{ key: string }>(
        'SELECT key FROM system_config WHERE key = ?',
        [key],
      );
      if (existing.length === 0) {
        await db.execute(
          'INSERT INTO system_config (key, value, updated_at) VALUES (?, ?, ?)',
          [key, value, now],
        );
      } else {
        await db.execute(
          'UPDATE system_config SET value = ?, updated_at = ? WHERE key = ?',
          [value, now, key],
        );
      }
    }

    const config = await readConfig();
    return NextResponse.json({ config });
  } catch (error) {
    logger.error('admin_config_put_failed', { error });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
