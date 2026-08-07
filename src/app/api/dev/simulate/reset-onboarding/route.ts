// POST /api/dev/simulate/reset-onboarding — dev-only. Hard-resets the admin
// onboarding registry so the next onboarding flow starts from a true blank
// slate.
//
// Wipes (in FK-safe order):
//   - All cached patient/journey/labour/partograph/referral/newborn rows
//     (FK-dependent on hospitals)
//   - hospital_bms_config (1:1 child of hospitals)
//   - webhook_api_keys (N:1 child of hospitals)
//   - hospitals (HARD DELETE — row removed, not soft-deactivated)
//
// Sibling endpoint /api/dev/simulate/clear preserves hospitals + BMS config +
// webhook keys (it's the "clear patient data only" path). This endpoint is
// the destructive opposite — it removes everything tied to onboarded
// hospitals so a fresh onboarding cycle can be tested. Patient-side rows are
// taken too because they FK-reference hospital ids; keeping them would block
// the DELETE FROM hospitals statement.
import { NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import { simulationGuard } from '../_guard';
import { simulationOrchestrator } from '@/services/dev-simulation/orchestrator';
import { resetPool } from '@/services/dev-simulation/pool';
import { clearDevApiKeyCache, getDevApiKeyCacheSize } from '@/services/dev-simulation/api-keys';
import { SseManager } from '@/lib/sse';
import { getDatabase } from '@/db/connection';
import { ensureInit } from '@/lib/ensure-init';
import { logger } from '@/lib/logger';
import { tryLogAccess } from '@/services/audit';
import { auditActorFromSession } from '@/lib/audit-actor';

// FK-dependent tables on hospitals (and on each other). Order matters for
// hard-delete: leaves first, parents last. Mirrors the order used in
// /api/dev/simulate/clear, with hospitals appended at the very end.
const FK_DEPENDENT_TABLES = [
  'cpd_scores',
  'cached_vital_signs',
  'cached_partograph_observations',
  'cached_anc_risks',
  'cached_anc_visits',
  'cached_newborns',
  'cached_referrals',
  'cached_patients',
  'maternal_journeys',
  // direct hospital children
  'webhook_api_keys',
  'hospital_bms_config',
] as const;

export async function POST() {
  const guard = await simulationGuard();
  if (guard instanceof NextResponse) return guard;
  const session = guard;
  const requestId = uuidv4();

  // Drop in-memory key cache + stop orchestrator before touching the DB so a
  // running sim tick can't re-create rows mid-wipe.
  const cachedBefore = getDevApiKeyCacheSize();
  clearDevApiKeyCache();

  let orchestratorWasRunning = false;
  if (simulationOrchestrator.isRunning()) {
    orchestratorWasRunning = true;
    await simulationOrchestrator.stop();
  }

  await ensureInit();
  const db = await getDatabase();

  const counts: Record<string, number> = {};

  try {
    // Wipe FK leaves → roots, plus the final hospitals delete, inside one
    // transaction so a mid-loop failure rolls back everything instead of
    // leaving a partially wiped registry.
    await db.transaction(async (tx) => {
      for (const t of FK_DEPENDENT_TABLES) {
        const before = await tx.query<{ n: number }>(`SELECT COUNT(*) as n FROM ${t}`);
        counts[t] = Number(before[0]?.n ?? 0);
        await tx.execute(`DELETE FROM ${t}`);
      }

      // HARD delete hospitals — registry truly empty after this. Re-add via
      // /admin → โรงพยาบาล tab (re-creates the row from MoPH master).
      const beforeHospitals = await tx.query<{ n: number }>(`SELECT COUNT(*) as n FROM hospitals`);
      counts['hospitals'] = Number(beforeHospitals[0]?.n ?? 0);
      await tx.execute('DELETE FROM hospitals');
    });

    await tryLogAccess(db, {
      ...auditActorFromSession(session),
      action: 'dev_simulation_reset_onboarding',
      resourceType: 'simulation',
      metadata: { requestId, environment: process.env.NODE_ENV, counts },
    });

    // Reset in-process state belt-and-suspenders.
    resetPool();
    clearDevApiKeyCache();

    // Tell dashboards to re-fetch — admin / hospital table / map listen to
    // `sync-complete` and call refreshAll().
    const sse = SseManager.getInstance();
    sse.broadcast('sync-complete', {
      hcode: '',
      patientsUpdated: 0,
      reason: 'onboarding_reset',
      timestamp: new Date().toISOString(),
    });

    logger.warn('sim_onboarding_reset', {
      requestId,
      counts,
      cacheEntriesPurged: cachedBefore,
      orchestratorWasRunning,
    });

    return NextResponse.json({
      ok: true,
      requestId,
      cleared: counts,
      diagnostics: {
        cacheEntriesPurged: cachedBefore,
        orchestratorWasRunning,
      },
    });
  } catch (error) {
    // Surface the actual DB error to the caller — opaque 500s here have cost
    // hours of debugging in the past (varchar overflow on connection_status,
    // FK violations from missed dependent tables, etc.).
    const message = error instanceof Error ? error.message : String(error);
    logger.error('sim_onboarding_reset_failed', {
      requestId,
      error: message,
      countsBeforeFailure: counts,
    });
    return NextResponse.json(
      {
        ok: false,
        error: 'reset-onboarding failed — no data was deleted (transaction rolled back)',
        detail: message,
        requestId,
        countsBeforeFailure: counts,
      },
      { status: 500 },
    );
  }
}
