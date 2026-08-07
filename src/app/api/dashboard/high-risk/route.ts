// GET /api/dashboard/high-risk — high-risk patients across all hospitals
import { NextResponse } from 'next/server';
import { getDatabase } from '@/db/connection';
import { getHighRiskPatients } from '@/services/dashboard';
import { auth } from '@/lib/auth';
import { tryLogAccess } from '@/services/audit';
import { auditActorFromSession } from '@/lib/audit-actor';
import { ensureInit } from '@/lib/ensure-init';
import { logger } from '@/lib/logger';
import { cacheGetJson, cacheSetJson, cacheSetNx } from '@/lib/cache';
import type { HighRiskPatient } from '@/types/api';

// Same caching + audit-sampling posture as /api/dashboard (2026-07-17
// incident: this route was uncached and audited every poll — ~40 req/s of
// full recomputes + audit INSERTs). The cached payload lives in the same
// compose-internal Redis that already holds sync-run records; note it now
// carries decrypted display names for up to 50 patients (same data every
// authenticated dashboard sees).
const HR_CACHE_KEY = 'cache:dashboard:high-risk';
const HR_CACHE_TTL_SECONDS = 30;
const HR_STALE_KEY = 'cache:dashboard:high-risk:stale';
const HR_STALE_TTL_SECONDS = 300;
const HR_LOCK_KEY = 'cache:dashboard:high-risk:lock';
const HR_LOCK_TTL_SECONDS = 15;
const HR_CACHE_ENABLED = process.env.NODE_ENV !== 'test';
const AUDIT_SAMPLE_WINDOW_SECONDS = 300;

export async function GET() {
  try {
    await ensureInit();
    const db = await getDatabase();

    // Audit logging — sampled: one VIEW row per user per window.
    const session = await auth();
    if (session?.user) {
      const actor = auditActorFromSession(session);
      const userKey = String(actor.userId ?? actor.userName ?? 'anonymous');
      if (await cacheSetNx(`audit:sample:VIEW_HIGH_RISK:${userKey}`, AUDIT_SAMPLE_WINDOW_SECONDS)) {
        await tryLogAccess(db, {
          ...actor,
          action: 'VIEW_HIGH_RISK_PATIENTS',
          resourceType: 'DASHBOARD',
        });
      }
    }

    if (HR_CACHE_ENABLED) {
      const cached = await cacheGetJson<HighRiskPatient[]>(HR_CACHE_KEY);
      if (cached) return NextResponse.json({ patients: cached });
      const claimed = await cacheSetNx(HR_LOCK_KEY, HR_LOCK_TTL_SECONDS);
      if (!claimed) {
        const stale = await cacheGetJson<HighRiskPatient[]>(HR_STALE_KEY);
        if (stale) return NextResponse.json({ patients: stale });
      }
    }

    const patients = await getHighRiskPatients(db);
    if (HR_CACHE_ENABLED) {
      await cacheSetJson(HR_CACHE_KEY, patients, HR_CACHE_TTL_SECONDS);
      await cacheSetJson(HR_STALE_KEY, patients, HR_STALE_TTL_SECONDS);
    }
    return NextResponse.json({ patients });
  } catch (error) {
    logger.error('high_risk_patients_api_failed', { error });
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'เกิดข้อผิดพลาด กรุณาลองใหม่', details: null } },
      { status: 500 },
    );
  }
}
