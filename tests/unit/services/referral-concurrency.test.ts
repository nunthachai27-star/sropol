import { describe, it, expect, beforeEach } from 'vitest';
import { createTestDb } from '../../helpers/testDb';
import { SeedOrchestrator } from '@/db/seeds/index';
import type { DatabaseAdapter } from '@/db/adapter';
import { AncRiskLevel, ReferralStatus, UrgencyLevel } from '@/types/domain';
import { createJourney } from '@/services/journey';
import {
  initiateReferral,
  acceptReferral,
  rejectReferral,
  ReferralConflictError,
} from '@/services/referral';

let db: DatabaseAdapter;

async function seedReferral(): Promise<string> {
  const hosp = await db.query<{ id: string; hcode: string }>(
    `SELECT id, hcode FROM hospitals WHERE hcode IN ('10670','11004') ORDER BY hcode`,
  );
  const journey = await createJourney(db, {
    hospitalId: hosp[0].id,
    hn: 'HN-C1',
    personAncId: null,
    name: '',
    cid: '',
    cidHash: 'hash-c1',
    age: 30,
    gravida: 1,
    para: 0,
    lmp: null,
    edc: null,
    ancRiskLevel: AncRiskLevel.LOW,
  });
  const referral = await initiateReferral(db, {
    journeyId: journey.id,
    fromHospitalId: hosp[0].id,
    toHospitalId: hosp[1].id,
    reason: 'ทดสอบ',
    urgencyLevel: UrgencyLevel.URGENT,
  });
  return referral.id;
}

describe('referral transition concurrency', () => {
  beforeEach(async () => {
    db = await createTestDb();
    await new SeedOrchestrator().run(db);
  });

  it('concurrent accept + reject: exactly one wins, loser gets ReferralConflictError', async () => {
    const id = await seedReferral();
    const results = await Promise.allSettled([
      acceptReferral(db, id, 'พว.เอ'),
      rejectReferral(db, id, 'เตียงเต็ม'),
    ]);
    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(ReferralConflictError);

    // no mixed-column corruption: the losing transition wrote NOTHING
    const row = await db.query<{
      status: string;
      accepted_by: string | null;
      rejection_reason: string | null;
    }>('SELECT status, accepted_by, rejection_reason FROM cached_referrals WHERE id = ?', [id]);
    if (row[0].status === ReferralStatus.ACCEPTED) {
      expect(row[0].rejection_reason).toBeNull();
    } else {
      expect(row[0].status).toBe(ReferralStatus.REJECTED);
      expect(row[0].accepted_by).toBeNull();
    }
  });

  it('duplicate accepts are idempotent — first actor sticks', async () => {
    const id = await seedReferral();
    await acceptReferral(db, id, 'พว.หนึ่ง');
    const second = await acceptReferral(db, id, 'พว.สอง'); // duplicate request
    expect(second.status).toBe(ReferralStatus.ACCEPTED);
    const row = await db.query<{ accepted_by: string }>(
      'SELECT accepted_by FROM cached_referrals WHERE id = ?',
      [id],
    );
    expect(row[0].accepted_by).toBe('พว.หนึ่ง');
  });

  it('accept writes its audit row atomically with the transition', async () => {
    const id = await seedReferral();
    await acceptReferral(db, id, 'พว.เอ', {
      userId: 'u-c1',
      userName: 'พว.เอ',
      userRole: 'NURSE',
      hospitalCode: '11004',
    });
    const audit = await db.query<{ resource_id: string }>(
      `SELECT resource_id FROM audit_logs WHERE action = 'referral_accept'`,
    );
    expect(audit.length).toBe(1);
    expect(audit[0].resource_id).toBe(id);
  });
});
