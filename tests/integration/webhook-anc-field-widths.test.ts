// Integration tests: ANC webhook field-width containment.
//
// Root cause (prod, hospitals 11004/11011/12275): HOSxP lab/urine results are
// FREE TEXT ("Non-reactive" = 12 chars) but the target columns were declared
// for short codes (VARCHAR(10)). One over-long value threw
// "value too long for type character varying(10)" and aborted the hospital's
// ENTIRE ANC bundle every sync cycle (browser-push demotes it to a warning
// step, so the loss was silent).
//
// Contract under test:
//   1. Real-world free-text results are stored VERBATIM (columns widened —
//      source evidence is never truncated or fabricated).
//   2. A value still exceeding its column (pathological garbage, or a
//      contract-violating enum field) is nulled for THAT FIELD ONLY, counted
//      in result.fieldOverflows, and never aborts the patient or the bundle.
import { describe, it, expect, beforeEach } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import { createTestDb } from '../helpers/testDb';
import type { DatabaseAdapter } from '@/db/adapter';
import { SeedOrchestrator } from '@/db/seeds/index';
import { generateKey } from '@/lib/encryption';
import type { SseManager } from '@/lib/sse';
import { processAncWebhook, type WebhookAncPayload } from '@/services/webhook';

process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY ?? generateKey();

class MockSseManager {
  broadcast(): void {}
}
const sse = new MockSseManager() as unknown as SseManager;

const CID_A = '1005000123458'; // valid Thai CID checksum (existing fixture value)
const CID_B = '1005000777776'; // valid Thai CID checksum (existing fixture value)

function ancPayload(patients: WebhookAncPayload['patients']): WebhookAncPayload {
  return { type: 'anc_data', hospitalCode: '99902', patients };
}

