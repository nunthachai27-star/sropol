// POST /api/dev/simulate/clear — dev-only. Wipes all patient / journey /
// labor data so the next simulation run starts from a clean slate.
//
// PRESERVED — explicitly excluded from the wipe (do NOT add to `tables`):
//   - hospitals             — admin-managed registry (KK_HOSPITALS seed +
//                             multi-province admin additions). Wiping this
//                             would force re-registration of every external
//                             hospital and break their webhook keys.
//   - hospital_bms_config   — BMS tunnel + DB credentials per hospital.
//   - users / audit_logs    — auth identities and access trail.
//   - provinces / districts / tambons / moph_hospitals — geo lookups.
//   - system_config         — feature flags + active province pin.
//   - webhook_api_keys      — only sim-issued rows (label LIKE 'sim:dev:%')
//                             are deleted in step 4 below; production /
//                             HOSxP-provisioned keys are preserved.
//
// NOT scoped to "simulation-authored" rows — there's no source marker in the
// schema to tell simulator output from HOSxP / webhook data. In dev this is
// intentional; running this in production is blocked by the guard above.
//
// Order matters: delete children before parents to respect FK references.
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

export async function POST() {
  const guard = await simulationGuard();
  if (guard instanceof NextResponse) return guard;
  const session = guard;
  const requestId = uuidv4();

  try {
    // 1. ALWAYS clear the in-memory API-key cache first.
    //
    // If we don't do this up-front, a new sim started after clear can reuse raw
    // keys cached from a previous run that point to DB rows we're about to
    // DELETE. Every webhook POST then 401s with INVALID_API_KEY because the
    // key-hash lookup returns no rows. Clearing before stop() / DELETE makes the
    // cleanup idempotent regardless of orchestrator state, HMR reloads, or
    // whether stop() completed its own revocation cleanly.
    const cachedBefore = getDevApiKeyCacheSize();
    clearDevApiKeyCache();

    // 2. Stop any in-flight simulation so its next tick doesn't race with our
    //    DELETE and re-insert rows we just wiped.
    let orchestratorWasRunning = false;
    if (simulationOrchestrator.isRunning()) {
      orchestratorWasRunning = true;
      await simulationOrchestrator.stop();
    }

    await ensureInit();
    const db = await getDatabase();

    // 3. Delete children before parents. FKs: cached_anc_* → maternal_journeys,
    //    cached_vital_signs + cpd_scores + cached_partograph_observations →
    //    cached_patients, cached_patients.journey_id → maternal_journeys (nullable).
    //    Runs in one transaction with the sim-key cleanup (step 4) so a
    //    mid-loop failure rolls back everything instead of leaving a
    //    partially wiped database.
    const tables = [
      'cpd_scores',
      'cached_vital_signs',
      'cached_partograph_observations',
      'cached_anc_risks',
      'cached_anc_visits',
      'cached_newborns',
      'cached_referrals',
      'cached_patients',
      'maternal_journeys',
    ];

    const counts: Record<string, number> = {};
    await db.transaction(async (tx) => {
      for (const t of tables) {
        const before = await tx.query<{ n: number }>(`SELECT COUNT(*) as n FROM ${t}`);
        counts[t] = Number(before[0]?.n ?? 0);
        await tx.execute(`DELETE FROM ${t}`);
      }

      // 4. Delete simulator-issued webhook API keys. DELETE (not UPDATE) so
      //    fresh runs create brand-new rows; no chance of matching by hash
      //    against a lingering-but-revoked row.
      const simKeyRows = await tx.query<{ id: string }>(
        `SELECT id FROM webhook_api_keys WHERE label LIKE 'sim:dev:%'`,
      );
      if (simKeyRows.length > 0) {
        const placeholders = simKeyRows.map(() => '?').join(',');
        await tx.execute(
          `DELETE FROM webhook_api_keys WHERE id IN (${placeholders})`,
          simKeyRows.map((r) => r.id),
        );
      }
      counts['webhook_api_keys (sim)'] = simKeyRows.length;
    });

    await tryLogAccess(db, {
      ...auditActorFromSession(session),
      action: 'dev_simulation_clear',
      resourceType: 'simulation',
      metadata: { requestId, environment: process.env.NODE_ENV, counts },
    });

    // 5. Reset in-process state. resetPool clears patient/admission/referral
    //    pools; clearDevApiKeyCache again belt-and-suspenders (stop() may have
    //    re-populated the cache with freshly-revoked entries while shutting
    //    down — those entries would point to rows we just DELETE'd).
    resetPool();
    clearDevApiKeyCache();

    // 6. Verify post-clear DB state. A non-zero count here means something is
    //    still writing to these tables after we started clearing — worth
    //    flagging loudly so the next-start failure is easy to diagnose.
    const leftoverSimKeys = await db.query<{ n: number }>(
      `SELECT COUNT(*) as n FROM webhook_api_keys WHERE label LIKE 'sim:dev:%'`,
    );
    const leftoverCount = Number(leftoverSimKeys[0]?.n ?? 0);

    // 7. Tell connected clients to re-fetch. Dashboards listen to `sync-complete`
    //    and call refreshAll(), which invalidates all SWR caches that back the
    //    KPIs, hospital table, high-risk list, trends panel, etc.
    const sse = SseManager.getInstance();
    sse.broadcast('sync-complete', {
      hcode: '',
      patientsUpdated: 0,
      reason: 'dev_data_cleared',
      timestamp: new Date().toISOString(),
    });

    logger.warn('sim_data_cleared', {
      requestId,
      counts,
      cacheEntriesPurged: cachedBefore,
      orchestratorWasRunning,
      leftoverSimKeysAfter: leftoverCount,
    });

    return NextResponse.json({
      ok: true,
      requestId,
      cleared: counts,
      diagnostics: {
        cacheEntriesPurged: cachedBefore,
        orchestratorWasRunning,
        leftoverSimKeysAfter: leftoverCount,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error('sim_data_clear_failed', { requestId, error: message });
    return NextResponse.json(
      {
        ok: false,
        error: 'clear failed — no data was deleted (transaction rolled back)',
        requestId,
      },
      { status: 500 },
    );
  }
}
