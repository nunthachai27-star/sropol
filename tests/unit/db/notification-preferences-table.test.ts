// tests/unit/db/notification-preferences-table.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestDb } from '../../helpers/testDb';
import type { DatabaseAdapter } from '@/db/adapter';
import { generateKey } from '@/lib/encryption';

let db: DatabaseAdapter;
process.env.ENCRYPTION_KEY = generateKey();

describe('notification_preferences table', () => {
  beforeEach(async () => {
    db = await createTestDb();
  });
  afterEach(async () => {
    await db.close?.();
  });

  it('is created by schema sync with the opt-in columns + unique (user_cid, hospital_code)', async () => {
    const now = new Date().toISOString();
    await db.execute(
      `INSERT INTO notification_preferences
         (id, user_cid, hospital_code, moph_line_enabled, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      ['n1', '3320500282121', '10670', true, now, now],
    );
    await db.execute(
      `INSERT INTO notification_preferences
         (id, user_cid, hospital_code, moph_line_enabled, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      ['n2', '3320500282128', '10671', false, now, now],
    );
    const rows = await db.query<{ user_cid: string; moph_line_enabled: boolean }>(
      `SELECT user_cid, moph_line_enabled FROM notification_preferences ORDER BY user_cid`,
    );
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ user_cid: '3320500282121', moph_line_enabled: true });
  });
});
