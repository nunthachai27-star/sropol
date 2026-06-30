// GET /api/dashboard/high-risk — high-risk patients across all hospitals
import { NextResponse } from 'next/server';
import { getDatabase } from '@/db/connection';
import { getHighRiskPatients } from '@/services/dashboard';
import { auth } from '@/lib/auth';
import { tryLogAccess } from '@/services/audit';
import { ensureInit } from '@/lib/ensure-init';
import { cacheGetJson, cacheSetJson } from '@/lib/cache';
import { logger } from '@/lib/logger';

// Every open client polls this every 30s. The cross-hospital high-risk
// aggregation is expensive, so share one computed result for a short window
// (matches /api/dashboard) instead of recomputing per request × per user.
const HIGH_RISK_CACHE_KEY = 'cache:dashboard:high-risk';
const HIGH_RISK_CACHE_TTL_SECONDS = 10;

interface HighRiskPayload {
  patients: Awaited<ReturnType<typeof getHighRiskPatients>>;
}

export async function GET() {
  try {
    await ensureInit();
    const db = await getDatabase();

    const cached = await cacheGetJson<HighRiskPayload>(HIGH_RISK_CACHE_KEY);
    if (cached) {
      return NextResponse.json({ ...cached, cache: { hit: true, ttlSeconds: HIGH_RISK_CACHE_TTL_SECONDS } });
    }

    // Audit the actual recompute (cache miss) — not every 30s auto-refresh
    // poll, which used to write one row per user per 30s for an aggregate
    // view. Per-patient endpoints keep their own (PDPA-critical) audit.
    const session = await auth();
    if (session?.user) {
      await tryLogAccess(db, {
        userId: session.user.id,
        action: 'VIEW_HIGH_RISK_PATIENTS',
        resourceType: 'DASHBOARD',
      });
    }

    const patients = await getHighRiskPatients(db);
    const payload: HighRiskPayload = { patients };
    await cacheSetJson(HIGH_RISK_CACHE_KEY, payload, HIGH_RISK_CACHE_TTL_SECONDS);
    return NextResponse.json({ ...payload, cache: { hit: false, ttlSeconds: HIGH_RISK_CACHE_TTL_SECONDS } });
  } catch (error) {
    logger.error('high_risk_patients_api_failed', { error });
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'เกิดข้อผิดพลาด กรุณาลองใหม่', details: null } },
      { status: 500 },
    );
  }
}
