// 30-day audit_logs retention (operator-requested 2026-07-17): production
// audit_logs reached 1.8GB / 4.3M rows with no retention policy. This
// service purges rows older than a configurable window in small batches so
// a multi-million-row first run never holds one long-running transaction or
// blocks the ONE serving event loop (see src/lib/event-loop.ts — same
// incident class as the 2026-07-17 page-latency fix that introduced
// CooperativeYielder).
//
// The retention window is env-configurable (AUDIT_LOG_RETENTION_DAYS), never
// a hardcoded magic number, per the "no hardcoded conditions" project rule —
// it defaults to 30 days when unset.
import type { DatabaseAdapter } from '@/db/adapter';
import { CooperativeYielder } from '@/lib/event-loop';
import { logger } from '@/lib/logger';

export const AUDIT_LOG_RETENTION_DAYS_DEFAULT = 30;

/** Rows deleted per DELETE statement (bounds transaction/lock size). */
const DEFAULT_BATCH_SIZE = 50_000;
/** Delay before the first post-startup purge — lets the initial request burst settle. */
const RETENTION_INITIAL_DELAY_MS = 5_000;
/** Re-run cadence for the in-process scheduler: once a day. */
const RETENTION_INTERVAL_MS = 24 * 60 * 60 * 1000;

/**
 * Resolves the configured retention window from the `AUDIT_LOG_RETENTION_DAYS`
 * environment variable.
 *
 * - Unset / blank            → default (`AUDIT_LOG_RETENTION_DAYS_DEFAULT`, 30 days).
 * - `"off"` (case-insensitive) → `null`, meaning retention is explicitly
 *   disabled and `purgeOldAuditLogs` is a no-op. This is the ONLY way to turn
 *   purging off — it must be a deliberate opt-out, never a side effect of a
 *   bad value.
 * - Non-positive-integer values (`"0"`, `"-5"`, `"abc"`, `"3.5"`) fall back
 *   to the default. A misconfigured env var must never be interpreted as
 *   "delete everything right now" (0/negative cutoff) — fail safe to the
 *   documented default instead.
 * - A valid positive integer is used as-is.
 */
export function auditLogRetentionDays(): number | null {
  const raw = process.env.AUDIT_LOG_RETENTION_DAYS;
  if (raw == null || raw.trim() === '') return AUDIT_LOG_RETENTION_DAYS_DEFAULT;

  const trimmed = raw.trim();
  if (trimmed.toLowerCase() === 'off') return null;

  const parsed = Number(trimmed);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return AUDIT_LOG_RETENTION_DAYS_DEFAULT;
  }
  return parsed;
}

export interface PurgeOldAuditLogsOptions {
  /** Override the resolved retention window (days). Pass `null` to force a skip. */
  retentionDays?: number | null;
  /** Rows deleted per DELETE statement. Default 50,000. */
  batchSize?: number;
  /** Injectable clock for tests. Defaults to `new Date()`. */
  now?: Date;
}

export interface PurgeOldAuditLogsResult {
  deleted: number;
  batches: number;
  /** Cutoff timestamp used — rows with created_at strictly before this were
   *  deleted. `null` when the purge was skipped (retention disabled) or failed. */
  cutoff: Date | null;
  /** Present only when the purge failed. Callers (startup, the daily
   *  scheduler) must NOT treat this as fatal — retention failing must never
   *  take the app down. */
  error?: string;
}

/**
 * Deletes audit_logs rows older than the retention window, in batches, so a
 * multi-million-row backlog never holds one long transaction or blocks the
 * event loop. Never throws — a failure here must not take down startup or
 * the daily scheduler; callers get an `error` field back instead.
 *
 * Uses the `DELETE ... WHERE id IN (SELECT id ... LIMIT n) RETURNING id`
 * form because PostgreSQL's DELETE has no LIMIT clause of its own.
 */
