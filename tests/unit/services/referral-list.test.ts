// Provincial referral list service — TDD for /api/dashboard/referrals/list.
// Covers: pagination, hospital names, global status counts (filter-independent),
// patient context join, filters (urgency/hospital/range/q/overdue), and
// emergency-first ordering.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestDb } from '../../helpers/testDb';
import type { DatabaseAdapter } from '@/db/adapter';
import { v4 as uuidv4 } from 'uuid';
import { listReferrals, getReferralDetail, getReferralInsights } from '@/services/referral-list';
import { REFERRAL_SLA } from '@/config/referral-sla';
import {
  initiateReferral,
  acceptReferral,
  markInTransit,
  confirmArrival,
  rejectReferral,
} from '@/services/referral';
import { UrgencyLevel } from '@/types/domain';

interface SeededHospitals {
  hospAId: string;
  hospBId: string;
  hospCId: string;
}

async function seedHospitals(db: DatabaseAdapter): Promise<SeededHospitals> {
  const now = new Date().toISOString();
  const hospAId = uuidv4();
  const hospBId = uuidv4();
  const hospCId = uuidv4();
  const rows: Array<[string, string, string, string]> = [
    [hospAId, '10670', 'รพ.ต้นทาง', 'M1'],
    [hospBId, '11000', 'รพ.ปลายทาง', 'A_S'],
    [hospCId, '11002', 'รพ.ทางเลือก', 'M2'],
  ];
  for (const [id, hcode, name, level] of rows) {
    await db.execute(
      `INSERT INTO hospitals (id, hcode, name, level, is_active, connection_status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, hcode, name, level, true, 'ONLINE', now, now],
    );
  }
  return { hospAId, hospBId, hospCId };
}

interface JourneyOpts {
  name?: string;
  hn?: string;
  gaWeeks?: number | null;
  ancRiskLevel?: string;
}

async function seedJourney(
  db: DatabaseAdapter,
  hospitalId: string,
  opts: JourneyOpts = {},
): Promise<string> {
  const id = uuidv4();
  const now = new Date().toISOString();
  await db.execute(
    `INSERT INTO maternal_journeys (id, hospital_id, current_hospital_id, hn, name, cid, cid_hash, age, gravida, para, care_stage, anc_risk_level, anc_visit_count, ga_weeks, registered_at, stage_changed_at, synced_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      hospitalId,
      hospitalId,
      opts.hn ?? `HN-${id.slice(0, 8)}`,
      opts.name ?? 'สมหญิง ใจดี',
      `enc_cid_${id.slice(0, 8)}`,
      `cidhash_${id.slice(0, 8)}`,
      30,
      1,
      0,
      'PREGNANCY',
      opts.ancRiskLevel ?? 'LOW',
      0,
      opts.gaWeeks === undefined ? 36 : opts.gaWeeks,
      now,
      now,
      now,
      now,
      now,
    ],
  );
  return id;
}

interface ReferralOpts {
  journeyId: string;
  fromHospitalId: string;
  toHospitalId: string;
  status?: string;
  urgencyLevel?: string;
  referNumber?: string | null;
  diagnosisCode?: string | null;
  reason?: string;
  /** Hours before "now" the referral was initiated. Default 1. */
  ageHours?: number;
  /** Reference instant for ageHours. Defaults to the real clock. */
  now?: Date;
}

async function seedReferral(db: DatabaseAdapter, opts: ReferralOpts): Promise<string> {
  const id = uuidv4();
  const nowMs = (opts.now ?? new Date()).getTime();
  const initiatedAt = new Date(nowMs - (opts.ageHours ?? 1) * 3600_000).toISOString();
  await db.execute(
    `INSERT INTO cached_referrals (id, journey_id, refer_number, from_hospital_id, to_hospital_id, status, reason, diagnosis_code, urgency_level, initiated_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      opts.journeyId,
      opts.referNumber ?? `REF-${id.slice(0, 8)}`,
      opts.fromHospitalId,
      opts.toHospitalId,
      opts.status ?? 'INITIATED',
      opts.reason ?? 'ส่งต่อเพื่อการรักษา',
      opts.diagnosisCode ?? null,
      opts.urgencyLevel ?? 'ROUTINE',
      initiatedAt,
      initiatedAt,
      initiatedAt,
    ],
  );
  return id;
}

describe('listReferrals — pagination and status counts', () => {
  let db: DatabaseAdapter;
  let hosp: SeededHospitals;
  let journeyId: string;

  beforeEach(async () => {
    db = await createTestDb();
    hosp = await seedHospitals(db);
    journeyId = await seedJourney(db, hosp.hospAId);
  });

  afterEach(async () => {
    await db.close();
  });

  it('returns referrals newest-first with hospital names and pagination meta', async () => {
    await seedReferral(db, {
      journeyId,
      fromHospitalId: hosp.hospAId,
      toHospitalId: hosp.hospBId,
      ageHours: 5,
      referNumber: 'REF-OLD',
    });
    await seedReferral(db, {
      journeyId,
      fromHospitalId: hosp.hospAId,
      toHospitalId: hosp.hospBId,
      ageHours: 1,
      referNumber: 'REF-NEW',
    });

    const result = await listReferrals(db, {});

    expect(result.referrals).toHaveLength(2);
    expect(result.referrals[0].referNumber).toBe('REF-NEW');
    expect(result.referrals[1].referNumber).toBe('REF-OLD');
    expect(result.referrals[0].fromHospital).toBe('รพ.ต้นทาง');
    expect(result.referrals[0].toHospital).toBe('รพ.ปลายทาง');
    expect(result.pagination).toEqual({ total: 2, page: 1, perPage: 20, totalPages: 1 });
  });

  it('paginates but statusCounts still reflect every row', async () => {
    for (let i = 0; i < 25; i++) {
      await seedReferral(db, {
        journeyId,
        fromHospitalId: hosp.hospAId,
        toHospitalId: hosp.hospBId,
        ageHours: i + 1,
      });
    }

    const page2 = await listReferrals(db, { page: 2, perPage: 20 });

    expect(page2.referrals).toHaveLength(5);
    expect(page2.pagination).toEqual({ total: 25, page: 2, perPage: 20, totalPages: 2 });
    expect(page2.statusCounts.initiated).toBe(25);
    expect(page2.statusCounts.total).toBe(25);
  });

  it('status filter narrows referrals but statusCounts keep the full breakdown', async () => {
    await seedReferral(db, {
      journeyId,
      fromHospitalId: hosp.hospAId,
      toHospitalId: hosp.hospBId,
      status: 'INITIATED',
    });
    await seedReferral(db, {
      journeyId,
      fromHospitalId: hosp.hospAId,
      toHospitalId: hosp.hospBId,
      status: 'ARRIVED',
    });
    await seedReferral(db, {
      journeyId,
      fromHospitalId: hosp.hospAId,
      toHospitalId: hosp.hospBId,
      status: 'REJECTED',
    });

    const result = await listReferrals(db, { status: 'ARRIVED' });

    expect(result.referrals).toHaveLength(1);
    expect(result.referrals[0].status).toBe('ARRIVED');
    expect(result.statusCounts).toEqual({
      initiated: 1,
      accepted: 0,
      inTransit: 0,
      arrived: 1,
      rejected: 1,
      total: 3,
    });
  });
});

// Fixed reference instant (18:00 Bangkok) so date-range assertions never
// depend on when the suite runs.
const NOW = new Date('2026-07-08T18:00:00+07:00');

describe('listReferrals — patient context, filters, ordering, ops counts', () => {
  let db: DatabaseAdapter;
  let hosp: SeededHospitals;

  beforeEach(async () => {
    db = await createTestDb();
    hosp = await seedHospitals(db);
  });

  afterEach(async () => {
    await db.close();
  });

  it('carries patient context (name, hn, gaWeeks, ancRiskLevel) from the journey', async () => {
    const journeyId = await seedJourney(db, hosp.hospAId, {
      name: 'นาง สายฝน อุ่นเรือน',
      hn: 'HN001234',
      gaWeeks: 32,
      ancRiskLevel: 'HR2',
    });
    await seedReferral(db, {
      journeyId,
      fromHospitalId: hosp.hospAId,
      toHospitalId: hosp.hospBId,
      referNumber: 'REF-2569-001',
      diagnosisCode: 'O24.4',
      now: NOW,
    });

    const result = await listReferrals(db, {}, NOW);
    const item = result.referrals[0];

    expect(item.patientName).toBe('นาง สายฝน อุ่นเรือน');
    expect(item.hn).toBe('HN001234');
    expect(item.gaWeeks).toBe(32);
    expect(item.ancRiskLevel).toBe('HR2');
    expect(item.referNumber).toBe('REF-2569-001');
    expect(item.diagnosisCode).toBe('O24.4');
    expect(item.journeyId).toBe(journeyId);
  });

  it('filters by urgency level', async () => {
    const journeyId = await seedJourney(db, hosp.hospAId);
    await seedReferral(db, {
      journeyId,
      fromHospitalId: hosp.hospAId,
      toHospitalId: hosp.hospBId,
      urgencyLevel: 'EMERGENCY',
      now: NOW,
    });
    await seedReferral(db, {
      journeyId,
      fromHospitalId: hosp.hospAId,
      toHospitalId: hosp.hospBId,
      urgencyLevel: 'ROUTINE',
      now: NOW,
    });

    const result = await listReferrals(db, { urgency: 'EMERGENCY' }, NOW);

    expect(result.referrals).toHaveLength(1);
    expect(result.referrals[0].urgencyLevel).toBe('EMERGENCY');
  });

  it('filters by destination hospital', async () => {
    const journeyId = await seedJourney(db, hosp.hospAId);
    await seedReferral(db, {
      journeyId,
      fromHospitalId: hosp.hospAId,
      toHospitalId: hosp.hospBId,
      now: NOW,
    });
    await seedReferral(db, {
      journeyId,
      fromHospitalId: hosp.hospAId,
      toHospitalId: hosp.hospCId,
      now: NOW,
    });

    const result = await listReferrals(db, { toHospitalId: hosp.hospCId }, NOW);

    expect(result.referrals).toHaveLength(1);
    expect(result.referrals[0].toHospital).toBe('รพ.ทางเลือก');
  });

  it('range=today includes only referrals initiated since Bangkok midnight', async () => {
    const journeyId = await seedJourney(db, hosp.hospAId);
    await seedReferral(db, {
      journeyId,
      fromHospitalId: hosp.hospAId,
      toHospitalId: hosp.hospBId,
      referNumber: 'REF-TODAY',
      ageHours: 2, // 16:00 Bangkok today
      now: NOW,
    });
    await seedReferral(db, {
      journeyId,
      fromHospitalId: hosp.hospAId,
      toHospitalId: hosp.hospBId,
      referNumber: 'REF-YESTERDAY',
      ageHours: 30, // 12:00 Bangkok yesterday
      now: NOW,
    });

    const result = await listReferrals(db, { range: 'today' }, NOW);

    expect(result.referrals.map((r) => r.referNumber)).toEqual(['REF-TODAY']);
  });

  it('range=7d excludes referrals older than seven days', async () => {
    const journeyId = await seedJourney(db, hosp.hospAId);
    await seedReferral(db, {
      journeyId,
      fromHospitalId: hosp.hospAId,
      toHospitalId: hosp.hospBId,
      referNumber: 'REF-RECENT',
      ageHours: 24 * 3,
      now: NOW,
    });
    await seedReferral(db, {
      journeyId,
      fromHospitalId: hosp.hospAId,
      toHospitalId: hosp.hospBId,
      referNumber: 'REF-ANCIENT',
      ageHours: 24 * 10,
      now: NOW,
    });

    const result = await listReferrals(db, { range: '7d' }, NOW);

    expect(result.referrals.map((r) => r.referNumber)).toEqual(['REF-RECENT']);
  });

  it('q matches refer number contains, HN prefix, or patient name contains', async () => {
    const j1 = await seedJourney(db, hosp.hospAId, { name: 'นาง สายฝน อุ่นเรือน', hn: 'HN777001' });
    const j2 = await seedJourney(db, hosp.hospAId, {
      name: 'น.ส. จันทร์เพ็ญ ดีงาม',
      hn: 'HN888002',
    });
    await seedReferral(db, {
      journeyId: j1,
      fromHospitalId: hosp.hospAId,
      toHospitalId: hosp.hospBId,
      referNumber: 'REF-2569-042',
      now: NOW,
    });
    await seedReferral(db, {
      journeyId: j2,
      fromHospitalId: hosp.hospAId,
      toHospitalId: hosp.hospBId,
      referNumber: 'REF-2569-043',
      now: NOW,
    });

    const byRef = await listReferrals(db, { q: '2569-042' }, NOW);
    expect(byRef.referrals.map((r) => r.referNumber)).toEqual(['REF-2569-042']);
    expect(byRef.pagination.total).toBe(1);

    const byHn = await listReferrals(db, { q: 'HN888' }, NOW);
    expect(byHn.referrals.map((r) => r.referNumber)).toEqual(['REF-2569-043']);

    const byName = await listReferrals(db, { q: 'สายฝน' }, NOW);
    expect(byName.referrals.map((r) => r.referNumber)).toEqual(['REF-2569-042']);
  });

  it('overdue=true returns only INITIATED referrals older than the SLA threshold', async () => {
    const journeyId = await seedJourney(db, hosp.hospAId);
    await seedReferral(db, {
      journeyId,
      fromHospitalId: hosp.hospAId,
      toHospitalId: hosp.hospBId,
      referNumber: 'REF-OVERDUE',
      status: 'INITIATED',
      ageHours: REFERRAL_SLA.overdueAfterHours + 1,
      now: NOW,
    });
    await seedReferral(db, {
      journeyId,
      fromHospitalId: hosp.hospAId,
      toHospitalId: hosp.hospBId,
      referNumber: 'REF-FRESH',
      status: 'INITIATED',
      ageHours: 1,
      now: NOW,
    });
    await seedReferral(db, {
      journeyId,
      fromHospitalId: hosp.hospAId,
      toHospitalId: hosp.hospBId,
      referNumber: 'REF-DONE',
      status: 'ARRIVED',
      ageHours: REFERRAL_SLA.overdueAfterHours + 5,
      now: NOW,
    });

    const result = await listReferrals(db, { overdue: true }, NOW);

    expect(result.referrals.map((r) => r.referNumber)).toEqual(['REF-OVERDUE']);
  });

  it('pins active EMERGENCY referrals within the pin window above newer routine rows', async () => {
    const journeyId = await seedJourney(db, hosp.hospAId);
    await seedReferral(db, {
      journeyId,
      fromHospitalId: hosp.hospAId,
      toHospitalId: hosp.hospBId,
      referNumber: 'REF-ROUTINE-NEW',
      urgencyLevel: 'ROUTINE',
      ageHours: 1,
      now: NOW,
    });
    await seedReferral(db, {
      journeyId,
      fromHospitalId: hosp.hospAId,
      toHospitalId: hosp.hospBId,
      referNumber: 'REF-EMERGENCY-ACTIVE',
      urgencyLevel: 'EMERGENCY',
      status: 'INITIATED',
      ageHours: 10,
      now: NOW,
    });
    await seedReferral(db, {
      journeyId,
      fromHospitalId: hosp.hospAId,
      toHospitalId: hosp.hospBId,
      referNumber: 'REF-EMERGENCY-ARRIVED',
      urgencyLevel: 'EMERGENCY',
      status: 'ARRIVED',
      ageHours: 5,
      now: NOW,
    });

    const result = await listReferrals(db, {}, NOW);

    expect(result.referrals.map((r) => r.referNumber)).toEqual([
      'REF-EMERGENCY-ACTIVE', // pinned: active emergency inside pin window
      'REF-ROUTINE-NEW', // then newest-first
      'REF-EMERGENCY-ARRIVED', // terminal status — not pinned
    ]);
  });

  it('opsCounts summarise the whole table independent of list filters', async () => {
    const lowRisk = await seedJourney(db, hosp.hospAId, { ancRiskLevel: 'LOW' });
    const highRisk = await seedJourney(db, hosp.hospAId, { ancRiskLevel: 'HR3' });

    // Initiated 2h ago today, high-risk patient, emergency, active.
    await seedReferral(db, {
      journeyId: highRisk,
      fromHospitalId: hosp.hospAId,
      toHospitalId: hosp.hospBId,
      urgencyLevel: 'EMERGENCY',
      ageHours: 2,
      now: NOW,
    });
    // Initiated 3 days ago, low-risk, overdue INITIATED.
    await seedReferral(db, {
      journeyId: lowRisk,
      fromHospitalId: hosp.hospAId,
      toHospitalId: hosp.hospBId,
      urgencyLevel: 'ROUTINE',
      ageHours: 24 * 3,
      now: NOW,
    });
    // Initiated 10 days ago and ARRIVED — outside 7d, terminal, not overdue.
    await seedReferral(db, {
      journeyId: lowRisk,
      fromHospitalId: hosp.hospAId,
      toHospitalId: hosp.hospBId,
      urgencyLevel: 'EMERGENCY',
      status: 'ARRIVED',
      ageHours: 24 * 10,
      now: NOW,
    });

    const result = await listReferrals(db, { status: 'ARRIVED', range: 'today' }, NOW);

    expect(result.opsCounts).toEqual({
      today: 1,
      last7d: 2,
      emergencyActive: 1,
      highRisk: 1,
      overdue: 1,
    });
  });
});

describe('getReferralDetail — full referral with milestones and patient context', () => {
  let db: DatabaseAdapter;
  let hosp: SeededHospitals;

  beforeEach(async () => {
    db = await createTestDb();
    hosp = await seedHospitals(db);
    const now = new Date().toISOString();
    await db.execute(
      `INSERT INTO users (id, bms_user_name, role, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`,
      ['doctor-007', 'doctor-007', 'NURSE', true, now, now],
    );
  });

  afterEach(async () => {
    await db.close();
  });

  it('returns milestone timestamps, transport mode, and patient context after a full lifecycle', async () => {
    const journeyId = await seedJourney(db, hosp.hospAId, {
      name: 'นาง สายฝน อุ่นเรือน',
      hn: 'HN001234',
      gaWeeks: 38,
      ancRiskLevel: 'HR3',
    });
    const ref = await initiateReferral(db, {
      journeyId,
      fromHospitalId: hosp.hospAId,
      toHospitalId: hosp.hospBId,
      reason: 'Fetal distress',
      diagnosisCode: 'O68.0',
      urgencyLevel: UrgencyLevel.EMERGENCY,
    });
    await acceptReferral(db, ref.id, 'doctor-007');
    await markInTransit(db, ref.id, 'AMBULANCE');
    await confirmArrival(db, ref.id, 'AN-B-9999');

    const detail = await getReferralDetail(db, ref.id);

    expect(detail).not.toBeNull();
    expect(detail!.status).toBe('ARRIVED');
    expect(detail!.fromHospital).toBe('รพ.ต้นทาง');
    expect(detail!.toHospital).toBe('รพ.ปลายทาง');
    expect(detail!.patientName).toBe('นาง สายฝน อุ่นเรือน');
    expect(detail!.hn).toBe('HN001234');
    expect(detail!.gaWeeks).toBe(38);
    expect(detail!.ancRiskLevel).toBe('HR3');
    expect(detail!.diagnosisCode).toBe('O68.0');
    expect(detail!.transportMode).toBe('AMBULANCE');
    expect(detail!.acceptedAt).not.toBeNull();
    expect(detail!.departedAt).not.toBeNull();
    expect(detail!.arrivedAt).not.toBeNull();
    expect(detail!.rejectedAt).toBeNull();
    expect(detail!.rejectionReason).toBeNull();
  });

  it('returns rejection reason and suggested alternative hospital name for rejected referrals', async () => {
    const journeyId = await seedJourney(db, hosp.hospAId);
    const ref = await initiateReferral(db, {
      journeyId,
      fromHospitalId: hosp.hospAId,
      toHospitalId: hosp.hospBId,
      reason: 'Emergency delivery',
      urgencyLevel: UrgencyLevel.EMERGENCY,
    });
    await rejectReferral(db, ref.id, 'ICU เต็ม', hosp.hospCId);

    const detail = await getReferralDetail(db, ref.id);

    expect(detail!.status).toBe('REJECTED');
    expect(detail!.rejectionReason).toBe('ICU เต็ม');
    expect(detail!.rejectedAt).not.toBeNull();
    expect(detail!.suggestedAlternativeHospital).toBe('รพ.ทางเลือก');
  });

  it('returns null for an unknown referral id', async () => {
    expect(await getReferralDetail(db, 'no-such-id')).toBeNull();
  });
});

describe('getReferralInsights — corridors, daily volume, destinations', () => {
  let db: DatabaseAdapter;
  let hosp: SeededHospitals;
  let journeyId: string;

  beforeEach(async () => {
    db = await createTestDb();
    hosp = await seedHospitals(db);
    journeyId = await seedJourney(db, hosp.hospAId);
  });

  afterEach(async () => {
    await db.close();
  });

  it('aggregates corridors by from→to pair, busiest first', async () => {
    for (let i = 0; i < 3; i++) {
      await seedReferral(db, {
        journeyId,
        fromHospitalId: hosp.hospAId,
        toHospitalId: hosp.hospBId,
        now: NOW,
      });
    }
    for (let i = 0; i < 2; i++) {
      await seedReferral(db, {
        journeyId,
        fromHospitalId: hosp.hospAId,
        toHospitalId: hosp.hospCId,
        now: NOW,
      });
    }
    await seedReferral(db, {
      journeyId,
      fromHospitalId: hosp.hospCId,
      toHospitalId: hosp.hospBId,
      now: NOW,
    });

    const insights = await getReferralInsights(db, NOW);

    expect(insights.corridors).toHaveLength(3);
    expect(insights.corridors[0]).toMatchObject({
      fromHospital: 'รพ.ต้นทาง',
      toHospital: 'รพ.ปลายทาง',
      count: 3,
    });
    expect(insights.corridors[1].count).toBe(2);
  });

  it('buckets the last 7 Bangkok days of volume, oldest first', async () => {
    await seedReferral(db, {
      journeyId,
      fromHospitalId: hosp.hospAId,
      toHospitalId: hosp.hospBId,
      ageHours: 2, // today (16:00 Bangkok)
      now: NOW,
    });
    await seedReferral(db, {
      journeyId,
      fromHospitalId: hosp.hospAId,
      toHospitalId: hosp.hospBId,
      ageHours: 24 * 3, // 3 days ago
      now: NOW,
    });
    await seedReferral(db, {
      journeyId,
      fromHospitalId: hosp.hospAId,
      toHospitalId: hosp.hospBId,
      ageHours: 24 * 10, // outside the window
      now: NOW,
    });

    const insights = await getReferralInsights(db, NOW);

    expect(insights.daily).toHaveLength(7);
    expect(insights.daily[6]).toEqual({ date: '2026-07-08', count: 1 });
    expect(insights.daily[3]).toEqual({ date: '2026-07-05', count: 1 });
    expect(insights.daily.reduce((s, d) => s + d.count, 0)).toBe(2);
  });

  it('lists destination hospitals with referral counts for the filter dropdown', async () => {
    await seedReferral(db, {
      journeyId,
      fromHospitalId: hosp.hospAId,
      toHospitalId: hosp.hospBId,
      now: NOW,
    });
    await seedReferral(db, {
      journeyId,
      fromHospitalId: hosp.hospAId,
      toHospitalId: hosp.hospBId,
      now: NOW,
    });
    await seedReferral(db, {
      journeyId,
      fromHospitalId: hosp.hospBId,
      toHospitalId: hosp.hospCId,
      now: NOW,
    });

    const insights = await getReferralInsights(db, NOW);

    expect(insights.destinations).toEqual([
      { id: hosp.hospBId, name: 'รพ.ปลายทาง', count: 2 },
      { id: hosp.hospCId, name: 'รพ.ทางเลือก', count: 1 },
    ]);
  });
});
