import type { DatabaseAdapter } from '@/db/adapter';
import type { DatabaseDialect } from '@/config/hosxp-queries';
import { getEncryptionKey } from '@/lib/encryption';
import { SseManager } from '@/lib/sse';
import { logger } from '@/lib/logger';
import { pollHospital, type PollHospitalStats, type PollHospitalStep } from './polling';

export interface OnboardingHosxpSyncStep extends PollHospitalStep {
  at: string;
  cycle: number;
}

interface OnboardingSyncJob {
  interval: ReturnType<typeof setInterval>;
  startedAt: number;
  lastRunAt: number | null;
  lastSuccessAt: number | null;
  lastErrorAt: number | null;
  lastError: string | null;
  cycleCount: number;
  successCount: number;
  phase: 'scheduled' | 'querying_hosxp' | 'complete' | 'failed';
  fingerprint: string;
  intervalMs: number;
  ttlMs: number;
  lastStats: PollHospitalStats | null;
  lastSteps: OnboardingHosxpSyncStep[];
}

export interface StartOnboardingHosxpSyncInput {
  db: DatabaseAdapter;
  hospitalId: string;
  hcode: string;
  bmsUrl: string;
  bearerToken: string;
  databaseType: DatabaseDialect;
  marketplaceToken?: string | null;
  sseManager?: SseManager;
  /** When true, the call is treated as an explicit admin re-onboard: any
   *  prior `data_purged_at` flag on hospital_bms_config is cleared before
   *  the sync starts. Default false so a stray heartbeat from a stale
   *  browser tab can't undo a purge. */
  confirmReonboard?: boolean;
}

export interface StartOnboardingHosxpSyncResult {
  started: boolean;
  alreadyRunning: boolean;
  intervalMs: number;
  ttlMs: number;
  /** Set when the hospital was purged via /api/admin/hospitals/[hcode]/data
   *  and the caller didn't pass confirmReonboard=true. The sync stays
   *  suspended; the UI should show "ข้อมูลถูกลบ — กรุณายืนยันเชื่อมต่อใหม่"
   *  with a button that POSTs again with confirmReonboard=true. */
  purgedPendingReonboard?: boolean;
  purgedAt?: string | null;
}

export interface OnboardingHosxpSyncRuntimeStatus {
  running: boolean;
  phase: 'stopped' | OnboardingSyncJob['phase'];
  startedAt: string | null;
  expiresAt: string | null;
  lastRunAt: string | null;
  lastSuccessAt: string | null;
  lastErrorAt: string | null;
  lastError: string | null;
  nextRunAt: string | null;
  cycleCount: number;
  successCount: number;
  intervalMs: number | null;
  ttlMs: number | null;
  lastStats: PollHospitalStats | null;
  lastSteps: OnboardingHosxpSyncStep[];
}

const jobs = new Map<string, OnboardingSyncJob>();

const DEFAULT_INTERVAL_MS = 30_000;
const DEFAULT_TTL_MS = 8 * 60 * 60 * 1000;

