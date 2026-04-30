// T049: GET /api/dashboard — province dashboard summary
import { NextResponse } from 'next/server';
import { getDatabase } from '@/db/connection';
import { getProvinceDashboard, getStageKPIs, getDashboardAlerts, getTrends } from '@/services/dashboard';
import { auth } from '@/lib/auth';
import { tryLogAccess } from '@/services/audit';
import { ensureInit } from '@/lib/ensure-init';
import { logger } from '@/lib/logger';
import { cacheGetJson, cacheSetJson } from '@/lib/cache';

interface DashboardApiPayload {
  stageKPIs: Awaited<ReturnType<typeof getStageKPIs>>;
  alerts: Awaited<ReturnType<typeof getDashboardAlerts>>;
  trends: Awaited<ReturnType<typeof getTrends>>;
  hospitals: Awaited<ReturnType<typeof getProvinceDashboard>>['hospitals'];
  summary: Awaited<ReturnType<typeof getProvinceDashboard>>['summary'];
  updatedAt: string;
}

const DASHBOARD_CACHE_KEY = 'cache:dashboard:province';
const DASHBOARD_CACHE_TTL_SECONDS = 10;
const DASHBOARD_CACHE_ENABLED = process.env.NODE_ENV !== 'test';

export async function GET() {
  try {
    await ensureInit();
    const db = await getDatabase();

    // T091: Audit logging
    const session = await auth();
    if (session?.user) {
      await tryLogAccess(db, {
        userId: session.user.id,
        action: 'VIEW_DASHBOARD',
        resourceType: 'DASHBOARD',
      });
    }

    if (DASHBOARD_CACHE_ENABLED) {
      const cached = await cacheGetJson<DashboardApiPayload>(DASHBOARD_CACHE_KEY);
      if (cached) {
        return NextResponse.json({ ...cached, cache: { hit: true, ttlSeconds: DASHBOARD_CACHE_TTL_SECONDS } });
      }
    }

    const [result, stageKPIs, alerts, trends] = await Promise.all([
      getProvinceDashboard(db),
      getStageKPIs(db),
      getDashboardAlerts(db),
      getTrends(db),
    ]);
    const payload = { ...result, stageKPIs, alerts, trends };
    if (DASHBOARD_CACHE_ENABLED) {
      await cacheSetJson(DASHBOARD_CACHE_KEY, payload, DASHBOARD_CACHE_TTL_SECONDS);
    }
    return NextResponse.json({ ...payload, cache: { hit: false, ttlSeconds: DASHBOARD_CACHE_TTL_SECONDS } });
  } catch (error) {
    logger.error('dashboard_api_failed', { error });
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'เกิดข้อผิดพลาด กรุณาลองใหม่', details: null } },
      { status: 500 },
    );
  }
}
