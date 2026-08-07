// T046: Dashboard service tests — write FIRST (TDD)
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestDb } from '../../helpers/testDb';
import type { DatabaseAdapter } from '@/db/adapter';
import { SeedOrchestrator } from '@/db/seeds/index';
import {
  getProvinceDashboard,
  getSummaryTotals,
  getHospitalPatientList,
  getHospitalPartographAudit,
} from '@/services/dashboard';
import { v4 as uuidv4 } from 'uuid';

describe('Dashboard Service', () => {
  let db: DatabaseAdapter;

  beforeEach(async () => {
    db = await createTestDb();
    await new SeedOrchestrator().run(db);
  });

  afterEach(async () => {
    await db.close();
  });

  it('should return all hospitals with zero counts when no patients', async () => {
    const result = await getProvinceDashboard(db);
    expect(result.hospitals).toHaveLength(26);
    for (const h of result.hospitals) {
      expect(h.counts.total).toBe(0);
      expect(h.counts.low).toBe(0);
      expect(h.counts.medium).toBe(0);
      expect(h.counts.high).toBe(0);
    }
  });

  it('should count patients by risk level per hospital', async () => {
    // Get a hospital ID
    const hospitals = await db.query<{ id: string }>(
      "SELECT id FROM hospitals WHERE hcode = '10670'",
    );
    const hospitalId = hospitals[0].id;
    const now = new Date().toISOString();

    // Insert test patients
    const patientId1 = uuidv4();
    const patientId2 = uuidv4();
    await db.execute(
      'INSERT INTO cached_patients (id, hospital_id, hn, an, name, age, admit_date, labor_status, synced_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [patientId1, hospitalId, 'HN001', 'AN001', 'enc-name-1', 28, now, 'ACTIVE', now, now, now],
    );
    await db.execute(
      'INSERT INTO cached_patients (id, hospital_id, hn, an, name, age, admit_date, labor_status, synced_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [patientId2, hospitalId, 'HN002', 'AN002', 'enc-name-2', 32, now, 'ACTIVE', now, now, now],
    );

    // Insert CPD scores
    await db.execute(
      'INSERT INTO cpd_scores (id, patient_id, score, risk_level, calculated_at, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      [uuidv4(), patientId1, 3.5, 'LOW', now, now],
    );
    await db.execute(
      'INSERT INTO cpd_scores (id, patient_id, score, risk_level, calculated_at, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      [uuidv4(), patientId2, 11, 'HIGH', now, now],
    );

    const result = await getProvinceDashboard(db);
    const hospital = result.hospitals.find((h) => h.hcode === '10670');
    expect(hospital).toBeDefined();
    expect(hospital!.counts.total).toBe(2);
    expect(hospital!.counts.low).toBe(1);
    expect(hospital!.counts.high).toBe(1);
  });

  it('reports per-hospital partograph coverage over the quality window', async () => {
    const hospitals = await db.query<{ id: string }>(
      "SELECT id FROM hospitals WHERE hcode = '10670'",
    );
    const hospitalId = hospitals[0].id;
    const now = new Date();
    const iso = (daysAgo: number) => new Date(now.getTime() - daysAgo * 86_400_000).toISOString();

    const insertPatient = (id: string, an: string, admitDaysAgo: number) =>
      db.execute(
        'INSERT INTO cached_patients (id, hospital_id, hn, an, name, age, admit_date, labor_status, synced_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [
          id,
          hospitalId,
          `HN-${an}`,
          an,
          'enc',
          28,
          iso(admitDaysAgo),
          'ACTIVE',
          iso(0),
          iso(0),
          iso(0),
        ],
      );
    // Two admissions inside the window (one charted), one outside it.
    await insertPatient('pq-1', 'PQ001', 2);
    await insertPatient('pq-2', 'PQ002', 5);
    await insertPatient('pq-3', 'PQ003', 60);
    await db.execute(
      `INSERT INTO cached_partograph_observations
         (id, patient_id, hospital_id, source_system, source_pk, observe_datetime,
          synced_at, created_at, updated_at)
       VALUES (?, ?, ?, 'hosxp', 'src-1', ?, ?, ?, ?)`,
      [uuidv4(), 'pq-1', hospitalId, iso(1), iso(0), iso(0), iso(0)],
    );

    const result = await getProvinceDashboard(db);
    const hospital = result.hospitals.find((h) => h.hcode === '10670')!;
    expect(hospital.partographQuality).toEqual({ laborRecent: 2, withPartograph: 1 });

    // Hospitals with no recent admissions report zeros, not undefined.
    const other = result.hospitals.find((h) => h.hcode !== '10670')!;
    expect(other.partographQuality).toEqual({ laborRecent: 0, withPartograph: 0 });
  });

  it('partograph audit lists window admissions, uncharted first; null for unknown hcode', async () => {
    expect(await getHospitalPartographAudit(db, '99999')).toBeNull();

    const hospitals = await db.query<{ id: string }>(
      "SELECT id FROM hospitals WHERE hcode = '10670'",
    );
    const hospitalId = hospitals[0].id;
    const iso = (daysAgo: number) => new Date(Date.now() - daysAgo * 86_400_000).toISOString();
    const insertPatient = (id: string, an: string, admitDaysAgo: number) =>
      db.execute(
        'INSERT INTO cached_patients (id, hospital_id, hn, an, name, age, admit_date, labor_status, synced_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [
          id,
          hospitalId,
          `HN-${an}`,
          an,
          'enc',
          28,
          iso(admitDaysAgo),
          'ACTIVE',
          iso(0),
          iso(0),
          iso(0),
        ],
      );
    await insertPatient('pa-1', 'PA001', 2); // charted
    await insertPatient('pa-2', 'PA002', 5); // never charted
    await insertPatient('pa-3', 'PA003', 60); // outside window
    await db.execute(
      `INSERT INTO cached_partograph_observations
         (id, patient_id, hospital_id, source_system, source_pk, observe_datetime,
          synced_at, created_at, updated_at)
       VALUES (?, 'pa-1', ?, 'hosxp', 'src-audit-1', ?, ?, ?, ?)`,
      [uuidv4(), hospitalId, iso(1), iso(0), iso(0), iso(0)],
    );

    const audit = await getHospitalPartographAudit(db, '10670');
    expect(audit).not.toBeNull();
    expect(audit!.laborRecent).toBe(2);
    expect(audit!.withPartograph).toBe(1);
    expect(audit!.admissions).toHaveLength(2);
    // Uncharted admissions sort first — they are the action items.
    expect(audit!.admissions[0].an).toBe('PA002');
    expect(audit!.admissions[0].observationCount).toBe(0);
    expect(audit!.admissions[1].an).toBe('PA001');
    expect(audit!.admissions[1].observationCount).toBe(1);
    expect(audit!.admissions[1].lastObservedAt).toBeTruthy();
  });

  it('should handle hospitals with OFFLINE status', async () => {
    // Update a hospital status
    await db.execute("UPDATE hospitals SET connection_status = 'OFFLINE' WHERE hcode = '10670'");

    const result = await getProvinceDashboard(db);
    const hospital = result.hospitals.find((h) => h.hcode === '10670');
    expect(hospital!.connectionStatus).toBe('OFFLINE');
  });

  describe('getSummaryTotals', () => {
    it('should aggregate counts across all hospitals', () => {
      const hospitals = [
        { hcode: '10670', counts: { low: 1, medium: 2, high: 0, total: 3 } },
        { hcode: '11000', counts: { low: 0, medium: 1, high: 1, total: 2 } },
      ];
      const summary = getSummaryTotals(hospitals as any);
      expect(summary.totalLow).toBe(1);
      expect(summary.totalMedium).toBe(3);
      expect(summary.totalHigh).toBe(1);
      expect(summary.totalActive).toBe(5);
    });
  });

  // T105: Date range filtering tests
  it('getHospitalPatientList returns lastSyncAt as an ISO string, not a pg Date', async () => {
    await db.execute("UPDATE hospitals SET last_sync_at = ? WHERE hcode = '10670'", [
      '2026-07-01T02:30:00.000Z',
    ]);
    const result = await getHospitalPatientList(db, '10670', { status: 'active' });
    expect(result).not.toBeNull();
    // pg returns TIMESTAMPTZ as a Date object; the API type declares string.
    expect(result?.hospital?.lastSyncAt).toBe('2026-07-01T02:30:00.000Z');
  });

  describe('getHospitalPatientList — date range filtering', () => {
    let hospitalId: string;
    const hcode = '10670';

    beforeEach(async () => {
      // Get hospital ID for test data
      const hospitals = await db.query<{ id: string }>('SELECT id FROM hospitals WHERE hcode = ?', [
        hcode,
      ]);
      hospitalId = hospitals[0].id;

      // Insert patients with different admit_date values
      const patients = [
        { id: uuidv4(), hn: 'HN-D01', an: 'AN-D01', admitDate: '2026-03-01T08:00:00.000Z' },
        { id: uuidv4(), hn: 'HN-D02', an: 'AN-D02', admitDate: '2026-03-05T10:00:00.000Z' },
        { id: uuidv4(), hn: 'HN-D03', an: 'AN-D03', admitDate: '2026-03-08T14:00:00.000Z' },
        { id: uuidv4(), hn: 'HN-D04', an: 'AN-D04', admitDate: '2026-03-10T06:00:00.000Z' },
        { id: uuidv4(), hn: 'HN-D05', an: 'AN-D05', admitDate: '2026-03-15T12:00:00.000Z' },
      ];
      const now = new Date().toISOString();
      for (const p of patients) {
        await db.execute(
          'INSERT INTO cached_patients (id, hospital_id, hn, an, name, age, admit_date, labor_status, synced_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
          [p.id, hospitalId, p.hn, p.an, 'enc-test', 30, p.admitDate, 'ACTIVE', now, now, now],
        );
      }
    });

    it('should return all patients when no date filter is provided', async () => {
      const result = await getHospitalPatientList(db, hcode, { status: 'active' });
      expect(result.patients).toHaveLength(5);
      expect(result.pagination.total).toBe(5);
    });

    it('should filter patients by dateFrom only', async () => {
      const result = await getHospitalPatientList(db, hcode, {
        status: 'active',
        dateFrom: '2026-03-08',
      });
      // Should return patients admitted on or after 2026-03-08 (3 patients: 08, 10, 15)
      expect(result.patients).toHaveLength(3);
      expect(result.pagination.total).toBe(3);
    });

    it('should filter patients by dateTo only', async () => {
      const result = await getHospitalPatientList(db, hcode, {
        status: 'active',
        dateTo: '2026-03-05',
      });
      // Should return patients admitted on or before 2026-03-05 (2 patients: 01, 05)
      expect(result.patients).toHaveLength(2);
      expect(result.pagination.total).toBe(2);
    });

    it('should filter patients by both dateFrom and dateTo', async () => {
      const result = await getHospitalPatientList(db, hcode, {
        status: 'active',
        dateFrom: '2026-03-05',
        dateTo: '2026-03-10',
      });
      // Should return patients admitted between 2026-03-05 and 2026-03-10 (3 patients: 05, 08, 10)
      expect(result.patients).toHaveLength(3);
      expect(result.pagination.total).toBe(3);
    });

    it('should return empty when date range matches no patients', async () => {
      const result = await getHospitalPatientList(db, hcode, {
        status: 'active',
        dateFrom: '2026-04-01',
        dateTo: '2026-04-30',
      });
      expect(result.patients).toHaveLength(0);
      expect(result.pagination.total).toBe(0);
    });

    it('should correctly paginate with date filters', async () => {
      const result = await getHospitalPatientList(db, hcode, {
        status: 'active',
        dateFrom: '2026-03-01',
        dateTo: '2026-03-15',
        perPage: 2,
        page: 1,
      });
      expect(result.patients).toHaveLength(2);
      expect(result.pagination.total).toBe(5);
      expect(result.pagination.totalPages).toBe(3);

      const page2 = await getHospitalPatientList(db, hcode, {
        status: 'active',
        dateFrom: '2026-03-01',
        dateTo: '2026-03-15',
        perPage: 2,
        page: 2,
      });
      expect(page2.patients).toHaveLength(2);

      const page3 = await getHospitalPatientList(db, hcode, {
        status: 'active',
        dateFrom: '2026-03-01',
        dateTo: '2026-03-15',
        perPage: 2,
        page: 3,
      });
      expect(page3.patients).toHaveLength(1);
    });
  });
});
