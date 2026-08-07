// T10: Referral API routes tests — TDD: tests cover service layer used by route handlers
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestDb } from '../../helpers/testDb';
import type { DatabaseAdapter } from '@/db/adapter';
import { v4 as uuidv4 } from 'uuid';
import {
  initiateReferral,
  acceptReferral,
  rejectReferral,
  markInTransit,
  confirmArrival,
  getPendingReferrals,
  autoArriveReferrals,
} from '@/services/referral';
import { UrgencyLevel, ReferralStatus } from '@/types/domain';

// Helper: seed two hospitals and a journey (minimal journey row)
async function seedFixtures(db: DatabaseAdapter) {
  const now = new Date().toISOString();

  const hospAId = uuidv4();
  const hospBId = uuidv4();

  await db.execute(
    `INSERT INTO hospitals (id, hcode, name, level, is_active, connection_status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [hospAId, '10670', 'รพ.A', 'M1', true, 'ONLINE', now, now],
  );
  await db.execute(
    `INSERT INTO hospitals (id, hcode, name, level, is_active, connection_status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [hospBId, '11000', 'รพ.B', 'A_S', true, 'ONLINE', now, now],
  );

  const journeyId = uuidv4();

  await db.execute(
    `INSERT INTO maternal_journeys (id, hospital_id, current_hospital_id, hn, name, cid, cid_hash, age, gravida, para, care_stage, anc_risk_level, anc_visit_count, registered_at, stage_changed_at, synced_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      journeyId,
      hospAId,
      hospAId,
      '12345',
      'Test Patient',
      'enc_cid_test',
      'cidhash_test',
      30,
      1,
      0,
      'PREGNANCY',
      'HR3',
      0,
      now,
      now,
      now,
      now,
      now,
    ],
  );

  // Seed users for accepted_by FK
  for (const userId of [
    'doctor-007',
    'ob-gyn-B',
    'doctor-X',
    'doctor-Y',
    'doctor-Z',
    'nurse-001',
    'midwife-A',
  ]) {
    await db.execute(
      `INSERT INTO users (id, bms_user_name, role, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`,
      [userId, userId, 'NURSE', true, now, now],
    );
  }

  return { hospAId, hospBId, journeyId };
}

async function seedExtraJourney(db: DatabaseAdapter, hospitalId: string): Promise<string> {
  const id = uuidv4();
  const now = new Date().toISOString();
  await db.execute(
    `INSERT INTO maternal_journeys (id, hospital_id, current_hospital_id, hn, name, cid, cid_hash, age, gravida, para, care_stage, anc_risk_level, anc_visit_count, registered_at, stage_changed_at, synced_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      hospitalId,
      hospitalId,
      `HN-${id.slice(0, 8)}`,
      'Extra Patient',
      'enc_cid_extra',
      'cidhash_extra',
      28,
      1,
      0,
      'PREGNANCY',
      'LOW',
      0,
      now,
      now,
      now,
      now,
      now,
    ],
  );
  return id;
}

describe('Referral API — POST /api/referrals (initiateReferral)', () => {
  let db: DatabaseAdapter;

  beforeEach(async () => {
    db = await createTestDb();
  });

  afterEach(async () => {
    await db.close();
  });

  it('creates a referral and returns 201-equivalent data with INITIATED status', async () => {
    const { hospAId, hospBId, journeyId } = await seedFixtures(db);

    const referral = await initiateReferral(db, {
      journeyId,
      fromHospitalId: hospAId,
      toHospitalId: hospBId,
      reason: 'CPD suspected',
      urgencyLevel: UrgencyLevel.URGENT,
      initiatedBy: 'nurse-001',
    });

    expect(referral.id).toBeTruthy();
    expect(referral.status).toBe(ReferralStatus.INITIATED);
    expect(referral.journeyId).toBe(journeyId);
    expect(referral.fromHospitalId).toBe(hospAId);
    expect(referral.toHospitalId).toBe(hospBId);
    expect(referral.reason).toBe('CPD suspected');
    expect(referral.urgencyLevel).toBe(UrgencyLevel.URGENT);
    expect(referral.initiatedBy).toBe('nurse-001');
    expect(referral.acceptedBy).toBeNull();
    expect(referral.arrivedAt).toBeNull();
  });

  it('creates a referral with optional diagnosisCode', async () => {
    const { hospAId, hospBId, journeyId } = await seedFixtures(db);

    const referral = await initiateReferral(db, {
      journeyId,
      fromHospitalId: hospAId,
      toHospitalId: hospBId,
      reason: 'Fetal distress',
      diagnosisCode: 'O68.0',
      urgencyLevel: UrgencyLevel.EMERGENCY,
    });

    expect(referral.diagnosisCode).toBe('O68.0');
    expect(referral.urgencyLevel).toBe(UrgencyLevel.EMERGENCY);
  });

  it('persists referral to DB correctly', async () => {
    const { hospAId, hospBId, journeyId } = await seedFixtures(db);

    const referral = await initiateReferral(db, {
      journeyId,
      fromHospitalId: hospAId,
      toHospitalId: hospBId,
      reason: 'Placenta previa',
      urgencyLevel: UrgencyLevel.ROUTINE,
    });

    const rows = await db.query<{ status: string; reason: string }>(
      'SELECT status, reason FROM cached_referrals WHERE id = ?',
      [referral.id],
    );

    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('INITIATED');
    expect(rows[0].reason).toBe('Placenta previa');
  });
});

describe('Referral API — GET /api/referrals (getPendingReferrals)', () => {
  let db: DatabaseAdapter;

  beforeEach(async () => {
    db = await createTestDb();
  });

  afterEach(async () => {
    await db.close();
  });

  it('returns pending outbound referrals for a hospital', async () => {
    const { hospAId, hospBId, journeyId } = await seedFixtures(db);

    await initiateReferral(db, {
      journeyId,
      fromHospitalId: hospAId,
      toHospitalId: hospBId,
      reason: 'Test reason',
      urgencyLevel: UrgencyLevel.ROUTINE,
    });

    const outbound = await getPendingReferrals(db, hospAId, 'out');
    expect(outbound).toHaveLength(1);
    expect(outbound[0].fromHospitalId).toBe(hospAId);
    expect(outbound[0].status).toBe(ReferralStatus.INITIATED);
  });

  it('returns pending inbound referrals for a hospital', async () => {
    const { hospAId, hospBId, journeyId } = await seedFixtures(db);

    await initiateReferral(db, {
      journeyId,
      fromHospitalId: hospAId,
      toHospitalId: hospBId,
      reason: 'Test reason',
      urgencyLevel: UrgencyLevel.URGENT,
    });

    const inbound = await getPendingReferrals(db, hospBId, 'in');
    expect(inbound).toHaveLength(1);
    expect(inbound[0].toHospitalId).toBe(hospBId);
  });

  it('does not return REJECTED or ARRIVED referrals as pending', async () => {
    const { hospAId, hospBId, journeyId } = await seedFixtures(db);

    const r = await initiateReferral(db, {
      journeyId,
      fromHospitalId: hospAId,
      toHospitalId: hospBId,
      reason: 'Already rejected',
      urgencyLevel: UrgencyLevel.ROUTINE,
    });

    await rejectReferral(db, r.id, 'Capacity issue');

    const outbound = await getPendingReferrals(db, hospAId, 'out');
    expect(outbound).toHaveLength(0);
  });
});

describe('Referral API — PATCH accept', () => {
  let db: DatabaseAdapter;

  beforeEach(async () => {
    db = await createTestDb();
  });

  afterEach(async () => {
    await db.close();
  });

  it('transitions status from INITIATED to ACCEPTED', async () => {
    const { hospAId, hospBId, journeyId } = await seedFixtures(db);

    const ref = await initiateReferral(db, {
      journeyId,
      fromHospitalId: hospAId,
      toHospitalId: hospBId,
      reason: 'CPD',
      urgencyLevel: UrgencyLevel.URGENT,
    });

    const accepted = await acceptReferral(db, ref.id, 'doctor-007');
    expect(accepted.status).toBe(ReferralStatus.ACCEPTED);
    expect(accepted.acceptedBy).toBe('doctor-007');
    expect(accepted.acceptedAt).not.toBeNull();
  });
});

describe('Referral API — PATCH reject', () => {
  let db: DatabaseAdapter;

  beforeEach(async () => {
    db = await createTestDb();
  });

  afterEach(async () => {
    await db.close();
  });

  it('transitions status to REJECTED with a reason', async () => {
    const { hospAId, hospBId, journeyId } = await seedFixtures(db);

    const ref = await initiateReferral(db, {
      journeyId,
      fromHospitalId: hospAId,
      toHospitalId: hospBId,
      reason: 'Eclampsia',
      urgencyLevel: UrgencyLevel.EMERGENCY,
    });

    const rejected = await rejectReferral(db, ref.id, 'ICU full');
    expect(rejected.status).toBe(ReferralStatus.REJECTED);
    expect(rejected.rejectionReason).toBe('ICU full');
    expect(rejected.suggestedAlternativeId).toBeNull();
  });

  it('stores suggested alternative hospital ID when provided', async () => {
    const { hospAId, hospBId, journeyId } = await seedFixtures(db);
    const altHospId = uuidv4();
    const now = new Date().toISOString();
    await db.execute(
      `INSERT INTO hospitals (id, hcode, name, level, is_active, connection_status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [altHospId, '11002', 'รพ.C', 'M2', true, 'ONLINE', now, now],
    );

    const ref = await initiateReferral(db, {
      journeyId,
      fromHospitalId: hospAId,
      toHospitalId: hospBId,
      reason: 'Emergency delivery',
      urgencyLevel: UrgencyLevel.EMERGENCY,
    });

    const rejected = await rejectReferral(db, ref.id, 'No OB on duty', altHospId);
    expect(rejected.status).toBe(ReferralStatus.REJECTED);
    expect(rejected.suggestedAlternativeId).toBe(altHospId);
  });
});

describe('Referral API — full lifecycle INITIATED → ACCEPTED → IN_TRANSIT → ARRIVED', () => {
  let db: DatabaseAdapter;

  beforeEach(async () => {
    db = await createTestDb();
  });

  afterEach(async () => {
    await db.close();
  });

  it('completes the full referral lifecycle', async () => {
    const { hospAId, hospBId, journeyId } = await seedFixtures(db);

    // Step 1: Initiate
    const initiated = await initiateReferral(db, {
      journeyId,
      fromHospitalId: hospAId,
      toHospitalId: hospBId,
      reason: 'Fetal macrosomia',
      diagnosisCode: 'O33.5',
      urgencyLevel: UrgencyLevel.URGENT,
      initiatedBy: 'midwife-A',
    });
    expect(initiated.status).toBe(ReferralStatus.INITIATED);

    // Step 2: Accept
    const accepted = await acceptReferral(db, initiated.id, 'ob-gyn-B');
    expect(accepted.status).toBe(ReferralStatus.ACCEPTED);
    expect(accepted.acceptedAt).not.toBeNull();

    // Step 3: Mark in transit
    const inTransit = await markInTransit(db, initiated.id, 'AMBULANCE');
    expect(inTransit.status).toBe(ReferralStatus.IN_TRANSIT);
    expect(inTransit.transportMode).toBe('AMBULANCE');
    expect(inTransit.departedAt).not.toBeNull();

    // Step 4: Confirm arrival
    const arrived = await confirmArrival(db, initiated.id, 'AN-B-9999');
    expect(arrived.status).toBe(ReferralStatus.ARRIVED);
    expect(arrived.arrivedAt).not.toBeNull();

    // Verify referral is no longer listed as pending outbound
    const pending = await getPendingReferrals(db, hospAId, 'out');
    expect(pending).toHaveLength(0);
  });
});

describe('Dashboard Referrals — GET /api/dashboard/referrals', () => {
  let db: DatabaseAdapter;

  beforeEach(async () => {
    db = await createTestDb();
  });

  afterEach(async () => {
    await db.close();
  });

  it('returns zero counts when no referrals exist', async () => {
    const rows = await db.query<Record<string, unknown>>(
      `SELECT status, COUNT(*) as count FROM cached_referrals GROUP BY status`,
    );
    const inTransit = await db.query<{ count: number }>(
      `SELECT COUNT(*) as count FROM cached_referrals WHERE status = 'IN_TRANSIT'`,
    );

    expect(rows).toHaveLength(0);
    expect(Number(inTransit[0]?.count ?? 0)).toBe(0);
  });

  it('returns aggregate counts by status', async () => {
    const { hospAId, hospBId, journeyId } = await seedFixtures(db);

    // Create 2 INITIATED + 1 ACCEPTED + 1 IN_TRANSIT
    const r1 = await initiateReferral(db, {
      journeyId,
      fromHospitalId: hospAId,
      toHospitalId: hospBId,
      reason: 'Reason 1',
      urgencyLevel: UrgencyLevel.ROUTINE,
    });
    const r2 = await initiateReferral(db, {
      journeyId: await seedExtraJourney(db, hospAId),
      fromHospitalId: hospAId,
      toHospitalId: hospBId,
      reason: 'Reason 2',
      urgencyLevel: UrgencyLevel.URGENT,
    });
    const r3 = await initiateReferral(db, {
      journeyId: await seedExtraJourney(db, hospBId),
      fromHospitalId: hospBId,
      toHospitalId: hospAId,
      reason: 'Reason 3',
      urgencyLevel: UrgencyLevel.EMERGENCY,
    });
    // Accept r2
    await acceptReferral(db, r2.id, 'doctor-X');
    // Accept and transit r3
    await acceptReferral(db, r3.id, 'doctor-Y');
    await markInTransit(db, r3.id, 'HELICOPTER');

    // r1 stays INITIATED
    void r1;

    const rows = await db.query<Record<string, unknown>>(
      `SELECT status, COUNT(*) as count FROM cached_referrals GROUP BY status`,
    );
    const inTransit = await db.query<{ count: number }>(
      `SELECT COUNT(*) as count FROM cached_referrals WHERE status = 'IN_TRANSIT'`,
    );

    const byStatus: Record<string, number> = {};
    let totalPending = 0;
    for (const row of rows) {
      const status = String(row.status);
      const count = Number(row.count);
      byStatus[status] = count;
      if (status !== 'REJECTED' && status !== 'ARRIVED') {
        totalPending += count;
      }
    }

    expect(byStatus['INITIATED']).toBe(1);
    expect(byStatus['ACCEPTED']).toBe(1);
    expect(byStatus['IN_TRANSIT']).toBe(1);
    expect(Number(inTransit[0]?.count ?? 0)).toBe(1);
    expect(totalPending).toBe(3);
  });

  it('excludes REJECTED and ARRIVED from totalPending', async () => {
    const { hospAId, hospBId, journeyId } = await seedFixtures(db);

    const r1 = await initiateReferral(db, {
      journeyId,
      fromHospitalId: hospAId,
      toHospitalId: hospBId,
      reason: 'Pending referral',
      urgencyLevel: UrgencyLevel.ROUTINE,
    });
    const r2 = await initiateReferral(db, {
      journeyId: await seedExtraJourney(db, hospAId),
      fromHospitalId: hospAId,
      toHospitalId: hospBId,
      reason: 'Will be rejected',
      urgencyLevel: UrgencyLevel.ROUTINE,
    });
    const r3 = await initiateReferral(db, {
      journeyId: await seedExtraJourney(db, hospBId),
      fromHospitalId: hospBId,
      toHospitalId: hospAId,
      reason: 'Will arrive',
      urgencyLevel: UrgencyLevel.URGENT,
    });

    void r1; // stays INITIATED — pending

    await rejectReferral(db, r2.id, 'Full capacity');

    await acceptReferral(db, r3.id, 'doctor-Z');
    await markInTransit(db, r3.id, 'AMBULANCE');
    await confirmArrival(db, r3.id, 'AN-DEST-001');

    const rows = await db.query<Record<string, unknown>>(
      `SELECT status, COUNT(*) as count FROM cached_referrals GROUP BY status`,
    );

    const byStatus: Record<string, number> = {};
    let totalPending = 0;
    for (const row of rows) {
      const status = String(row.status);
      const count = Number(row.count);
      byStatus[status] = count;
      if (status !== 'REJECTED' && status !== 'ARRIVED') {
        totalPending += count;
      }
    }

    // Only r1 (INITIATED) counts as pending
    expect(totalPending).toBe(1);
    expect(byStatus['REJECTED']).toBe(1);
    expect(byStatus['ARRIVED']).toBe(1);
    expect(byStatus['INITIATED']).toBe(1);
  });
});

describe('autoArriveReferrals — arrival inferred from journey ownership', () => {
  let db: DatabaseAdapter;

  beforeEach(async () => {
    db = await createTestDb();
  });

  afterEach(async () => {
    await db.close();
  });

  async function moveJourneyTo(journeyId: string, hospitalId: string, at: Date) {
    await db.execute(
      `UPDATE maternal_journeys SET current_hospital_id = ?, updated_at = ? WHERE id = ?`,
      [hospitalId, at.toISOString(), journeyId],
    );
  }

  it('marks an INITIATED referral ARRIVED when the journey moved to the destination after initiation', async () => {
    const { hospAId, hospBId, journeyId } = await seedFixtures(db);
    const ref = await initiateReferral(db, {
      journeyId,
      fromHospitalId: hospAId,
      toHospitalId: hospBId,
      reason: 'ส่งต่อ ANC เสี่ยงสูง',
      urgencyLevel: UrgencyLevel.URGENT,
    });
    const evidenceAt = new Date(Date.now() + 60_000);
    await moveJourneyTo(journeyId, hospBId, evidenceAt);

    const arrivedCount = await autoArriveReferrals(db);

    expect(arrivedCount).toBe(1);
    const rows = await db.query<{ status: string; arrived_at: string }>(
      `SELECT status, arrived_at FROM cached_referrals WHERE id = ?`,
      [ref.id],
    );
    expect(rows[0].status).toBe('ARRIVED');
    // Arrival evidence time = the journey's ownership-change timestamp.
    expect(new Date(rows[0].arrived_at).toISOString()).toBe(evidenceAt.toISOString());
  });

  it('leaves referrals alone while the journey still sits at the origin hospital', async () => {
    const { hospAId, hospBId, journeyId } = await seedFixtures(db);
    const ref = await initiateReferral(db, {
      journeyId,
      fromHospitalId: hospAId,
      toHospitalId: hospBId,
      reason: 'ยังไม่เดินทาง',
      urgencyLevel: UrgencyLevel.ROUTINE,
    });

    const arrivedCount = await autoArriveReferrals(db);

    expect(arrivedCount).toBe(0);
    const rows = await db.query<{ status: string }>(
      `SELECT status FROM cached_referrals WHERE id = ?`,
      [ref.id],
    );
    expect(rows[0].status).toBe('INITIATED');
  });

  it('ignores journey updates that predate the referral (stale evidence)', async () => {
    const { hospAId, hospBId, journeyId } = await seedFixtures(db);
    // Journey happens to already point at hospital B, but was last updated
    // BEFORE the referral existed — that is not arrival evidence.
    await moveJourneyTo(journeyId, hospBId, new Date(Date.now() - 3600_000));
    const ref = await initiateReferral(db, {
      journeyId,
      fromHospitalId: hospAId,
      toHospitalId: hospBId,
      reason: 'หลักฐานเก่า',
      urgencyLevel: UrgencyLevel.ROUTINE,
    });

    const arrivedCount = await autoArriveReferrals(db);

    expect(arrivedCount).toBe(0);
    const rows = await db.query<{ status: string }>(
      `SELECT status FROM cached_referrals WHERE id = ?`,
      [ref.id],
    );
    expect(rows[0].status).toBe('INITIATED');
  });

  it('is a no-op when disabled via options', async () => {
    const { hospAId, hospBId, journeyId } = await seedFixtures(db);
    await initiateReferral(db, {
      journeyId,
      fromHospitalId: hospAId,
      toHospitalId: hospBId,
      reason: 'ปิดการทำงานอัตโนมัติ',
      urgencyLevel: UrgencyLevel.ROUTINE,
    });
    await moveJourneyTo(journeyId, hospBId, new Date(Date.now() + 60_000));

    const arrivedCount = await autoArriveReferrals(db, { enabled: false });

    expect(arrivedCount).toBe(0);
  });
});
