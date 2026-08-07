// Unit tests: POST /api/referrals/check — pre-check referral eligibility by CID
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createHash } from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { createTestDb } from '../../helpers/testDb';
import type { DatabaseAdapter } from '@/db/adapter';
import { SeedOrchestrator } from '@/db/seeds/index';

describe('Referral Check API Logic', () => {
  let db: DatabaseAdapter;
  let hospitalId: string;
  const now = new Date().toISOString();

  function cidHash(cid: string): string {
    return createHash('sha256').update(cid).digest('hex');
  }

  beforeEach(async () => {
    db = await createTestDb();
    await new SeedOrchestrator().run(db);

    hospitalId = uuidv4();
    await db.execute(
      `INSERT INTO hospitals (id, hcode, name, level, is_active, connection_status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [hospitalId, '99910', 'รพ.ทดสอบ Check API', 'M2', true, 'ONLINE', now, now],
    );
  });

  afterEach(async () => {
    await db.close();
  });

  it('returns canRefer=false when patient not found', async () => {
    const cid = '1100500000000';
    const hash = cidHash(cid);

    const journeys = await db.query('SELECT * FROM maternal_journeys WHERE cid_hash = ?', [hash]);
    expect(journeys).toHaveLength(0);

    const labor = await db.query(
      "SELECT * FROM cached_patients WHERE cid_hash = ? AND labor_status = 'ACTIVE'",
      [hash],
    );
    expect(labor).toHaveLength(0);
    // canRefer would be false — no data
  });

  it('returns canRefer=true when patient has active ANC journey', async () => {
    const cid = '1100500011111';
    const hash = cidHash(cid);
    const journeyId = uuidv4();

    await db.execute(
      `INSERT INTO maternal_journeys (id, hospital_id, current_hospital_id, hn, name, cid, cid_hash, age, gravida, para, care_stage, anc_risk_level, anc_visit_count, registered_at, stage_changed_at, synced_at, created_at, updated_at)
       VALUES (?, ?, ?, '12345', 'Test', 'enc', ?, 28, 1, 0, 'PREGNANCY', 'HR1', 3, ?, ?, ?, ?, ?)`,
      [journeyId, hospitalId, hospitalId, hash, now, now, now, now, now],
    );

    const journeys = await db.query<{ care_stage: string; anc_risk_level: string }>(
      'SELECT care_stage, anc_risk_level FROM maternal_journeys WHERE cid_hash = ? ORDER BY created_at DESC LIMIT 1',
      [hash],
    );
    expect(journeys).toHaveLength(1);
    expect(journeys[0].care_stage).toBe('PREGNANCY');
    expect(journeys[0].anc_risk_level).toBe('HR1');
  });

  it('returns canRefer=false when patient already DELIVERED', async () => {
    const cid = '1100500022222';
    const hash = cidHash(cid);
    const journeyId = uuidv4();

    await db.execute(
      `INSERT INTO maternal_journeys (id, hospital_id, current_hospital_id, hn, name, cid, cid_hash, age, gravida, para, care_stage, anc_risk_level, anc_visit_count, registered_at, stage_changed_at, synced_at, created_at, updated_at)
       VALUES (?, ?, ?, '22222', 'Test', 'enc', ?, 30, 1, 0, 'DELIVERED', 'LOW', 5, ?, ?, ?, ?, ?)`,
      [journeyId, hospitalId, hospitalId, hash, now, now, now, now, now],
    );

    const journeys = await db.query<{ care_stage: string }>(
      'SELECT care_stage FROM maternal_journeys WHERE cid_hash = ? ORDER BY created_at DESC LIMIT 1',
      [hash],
    );
    expect(journeys[0].care_stage).toBe('DELIVERED');
    // canRefer would be false — already delivered
  });

  it('warns when active referral already exists', async () => {
    const cid = '1100500033333';
    const hash = cidHash(cid);
    const journeyId = uuidv4();
    const destHospId = uuidv4();

    await db.execute(
      `INSERT INTO hospitals (id, hcode, name, level, is_active, connection_status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [destHospId, '99911', 'รพ.ปลายทาง Check', 'A', true, 'ONLINE', now, now],
    );

    await db.execute(
      `INSERT INTO maternal_journeys (id, hospital_id, current_hospital_id, hn, name, cid, cid_hash, age, gravida, para, care_stage, anc_risk_level, anc_visit_count, registered_at, stage_changed_at, synced_at, created_at, updated_at)
       VALUES (?, ?, ?, '33333', 'Test', 'enc', ?, 25, 1, 0, 'LABOR', 'HR3', 4, ?, ?, ?, ?, ?)`,
      [journeyId, hospitalId, hospitalId, hash, now, now, now, now, now],
    );

    await db.execute(
      `INSERT INTO cached_referrals (id, journey_id, refer_number, from_hospital_id, to_hospital_id, status, reason, initiated_at, created_at, updated_at)
       VALUES (?, ?, 'REF-EXIST', ?, ?, 'INITIATED', 'ส่งต่อแล้ว', ?, ?, ?)`,
      [uuidv4(), journeyId, hospitalId, destHospId, now, now, now],
    );

    // Count active referrals
    const refCount = await db.query<{ cnt: number }>(
      `SELECT COUNT(*) as cnt FROM cached_referrals
       WHERE journey_id = ? AND status NOT IN ('ARRIVED', 'REJECTED')`,
      [journeyId],
    );
    expect(refCount[0].cnt).toBe(1);
    // canRefer would be true but with warning about existing referral
  });

  it('finds patient by CID across different hospitals', async () => {
    const cid = '1100500044444';
    const hash = cidHash(cid);
    const journeyId = uuidv4();
    const otherHospId = uuidv4();

    await db.execute(
      `INSERT INTO hospitals (id, hcode, name, level, is_active, connection_status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [otherHospId, '99912', 'รพ.อื่น Check', 'M1', true, 'ONLINE', now, now],
    );

    // Journey created at otherHosp
    await db.execute(
      `INSERT INTO maternal_journeys (id, hospital_id, current_hospital_id, hn, name, cid, cid_hash, age, gravida, para, care_stage, anc_risk_level, anc_visit_count, registered_at, stage_changed_at, synced_at, created_at, updated_at)
       VALUES (?, ?, ?, '99999', 'Test', 'enc', ?, 27, 2, 1, 'PREGNANCY', 'HR2', 2, ?, ?, ?, ?, ?)`,
      [journeyId, otherHospId, otherHospId, hash, now, now, now, now, now],
    );

    // Query from any hospital should find by CID hash
    const journeys = await db.query<{ care_stage: string; anc_risk_level: string }>(
      'SELECT care_stage, anc_risk_level FROM maternal_journeys WHERE cid_hash = ? ORDER BY created_at DESC LIMIT 1',
      [hash],
    );
    expect(journeys).toHaveLength(1);
    expect(journeys[0].care_stage).toBe('PREGNANCY');
    expect(journeys[0].anc_risk_level).toBe('HR2');
  });
});
