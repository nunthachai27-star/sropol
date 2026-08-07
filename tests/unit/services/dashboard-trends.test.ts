// Trends service tests — 24h admission pulse, today vs 7d avg, newByRisk24h,
// and current/previous shift counts for the redesigned dashboard (§5 of the
// 2026-04-21 brief).
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestDb } from '../../helpers/testDb';
import type { DatabaseAdapter } from '@/db/adapter';
import { SeedOrchestrator } from '@/db/seeds/index';
import { getTrends } from '@/services/dashboard';
import { v4 as uuidv4 } from 'uuid';

async function seedPatient(
  db: DatabaseAdapter,
  hospitalId: string,
  admitDate: string,
  opts: { risk?: 'LOW' | 'MEDIUM' | 'HIGH'; deliveredAt?: string | null } = {},
): Promise<string> {
  const patientId = uuidv4();
  const now = new Date().toISOString();
  await db.execute(
    'INSERT INTO cached_patients (id, hospital_id, hn, an, name, age, admit_date, delivered_at, labor_status, synced_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [
      patientId,
      hospitalId,
      `HN-${patientId.slice(0, 6)}`,
      `AN-${patientId.slice(0, 6)}`,
      'enc-test',
      30,
      admitDate,
      opts.deliveredAt ?? null,
      opts.deliveredAt ? 'DELIVERED' : 'ACTIVE',
      now,
      now,
      now,
    ],
  );
  if (opts.risk) {
    await db.execute(
      'INSERT INTO cpd_scores (id, patient_id, score, risk_level, calculated_at, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      [uuidv4(), patientId, opts.risk === 'HIGH' ? 11 : opts.risk === 'MEDIUM' ? 6 : 2, opts.risk, admitDate, admitDate],
    );
  }
  return patientId;
}

async function seedReferral(
  db: DatabaseAdapter,
  fromHospitalId: string,
  toHospitalId: string,
  initiatedAt: string,
  status: 'INITIATED' | 'ACCEPTED' | 'IN_TRANSIT' | 'ARRIVED' = 'INITIATED',
) {
  const now = new Date().toISOString();
  const journeyId = uuidv4();
  await db.execute(
    'INSERT INTO maternal_journeys (id, hospital_id, current_hospital_id, hn, name, cid, cid_hash, age, gravida, care_stage, anc_risk_level, registered_at, stage_changed_at, synced_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [
      journeyId,
      fromHospitalId,
      fromHospitalId,
      `HN-${journeyId.slice(0, 6)}`,
      'enc-name',
      'enc-cid',
      'hash',
      30,
      1,
      'LABOR',
      'LOW',
      now,
      now,
      now,
      now,
      now,
    ],
  );
  await db.execute(
    'INSERT INTO cached_referrals (id, journey_id, from_hospital_id, to_hospital_id, status, reason, urgency_level, initiated_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [uuidv4(), journeyId, fromHospitalId, toHospitalId, status, 'test-seed', 'ROUTINE', initiatedAt, now, now],
  );
}

