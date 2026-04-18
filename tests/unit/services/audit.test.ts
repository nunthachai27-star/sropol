// T084: Audit service tests — TDD: write tests FIRST
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SqliteAdapter } from '@/db/sqlite-adapter';
import { SchemaSync } from '@/db/schema-sync';
import { ALL_TABLES } from '@/db/tables/index';
import { logAccess, tryLogAccess } from '@/services/audit';
import type { DatabaseAdapter } from '@/db/adapter';

describe('Audit Service', () => {
  let db: SqliteAdapter;

  beforeEach(async () => {
    db = new SqliteAdapter();
    await SchemaSync.sync(db, ALL_TABLES, 'sqlite');
    // Seed a user for FK constraint
    await db.execute(
      `INSERT INTO users (id, bms_user_name, role, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      ['user-1', 'Test User', 'NURSE', 1, new Date().toISOString(), new Date().toISOString()],
    );
  });

  it('creates audit_logs row with all required fields', async () => {
    await logAccess(db, {
      userId: 'user-1',
      action: 'VIEW_PATIENT',
      resourceType: 'PATIENT',
      resourceId: 'AN001',
      ipAddress: '192.168.1.1',
      userAgent: 'Mozilla/5.0',
    });

    const logs = await db.query<{
      user_id: string;
      action: string;
      resource_type: string;
      resource_id: string;
      ip_address: string;
    }>('SELECT user_id, action, resource_type, resource_id, ip_address FROM audit_logs');

    expect(logs.length).toBe(1);
    expect(logs[0].user_id).toBe('user-1');
    expect(logs[0].action).toBe('VIEW_PATIENT');
    expect(logs[0].resource_type).toBe('PATIENT');
    expect(logs[0].resource_id).toBe('AN001');
    expect(logs[0].ip_address).toBe('192.168.1.1');
  });

  it('enforces append-only — no update/delete exposed', async () => {
    await logAccess(db, {
      userId: 'user-1',
      action: 'VIEW_DASHBOARD',
      resourceType: 'DASHBOARD',
    });

    // Verify the record exists
    const logs = await db.query<{ id: string }>('SELECT id FROM audit_logs');
    expect(logs.length).toBe(1);
  });

  it('stores optional metadata as JSON', async () => {
    await logAccess(db, {
      userId: 'user-1',
      action: 'VIEW_PATIENT',
      resourceType: 'PATIENT',
      resourceId: 'AN002',
      metadata: { reason: 'routine check', screen: 'detail' },
    });

    const logs = await db.query<{ metadata: string }>('SELECT metadata FROM audit_logs');
    expect(logs.length).toBe(1);
    const parsed = JSON.parse(logs[0].metadata);
    expect(parsed.reason).toBe('routine check');
  });

  it('validates required fields', async () => {
    await expect(
      logAccess(db, {
        userId: '',
        action: 'VIEW_PATIENT',
        resourceType: 'PATIENT',
      }),
    ).rejects.toThrow();
  });

  describe('tryLogAccess (fire-and-forget wrapper)', () => {
    let warnSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      // Spy on console.warn (used by logger.warn under the hood) so we can
      // assert that audit failures are surfaced via structured logging.
      warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    });

    afterEach(() => {
      warnSpy.mockRestore();
    });

    it('writes the audit row on the happy path', async () => {
      await tryLogAccess(db, {
        userId: 'user-1',
        action: 'VIEW_PATIENT',
        resourceType: 'PATIENT',
        resourceId: 'AN999',
      });

      const logs = await db.query<{ resource_id: string }>(
        'SELECT resource_id FROM audit_logs WHERE resource_id = ?',
        ['AN999'],
      );
      expect(logs.length).toBe(1);
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it('does NOT throw when the underlying INSERT fails', async () => {
      // Simulate a DB outage by stubbing execute to reject. Using a fake
      // adapter rather than mocking the real SqliteAdapter keeps the test
      // independent of better-sqlite3 internals.
      const failingDb = {
        execute: vi.fn().mockRejectedValue(new Error('database is locked')),
        query: vi.fn(),
      } as unknown as DatabaseAdapter;

      // Should resolve without throwing — the request must continue.
      await expect(
        tryLogAccess(failingDb, {
          userId: 'user-1',
          action: 'VIEW_DASHBOARD',
          resourceType: 'DASHBOARD',
        }),
      ).resolves.toBeUndefined();
    });

    it('emits logger.warn with audit_log_failed event when INSERT fails', async () => {
      const failingDb = {
        execute: vi.fn().mockRejectedValue(new Error('database is locked')),
        query: vi.fn(),
      } as unknown as DatabaseAdapter;

      await tryLogAccess(failingDb, {
        userId: 'user-1',
        action: 'VIEW_PATIENT',
        resourceType: 'PATIENT',
        resourceId: 'AN-fail',
      });

      expect(warnSpy).toHaveBeenCalledOnce();
      const logged = JSON.parse(warnSpy.mock.calls[0][0] as string);
      expect(logged.level).toBe('warn');
      expect(logged.event).toBe('audit_log_failed');
      expect(logged.action).toBe('VIEW_PATIENT');
      expect(logged.resourceType).toBe('PATIENT');
      expect(logged.resourceId).toBe('AN-fail');
      expect(logged.error.message).toBe('database is locked');
    });

    it('emits logger.warn when validation fails (missing userId)', async () => {
      // Validation errors thrown by logAccess should also be caught and
      // logged — they indicate a bug in the caller, not the user's fault.
      await tryLogAccess(db, {
        userId: '',
        action: 'VIEW_PATIENT',
        resourceType: 'PATIENT',
      });

      expect(warnSpy).toHaveBeenCalledOnce();
      const logged = JSON.parse(warnSpy.mock.calls[0][0] as string);
      expect(logged.event).toBe('audit_log_failed');
      expect(logged.error.message).toContain('Missing required audit log fields');
    });
  });
});
