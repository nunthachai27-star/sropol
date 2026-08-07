// Dashboard API route logic tests — tests the service layer that route.ts calls
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestDb } from '../../helpers/testDb';
import type { DatabaseAdapter } from '@/db/adapter';
import { SeedOrchestrator } from '@/db/seeds/index';
import { getProvinceDashboard } from '@/services/dashboard';
import { v4 as uuidv4 } from 'uuid';

describe('Dashboard API Logic', () => {
  let db: DatabaseAdapter;

  beforeEach(async () => {
    db = await createTestDb();
    await new SeedOrchestrator().run(db);
  });

  afterEach(async () => {
    await db.close();
  });

  it('returns dashboard with all 26 KK hospitals', async () => {
    const result = await getProvinceDashboard(db);
    expect(result.hospitals).toHaveLength(26);
    // Verify each hospital has required fields
    for (const h of result.hospitals) {
      expect(h.hcode).toBeTruthy();
      expect(h.name).toBeTruthy();
      expect(h.level).toBeTruthy();
      expect(h.connectionStatus).toBeTruthy();
      expect(h.counts).toBeDefined();
    }
  });

  it('returns correct risk counts when patients with CPD scores exist', async () => {
    const hospitals = await db.query<{ id: string }>(
      "SELECT id FROM hospitals WHERE hcode = '10670'",
    );
    const hospitalId = hospitals[0].id;
    const now = new Date().toISOString();

    // Insert 3 patients with different risk levels
    const patLow = uuidv4();
    const patMed = uuidv4();
    const patHigh = uuidv4();

    for (const [id, hn, an] of [
      [patLow, 'HN-L1', 'AN-L1'],
      [patMed, 'HN-M1', 'AN-M1'],
      [patHigh, 'HN-H1', 'AN-H1'],
    ] as const) {
      await db.execute(
        'INSERT INTO cached_patients (id, hospital_id, hn, an, name, age, admit_date, labor_status, synced_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [id, hospitalId, hn, an, 'enc-name', 30, now, 'ACTIVE', now, now, now],
      );
    }

    // Assign CPD scores
    await db.execute(
      'INSERT INTO cpd_scores (id, patient_id, score, risk_level, calculated_at, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      [uuidv4(), patLow, 2, 'LOW', now, now],
    );
    await db.execute(
      'INSERT INTO cpd_scores (id, patient_id, score, risk_level, calculated_at, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      [uuidv4(), patMed, 7, 'MEDIUM', now, now],
    );
    await db.execute(
      'INSERT INTO cpd_scores (id, patient_id, score, risk_level, calculated_at, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      [uuidv4(), patHigh, 12, 'HIGH', now, now],
    );

    const result = await getProvinceDashboard(db);
    const hospital = result.hospitals.find((h) => h.hcode === '10670');

    expect(hospital).toBeDefined();
    expect(hospital!.counts.low).toBe(1);
    expect(hospital!.counts.medium).toBe(1);
    expect(hospital!.counts.high).toBe(1);
    expect(hospital!.counts.total).toBe(3);
  });

  it('returns zero counts when no patients', async () => {
    const result = await getProvinceDashboard(db);
    for (const h of result.hospitals) {
      expect(h.counts.total).toBe(0);
      expect(h.counts.low).toBe(0);
      expect(h.counts.medium).toBe(0);
      expect(h.counts.high).toBe(0);
    }
  });

  it('includes summary totals matching individual hospital counts', async () => {
    // Add patients to two different hospitals
    const hospitals = await db.query<{ id: string; hcode: string }>(
      "SELECT id, hcode FROM hospitals WHERE hcode IN ('10670', '11000')",
    );
    const now = new Date().toISOString();

    for (const hosp of hospitals) {
      const patId = uuidv4();
      await db.execute(
        'INSERT INTO cached_patients (id, hospital_id, hn, an, name, age, admit_date, labor_status, synced_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [patId, hosp.id, `HN-${hosp.hcode}`, `AN-${hosp.hcode}`, 'enc-name', 28, now, 'ACTIVE', now, now, now],
      );
      await db.execute(
        'INSERT INTO cpd_scores (id, patient_id, score, risk_level, calculated_at, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        [uuidv4(), patId, 5, 'MEDIUM', now, now],
      );
    }

    const result = await getProvinceDashboard(db);

    // Summary should aggregate all hospitals
    expect(result.summary.totalMedium).toBe(2);
    expect(result.summary.totalActive).toBe(2);
    expect(result.summary.totalLow).toBe(0);
    expect(result.summary.totalHigh).toBe(0);

    // updatedAt should be present
    expect(result.updatedAt).toBeTruthy();
    expect(new Date(result.updatedAt).getTime()).not.toBeNaN();
  });
});
