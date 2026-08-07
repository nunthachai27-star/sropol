// Hospital patients API route logic tests — tests getHospitalPatientList service
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestDb } from '../../helpers/testDb';
import type { DatabaseAdapter } from '@/db/adapter';
import { SeedOrchestrator } from '@/db/seeds/index';
import { getHospitalPatientList } from '@/services/dashboard';
import { v4 as uuidv4 } from 'uuid';

describe('Hospital Patients API Logic', () => {
  let db: DatabaseAdapter;
  let hospitalId: string;
  const hcode = '10670';

  beforeEach(async () => {
    db = await createTestDb();
    await new SeedOrchestrator().run(db);

    // Get hospital ID
    const hospitals = await db.query<{ id: string }>(
      'SELECT id FROM hospitals WHERE hcode = ?',
      [hcode],
    );
    hospitalId = hospitals[0].id;
  });

  afterEach(async () => {
    await db.close();
  });

  // Helper to insert a patient
  async function insertPatient(overrides: {
    hn?: string;
    an?: string;
    laborStatus?: string;
    admitDate?: string;
  } = {}) {
    const id = uuidv4();
    const now = new Date().toISOString();
    await db.execute(
      'INSERT INTO cached_patients (id, hospital_id, hn, an, name, age, admit_date, labor_status, synced_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [
        id,
        hospitalId,
        overrides.hn ?? `HN-${id.slice(0, 6)}`,
        overrides.an ?? `AN-${id.slice(0, 6)}`,
        'enc-name',
        28,
        overrides.admitDate ?? now,
        overrides.laborStatus ?? 'ACTIVE',
        now,
        now,
        now,
      ],
    );
    return id;
  }

  it('returns patient list for valid hcode', async () => {
    await insertPatient({ hn: 'HN001', an: 'AN001' });
    await insertPatient({ hn: 'HN002', an: 'AN002' });

    const result = await getHospitalPatientList(db, hcode);
    expect(result.patients).toHaveLength(2);
    expect(result.pagination.total).toBe(2);
    expect(result.pagination.page).toBe(1);
    expect(result.pagination.perPage).toBe(20);
  });

  it('returns empty list for unknown hcode', async () => {
    const result = await getHospitalPatientList(db, '99999');
    expect(result.patients).toHaveLength(0);
    expect(result.pagination.total).toBe(0);
    expect(result.pagination.totalPages).toBe(0);
  });

  it('filters by status active', async () => {
    await insertPatient({ hn: 'HN-A1', an: 'AN-A1', laborStatus: 'ACTIVE' });
    await insertPatient({ hn: 'HN-A2', an: 'AN-A2', laborStatus: 'ACTIVE' });
    await insertPatient({ hn: 'HN-D1', an: 'AN-D1', laborStatus: 'DELIVERED' });

    const result = await getHospitalPatientList(db, hcode, { status: 'active' });
    expect(result.patients).toHaveLength(2);
    expect(result.pagination.total).toBe(2);
  });

  it('filters by status delivered', async () => {
    await insertPatient({ hn: 'HN-A1', an: 'AN-A1', laborStatus: 'ACTIVE' });
    await insertPatient({ hn: 'HN-D1', an: 'AN-D1', laborStatus: 'DELIVERED' });
    await insertPatient({ hn: 'HN-D2', an: 'AN-D2', laborStatus: 'DELIVERED' });

    const result = await getHospitalPatientList(db, hcode, { status: 'delivered' });
    expect(result.patients).toHaveLength(2);
    expect(result.pagination.total).toBe(2);
  });

  it('filters by date range dateFrom', async () => {
    await insertPatient({ hn: 'HN-E1', an: 'AN-E1', admitDate: '2026-03-01T08:00:00Z' });
    await insertPatient({ hn: 'HN-E2', an: 'AN-E2', admitDate: '2026-03-05T10:00:00Z' });
    await insertPatient({ hn: 'HN-E3', an: 'AN-E3', admitDate: '2026-03-10T14:00:00Z' });

    const result = await getHospitalPatientList(db, hcode, {
      status: 'active',
      dateFrom: '2026-03-05',
    });
    // Should include patients from Mar 5 and Mar 10
    expect(result.patients).toHaveLength(2);
  });

  it('filters by date range dateTo', async () => {
    await insertPatient({ hn: 'HN-F1', an: 'AN-F1', admitDate: '2026-03-01T08:00:00Z' });
    await insertPatient({ hn: 'HN-F2', an: 'AN-F2', admitDate: '2026-03-05T10:00:00Z' });
    await insertPatient({ hn: 'HN-F3', an: 'AN-F3', admitDate: '2026-03-10T14:00:00Z' });

    const result = await getHospitalPatientList(db, hcode, {
      status: 'active',
      dateTo: '2026-03-05',
    });
    // Should include patients from Mar 1 and Mar 5
    expect(result.patients).toHaveLength(2);
  });

  it('paginates results correctly', async () => {
    // Insert 5 patients
    for (let i = 1; i <= 5; i++) {
      await insertPatient({
        hn: `HN-P${i}`,
        an: `AN-P${i}`,
        admitDate: `2026-03-${String(i).padStart(2, '0')}T08:00:00Z`,
      });
    }

    // Page 1 with 2 per page
    const page1 = await getHospitalPatientList(db, hcode, {
      status: 'active',
      perPage: 2,
      page: 1,
    });
    expect(page1.patients).toHaveLength(2);
    expect(page1.pagination.total).toBe(5);
    expect(page1.pagination.totalPages).toBe(3);
    expect(page1.pagination.page).toBe(1);

    // Page 2
    const page2 = await getHospitalPatientList(db, hcode, {
      status: 'active',
      perPage: 2,
      page: 2,
    });
    expect(page2.patients).toHaveLength(2);

    // Page 3 (last page, only 1 patient)
    const page3 = await getHospitalPatientList(db, hcode, {
      status: 'active',
      perPage: 2,
      page: 3,
    });
    expect(page3.patients).toHaveLength(1);

    // Page 4 (beyond last page, empty)
    const page4 = await getHospitalPatientList(db, hcode, {
      status: 'active',
      perPage: 2,
      page: 4,
    });
    expect(page4.patients).toHaveLength(0);
  });
});
