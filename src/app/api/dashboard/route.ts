// T049: GET /api/dashboard — province dashboard summary
import { NextResponse } from 'next/server';
import { getDatabase } from '@/db/connection';
import {
  getProvinceDashboard,
  getStageKPIs,
  getDashboardAlerts,
  getTrends,
} from '@/services/dashboard';
import { getAncBoardCounts } from '@/services/journey-list';
import { getReferralOpsCounts } from '@/services/referral-list';
import type { DashboardContinuum } from '@/types/api';
import { auth } from '@/lib/auth';
import { tryLogAccess } from '@/services/audit';
import { auditActorFromSession } from '@/lib/audit-actor';
import { ensureInit } from '@/lib/ensure-init';
import { logger } from '@/lib/logger';
import { cacheGetJson, cacheSetJson, cacheSetNx } from '@/lib/cache';

interface DashboardApiPayload {
  stageKPIs: Awaited<ReturnType<typeof getStageKPIs>>;
  alerts: Awaited<ReturnType<typeof getDashboardAlerts>>;
  trends: Awaited<ReturnType<typeof getTrends>>;
  hospitals: Awaited<ReturnType<typeof getProvinceDashboard>>['hospitals'];
  summary: Awaited<ReturnType<typeof getProvinceDashboard>>['summary'];
  continuum: DashboardContinuum;
  updatedAt: string;
}

const DASHBOARD_CACHE_KEY = 'cache:dashboard:province';
// 30s to match the clients' SWR refreshInterval — the old 10s TTL expired 3x
// per poll cycle for no freshness gain (2026-07-17 incident: ~35x recompute
// stampede at every expiry).
const DASHBOARD_CACHE_TTL_SECONDS = 30;
// Last good payload, kept longer: served while a recompute is in flight
// (stale-while-revalidate) so concurrent cache misses never stampede.
const DASHBOARD_STALE_KEY = 'cache:dashboard:province:stale';
const DASHBOARD_STALE_TTL_SECONDS = 300;
const DASHBOARD_LOCK_KEY = 'cache:dashboard:province:lock';
const DASHBOARD_LOCK_TTL_SECONDS = 15;
const DASHBOARD_CACHE_ENABLED = process.env.NODE_ENV !== 'test';
// Audit sampling: polled read routes write at most one VIEW row per user per
// window — an unsampled awaited INSERT per poll wrote ~4.5M audit rows/day.
const AUDIT_SAMPLE_WINDOW_SECONDS = 300;

async function sampleAudit(userKey: string, action: string): Promise<boolean> {
  // Claimed = this user's first request in the window ⇒ audit it.
  return cacheSetNx(`audit:sample:${action}:${userKey}`, AUDIT_SAMPLE_WINDOW_SECONDS);
}

async function computeDashboardPayload(
  db: Awaited<ReturnType<typeof getDatabase>>,
): Promise<DashboardApiPayload> {
  const [result, stageKPIs, alerts, trends, ancCounts, referralOps] = await Promise.all([
    getProvinceDashboard(db),
    getStageKPIs(db),
    getDashboardAlerts(db),
    getTrends(db),
    getAncBoardCounts(db),
    getReferralOpsCounts(db),
  ]);
  const continuum: DashboardContinuum = {
    anc: {
      total: ancCounts.risk.total,
      hr3: ancCounts.risk.hr3,
      dueSoon: ancCounts.ops.dueSoon,
    },
    referrals: { today: referralOps.today, last7d: referralOps.last7d },
  };
  return { ...result, stageKPIs, alerts, trends, continuum };
}

export async function GET() {
  try {
    await ensureInit();
    const db = await getDatabase();

    // T091: Audit logging — sampled (one VIEW_DASHBOARD per user per window)
    // and never blocking the response path beyond the sample check.
    const session = await auth();
    if (session?.user) {
      const actor = auditActorFromSession(session);
      const userKey = actor.userId ?? actor.userName ?? 'anonymous';
      if (await sampleAudit(String(userKey), 'VIEW_DASHBOARD')) {
        await tryLogAccess(db, {
          ...actor,
          action: 'VIEW_DASHBOARD',
          resourceType: 'DASHBOARD',
        });
      }
    }

    if (DASHBOARD_CACHE_ENABLED) {
      const cached = await cacheGetJson<DashboardApiPayload>(DASHBOARD_CACHE_KEY);
      if (cached) {
        return NextResponse.json({
          ...cached,
          cache: { hit: true, ttlSeconds: DASHBOARD_CACHE_TTL_SECONDS },
        });
      }
      // Cache miss: single-flight. Exactly one request recomputes; everyone
      // else serves the stale copy (bounded staleness ≤ TTL+lock) instead of
      // stampeding ~20 queries each.
      const claimed = await cacheSetNx(DASHBOARD_LOCK_KEY, DASHBOARD_LOCK_TTL_SECONDS);
      if (!claimed) {
        const stale = await cacheGetJson<DashboardApiPayload>(DASHBOARD_STALE_KEY);
        if (stale) {
          return NextResponse.json({
            ...stale,
            cache: { hit: true, stale: true, ttlSeconds: DASHBOARD_CACHE_TTL_SECONDS },
          });
        }
        // No stale copy (cold start): fall through and recompute anyway —
        // correctness beats the extra recompute in this rare window.
      }
    }

    const payload = await computeDashboardPayload(db);
    if (DASHBOARD_CACHE_ENABLED) {
      await cacheSetJson(DASHBOARD_CACHE_KEY, payload, DASHBOARD_CACHE_TTL_SECONDS);
      await cacheSetJson(DASHBOARD_STALE_KEY, payload, DASHBOARD_STALE_TTL_SECONDS);
    }
    return NextResponse.json({
      ...payload,
      cache: { hit: false, ttlSeconds: DASHBOARD_CACHE_TTL_SECONDS },
    });
  } catch (error) {
    logger.error('dashboard_api_failed', { error });
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'เกิดข้อผิดพลาด กรุณาลองใหม่', details: null } },
      { status: 500 },
    );
  }
}
