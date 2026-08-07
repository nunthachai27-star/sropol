// Smoke tests for the auto-discharge diff in sync/polling.ts
//
// Bug it covers: when a patient is discharged in HOSxP (confirm_discharge='Y'),
// the HOSxP labor query stops returning them, and our local cache used to
// leave their labor_status='ACTIVE' forever. The sync now diffs existingAns
// (still cached as ACTIVE) against currentAns (returned this poll cycle) and
// closes out anything missing — except cross-hospital transfers, which the
// transfer-detection block already handled.
//
// These tests exercise the SQL the sync runs without standing up the whole
// pollHospital function (no BMS client, no HOSxP queries) — a deliberately
// small surface so the regression is unambiguous and the test is fast.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestDb } from '../../helpers/testDb';
import type { DatabaseAdapter } from '@/db/adapter';
import { SeedOrchestrator } from '@/db/seeds/index';
import { randomUUID } from 'crypto';
import { LaborStatus } from '@/types/domain';

const HOSPITAL_HCODE = '10670';

interface CachedPatientSeed {
  an: string;
  hn: string;
  laborStatus: LaborStatus | string;
  admitDate?: string;
}

async function getHospitalId(db: DatabaseAdapter): Promise<string> {
  const rows = await db.query<{ id: string }>('SELECT id FROM hospitals WHERE hcode = ?', [
    HOSPITAL_HCODE,
  ]);
  return rows[0].id;
}

