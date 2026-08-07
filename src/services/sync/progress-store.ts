// Sync progress store — persists every poll cycle's step trail to Redis
// (with the cache.ts in-memory fallback) so admins can see WHY a hospital
// failed to pull data without needing log access. Each "run" represents
// one invocation of pollHospital().
//
// Storage shape (cacheSetJson namespaces with `kk-lrms:` automatically):
//   sync:run:<hospitalId>:<runId>  → SyncProgressRun, TTL 24h
//   sync:latest:<hospitalId>       → most recent SyncProgressRun, TTL 24h
//
// The latest pointer lets the dashboard render quickly without scanning
// the full run set; listSyncRuns() reads via cacheKeys() for history.
import { randomBytes } from 'crypto';
import { logger } from '@/lib/logger';
import type { PollHospitalStep } from './polling';

// Lazy-load the cache module so unit tests (vitest on hosts without the
// optional redis package installed) can import polling.ts without pulling
// in `redis` at module-evaluation time. The cache layer itself already
// gracefully degrades to memory when REDIS_URL is unset.
type CacheModule = typeof import('@/lib/cache');
let cacheModulePromise: Promise<CacheModule> | null = null;
function loadCache(): Promise<CacheModule> {
  cacheModulePromise ??= import('@/lib/cache');
  return cacheModulePromise;
}

export type SyncRunOutcome = 'running' | 'success' | 'partial' | 'failed';
// 'browser' = user's tab pulled HOSxP data via local-127.0.0.1 gateway and
// pushed it to /api/sync/browser-push (avoids the rate-limited tunnel).
export type SyncRunTrigger = 'scheduled' | 'immediate' | 'onboarding' | 'browser';

export interface SyncProgressStep extends PollHospitalStep {
  at: string;
}

export interface SyncProgressRun {
  runId: string;
  hospitalId: string;
  hcode: string;
  trigger: SyncRunTrigger;
  /**
   * BMS PasteJSON session id the browser client pulled HOSxP data under
   * (trigger='browser' only; null for server-side/legacy runs and older
   * clients that don't send it). Operators use it as the handle for running
   * diagnostic SQL against the hospital's HOSxP via the BMS Session API.
   * Deliberately stored ONLY here (Redis run record, 24h TTL) and never
   * emitted via logger — logger.ts SENSITIVE_KEYS redacts session ids.
   * Optional so run records persisted before this field existed still parse.
   */
  bmsSessionId?: string | null;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  outcome: SyncRunOutcome;
  finalMessage: string | null;
  errorMessage: string | null;
  steps: SyncProgressStep[];
}

const RUN_TTL_SEC = 24 * 60 * 60;

function newRunId(): string {
  // Sortable-by-startedAt: ISO timestamp + 6-char random suffix to dedup
  // sub-millisecond simultaneous starts.
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const suffix = randomBytes(3).toString('hex');
  return `${ts}-${suffix}`;
}

function runKey(hospitalId: string, runId: string): string {
  return `sync:run:${hospitalId}:${runId}`;
}

function latestKey(hospitalId: string): string {
  return `sync:latest:${hospitalId}`;
}

export async function startSyncRun(
  hospitalId: string,
  hcode: string,
  trigger: SyncRunTrigger,
  options?: { bmsSessionId?: string | null },
): Promise<string> {
  const runId = newRunId();
  const run: SyncProgressRun = {
    runId,
    hospitalId,
    hcode,
    trigger,
    bmsSessionId: options?.bmsSessionId ?? null,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    durationMs: null,
    outcome: 'running',
    finalMessage: null,
    errorMessage: null,
    steps: [],
  };
  try {
    const cache = await loadCache();
    await cache.cacheSetJson(runKey(hospitalId, runId), run, RUN_TTL_SEC);
    await cache.cacheSetJson(latestKey(hospitalId), run, RUN_TTL_SEC);
  } catch (error) {
    // Progress recording must never fail a sync — log and move on.
    logger.warn('sync_progress_start_failed', { hospitalId, runId, error });
  }
  return runId;
}

