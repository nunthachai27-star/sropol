// Dev-only API-key cache for the simulation orchestrator.
//
// When the user calls `/api/dev/simulate/start`, the orchestrator switches
// over to hitting the real webhook endpoint over HTTP (so auth, routing,
// validation, and error handling are all exercised — not just the service
// functions). For that to work each hospital needs a valid Bearer token.
//
// This module:
//  1. Auto-issues ONE labeled API key per hospital on first use
//     (label = `sim:dev:<hcode>`), using the existing `createApiKey` service
//     so keys go through the normal SHA-256 hash + DB row path.
//  2. Caches the raw keys in process memory for the lifetime of the server
//     (raw key = displayed only at creation time per production rules;
//     holding it in the dev process is a deliberate dev-only compromise).
//  3. Reuses an in-memory key if already issued this process.
//  4. Provides `revokeDevApiKeys()` so the orchestrator can clean up on stop.
//
// This file HARD-REFUSES to run when the simulator is disabled — calling any
// function while `isSimulationEnabled()` returns false throws. The UI and
// orchestrator also gate themselves separately through the same helper.

import type { DatabaseAdapter } from '@/db/adapter';
import { createApiKey, revokeApiKey } from '@/services/webhook';
import { logger } from '@/lib/logger';
import { isSimulationEnabled } from '@/lib/feature-flags';

const SIM_LABEL_PREFIX = 'sim:dev:';

interface CachedKey {
  keyId: string;
  rawKey: string;
}

// Keyed by hcode. Survives HMR via `global` attachment.
const globalAny = global as unknown as {
  __simApiKeyCache?: Map<string, CachedKey>;
};
const cache: Map<string, CachedKey> =
  globalAny.__simApiKeyCache ?? new Map<string, CachedKey>();
if (!globalAny.__simApiKeyCache) globalAny.__simApiKeyCache = cache;

function ensureDev(): void {
  if (!isSimulationEnabled()) {
    throw new Error('Simulation API key cache disabled by feature flag');
  }
}

/**
 * Returns a valid Bearer key for the given hospital, issuing one if this
 * process hasn't seen the hospital before.
 *
 * Before handing back a cached key, we verify the underlying DB row is still
 * active. If it's not (e.g. someone DELETE'd the row but the in-process cache
 * wasn't cleared — a known cause of every-thread-401s after clear+start), we
 * drop the stale entry and create a fresh key instead.
 */
export async function getOrCreateDevApiKey(
  db: DatabaseAdapter,
  hospitalId: string,
  hcode: string,
): Promise<string> {
  ensureDev();
  const hit = cache.get(hcode);
  if (hit) {
    const rows = await db.query<{ id: string }>(
      `SELECT id FROM webhook_api_keys
       WHERE id = ? AND is_active = true AND revoked_at IS NULL`,
      [hit.keyId],
    );
    if (rows.length > 0) return hit.rawKey;
    // Stale cache entry — DB row is gone or revoked. Drop and reissue below.
    cache.delete(hcode);
    logger.warn('sim_api_key_cache_stale', { hcode, keyId: hit.keyId });
  }
  const { id, rawKey } = await createApiKey(db, hospitalId, `${SIM_LABEL_PREFIX}${hcode}`);
  cache.set(hcode, { keyId: id, rawKey });
  logger.info('sim_api_key_issued', { hcode, keyId: id });
  return rawKey;
}

/**
 * Clears the in-process key cache without touching the DB. Use when the DB
 * rows were deleted out-of-band (e.g. simulate/clear wipes the whole table).
 */
export function clearDevApiKeyCache(): void {
  cache.clear();
}

/**
 * Current size of the in-process key cache. Used by the clear route to
 * report how many stale entries were purged.
 */
export function getDevApiKeyCacheSize(): number {
  return cache.size;
}

/**
 * Revoke every key this process has issued for simulation. Called from the
 * orchestrator's stop path so the DB doesn't accumulate dev keys across runs.
 */
export async function revokeDevApiKeys(db: DatabaseAdapter): Promise<number> {
  ensureDev();
  let revoked = 0;
  for (const [, { keyId }] of cache.entries()) {
    try {
      await revokeApiKey(db, keyId);
      revoked += 1;
    } catch (err) {
      logger.warn('sim_api_key_revoke_failed', {
        keyId,
        err: err instanceof Error ? err.message : String(err),
      });
    }
  }
  cache.clear();
  return revoked;
}
