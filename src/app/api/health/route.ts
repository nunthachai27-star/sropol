// T109: Health check API endpoint — public, no auth required

import { NextResponse } from 'next/server';
import { getDatabase } from '@/db/connection';
import { ensureInit } from '@/lib/ensure-init';
import { getHealthStatus } from '@/services/health';

export async function GET() {
  try {
    await ensureInit();
    const db = await getDatabase();
    const health = await getHealthStatus(db);
    const statusCode = health.status === 'unhealthy' ? 503 : 200;
    return NextResponse.json(health, { status: statusCode });
  } catch {
    return NextResponse.json(
      {
        status: 'unhealthy',
        database: 'disconnected',
        cache: { backend: 'memory', degraded: false, degradedSince: null },
        uptime: 0,
        timestamp: new Date().toISOString(),
        hospitalConnections: { total: 0, online: 0, offline: 0, unknown: 0 },
        degradedReasons: ['health_check_failed'],
      },
      { status: 503 },
    );
  }
}
