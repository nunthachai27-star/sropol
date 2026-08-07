// Deletion + rollover atomicity — Release B task B3.
//
// Labor-patient deletion used to run 3 sequential DELETEs and MISS
// cached_partograph_observations; that table's FK to cached_patients has no
// ON DELETE action, so the patient DELETE threw an FK violation whenever
// observations existed, after cpd/vitals were already deleted (partial
// state). Pregnancy rollover (transitionToDelivered + createJourney) was two
// non-transactional statements, so a crash between them could strand a
// mother with zero active journeys. Both are now wrapped in db.transaction()
// so they commit or roll back as a unit.
import { describe, it, expect, beforeEach } from 'vitest';
import { createHash } from 'crypto';
import { createTestDb } from '../../helpers/testDb';
import { FailingAdapter } from '../../helpers/failingDb';
import { SeedOrchestrator } from '@/db/seeds/index';
import type { DatabaseAdapter } from '@/db/adapter';
import { processWebhookPayload } from '@/services/webhook';
import { SseManager } from '@/lib/sse';
import { generateKey } from '@/lib/encryption';

process.env.ENCRYPTION_KEY = generateKey();

let db: DatabaseAdapter;
const HCODE = '99902';
const CID = '1100500090006';

// HCODE '99902' is a webhook-test hospital, not part of the seeded KK
// hospital list (src/config/hospitals.ts) — insert it directly, same
// pattern as tests/integration/webhook-anc-referral.test.ts and
// tests/unit/services/webhook-anc-risk.test.ts.
async function seedWebhookHospital(): Promise<void> {
  const now = new Date().toISOString();
  await db.execute(
    `INSERT INTO hospitals (id, hcode, name, level, is_active, connection_status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [crypto.randomUUID(), HCODE, 'รพ.ทดสอบ B3', 'M2', true, 'UNKNOWN', now, now],
  );
}

async function hospitalId(): Promise<string> {
  const rows = await db.query<{ id: string }>('SELECT id FROM hospitals WHERE hcode = ?', [HCODE]);
  return rows[0].id;
}

async function seedLaborPatientWithClinicalData(): Promise<string> {
  const hid = await hospitalId();
  await processWebhookPayload(
    db,
    hid,
    {
      hospitalCode: HCODE,
      patients: [
        {
          an: 'AN-B3',
          hn: 'HN-B3',
          cid: CID,
          name: 'นางทดสอบ ลบ',
          age: 28,
          admit_date: '2026-07-13T08:00:00Z',
          labor_status: 'ACTIVE',
        },
      ],
    } as never,
    SseManager.getInstance(),
  );
  const p = await db.query<{ id: string }>(
    'SELECT id FROM cached_patients WHERE hospital_id = ? AND an = ?',
    [hid, 'AN-B3'],
  );
  const patientId = p[0].id;
  const now = new Date().toISOString();
  // one partograph observation — the table the old delete path missed
  await db.execute(
    `INSERT INTO cached_partograph_observations
       (id, patient_id, hospital_id, source_system, source_pk, observe_datetime,
        synced_at, created_at, updated_at)
     VALUES (?, ?, ?, 'webhook', 'obs-b3-1', ?, ?, ?, ?)`,
    [crypto.randomUUID(), patientId, hid, now, now, now, now],
  );
  // cached_vital_signs has no hospital_id column and requires measured_at +
  // synced_at (both NOT NULL) — see src/db/tables/cached-vital-signs.ts.
  await db.execute(
    `INSERT INTO cached_vital_signs (id, patient_id, measured_at, synced_at, created_at)
     VALUES (?, ?, ?, ?, ?)`,
    [crypto.randomUUID(), patientId, now, now, now],
  );
  return patientId;
}

const deletePayload = {
  hospitalCode: HCODE,
  patients: [{ an: 'AN-B3', hn: 'HN-B3', cid: CID, name: 'นางทดสอบ ลบ', action: 'delete' }],
};

describe('labor patient deletion atomicity', () => {
  beforeEach(async () => {
    db = await createTestDb();
    await new SeedOrchestrator().run(db);
    await seedWebhookHospital();
    SseManager.resetForTests();
  });

  it('deletes the patient AND all dependent clinical rows (incl. partograph)', async () => {
    const patientId = await seedLaborPatientWithClinicalData();
    await processWebhookPayload(
      db,
      await hospitalId(),
      deletePayload as never,
      SseManager.getInstance(),
    );

    for (const table of [
      'cached_patients',
      'cached_vital_signs',
      'cached_partograph_observations',
    ]) {
      const col = table === 'cached_patients' ? 'id' : 'patient_id';
      const rows = await db.query(`SELECT ${col} FROM ${table} WHERE ${col} = ?`, [patientId]);
      expect(rows, table).toEqual([]);
    }
  });

  it('an injected failure leaves ALL clinical rows intact (rollback)', async () => {
    const patientId = await seedLaborPatientWithClinicalData();
    const failing = new FailingAdapter(db, /DELETE FROM cached_patients/);

    await expect(
      processWebhookPayload(
        failing,
        await hospitalId(),
        deletePayload as never,
        SseManager.getInstance(),
      ),
    ).rejects.toThrow(/injected failure/);

    const vitals = await db.query('SELECT id FROM cached_vital_signs WHERE patient_id = ?', [
      patientId,
    ]);
    expect(vitals.length).toBe(1);
    const obs = await db.query(
      'SELECT id FROM cached_partograph_observations WHERE patient_id = ?',
      [patientId],
    );
    expect(obs.length).toBe(1);
  });
});

describe('pregnancy rollover atomicity', () => {
  beforeEach(async () => {
    db = await createTestDb();
    await new SeedOrchestrator().run(db);
    await seedWebhookHospital();
    SseManager.resetForTests();
  });

  it('a failed new-journey INSERT leaves the old journey un-closed', async () => {
    const { processAncWebhook } = await import('@/services/webhook');
    const hid = await hospitalId();
    const ancPatient = (pregNo: number) => ({
      hospitalCode: HCODE,
      patients: [{ name: 'นางทดสอบ โรลโอเวอร์', cid: CID, hn: 'HN-B3R', pregNo }],
    });
    await processAncWebhook(db, hid, ancPatient(1) as never, SseManager.getInstance());

    const failing = new FailingAdapter(db, /INSERT INTO maternal_journeys/);
    await expect(
      processAncWebhook(failing, hid, ancPatient(2) as never, SseManager.getInstance()),
    ).rejects.toThrow(/injected failure/);

    const stages = await db.query<{ care_stage: string }>(
      `SELECT care_stage FROM maternal_journeys WHERE cid_hash = ?`,
      [createHash('sha256').update(CID).digest('hex')],
    );
    expect(stages.length).toBe(1);
    expect(stages[0].care_stage).toBe('PREGNANCY'); // NOT stranded as DELIVERED
  });
});
