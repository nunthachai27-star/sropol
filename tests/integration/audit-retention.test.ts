// Integration tests: 30-day audit_logs retention (operator-requested
// 2026-07-17 — production audit_logs reached 1.8GB / 4.3M rows with no
// retention policy). Uses the shared PGlite harness (createTestDb) since
// this feature does no DDL — see tests/helpers/testDb.ts.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import { createTestDb } from '../helpers/testDb';
import { FailingAdapter } from '../helpers/failingDb';
import type { DatabaseAdapter } from '@/db/adapter';
import {
  purgeOldAuditLogs,
  auditLogRetentionDays,
  scheduleAuditLogRetention,
  stopAuditLogRetentionSchedule,
  AUDIT_LOG_RETENTION_DAYS_DEFAULT,
} from '@/services/audit-retention';

const DAY_MS = 24 * 60 * 60 * 1000;

async function insertAuditLog(db: DatabaseAdapter, createdAt: Date): Promise<string> {
  const id = uuidv4();
  await db.execute(
    `INSERT INTO audit_logs (id, action, resource_type, created_at) VALUES (?, ?, ?, ?)`,
    [id, 'VIEW_PATIENT', 'PATIENT', createdAt.toISOString()],
  );
  return id;
}

async function countAuditLogs(db: DatabaseAdapter): Promise<number> {
  const rows = await db.query<{ c: number }>(`SELECT COUNT(*)::int AS c FROM audit_logs`);
  return Number(rows[0].c);
}

describe('purgeOldAuditLogs', () => {
  let db: DatabaseAdapter;
  const now = new Date('2026-07-17T12:00:00.000Z');

  beforeEach(async () => {
    db = await createTestDb();
  });

  it('deletes rows older than the retention window and keeps recent rows', async () => {
    // 3 old (40 days), 2 recent (10 days).
    await insertAuditLog(db, new Date(now.getTime() - 40 * DAY_MS));
    await insertAuditLog(db, new Date(now.getTime() - 35 * DAY_MS));
    await insertAuditLog(db, new Date(now.getTime() - 31 * DAY_MS));
    const recent1 = await insertAuditLog(db, new Date(now.getTime() - 10 * DAY_MS));
    const recent2 = await insertAuditLog(db, new Date(now.getTime() - 1 * DAY_MS));

    const result = await purgeOldAuditLogs(db, { retentionDays: 30, now });

    expect(result).toEqual({
      deleted: 3,
      batches: 1,
      cutoff: new Date(now.getTime() - 30 * DAY_MS),
    });
    expect(await countAuditLogs(db)).toBe(2);

    const remaining = await db.query<{ id: string }>(`SELECT id FROM audit_logs ORDER BY id`);
    const remainingIds = remaining.map((r) => r.id).sort();
    expect(remainingIds).toEqual([recent1, recent2].sort());
  });

  it('batches the delete loop and terminates (batchSize 2, 5 old rows -> 3 batches)', async () => {
    for (let i = 0; i < 5; i++) {
      await insertAuditLog(db, new Date(now.getTime() - (40 + i) * DAY_MS));
    }

    const result = await purgeOldAuditLogs(db, { retentionDays: 30, batchSize: 2, now });

    expect(result.deleted).toBe(5);
    expect(result.batches).toBe(3);
    expect(await countAuditLogs(db)).toBe(0);
  });

  it('is a no-op when there are no rows past the cutoff', async () => {
    await insertAuditLog(db, new Date(now.getTime() - 1 * DAY_MS));
    const result = await purgeOldAuditLogs(db, { retentionDays: 30, now });
    expect(result).toEqual({
      deleted: 0,
      batches: 0,
      cutoff: new Date(now.getTime() - 30 * DAY_MS),
    });
    expect(await countAuditLogs(db)).toBe(1);
  });

  it('skips the purge entirely when retentionDays resolves to null ("off")', async () => {
    await insertAuditLog(db, new Date(now.getTime() - 400 * DAY_MS));
    const result = await purgeOldAuditLogs(db, { retentionDays: null, now });
    expect(result).toEqual({ deleted: 0, batches: 0, cutoff: null });
    expect(await countAuditLogs(db)).toBe(1);
  });

  it('resolves retentionDays from AUDIT_LOG_RETENTION_DAYS=off end-to-end and skips the purge', async () => {
    vi.stubEnv('AUDIT_LOG_RETENTION_DAYS', 'off');
    try {
      await insertAuditLog(db, new Date(now.getTime() - 400 * DAY_MS));
      const result = await purgeOldAuditLogs(db, { now });
      expect(result.deleted).toBe(0);
      expect(await countAuditLogs(db)).toBe(1);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('tolerates a purge failure and returns an error indicator instead of throwing', async () => {
    await insertAuditLog(db, new Date(now.getTime() - 400 * DAY_MS));
    const failing = new FailingAdapter(db, /DELETE FROM audit_logs/);

    const result = await purgeOldAuditLogs(failing, { retentionDays: 30, now });

    expect(result.deleted).toBe(0);
    expect(result.batches).toBe(0);
    expect(result.cutoff).toBeNull();
    expect(result.error).toBeTruthy();
    // The row was never touched — the failure happened before any commit.
    expect(await countAuditLogs(db)).toBe(1);
  });
});

describe('auditLogRetentionDays', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('defaults to 30 when unset', () => {
    vi.stubEnv('AUDIT_LOG_RETENTION_DAYS', '');
    expect(auditLogRetentionDays()).toBe(AUDIT_LOG_RETENTION_DAYS_DEFAULT);
  });

  it.each(['0', '-5', 'abc', '3.5', '  '])(
    'falls back to the default for invalid value %j (never "delete everything")',
    (value) => {
      vi.stubEnv('AUDIT_LOG_RETENTION_DAYS', value);
      expect(auditLogRetentionDays()).toBe(AUDIT_LOG_RETENTION_DAYS_DEFAULT);
    },
  );

  it('returns null for "off" (case-insensitive) — explicit opt-out', () => {
    vi.stubEnv('AUDIT_LOG_RETENTION_DAYS', 'OFF');
    expect(auditLogRetentionDays()).toBeNull();
  });

  it('honors a valid positive integer', () => {
    vi.stubEnv('AUDIT_LOG_RETENTION_DAYS', '90');
    expect(auditLogRetentionDays()).toBe(90);
  });
});

describe('scheduleAuditLogRetention', () => {
  afterEach(() => {
    stopAuditLogRetentionSchedule();
    vi.useRealTimers();
  });

  it('fires an initial delayed purge, re-runs daily, and does not double-register on a second call', async () => {
    vi.useFakeTimers();
    const queryMock = vi.fn(async () => []);
    const fakeDb = { query: queryMock } as unknown as DatabaseAdapter;

    scheduleAuditLogRetention(fakeDb);
    scheduleAuditLogRetention(fakeDb); // idempotent — must not register a second interval

    expect(queryMock).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(5_000);
    expect(queryMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(DAY_MS);
    expect(queryMock).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(DAY_MS);
    expect(queryMock).toHaveBeenCalledTimes(3);
  });
});