function readPositiveIntEnv(name: string, fallback: number): number {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

function getIntervalMs(): number {
  return Math.max(
    10_000,
    readPositiveIntEnv('HOSXP_ONBOARD_SYNC_INTERVAL_MS', DEFAULT_INTERVAL_MS),
  );
}

function getTtlMs(): number {
  return Math.max(
    60_000,
    readPositiveIntEnv('HOSXP_ONBOARD_SYNC_TTL_MS', DEFAULT_TTL_MS),
  );
}

function fingerprint(input: StartOnboardingHosxpSyncInput): string {
  const tokenPrefix = input.bearerToken.slice(0, 12);
  const mpPrefix = input.marketplaceToken?.slice(0, 12) ?? '';
  return [
    input.hospitalId,
    input.bmsUrl.replace(/\/$/, ''),
    input.databaseType,
    tokenPrefix,
    mpPrefix,
  ].join('|');
}

export function stopOnboardingHosxpSync(hospitalId: string): boolean {
  const existing = jobs.get(hospitalId);
  if (!existing) return false;
  clearInterval(existing.interval);
  jobs.delete(hospitalId);
  return true;
}

export function getOnboardingHosxpSyncStatus(
  hospitalId: string,
): OnboardingHosxpSyncRuntimeStatus {
  const job = jobs.get(hospitalId);
  if (!job) {
    return {
      running: false,
      phase: 'stopped',
      startedAt: null,
      expiresAt: null,
      lastRunAt: null,
      lastSuccessAt: null,
      lastErrorAt: null,
      lastError: null,
      nextRunAt: null,
      cycleCount: 0,
      successCount: 0,
      intervalMs: null,
      ttlMs: null,
      lastStats: null,
      lastSteps: [],
    };
  }

  const lastAnchor = job.lastRunAt ?? job.startedAt;
  return {
    running: true,
    phase: job.phase,
    startedAt: new Date(job.startedAt).toISOString(),
    expiresAt: new Date(job.startedAt + job.ttlMs).toISOString(),
    lastRunAt: job.lastRunAt ? new Date(job.lastRunAt).toISOString() : null,
    lastSuccessAt: job.lastSuccessAt ? new Date(job.lastSuccessAt).toISOString() : null,
    lastErrorAt: job.lastErrorAt ? new Date(job.lastErrorAt).toISOString() : null,
    lastError: job.lastError,
    nextRunAt: new Date(lastAnchor + job.intervalMs).toISOString(),
    cycleCount: job.cycleCount,
    successCount: job.successCount,
    intervalMs: job.intervalMs,
    ttlMs: job.ttlMs,
    lastStats: job.lastStats,
    lastSteps: job.lastSteps,
  };
}

export function _resetOnboardingHosxpSyncForTesting(): void {
  for (const job of jobs.values()) {
    clearInterval(job.interval);
  }
  jobs.clear();
}

export async function startOnboardingHosxpSync(
  input: StartOnboardingHosxpSyncInput,
): Promise<StartOnboardingHosxpSyncResult> {
  const intervalMs = getIntervalMs();
  const ttlMs = getTtlMs();

  // is_active guard. When admin toggles "เปิดใช้งาน" off in /admin, the
  // hospital should be inert — neither dashboard reads nor sync writes. A
  // still-open admin tab on `/` keeps firing useOnboardHosxpSync, so we
  // have to enforce this server-side rather than relying on the browser
  // to stop. Returning a no-op result lets the hook log "blocked" and
  // stop polling status (it gates on .started || .alreadyRunning).
  const hospitalRows = await input.db.query<{ is_active: boolean | number }>(
    'SELECT is_active FROM hospitals WHERE id = ?',
    [input.hospitalId],
  );
  const hospitalActive = hospitalRows[0]?.is_active === true ||
    hospitalRows[0]?.is_active === 1;
  if (!hospitalActive) {
    // Stop any in-flight job from a prior active state so the next cycle
    // doesn't fire after the toggle flips.
    if (jobs.has(input.hospitalId)) {
      stopOnboardingHosxpSync(input.hospitalId);
    }
    logger.info('onboarding_hosxp_sync_blocked_hospital_inactive', {
      hcode: input.hcode,
      hospitalId: input.hospitalId,
    });
    return {
      started: false,
      alreadyRunning: false,
      intervalMs,
      ttlMs,
    };
  }

  // Purge guard. /api/admin/hospitals/[hcode]/data sets data_purged_at when
  // the admin wipes a hospital's cached data; the request must arrive with
  // confirmReonboard=true to clear it.
  //
  // Callers that explicitly intend to re-onboard:
  //   - Admin click "เปิดใช้งาน Sync อีกครั้ง" → POST /api/admin/.../clear-purge
  //     (server-only flag clear; sync resumes on next user open of /).
  //   - User opens / or /hospital-maternity-ward → useOnboardHosxpSync hook
  //     posts here with confirmReonboard=true (the hook is ref-guarded so
  //     it fires at most once per tab, and is NOT mounted on /admin, so an
  //     admin mid-purge can't accidentally undo via their own tab).
  //
  // For permanent blocks, admins should also set is_active=false on the
  // hospital — the purge flag alone is "clean and let next user re-sync",
  // not "stay off forever".
  const purgeRows = await input.db.query<{ data_purged_at: string | null }>(
    'SELECT data_purged_at FROM hospital_bms_config WHERE hospital_id = ?',
    [input.hospitalId],
  );
  const purgedAt = purgeRows[0]?.data_purged_at ?? null;
  if (purgedAt && !input.confirmReonboard) {
    logger.info('onboarding_hosxp_sync_blocked_purged_pending_reonboard', {
      hcode: input.hcode,
      hospitalId: input.hospitalId,
      purgedAt,
    });
    return {
      started: false,
      alreadyRunning: false,
      intervalMs,
      ttlMs,
      purgedPendingReonboard: true,
      purgedAt,
    };
  }
  if (purgedAt && input.confirmReonboard) {
    await input.db.execute(
      `UPDATE hospital_bms_config
          SET data_purged_at = NULL,
              last_authenticity_status = NULL,
              last_authenticity_reason = NULL,
              updated_at = ?
        WHERE hospital_id = ?`,
      [new Date().toISOString(), input.hospitalId],
    );
    logger.info('onboarding_hosxp_sync_purge_flag_cleared', {
      hcode: input.hcode,
      hospitalId: input.hospitalId,
    });
  }

  const nextFingerprint = fingerprint(input);
  const existing = jobs.get(input.hospitalId);

  if (existing?.fingerprint === nextFingerprint) {
    return { started: false, alreadyRunning: true, intervalMs, ttlMs };
  }

  if (existing) {
    clearInterval(existing.interval);
    jobs.delete(input.hospitalId);
  }

  const sseManager = input.sseManager ?? SseManager.getInstance();
  const encryptionKey = getEncryptionKey();
  const bmsUrl = input.bmsUrl.replace(/\/$/, '');
  let running = false;
  const startedAt = Date.now();

  const runOnce = async () => {
    if (running) return;
    if (Date.now() - startedAt > ttlMs) {
      stopOnboardingHosxpSync(input.hospitalId);
      logger.info('onboarding_hosxp_sync_expired', {
        hcode: input.hcode,
        hospitalId: input.hospitalId,
      });
      return;
    }

    running = true;
    const job = jobs.get(input.hospitalId);
    if (job) {
      job.lastRunAt = Date.now();
      job.cycleCount += 1;
      job.phase = 'querying_hosxp';
      job.lastSteps = [{
        at: new Date().toISOString(),
        cycle: job.cycleCount,
        name: 'cycle_start',
        status: 'running',
        message: `Starting HOSxP sync cycle for hcode ${input.hcode}`,
        detail: `db=${input.databaseType}; interval=${intervalMs}ms`,
      }];
    }
    try {
      const appendStep = (step: PollHospitalStep) => {
        const target = jobs.get(input.hospitalId);
        if (!target) return;
        target.lastSteps.push({
          ...step,
          at: new Date().toISOString(),
          cycle: target.cycleCount,
        });
        if (target.lastSteps.length > 80) {
          target.lastSteps = target.lastSteps.slice(-80);
        }
      };
      const stats = await pollHospital(
        input.db,
        input.hospitalId,
        bmsUrl,
        bmsUrl,
        input.bearerToken,
        input.databaseType,
        encryptionKey,
        sseManager,
        {
          marketplaceToken: input.marketplaceToken,
          onStep: appendStep,
          trigger: 'onboarding',
        },
      );
      logger.info('onboarding_hosxp_sync_cycle_complete', {
        hcode: input.hcode,
        hospitalId: input.hospitalId,
      });
      const done = jobs.get(input.hospitalId);
      if (done) {
        done.lastSuccessAt = Date.now();
        done.successCount += 1;
        done.lastError = null;
        done.lastErrorAt = null;
        done.phase = 'complete';
        done.lastStats = stats;
        done.lastSteps.push({
          at: new Date().toISOString(),
          cycle: done.cycleCount,
          name: 'cycle_complete',
          status: 'success',
          message: 'Cycle completed and local cache was updated.',
          counts: {
            iptSynced: stats.activePatientsSynced,
            ancSynced: stats.anc.patientsSynced,
            ancVisits: stats.anc.servicesMapped,
            partographUpserted: stats.partographRowsUpserted,
          },
        });
      }
    } catch (error) {
      const failed = jobs.get(input.hospitalId);
      if (failed) {
        failed.lastErrorAt = Date.now();
        failed.lastError = error instanceof Error ? error.message : String(error);
        failed.phase = 'failed';
        failed.lastSteps.push({
          at: new Date().toISOString(),
          cycle: failed.cycleCount,
          name: 'cycle_failed',
          status: 'error',
          message: 'Cycle failed before local cache update completed.',
          detail: failed.lastError,
        });
      }
      logger.error('onboarding_hosxp_sync_cycle_failed', {
        hcode: input.hcode,
        hospitalId: input.hospitalId,
        error,
      });
    } finally {
      running = false;
    }
  };

  // Server-side periodic pollHospital is DISABLED — the browser hook
  // useBrowserPoll handles all ongoing HOSxP pulls via the local
  // 127.0.0.1:45011 gateway. The onboarding endpoint still establishes
  // the BMS session config / marketplace_token / purge-clear above; we
  // just don't run the interval here. We also skip the initial runOnce()
  // because the browser will fire its first poll within 30 s anyway.
  // `runOnce` is preserved (referenced via no-op timer) so the existing
  // status-reporting machinery keeps compiling without change.
  void runOnce; // explicit no-op reference — silences unused-var lint
  const interval = setInterval(() => {
    /* polling disabled — browser-only mode */
  }, intervalMs);
  jobs.set(input.hospitalId, {
    interval,
    startedAt,
    lastRunAt: null,
    lastSuccessAt: null,
    lastErrorAt: null,
    lastError: null,
    cycleCount: 0,
    successCount: 0,
    phase: 'scheduled',
    fingerprint: nextFingerprint,
    intervalMs,
    ttlMs,
    lastStats: null,
    lastSteps: [],
  });

  logger.info('onboarding_hosxp_sync_started_browser_only', {
    hcode: input.hcode,
    hospitalId: input.hospitalId,
    ttlMs,
    databaseType: input.databaseType,
  });

  return { started: true, alreadyRunning: false, intervalMs, ttlMs };
}
