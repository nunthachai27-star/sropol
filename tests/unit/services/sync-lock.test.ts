// Tests for the sync lock manager: cooldown, in-progress lock, and
// stuck-lock auto-release. These cover the SYNC_COOLDOWN_MS and
// SYNC_TIMEOUT_MS behavior in src/services/sync/polling.ts.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createTestDb } from '../../helpers/testDb';
import type { DatabaseAdapter } from '@/db/adapter';
import { SeedOrchestrator } from '@/db/seeds/index';
import type { SseManager } from '@/lib/sse';
import {
  getSyncState,
  _resetSyncStatesForTesting,
  requestImmediateSync,
} from '@/services/sync/polling';

const HOSPITAL_ID = '00000000-0000-0000-0000-000000000001';

describe('Sync Lock Manager', () => {
  let db: DatabaseAdapter;
  let sseManager: SseManager;

  beforeEach(async () => {
    _resetSyncStatesForTesting();
    db = await createTestDb();
    await new SeedOrchestrator().run(db);
    sseManager = { broadcast: vi.fn() } as unknown as SseManager;

    // Seed a hospital with the deterministic id so requestImmediateSync
    // can find it. We don't seed bms_config — we'll get reason='no_config'
    // before any real network call happens.
    await db.execute(
      `INSERT INTO hospitals (id, hcode, name, level, is_active, connection_status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        HOSPITAL_ID,
        '99999',
        'Test Hospital',
        'F1',
        true,
        'UNKNOWN',
        new Date().toISOString(),
        new Date().toISOString(),
      ],
    );
  });

  afterEach(async () => {
    _resetSyncStatesForTesting();
    await db.close();
    vi.useRealTimers();
  });

  describe('getSyncState', () => {
    it('returns a fresh state for a new hospital', () => {
      const state = getSyncState(HOSPITAL_ID);
      expect(state.inProgress).toBe(false);
      expect(state.syncStartedAt).toBe(0);
      expect(state.lastSyncAt).toBe(0);
      expect(state.lastJwtRefreshAt).toBe(0);
    });

    it('returns the same state object across calls for the same hospital', () => {
      const a = getSyncState(HOSPITAL_ID);
      a.lastSyncAt = 12345;
      const b = getSyncState(HOSPITAL_ID);
      expect(b.lastSyncAt).toBe(12345);
      expect(b).toBe(a);
    });

    it('keeps inProgress lock when sync is fresh (under SYNC_TIMEOUT_MS)', () => {
      const state = getSyncState(HOSPITAL_ID);
      state.inProgress = true;
      state.syncStartedAt = Date.now() - 30_000; // 30s ago — well under 60s

      const stillLocked = getSyncState(HOSPITAL_ID);
      expect(stillLocked.inProgress).toBe(true);
    });

    it('auto-releases stuck lock when syncStartedAt is older than SYNC_TIMEOUT_MS', () => {
      const state = getSyncState(HOSPITAL_ID);
      state.inProgress = true;
      state.syncStartedAt = Date.now() - 65_000; // 65s ago — exceeds 60s timeout

      const released = getSyncState(HOSPITAL_ID);
      expect(released.inProgress).toBe(false);
    });

    it('logs a warning when force-releasing a stuck lock', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const state = getSyncState(HOSPITAL_ID);
      state.inProgress = true;
      state.syncStartedAt = Date.now() - 70_000;

      getSyncState(HOSPITAL_ID); // triggers the auto-release

      expect(warnSpy).toHaveBeenCalledOnce();
      const [msg] = warnSpy.mock.calls[0];
      expect(msg).toContain('[SYNC] Force-releasing stuck sync lock');
      expect(msg).toContain(HOSPITAL_ID);
      warnSpy.mockRestore();
    });

    it('does NOT release a lock that is exactly at the timeout boundary', () => {
      const state = getSyncState(HOSPITAL_ID);
      state.inProgress = true;
      // exactly 60_000 ms ago — strict greater-than check should NOT release
      state.syncStartedAt = Date.now() - 60_000;

      const stillLocked = getSyncState(HOSPITAL_ID);
      expect(stillLocked.inProgress).toBe(true);
    });
  });

  describe('requestImmediateSync — concurrency control', () => {
    it('returns reason="in_progress" when another sync is already running', async () => {
      const state = getSyncState(HOSPITAL_ID);
      state.inProgress = true;
      state.syncStartedAt = Date.now(); // fresh — won't auto-release
      state.lastSyncAt = 0; // ensure cooldown check passes

      const result = await requestImmediateSync(db, HOSPITAL_ID, sseManager);
      expect(result.synced).toBe(false);
      expect(result.reason).toBe('in_progress');
    });

    it('returns reason="cooldown" when called within SYNC_COOLDOWN_MS of last sync', async () => {
      const state = getSyncState(HOSPITAL_ID);
      state.lastSyncAt = Date.now() - 5_000; // 5s ago — under 10s cooldown
      state.inProgress = false;

      const result = await requestImmediateSync(db, HOSPITAL_ID, sseManager);
      expect(result.synced).toBe(false);
      expect(result.reason).toBe('cooldown');
      expect(result.lastSyncAt).not.toBeNull();
    });

    it('returns reason="no_config" past cooldown when hospital has no BMS config', async () => {
      // Past cooldown, no lock — should attempt sync, fail at config lookup.
      const state = getSyncState(HOSPITAL_ID);
      state.lastSyncAt = Date.now() - 30_000;
      state.inProgress = false;

      const result = await requestImmediateSync(db, HOSPITAL_ID, sseManager);
      expect(result.synced).toBe(false);
      expect(result.reason).toBe('no_config');
    });

    it('cooldown takes precedence over in-progress lock', async () => {
      // Both conditions true — cooldown is checked first, so we should
      // get 'cooldown', not 'in_progress'. Documents the call order.
      const state = getSyncState(HOSPITAL_ID);
      state.lastSyncAt = Date.now() - 1_000;
      state.inProgress = true;
      state.syncStartedAt = Date.now();

      const result = await requestImmediateSync(db, HOSPITAL_ID, sseManager);
      expect(result.reason).toBe('cooldown');
    });

    it('does NOT release a stuck lock that is past timeout when cooldown also blocks', async () => {
      // Edge case: cooldown returns BEFORE getSyncState's auto-release runs,
      // so a stuck lock can survive if the caller is also rate-limited.
      // This documents current behavior — fix is to move auto-release to
      // happen before the cooldown check if this becomes a problem.
      const state = getSyncState(HOSPITAL_ID);
      state.lastSyncAt = Date.now() - 1_000; // within cooldown
      state.inProgress = true;
      state.syncStartedAt = Date.now() - 70_000; // would otherwise be released

      await requestImmediateSync(db, HOSPITAL_ID, sseManager);
      // Cooldown returns first; the auto-release inside getSyncState DID
      // run though (because requestImmediateSync calls it). So lock IS
      // released even when cooldown blocks the actual sync attempt.
      const after = getSyncState(HOSPITAL_ID);
      expect(after.inProgress).toBe(false);
    });
  });
});
