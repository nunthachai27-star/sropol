import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestDb } from '../../helpers/testDb';
import type { DatabaseAdapter } from '@/db/adapter';
import {
  initiateReferral,
  acceptReferral,
  rejectReferral,
  markInTransit,
  confirmArrival,
  getPendingReferrals,
} from '@/services/referral';
import { ReferralStatus, UrgencyLevel } from '@/types/domain';

describe('Referral Workflow Service', () => {
  let db: DatabaseAdapter;
  const fromHospId = 'hosp-from';
  const toHospId = 'hosp-to';
  const journeyId = 'journey-001';

  beforeEach(async () => {
    db = await createTestDb();
    // Seed hospitals
    await db.execute(
      `INSERT INTO hospitals (id, hcode, name, level, is_active, connection_status, created_at, updated_at) VALUES
       ('${fromHospId}', '11004', 'รพ.พล', 'F2', TRUE, 'ONLINE', NOW(), NOW())`,
    );
    await db.execute(
      `INSERT INTO hospitals (id, hcode, name, level, is_active, connection_status, created_at, updated_at) VALUES
       ('${toHospId}', '10670', 'รพ.ขอนแก่น', 'A_S', TRUE, 'ONLINE', NOW(), NOW())`,
    );
    // Seed a user (for accepted_by FK)
    await db.execute(
      `INSERT INTO users (id, bms_user_name, role, is_active, created_at, updated_at) VALUES
       ('user-001', 'testuser', 'NURSE', TRUE, NOW(), NOW())`,
    );
    // Seed a journey
    await db.execute(
      `INSERT INTO maternal_journeys (id, hospital_id, current_hospital_id, hn, name, cid, cid_hash, age, gravida, para, care_stage, anc_risk_level, anc_visit_count, registered_at, stage_changed_at, synced_at, created_at, updated_at)
       VALUES ('${journeyId}', '${fromHospId}', '${fromHospId}', '12345', 'Test Patient', 'enc_cid', 'cidhash_test', 30, 1, 0, 'PREGNANCY', 'HR3', 0, NOW(), NOW(), NOW(), NOW(), NOW())`,
    );
  });

  afterEach(() => {
    db.close();
  });

  it('initiateReferral creates a referral with INITIATED status', async () => {
    const ref = await initiateReferral(db, {
      journeyId,
      fromHospitalId: fromHospId,
      toHospitalId: toHospId,
      reason: 'HR3 exceeds capability',
      urgencyLevel: UrgencyLevel.URGENT,
    });
    expect(ref.status).toBe(ReferralStatus.INITIATED);
    expect(ref.fromHospitalId).toBe(fromHospId);
    expect(ref.toHospitalId).toBe(toHospId);
    expect(ref.reason).toBe('HR3 exceeds capability');
    expect(ref.urgencyLevel).toBe(UrgencyLevel.URGENT);
  });

  it('acceptReferral transitions to ACCEPTED', async () => {
    const ref = await initiateReferral(db, {
      journeyId,
      fromHospitalId: fromHospId,
      toHospitalId: toHospId,
      reason: 'HR3',
      urgencyLevel: UrgencyLevel.URGENT,
    });
    const updated = await acceptReferral(db, ref.id, 'user-001');
    expect(updated.status).toBe(ReferralStatus.ACCEPTED);
    expect(updated.acceptedAt).not.toBeNull();
    expect(updated.acceptedBy).toBe('user-001');
  });

  it('rejectReferral transitions to REJECTED with reason', async () => {
    const ref = await initiateReferral(db, {
      journeyId,
      fromHospitalId: fromHospId,
      toHospitalId: toHospId,
      reason: 'HR3',
      urgencyLevel: UrgencyLevel.ROUTINE,
    });
    const updated = await rejectReferral(db, ref.id, 'No bed available');
    expect(updated.status).toBe(ReferralStatus.REJECTED);
    expect(updated.rejectionReason).toBe('No bed available');
    expect(updated.rejectedAt).not.toBeNull();
  });

  it('full lifecycle: INITIATED → ACCEPTED → IN_TRANSIT → ARRIVED', async () => {
    const ref = await initiateReferral(db, {
      journeyId,
      fromHospitalId: fromHospId,
      toHospitalId: toHospId,
      reason: 'Test',
      urgencyLevel: UrgencyLevel.EMERGENCY,
    });
    await acceptReferral(db, ref.id, 'user-001');
    await markInTransit(db, ref.id, 'ambulance');
    const arrived = await confirmArrival(db, ref.id, 'AN-9999');
    expect(arrived.status).toBe(ReferralStatus.ARRIVED);
    expect(arrived.arrivedAt).not.toBeNull();
  });

  it('confirmArrival updates journey current_hospital_id', async () => {
    const ref = await initiateReferral(db, {
      journeyId,
      fromHospitalId: fromHospId,
      toHospitalId: toHospId,
      reason: 'Test',
      urgencyLevel: UrgencyLevel.URGENT,
    });
    await acceptReferral(db, ref.id, 'user-001');
    await markInTransit(db, ref.id, 'ambulance');
    await confirmArrival(db, ref.id, 'AN-9999');

    const rows = await db.query<Record<string, unknown>>(
      `SELECT current_hospital_id FROM maternal_journeys WHERE id = ?`,
      [journeyId],
    );
    expect(rows[0].current_hospital_id).toBe(toHospId);
  });

  it('getPendingReferrals returns outbound referrals', async () => {
    await initiateReferral(db, {
      journeyId,
      fromHospitalId: fromHospId,
      toHospitalId: toHospId,
      reason: 'Test',
      urgencyLevel: UrgencyLevel.ROUTINE,
    });
    const pending = await getPendingReferrals(db, fromHospId, 'out');
    expect(pending.length).toBe(1);
    expect(pending[0].fromHospitalId).toBe(fromHospId);
  });

  it('getPendingReferrals excludes ARRIVED and REJECTED', async () => {
    const ref1 = await initiateReferral(db, {
      journeyId,
      fromHospitalId: fromHospId,
      toHospitalId: toHospId,
      reason: 'Test1',
      urgencyLevel: UrgencyLevel.ROUTINE,
    });
    await rejectReferral(db, ref1.id, 'No bed');

    const pending = await getPendingReferrals(db, fromHospId, 'out');
    expect(pending.length).toBe(0);
  });

  it('getPendingReferrals returns inbound referrals', async () => {
    await initiateReferral(db, {
      journeyId,
      fromHospitalId: fromHospId,
      toHospitalId: toHospId,
      reason: 'Test',
      urgencyLevel: UrgencyLevel.URGENT,
    });
    const inbound = await getPendingReferrals(db, toHospId, 'in');
    expect(inbound.length).toBe(1);
  });
});
