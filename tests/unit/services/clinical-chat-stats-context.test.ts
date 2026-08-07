// TDD — statistics-mode context builder (codex verdict: Phase 1 = deterministic
// aggregate injection, no PHI, no heavy dashboard joins). The builder returns
// pure COUNT aggregates over confirmed tables; raw patient names/CIDs must
// NEVER appear in the emitted context string.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestDb } from '../../helpers/testDb';
import type { DatabaseAdapter } from '@/db/adapter';
import { generateKey } from '@/lib/encryption';
import { buildStatisticsContext } from '@/services/chat/stats-context-builder';

let db: DatabaseAdapter;
process.env.ENCRYPTION_KEY = generateKey();

describe('buildStatisticsContext — deterministic aggregates, no PHI', () => {
  beforeEach(async () => {
    db = await createTestDb();
  });
  afterEach(async () => {
    await db.close?.();
  });

  async function seedData() {
    const now = new Date().toISOString();
    await db.execute(
      `INSERT INTO hospitals (id, hcode, name, level, is_active, created_at, updated_at)
       VALUES ('h1', '10670', 'รพ.ทดสอบ', 'M2', true, ?, ?)`,
      [now, now],
    );
    // Origin hospital for the referral below (from_hospital_id FK).
    await db.execute(
      `INSERT INTO hospitals (id, hcode, name, level, is_active, created_at, updated_at)
       VALUES ('hx', '10671', 'รพ.ต้นทาง', 'M2', true, ?, ?)`,
      [now, now],
    );
    // 2 active admitted patients (hospital h1) with raw-ish names/CID.
    for (const i of [1, 2]) {
      await db.execute(
        `INSERT INTO cached_patients (id, hospital_id, hn, an, name, cid, cid_hash, age, admit_date, synced_at, created_at, updated_at)
         VALUES (?, 'h1', ?, ?, ?, ?, ?, 30, ?, ?, ?, ?)`,
        [
          `p${i}`,
          `HN-${i}`,
          `AN-${i}`,
          `name${i}`,
          `332050028212${i}`,
          `sha${i}`,
          now,
          now,
          now,
          now,
        ],
      );
    }
    // A maternal journey (cached_referrals.journey_id is NOT NULL).
    await db.execute(
      `INSERT INTO maternal_journeys (id, hospital_id, current_hospital_id, hn, name, cid, cid_hash, age, gravida, para, care_stage, registered_at, stage_changed_at, synced_at, created_at, updated_at)
       VALUES ('j1', 'h1', 'h1', 'HN-1', 'enc-name', 'enc-cid', 'sha1', 30, 1, 0, 'PREGNANCY', ?, ?, ?, ?, ?)`,
      [now, now, now, now, now],
    );
    // 1 pending referral to h1.
    await db.execute(
      `INSERT INTO cached_referrals (id, journey_id, refer_number, from_hospital_id, to_hospital_id, status, reason, urgency_level, initiated_at, created_at, updated_at)
       VALUES ('r1', 'j1', 'RF-1', 'hx', 'h1', 'INITIATED', 'r', 'ROUTINE', ?, ?, ?)`,
      [now, now, now],
    );
  }

  it('returns hospital-scoped aggregate counts, never raw names/CIDs', async () => {
    await seedData();
    const ctx = await buildStatisticsContext(db, 'h1');
    expect(ctx).not.toBeNull();
    const block = ctx!.context;
    // Deterministic counts present.
    expect(block).toContain('ผู้ป่วยทั้งหมด');
    expect(block).toContain('2'); // active admitted patients at h1
    expect(block).toContain('ส่งต่อค้าง'); // pending referrals
    // No PHI.
    expect(block).not.toContain('name1');
    expect(block).not.toContain('3320500282121');
    expect(block).not.toContain('sha1');
    expect(block).not.toContain('HN-1');
  });

  it('returns null for unknown hospital (no crash)', async () => {
    const ctx = await buildStatisticsContext(db, 'no-such-id');
    expect(ctx).toBeNull();
  });
});