export async function purgeOldAuditLogs(
  db: DatabaseAdapter,
  opts: PurgeOldAuditLogsOptions = {},
): Promise<PurgeOldAuditLogsResult> {
  const retentionDays =
    opts.retentionDays !== undefined ? opts.retentionDays : auditLogRetentionDays();

  if (retentionDays === null) {
    logger.debug('audit_logs_purge_skipped', { reason: 'retention_disabled' });
    return { deleted: 0, batches: 0, cutoff: null };
  }

  const batchSize = opts.batchSize ?? DEFAULT_BATCH_SIZE;
  const now = opts.now ?? new Date();
  const cutoff = new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1000);

  try {
    const yielder = new CooperativeYielder();
    let deleted = 0;
    let batches = 0;

    for (;;) {
      const rows = await db.query<{ id: string }>(
        `DELETE FROM audit_logs
          WHERE id IN (
            SELECT id FROM audit_logs WHERE created_at < ? LIMIT ?
          )
          RETURNING id`,
        [cutoff.toISOString(), batchSize],
      );
      if (rows.length === 0) break;
      deleted += rows.length;
      batches++;
      // Never yield inside a transaction — this loop issues one
      // autocommitted DELETE per batch, no explicit transaction wraps it.
      await yielder.tick();
    }

    if (deleted > 0) {
      // Counts and dates only — no PHI, no row identifiers beyond a total.
      logger.info('audit_logs_purged', { deleted, batches, retentionDays });
    } else {
      logger.debug('audit_logs_purge_noop', { retentionDays });
    }
    return { deleted, batches, cutoff };
  } catch (error) {
    logger.error('audit_logs_purge_failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      deleted: 0,
      batches: 0,
      cutoff: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

// --- In-process daily scheduling ---------------------------------------

interface RetentionScheduleState {
  interval: ReturnType<typeof setInterval>;
}

// HMR-safe: pin the daily-interval handle on globalThis (same pattern as
// SseManager.getInstance in src/lib/sse.ts) so a Next.js dev reload doesn't
// register a second competing interval on top of the one from the previous
// module instance.
const _global = globalThis as unknown as { __auditRetentionSchedule?: RetentionScheduleState };

/**
 * Registers the audit_logs retention purge: one fire-and-forget run shortly
 * after startup (NOT awaited by the caller — a 4.3M-row first run could take
 * minutes and must not delay the ~700ms startup path), then a daily re-run
 * for as long as the process lives.
 *
 * Idempotent — a second call while a schedule is already registered (HMR
 * reload in dev) is a no-op. Both timers are `.unref?.()`d so they never
 * hold a short-lived process (tests, CLI) open.
 */
export function scheduleAuditLogRetention(db: DatabaseAdapter): void {
  if (_global.__auditRetentionSchedule) return;

  const runOnce = (): void => {
    // purgeOldAuditLogs() already catches internally and never rejects;
    // this .catch is defense in depth against an unhandled-rejection crash
    // if that contract ever changes.
    purgeOldAuditLogs(db).catch((error) => {
      logger.error('audit_logs_purge_failed', {
        error: error instanceof Error ? error.message : String(error),
      });
    });
  };

  const initialTimer = setTimeout(runOnce, RETENTION_INITIAL_DELAY_MS);
  initialTimer.unref?.();

  const interval = setInterval(runOnce, RETENTION_INTERVAL_MS);
  interval.unref?.();

  _global.__auditRetentionSchedule = { interval };
}

/**
 * Tears down the scheduled interval — mirrors stopPolling() in
 * src/services/sync/polling.ts. Called from shutdownApp() on graceful
 * shutdown, and from tests that need a clean globalThis slate between runs
 * (e.g. to re-register with a different injected db/clock).
 */
export function stopAuditLogRetentionSchedule(): void {
  if (_global.__auditRetentionSchedule) {
    clearInterval(_global.__auditRetentionSchedule.interval);
    _global.__auditRetentionSchedule = undefined;
  }
}