export async function appendSyncStep(
  hospitalId: string,
  runId: string,
  step: PollHospitalStep,
): Promise<void> {
  try {
    const cache = await loadCache();
    const run = await cache.cacheGetJson<SyncProgressRun>(runKey(hospitalId, runId));
    if (!run) return;
    run.steps.push({ ...step, at: new Date().toISOString() });
    await cache.cacheSetJson(runKey(hospitalId, runId), run, RUN_TTL_SEC);
    await cache.cacheSetJson(latestKey(hospitalId), run, RUN_TTL_SEC);
  } catch (error) {
    logger.warn('sync_progress_step_failed', { hospitalId, runId, error });
  }
}

export async function finalizeSyncRun(
  hospitalId: string,
  runId: string,
  outcome: SyncRunOutcome,
  finalMessage: string | null,
  errorMessage: string | null,
): Promise<void> {
  try {
    const cache = await loadCache();
    const run = await cache.cacheGetJson<SyncProgressRun>(runKey(hospitalId, runId));
    if (!run) return;
    const finishedAt = new Date().toISOString();
    run.finishedAt = finishedAt;
    run.durationMs = new Date(finishedAt).getTime() - new Date(run.startedAt).getTime();
    run.outcome = outcome;
    run.finalMessage = finalMessage;
    run.errorMessage = errorMessage;
    await cache.cacheSetJson(runKey(hospitalId, runId), run, RUN_TTL_SEC);
    await cache.cacheSetJson(latestKey(hospitalId), run, RUN_TTL_SEC);
  } catch (error) {
    logger.warn('sync_progress_finalize_failed', { hospitalId, runId, error });
  }
}

export async function getLatestSyncRun(hospitalId: string): Promise<SyncProgressRun | null> {
  const cache = await loadCache();
  return cache.cacheGetJson<SyncProgressRun>(latestKey(hospitalId));
}

/**
 * Record a "skipped" run when the polling cycle short-circuits BEFORE
 * reaching pollHospital — e.g. authenticity cooldown. Without this,
 * the Sync Log tab is empty for blocked hospitals (the user can't tell
 * "is the system trying?" from "the system never tried").
 *
 * Deduped: if the most recent run for this hospital is already a skip
 * with the same reason and was written within the last 5 minutes, this
 * is a no-op — otherwise blocked hospitals would write a new run every
 * 30 s for hours, polluting the trail.
 */
export async function recordSkippedSyncRun(
  hospitalId: string,
  hcode: string,
  trigger: SyncRunTrigger,
  reason: string,
  message: string,
): Promise<void> {
  try {
    const latest = await getLatestSyncRun(hospitalId);
    const skipRecentlyAlreadyRecorded =
      latest &&
      latest.outcome === 'failed' &&
      latest.errorMessage === reason &&
      Date.now() - new Date(latest.startedAt).getTime() < 5 * 60 * 1000;
    if (skipRecentlyAlreadyRecorded) return;

    const runId = await startSyncRun(hospitalId, hcode, trigger);
    await appendSyncStep(hospitalId, runId, {
      name: 'cycle_skipped',
      status: 'info',
      message,
      detail: reason,
    });
    await finalizeSyncRun(hospitalId, runId, 'failed', message, reason);
  } catch (error) {
    logger.warn('sync_progress_skip_failed', { hospitalId, reason, error });
  }
}

export async function listSyncRuns(hospitalId: string, limit = 20): Promise<SyncProgressRun[]> {
  const cache = await loadCache();
  const keys = await cache.cacheKeys(`sync:run:${hospitalId}:*`);
  const runs = (await Promise.all(keys.map((k) => cache.cacheGetJson<SyncProgressRun>(k)))).filter(
    (r): r is SyncProgressRun => r !== null,
  );
  // newest first — runId is ISO-timestamp-prefixed, so startedAt sort works.
  runs.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  return runs.slice(0, limit);
}