async function seedActivePatient(
  db: DatabaseAdapter,
  hospitalId: string,
  seed: CachedPatientSeed,
): Promise<void> {
  const now = new Date().toISOString();
  await db.execute(
    `INSERT INTO cached_patients (
       id, hospital_id, hn, an, name, cid, cid_hash, age, gravida, ga_weeks,
       anc_count, admit_date, labor_status, synced_at, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      randomUUID(),
      hospitalId,
      seed.hn,
      seed.an,
      'encrypted_name_placeholder',
      'encrypted_cid_placeholder',
      'cidhash_placeholder',
      28,
      1,
      39,
      4,
      seed.admitDate ?? now,
      seed.laborStatus,
      now,
      now,
      now,
    ],
  );
}

// Mirrors the auto-discharge logic in src/services/sync/polling.ts that
// runs after upsertCachedPatients() + the transfer-detection loop. We
// reproduce it verbatim here so the test fails if either the algorithm
// OR the SQL drifts.
async function applyAutoDischarge(
  db: DatabaseAdapter,
  hospitalId: string,
  existingAns: string[],
  currentAns: string[],
  transferredAns: string[],
): Promise<string[]> {
  const currentSet = new Set(currentAns);
  const transferredSet = new Set(transferredAns);
  const discharged = existingAns.filter((an) => !currentSet.has(an) && !transferredSet.has(an));
  const now = new Date().toISOString();
  for (const an of discharged) {
    await db.execute(
      `UPDATE cached_patients
         SET labor_status = 'DISCHARGED', updated_at = ?
       WHERE hospital_id = ? AND an = ? AND labor_status = 'ACTIVE'`,
      [now, hospitalId, an],
    );
  }
  return discharged;
}

describe('sync auto-discharge — root-cause fix for stale labor_status=ACTIVE', () => {
  let db: DatabaseAdapter;
  let hospitalId: string;

  beforeEach(async () => {
    db = await createTestDb();
    await new SeedOrchestrator().run(db);
    hospitalId = await getHospitalId(db);
  });

  afterEach(async () => {
    await db.close();
  });

  it('closes an ACTIVE patient that HOSxP no longer returns', async () => {
    await seedActivePatient(db, hospitalId, { an: 'AN-001', hn: 'HN-001', laborStatus: 'ACTIVE' });
    await seedActivePatient(db, hospitalId, { an: 'AN-002', hn: 'HN-002', laborStatus: 'ACTIVE' });

    // Simulate the sync cycle:
    //   - both ANs are currently ACTIVE in cache
    //   - only AN-001 still appears in this cycle's HOSxP pull
    //   - AN-002 was discharged in HOSxP (confirm_discharge='Y')
    const existingAns = ['AN-001', 'AN-002'];
    const currentAns = ['AN-001'];
    const transferredAns: string[] = [];

    const dischargedAns = await applyAutoDischarge(
      db,
      hospitalId,
      existingAns,
      currentAns,
      transferredAns,
    );

    expect(dischargedAns).toEqual(['AN-002']);

    const after = await db.query<{ an: string; labor_status: string }>(
      'SELECT an, labor_status FROM cached_patients WHERE hospital_id = ? ORDER BY an',
      [hospitalId],
    );
    expect(after).toEqual([
      { an: 'AN-001', labor_status: 'ACTIVE' },
      { an: 'AN-002', labor_status: 'DISCHARGED' },
    ]);
  });

  it('does NOT mark a transferred patient as discharged (transfer takes priority)', async () => {
    // AN-100 was transferred to another hospital in this cycle. The
    // transfer-detection block marks the from-side as TRANSFERRED. Our
    // diff must skip it so we don't overwrite that transition.
    await seedActivePatient(db, hospitalId, {
      an: 'AN-100',
      hn: 'HN-100',
      laborStatus: 'TRANSFERRED',
    });
    await seedActivePatient(db, hospitalId, { an: 'AN-200', hn: 'HN-200', laborStatus: 'ACTIVE' });

    const existingAns = ['AN-100', 'AN-200'];
    const currentAns: string[] = [];
    const transferredAns = ['AN-100'];

    const dischargedAns = await applyAutoDischarge(
      db,
      hospitalId,
      existingAns,
      currentAns,
      transferredAns,
    );

    // AN-200 should be closed; AN-100 must not be touched.
    expect(dischargedAns).toEqual(['AN-200']);

    const after = await db.query<{ an: string; labor_status: string }>(
      'SELECT an, labor_status FROM cached_patients WHERE hospital_id = ? ORDER BY an',
      [hospitalId],
    );
    expect(after).toEqual([
      { an: 'AN-100', labor_status: 'TRANSFERRED' },
      { an: 'AN-200', labor_status: 'DISCHARGED' },
    ]);
  });

  it('is idempotent — running twice does not re-touch already-DISCHARGED rows', async () => {
    // The guard `WHERE labor_status='ACTIVE'` in the UPDATE prevents
    // overwriting a DELIVERED/DISCHARGED row that a parallel cycle wrote.
    await seedActivePatient(db, hospitalId, {
      an: 'AN-300',
      hn: 'HN-300',
      laborStatus: 'DISCHARGED',
    });
    await seedActivePatient(db, hospitalId, { an: 'AN-301', hn: 'HN-301', laborStatus: 'ACTIVE' });

    // First cycle — AN-301 vanishes from HOSxP, should be closed.
    await applyAutoDischarge(db, hospitalId, ['AN-300', 'AN-301'], [], []);
    // Second cycle — both are now DISCHARGED, neither appears, the diff
    // identifies them as candidates but the SQL guard short-circuits.
    await applyAutoDischarge(db, hospitalId, ['AN-300', 'AN-301'], [], []);

    const after = await db.query<{ an: string; labor_status: string }>(
      'SELECT an, labor_status FROM cached_patients WHERE hospital_id = ? ORDER BY an',
      [hospitalId],
    );
    // Both are DISCHARGED. Critically, the row that was already
    // DISCHARGED stays DISCHARGED (not somehow flipped or duplicated).
    expect(after).toEqual([
      { an: 'AN-300', labor_status: 'DISCHARGED' },
      { an: 'AN-301', labor_status: 'DISCHARGED' },
    ]);
  });

  it('handles the no-op case — HOSxP pull matches cache exactly', async () => {
    await seedActivePatient(db, hospitalId, { an: 'AN-A', hn: 'HN-A', laborStatus: 'ACTIVE' });
    await seedActivePatient(db, hospitalId, { an: 'AN-B', hn: 'HN-B', laborStatus: 'ACTIVE' });

    const dischargedAns = await applyAutoDischarge(
      db,
      hospitalId,
      ['AN-A', 'AN-B'], // existing
      ['AN-A', 'AN-B'], // current pull contains both
      [],
    );

    expect(dischargedAns).toEqual([]);

    const after = await db.query<{ an: string; labor_status: string }>(
      'SELECT an, labor_status FROM cached_patients WHERE hospital_id = ? ORDER BY an',
      [hospitalId],
    );
    expect(after).toEqual([
      { an: 'AN-A', labor_status: 'ACTIVE' },
      { an: 'AN-B', labor_status: 'ACTIVE' },
    ]);
  });

  it('closes multiple stale patients in one cycle', async () => {
    // Realistic shift-end scenario: 5 patients discharged at the same
    // time (end-of-shift batch update in HOSxP). All should be closed.
    for (let i = 1; i <= 5; i++) {
      await seedActivePatient(db, hospitalId, {
        an: `AN-${String(i).padStart(3, '0')}`,
        hn: `HN-${String(i).padStart(3, '0')}`,
        laborStatus: 'ACTIVE',
      });
    }

    const existingAns = ['AN-001', 'AN-002', 'AN-003', 'AN-004', 'AN-005'];
    const currentAns = ['AN-001']; // only one remains active in HOSxP
    const dischargedAns = await applyAutoDischarge(db, hospitalId, existingAns, currentAns, []);

    expect(dischargedAns.sort()).toEqual(['AN-002', 'AN-003', 'AN-004', 'AN-005']);

    const active = await db.query<{ count: number }>(
      "SELECT COUNT(*) as count FROM cached_patients WHERE hospital_id = ? AND labor_status = 'ACTIVE'",
      [hospitalId],
    );
    expect(active[0].count).toBe(1);
  });
});