describe('getTrends', () => {
  let db: DatabaseAdapter;
  let hospitalId: string;
  let otherHospitalId: string;
  const REFERENCE_NOW = new Date('2026-04-21T08:42:07.000Z'); // 15:42 Bangkok (เวรบ่าย shift)

  beforeEach(async () => {
    db = await createTestDb();
    await new SeedOrchestrator().run(db);
    const rows = await db.query<{ id: string; hcode: string }>(
      "SELECT id, hcode FROM hospitals WHERE hcode IN ('10670', '10998')",
    );
    hospitalId = rows.find((r) => r.hcode === '10670')!.id;
    otherHospitalId = rows.find((r) => r.hcode === '10998')!.id;
  });

  afterEach(async () => {
    await db.close();
  });

  it('returns zero trends on empty DB', async () => {
    const t = await getTrends(db, REFERENCE_NOW);
    expect(t.admissions24h).toHaveLength(24);
    expect(t.admissions24h.reduce((a, b) => a + b, 0)).toBe(0);
    expect(t.admissionsToday).toBe(0);
    expect(t.admissions7dAvg).toBe(0);
    expect(t.newByRisk24h).toEqual({ high: 0, medium: 0, low: 0, total: 0 });
    expect(t.currentShift.admissions).toBe(0);
    expect(t.previousShift.admissions).toBe(0);
  });

  it('buckets 24h admissions into hourly slots, newest at index 23', async () => {
    // Reference now = 2026-04-21T08:42 UTC = 15:42 Bangkok. 24h window starts
    // at 2026-04-20T09:00 UTC (= 16:00 BKK yesterday). Seed an admission in
    // the hour that began 2h ago (2026-04-21T06:00 UTC — 13:00 BKK).
    await seedPatient(db, hospitalId, '2026-04-21T06:15:00.000Z');
    // One at 24h ago exactly (lands in index 0)
    await seedPatient(db, hospitalId, '2026-04-20T09:10:00.000Z');
    // One before the 24h window — must NOT appear
    await seedPatient(db, hospitalId, '2026-04-20T05:00:00.000Z');

    const t = await getTrends(db, REFERENCE_NOW);
    expect(t.admissions24h[0]).toBe(1);
    // index 21 = 2h ago (23 - 2)
    expect(t.admissions24h[21]).toBe(1);
    expect(t.admissions24h.reduce((a, b) => a + b, 0)).toBe(2);
  });

  it('counts admissions today (Bangkok tz) and 7-day average', async () => {
    // Today in Bangkok = 2026-04-21 → starts 2026-04-20T17:00:00Z (midnight BKK).
    await seedPatient(db, hospitalId, '2026-04-20T17:10:00.000Z'); // today
    await seedPatient(db, hospitalId, '2026-04-21T02:00:00.000Z'); // today
    await seedPatient(db, hospitalId, '2026-04-20T16:59:00.000Z'); // yesterday (part of 7d window)
    // 5 more across the 7-day window pre-today
    await seedPatient(db, hospitalId, '2026-04-15T12:00:00.000Z');
    await seedPatient(db, hospitalId, '2026-04-16T12:00:00.000Z');
    await seedPatient(db, hospitalId, '2026-04-17T12:00:00.000Z');
    await seedPatient(db, hospitalId, '2026-04-18T12:00:00.000Z');
    await seedPatient(db, hospitalId, '2026-04-19T12:00:00.000Z');

    const t = await getTrends(db, REFERENCE_NOW);
    expect(t.admissionsToday).toBe(2);
    // 6 admissions across 7 days pre-today → ~0.9
    expect(t.admissions7dAvg).toBeGreaterThan(0.8);
    expect(t.admissions7dAvg).toBeLessThan(1.0);
  });

  it('counts new admits in last 24h grouped by current CPD risk', async () => {
    await seedPatient(db, hospitalId, '2026-04-21T05:00:00.000Z', { risk: 'HIGH' });
    await seedPatient(db, hospitalId, '2026-04-21T06:00:00.000Z', { risk: 'MEDIUM' });
    await seedPatient(db, hospitalId, '2026-04-21T07:00:00.000Z', { risk: 'LOW' });
    // Patient without a CPD score still counts toward total but not any tier.
    await seedPatient(db, hospitalId, '2026-04-21T07:30:00.000Z');
    // Pre-24h — excluded.
    await seedPatient(db, hospitalId, '2026-04-19T00:00:00.000Z', { risk: 'HIGH' });

    const t = await getTrends(db, REFERENCE_NOW);
    expect(t.newByRisk24h).toMatchObject({ high: 1, medium: 1, low: 1, total: 4 });
  });

  it('resolves current shift = เวรบ่าย for 15:42 Bangkok', async () => {
    const t = await getTrends(db, REFERENCE_NOW);
    expect(t.currentShift.label).toContain('เวรบ่าย');
    expect(t.previousShift.label).toContain('เวรเช้า');
    // Current-shift end is capped at now(), previous is full window.
    expect(new Date(t.currentShift.windowEnd).getTime()).toBeLessThanOrEqual(REFERENCE_NOW.getTime());
    expect(new Date(t.previousShift.windowEnd).getTime()).toBeGreaterThan(
      new Date(t.previousShift.windowStart).getTime(),
    );
  });

  it('counts shift admissions, deliveries, and referrals within window', async () => {
    // เวรบ่าย (15:00-22:00 BKK) = 08:00-15:00 UTC. Current shift window so far:
    // 08:00 UTC → 08:42 UTC (ref now). Seed items inside and outside.
    await seedPatient(db, hospitalId, '2026-04-21T08:15:00.000Z'); // inside current
    await seedPatient(db, hospitalId, '2026-04-21T08:30:00.000Z', { deliveredAt: '2026-04-21T08:35:00.000Z' }); // delivered inside current
    await seedReferral(db, hospitalId, otherHospitalId, '2026-04-21T08:20:00.000Z');

    // Previous shift = เวรเช้า 07:00-15:00 BKK = 00:00-08:00 UTC today
    await seedPatient(db, hospitalId, '2026-04-21T02:00:00.000Z'); // inside prev
    await seedPatient(db, hospitalId, '2026-04-21T03:00:00.000Z'); // inside prev
    await seedReferral(db, hospitalId, otherHospitalId, '2026-04-21T04:00:00.000Z');
    await seedReferral(db, hospitalId, otherHospitalId, '2026-04-21T05:00:00.000Z');

    // Outside both shifts (before 00:00 UTC today) — should be excluded.
    await seedPatient(db, hospitalId, '2026-04-20T20:00:00.000Z');

    const t = await getTrends(db, REFERENCE_NOW);
    expect(t.currentShift.admissions).toBe(2); // the 2 admissions at 08:15 + 08:30 (delivered one still counted as admission)
    expect(t.currentShift.delivered).toBe(1);
    expect(t.currentShift.referred).toBe(1);
    expect(t.previousShift.admissions).toBe(2);
    expect(t.previousShift.referred).toBe(2);
  });
});
