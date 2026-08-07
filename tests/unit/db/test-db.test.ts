// Contract tests for the shared PGlite test harness (tests/helpers/testDb.ts)
// that replaces the per-test `new SqliteAdapter(':memory:')` pattern.
//
// Why pglite: production runs real Postgres, and SQLite-based tests kept
// letting dialect bugs through — pg returns TIMESTAMPTZ as Date and NUMERIC
// as string-unless-parsed, while SQLite returns plain strings/numbers. The
// /api/hospitals partograph-audit 500 (`admitDate.localeCompare is not a
// function`) was exactly this class of bug. The harness must behave like
// PostgresAdapter, including its custom pg type parsers (numeric → number).
//
// Performance contract: PGlite WASM boot + schema sync costs seconds, so the
// harness keeps ONE instance per test file and resets state by truncating
// every table EXCEPT the static thai-geo lookups (~10k rows, never mutated
// by tests) so SeedOrchestrator's shouldRun() guards keep reseeds cheap.
import { describe, it, expect } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import { createTestDb } from '../../helpers/testDb';
import { SeedOrchestrator } from '@/db/seeds/index';
import type { DatabaseAdapter } from '@/db/adapter';

async function seedAndGetHospitalId(db: DatabaseAdapter): Promise<string> {
  await new SeedOrchestrator().run(db);
  const rows = await db.query<{ id: string }>("SELECT id FROM hospitals WHERE hcode = '10670'");
  return rows[0].id;
}

async function insertPatient(db: DatabaseAdapter, hospitalId: string): Promise<string> {
  const id = uuidv4();
  const now = new Date().toISOString();
  await db.execute(
    'INSERT INTO cached_patients (id, hospital_id, hn, an, name, age, admit_date, labor_status, synced_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [id, hospitalId, 'HN001', 'AN001', 'enc-name', 28, now, 'ACTIVE', now, now, now],
  );
  return id;
}

describe('createTestDb (shared pglite test harness)', () => {
  it('provides the production schema over the postgresql dialect', async () => {
    const db = await createTestDb();
    const tables = await db.getTableNames();
    expect(tables).toEqual(
      expect.arrayContaining(['hospitals', 'cached_patients', 'cpd_scores', 'provinces']),
    );
  });

  it('returns DECIMAL columns as numbers, matching PostgresAdapter type parsers', async () => {
    const db = await createTestDb();
    const hospitalId = await seedAndGetHospitalId(db);
    const patientId = await insertPatient(db, hospitalId);
    const now = new Date().toISOString();
    await db.execute(
      'INSERT INTO cpd_scores (id, patient_id, score, risk_level, calculated_at, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      [uuidv4(), patientId, 3.5, 'LOW', now, now],
    );
    const rows = await db.query<{ score: unknown }>('SELECT score FROM cpd_scores');
    // pglite's default NUMERIC parser returns the string "3.50"; production
    // PostgresAdapter registers pgTypes.setTypeParser(1700, parseFloat).
    expect(rows[0].score).toBe(3.5);
  });

  it('returns TIMESTAMPTZ columns as Date objects, like production pg', async () => {
    const db = await createTestDb();
    const hospitalId = await seedAndGetHospitalId(db);
    await insertPatient(db, hospitalId);
    const rows = await db.query<{ admit_date: unknown }>('SELECT admit_date FROM cached_patients');
    expect(rows[0].admit_date).toBeInstanceOf(Date);
  });

  it('wipes dynamic tables between createTestDb() calls', async () => {
    const first = await createTestDb();
    const hospitalId = await seedAndGetHospitalId(first);
    await insertPatient(first, hospitalId);

    const second = await createTestDb();
    const patients = await second.query<{ n: number }>('SELECT COUNT(*) AS n FROM cached_patients');
    expect(patients[0].n).toBe(0);
    // Seeded hospitals are dynamic state too — each test reseeds explicitly.
    const hospitals = await second.query<{ n: number }>('SELECT COUNT(*) AS n FROM hospitals');
    expect(hospitals[0].n).toBe(0);
  });

  it('preserves static thai-geo lookup tables across resets', async () => {
    const first = await createTestDb();
    await new SeedOrchestrator().run(first);
    const before = await first.query<{ n: number }>('SELECT COUNT(*) AS n FROM provinces');
    expect(before[0].n).toBeGreaterThan(0);

    const second = await createTestDb();
    const after = await second.query<{ n: number }>('SELECT COUNT(*) AS n FROM provinces');
    expect(after[0].n).toBe(before[0].n);
  });

  it('treats close() as a no-op so legacy afterEach(db.close) blocks stay harmless', async () => {
    const db = await createTestDb();
    await db.close();
    const rows = await db.query<{ ok: number }>('SELECT 1 AS ok');
    expect(rows[0].ok).toBe(1);
  });
});
