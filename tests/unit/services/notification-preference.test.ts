// tests/unit/services/notification-preference.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestDb } from '../../helpers/testDb';
import type { DatabaseAdapter } from '@/db/adapter';
import { generateKey } from '@/lib/encryption';
import {
  getNotificationPreference,
  upsertNotificationPreference,
  enabledSubscriberCids,
  backfillActiveConsultDoctorPrefs,
} from '@/services/notification-preference';

let db: DatabaseAdapter;
process.env.ENCRYPTION_KEY = generateKey();

describe('notification-preference service', () => {
  beforeEach(async () => {
    db = await createTestDb();
  });
  afterEach(async () => {
    await db.close?.();
  });

  it('get returns null when no row (Default OFF)', async () => {
    const p = await getNotificationPreference(db, '3320500282121', '10670');
    expect(p).toBeNull();
  });

  it('upsert creates then updates the row (idempotent by (cid,hcode))', async () => {
    const created = await upsertNotificationPreference(db, '3320500282121', '10670', true);
    expect(created.mophLineEnabled).toBe(true);
    const updated = await upsertNotificationPreference(db, '3320500282121', '10670', false);
    expect(updated.mophLineEnabled).toBe(false);
    const rows = await db.query<{ user_cid: string }>(
      `SELECT user_cid FROM notification_preferences WHERE user_cid = ?`,
      ['3320500282121'],
    );
    expect(rows).toHaveLength(1);
  });

  it('enabledSubscriberCids returns only enabled rows for the hospital', async () => {
    await upsertNotificationPreference(db, '3320500282121', '10670', true);
    await upsertNotificationPreference(db, '1111111111112', '10670', false);
    await upsertNotificationPreference(db, '3333333333334', '99999', true); // other hospital
    const cids = await enabledSubscriberCids(db, '10670');
    expect(cids.map((c) => c.cid)).toEqual(['3320500282121']);
  });

  describe('backfillActiveConsultDoctorPrefs (P1-D rollout)', () => {
    async function seedAdminLists() {
      const now = new Date().toISOString();
      await db.execute(
        `INSERT INTO hospitals (id, hcode, name, level, is_active, created_at, updated_at)
         VALUES ('h1', '10670', 'รพ.ทดสอบ', 'M2', true, ?, ?)`,
        [now, now],
      );
      // one active + one inactive consult doctor
      await db.execute(
        `INSERT INTO hospital_consult_doctors (id, hospital_id, cid, name, position, is_active, created_at, updated_at)
         VALUES ('d1', 'h1', '3320500282121', 'นพ. ก', 'สูติ', true, ?, ?),
                ('d2', 'h1', '3320500282122', 'นพ. ข', 'สูติ', false, ?, ?)`,
        [now, now, now, now],
      );
    }

    it('creates enabled prefs for ALL active consult doctors only, keyed by hcode', async () => {
      await seedAdminLists();
      await backfillActiveConsultDoctorPrefs(db);
      const rows = await db.query<{ user_cid: string; hospital_code: string; enabled: boolean }>(
        `SELECT user_cid, hospital_code, moph_line_enabled AS enabled
         FROM notification_preferences ORDER BY user_cid`,
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        user_cid: '3320500282121',
        hospital_code: '10670',
        enabled: true,
      });
    });

    it('is idempotent: re-run does not duplicate, and never clobbers a user opt-out', async () => {
      await seedAdminLists();
      // simulate a user who toggled OFF after the backfill
      await db.execute(
        `INSERT INTO notification_preferences (id, user_cid, hospital_code, moph_line_enabled, created_at, updated_at)
         VALUES ('u1', '3320500282121', '10670', false, NOW(), NOW())`,
      );
      await backfillActiveConsultDoctorPrefs(db);
      await backfillActiveConsultDoctorPrefs(db); // second pass
      const rows = await db.query<{ user_cid: string; moph_line_enabled: boolean }>(
        `SELECT user_cid, moph_line_enabled FROM notification_preferences`,
      );
      // user's opt-out preserved; still only 1 row (no dupes)
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ user_cid: '3320500282121', moph_line_enabled: false });
    });
  });
});