describe('ANC webhook field widths (value-too-long containment)', () => {
  let db: DatabaseAdapter;
  let hospitalId: string;

  beforeEach(async () => {
    db = await createTestDb();
    await new SeedOrchestrator().run(db);
    const now = new Date().toISOString();
    hospitalId = uuidv4();
    await db.execute(
      `INSERT INTO hospitals (id, hcode, name, level, is_active, connection_status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [hospitalId, '99902', 'รพ.ANC ทดสอบ (ความกว้างฟิลด์)', 'M2', true, 'UNKNOWN', now, now],
    );
  });

  it('stores real-world free-text lab and urine results verbatim (Non-reactive class)', async () => {
    const result = await processAncWebhook(
      db,
      hospitalId,
      ancPayload([
        {
          hn: 'W-001',
          name: 'ทดสอบ ความกว้าง',
          cid: CID_A,
          birthday: '1995-02-10',
          pregNo: 1,
          lmp: '2026-01-05',
          bloodGroup: 'AB+', // 3 chars — overflowed the old VARCHAR(2)
          rhFactor: 'positive', // 8 chars — overflowed the old VARCHAR(3)
          hbsagResult: 'Non-reactive', // 12 chars — the prod failure class
          vdrlResult: 'Non-reactive',
          hivResult: 'Non-reactive',
          ogttResult: 'ผิดปกติเล็กน้อย', // 15 Thai chars
          visits: [
            {
              date: '2026-03-02',
              visitNumber: 1,
              gaWeeks: 8,
              urineProtein: 'trace albumin', // 13 chars
              urineGlucose: 'พบน้ำตาลเล็กน้อย', // 16 Thai chars
              urineKetone: 'negative +/-', // 12 chars
              urineCultureResult: 'no growth in 48 hours', // 21 chars
            },
          ],
        },
      ]),
      sse,
    );

    expect(result.patientsProcessed).toBe(1);
    expect(result.fieldOverflows).toBe(0);

    const journeys = await db.query<Record<string, unknown>>(
      `SELECT blood_group, rh_factor, hbsag_result, vdrl_result, hiv_result, ogtt_result
         FROM maternal_journeys WHERE hn = ?`,
      ['W-001'],
    );
    expect(journeys).toHaveLength(1);
    expect(journeys[0].blood_group).toBe('AB+');
    expect(journeys[0].rh_factor).toBe('positive');
    expect(journeys[0].hbsag_result).toBe('Non-reactive');
    expect(journeys[0].vdrl_result).toBe('Non-reactive');
    expect(journeys[0].hiv_result).toBe('Non-reactive');
    expect(journeys[0].ogtt_result).toBe('ผิดปกติเล็กน้อย');

    const visits = await db.query<Record<string, unknown>>(
      `SELECT urine_protein, urine_glucose, urine_ketone, urine_culture_result
         FROM cached_anc_visits WHERE hospital_id = ?`,
      [hospitalId],
    );
    expect(visits).toHaveLength(1);
    expect(visits[0].urine_protein).toBe('trace albumin');
    expect(visits[0].urine_glucose).toBe('พบน้ำตาลเล็กน้อย');
    expect(visits[0].urine_ketone).toBe('negative +/-');
    expect(visits[0].urine_culture_result).toBe('no growth in 48 hours');
  });

  it('nulls a pathologically long field, counts it, and never aborts the bundle', async () => {
    const garbage = 'x'.repeat(60); // exceeds even the widened VARCHAR(50)
    const result = await processAncWebhook(
      db,
      hospitalId,
      ancPayload([
        {
          hn: 'W-002',
          name: 'ทดสอบ ล้นฟิลด์',
          cid: CID_A,
          birthday: '1994-06-01',
          pregNo: 1,
          visits: [
            {
              date: '2026-03-03',
              visitNumber: 1,
              gaWeeks: 10,
              bpSystolic: 118,
              bpDiastolic: 76,
              urineProtein: garbage,
            },
          ],
        },
        {
          hn: 'W-003',
          name: 'ทดสอบ คนถัดไป',
          cid: CID_B,
          birthday: '1993-01-20',
          pregNo: 2,
          visits: [{ date: '2026-03-03', visitNumber: 4, gaWeeks: 22 }],
        },
      ]),
      sse,
    );

    // Both patients processed — the over-long field never aborts the bundle.
    expect(result.patientsProcessed).toBe(2);
    expect(result.fieldOverflows).toBe(1);

    const v1 = await db.query<Record<string, unknown>>(
      `SELECT urine_protein, bp_systolic FROM cached_anc_visits cav
        JOIN maternal_journeys mj ON mj.id = cav.journey_id WHERE mj.hn = ?`,
      ['W-002'],
    );
    expect(v1).toHaveLength(1);
    expect(v1[0].urine_protein).toBeNull(); // nulled, not truncated, not fatal
    expect(Number(v1[0].bp_systolic)).toBe(118); // rest of the visit intact

    const j2 = await db.query<Record<string, unknown>>(
      `SELECT anc_visit_count FROM maternal_journeys WHERE hn = ?`,
      ['W-003'],
    );
    expect(j2).toHaveLength(1); // second patient fully persisted
  });

  it('nulls a contract-violating enum field longer than its column instead of failing', async () => {
    const result = await processAncWebhook(
      db,
      hospitalId,
      ancPayload([
        {
          hn: 'W-004',
          name: 'ทดสอบ enum ยาว',
          cid: CID_A,
          birthday: '1992-09-09',
          pregNo: 1,
          visits: [
            {
              date: '2026-03-04',
              visitNumber: 2,
              gaWeeks: 30,
              // TS says 'REACTIVE' | 'NON_REACTIVE' | 'PENDING' but external
              // senders are not bound by our types at runtime (VARCHAR(20)).
              nstResult: 'non-reactive, repeated twice' as unknown as 'PENDING',
            },
          ],
        },
      ]),
      sse,
    );

    expect(result.patientsProcessed).toBe(1);
    expect(result.fieldOverflows).toBe(1);
    const visits = await db.query<Record<string, unknown>>(
      `SELECT nst_result FROM cached_anc_visits WHERE hospital_id = ?`,
      [hospitalId],
    );
    expect(visits).toHaveLength(1);
    expect(visits[0].nst_result).toBeNull();
  });
});
