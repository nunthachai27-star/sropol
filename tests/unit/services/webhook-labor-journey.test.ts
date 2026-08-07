// Regression tests for Task B1 — labor ingestion transitions journeys to
// LABOR. processWebhookPayload previously only backfilled journey_id by
// cid_hash ("Fix E") with no stage transition; it now delegates to
// linkJourneyToLabor (src/services/sync/anc.ts) per active admission.
import { describe, it, expect, beforeEach } from 'vitest';
import { createHash } from 'crypto';
import { createTestDb } from '../../helpers/testDb';
import { SeedOrchestrator } from '@/db/seeds/index';
import type { DatabaseAdapter } from '@/db/adapter';
import { processWebhookPayload } from '@/services/webhook';
import { createJourney, transitionToDelivered } from '@/services/journey';
import { AncRiskLevel, CareStage } from '@/types/domain';
import { SseManager } from '@/lib/sse';
import { generateKey } from '@/lib/encryption';

process.env.ENCRYPTION_KEY = generateKey();

let db: DatabaseAdapter;
const HCODE = '10670'; // รพ.ขอนแก่น — seeded by HospitalSeeder
const CID = '1100500090006'; // checksum-valid synthetic
const CID_HASH = createHash('sha256').update(CID).digest('hex');

async function hospitalId(): Promise<string> {
  const rows = await db.query<{ id: string }>('SELECT id FROM hospitals WHERE hcode = ?', [HCODE]);
  return rows[0].id;
}

// Minimal labor patient passing validatePayload — if processWebhookPayload
// requires more fields, mirror the smallest passing patient object used in
// tests/unit/services/webhook.test.ts.
function laborPayload(overrides: Record<string, unknown> = {}) {
  return {
    hospitalCode: HCODE,
    patients: [
      {
        an: 'AN-B1',
        hn: 'HN-B1',
        cid: CID,
        name: 'นางทดสอบ คลอด',
        age: 30,
        admit_date: '2026-07-13T08:00:00Z',
        labor_status: 'ACTIVE',
        ...overrides,
      },
    ],
  };
}

describe('labor ingestion -> journey LABOR transition', () => {
  beforeEach(async () => {
    db = await createTestDb();
    await new SeedOrchestrator().run(db);
    SseManager.resetForTests();
  });

  it('transitions an existing PREGNANCY journey to LABOR and links the patient', async () => {
    const journey = await createJourney(db, {
      hospitalId: await hospitalId(),
      hn: 'HN-B1',
      personAncId: null,
      name: '',
      cid: '',
      cidHash: CID_HASH,
      age: 30,
      gravida: 1,
      para: 0,
      lmp: null,
      edc: null,
      ancRiskLevel: AncRiskLevel.LOW,
    });

    await processWebhookPayload(
      db,
      await hospitalId(),
      laborPayload() as never,
      SseManager.getInstance(),
    );

    const j = await db.query<{ care_stage: string }>(
      'SELECT care_stage FROM maternal_journeys WHERE id = ?',
      [journey.id],
    );
    expect(j[0].care_stage).toBe(CareStage.LABOR);
    const p = await db.query<{ journey_id: string }>(
      'SELECT journey_id FROM cached_patients WHERE an = ?',
      ['AN-B1'],
    );
    expect(p[0].journey_id).toBe(journey.id);
  });

  it('creates a LABOR journey for a walk-in with no prior ANC', async () => {
    await processWebhookPayload(
      db,
      await hospitalId(),
      laborPayload() as never,
      SseManager.getInstance(),
    );
    const j = await db.query<{ care_stage: string }>(
      'SELECT care_stage FROM maternal_journeys WHERE cid_hash = ?',
      [CID_HASH],
    );
    expect(j.length).toBe(1);
    expect(j[0].care_stage).toBe(CareStage.LABOR);
  });

  it('never regresses a DELIVERED journey', async () => {
    const journey = await createJourney(db, {
      hospitalId: await hospitalId(),
      hn: 'HN-B1',
      personAncId: null,
      name: '',
      cid: '',
      cidHash: CID_HASH,
      age: 30,
      gravida: 1,
      para: 0,
      lmp: null,
      edc: null,
      ancRiskLevel: AncRiskLevel.LOW,
    });
    await transitionToDelivered(db, journey.id);

    await processWebhookPayload(
      db,
      await hospitalId(),
      laborPayload() as never,
      SseManager.getInstance(),
    );

    const j = await db.query<{ care_stage: string }>(
      'SELECT care_stage FROM maternal_journeys WHERE id = ?',
      [journey.id],
    );
    expect(j[0].care_stage).toBe(CareStage.DELIVERED);
  });

  it('re-delivery is idempotent: one journey, stage_changed_at not re-stamped', async () => {
    await processWebhookPayload(
      db,
      await hospitalId(),
      laborPayload() as never,
      SseManager.getInstance(),
    );
    const first = await db.query<{ id: string; stage_changed_at: unknown }>(
      'SELECT id, stage_changed_at FROM maternal_journeys WHERE cid_hash = ?',
      [CID_HASH],
    );

    await processWebhookPayload(
      db,
      await hospitalId(),
      laborPayload() as never,
      SseManager.getInstance(),
    );
    const second = await db.query<{ id: string; stage_changed_at: unknown }>(
      'SELECT id, stage_changed_at FROM maternal_journeys WHERE cid_hash = ?',
      [CID_HASH],
    );

    expect(second.length).toBe(1);
    expect(second[0].id).toBe(first[0].id);
    expect(String(second[0].stage_changed_at)).toBe(String(first[0].stage_changed_at));
  });

  it('skips non-ACTIVE labor rows (DELIVERED payloads change no journey)', async () => {
    await processWebhookPayload(
      db,
      await hospitalId(),
      laborPayload({ labor_status: 'DELIVERED' }) as never,
      SseManager.getInstance(),
    );
    const j = await db.query('SELECT id FROM maternal_journeys WHERE cid_hash = ?', [CID_HASH]);
    expect(j.length).toBe(0); // no walk-in journey minted for a delivered row
  });
});
