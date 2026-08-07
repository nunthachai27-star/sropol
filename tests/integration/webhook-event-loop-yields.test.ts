// Integration seam test: cooperative event-loop yields are WIRED into the
// webhook hot paths (2026-07-17 page-latency incident).
//
// Root cause: browser-push sync processing (ANC bundles of hundreds of
// pregnancies × classification × per-field AES + the labor patient loops)
// ran multi-second synchronous-CPU stretches on the single serving event
// loop, stalling every page request 3-7s during push bursts. The fix ticks a
// CooperativeYielder at the top of each per-patient iteration so the loop
// hands control back every ~25ms.
//
// Contract under test — the ticks are real, not dead code:
//   1. processAncWebhook ticks once per pregnancy in the bundle.
//   2. processWebhookPayload ticks in its per-patient (labor) loop.
//   3. On a realistically sized ANC bundle (~60 pregnancies through the real
//      PGlite-backed path) at least one ACTUAL yield occurs (>= 1, never an
//      exact count — yield counts are machine-speed-dependent by design).
//   4. (Part 2) processPartographWebhook ticks per observation, and a
//      budget-elapsed tick genuinely yields through that path.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import { createTestDb } from '../helpers/testDb';
import { validCidFromSeed } from '../helpers/thai-cid';
import type { DatabaseAdapter } from '@/db/adapter';
import { SeedOrchestrator } from '@/db/seeds/index';
import { generateKey } from '@/lib/encryption';
import type { SseManager } from '@/lib/sse';
import { CooperativeYielder } from '@/lib/event-loop';
import {
  processAncWebhook,
  processWebhookPayload,
  processPartographWebhook,
  type WebhookAncPayload,
  type WebhookPayload,
  type WebhookPartographPayload,
} from '@/services/webhook';

process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY ?? generateKey();

class MockSseManager {
  broadcast(): void {}
}
const sse = new MockSseManager() as unknown as SseManager;

const ANC_BUNDLE_SIZE = 60;
const LABOR_BATCH_SIZE = 30;

function buildAncBundle(): WebhookAncPayload {
  return {
    type: 'anc_data',
    hospitalCode: '99903',
    patients: Array.from({ length: ANC_BUNDLE_SIZE }, (_, i) => ({
      hn: `YLD-${String(i + 1).padStart(3, '0')}`,
      name: `ทดสอบ ยีลด์ ${i + 1}`,
      cid: validCidFromSeed(700_000_000 + i), // distinct, checksum-valid
      birthday: '1995-02-10',
      pregNo: 1,
      lmp: '2026-01-05',
      riskItemIds: i % 3 === 0 ? [1, 2] : [],
      visits: [
        { date: '2026-02-02', visitNumber: 1, gaWeeks: 4 },
        { date: '2026-03-02', visitNumber: 2, gaWeeks: 8 },
      ],
    })),
  };
}

function buildLaborPayload(): WebhookPayload {
  return {
    hospitalCode: '99903',
    patients: Array.from({ length: LABOR_BATCH_SIZE }, (_, i) => ({
      hn: `YLD-L-${String(i + 1).padStart(3, '0')}`,
      an: `680${String(i + 1).padStart(5, '0')}`,
      name: `ทดสอบ คลอด ${i + 1}`,
      cid: validCidFromSeed(710_000_000 + i),
      age: 28,
      admit_date: new Date().toISOString(),
    })),
  };
}

describe('Webhook processing — cooperative event-loop yields (page-stall fix)', () => {
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
      [hospitalId, '99903', 'รพ.ทดสอบ event-loop yields', 'M2', true, 'UNKNOWN', now, now],
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('processAncWebhook ticks per pregnancy and actually yields at least once on a 60-pregnancy bundle', async () => {
    const tickSpy = vi.spyOn(CooperativeYielder.prototype, 'tick');

    const result = await processAncWebhook(db, hospitalId, buildAncBundle(), sse);
    expect(result.patientsProcessed).toBe(ANC_BUNDLE_SIZE); // real path ran end-to-end

    // Wiring proof: one tick per pregnancy at the top of the hot loop.
    expect(tickSpy.mock.calls.length).toBeGreaterThanOrEqual(ANC_BUNDLE_SIZE);

    // Behavior proof: on 60 real PGlite-backed pregnancies (>> 25ms of work)
    // the yielder handed control back to the event loop at least once.
    // >= 1, NOT an exact count — how often the 25ms budget elapses is
    // machine-speed-dependent.
    const yielders = new Set(tickSpy.mock.contexts as CooperativeYielder[]);
    const totalYields = [...yielders].reduce((n, y) => n + y.yields, 0);
    expect(totalYields).toBeGreaterThanOrEqual(1);
  });

  it('processWebhookPayload ticks in the per-patient labor loop', async () => {
    const tickSpy = vi.spyOn(CooperativeYielder.prototype, 'tick');

    const result = await processWebhookPayload(db, hospitalId, buildLaborPayload(), sse);
    expect(result.patientsProcessed).toBe(LABOR_BATCH_SIZE); // real path ran end-to-end

    // Wiring proof: part 2 also converted the AES transform `.map` to a
    // ticking `for` loop, so with the journey-link loop the floor is TWO
    // batches' worth of ticks. (The maternal-screening ingest loop is
    // flag-gated and OFF here; the delete loop has no delete actions.)
    expect(tickSpy.mock.calls.length).toBeGreaterThanOrEqual(2 * LABOR_BATCH_SIZE);
  });

  it('processPartographWebhook ticks per observation and a budget-elapsed tick actually yields', async () => {
    // Seed an ACTIVE labor admission the observations can attach to.
    const patientId = uuidv4();
    const now = new Date().toISOString();
    await db.execute(
      `INSERT INTO cached_patients
         (id, hospital_id, hn, an, name, age, admit_date,
          labor_status, synced_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?, ?, ?)`,
      [patientId, hospitalId, 'YLD-P-001', '68099001', 'enc', 27, now, now, now, now],
    );

    // The partograph transform loop is pure JS — far cheaper than 25ms per
    // batch — so unlike the ANC test we cannot rely on wall-clock to elapse
    // the budget. Deterministic seam instead: rewind the yielder's internal
    // clock on every tick so the budget is ALWAYS elapsed, then delegate to
    // the REAL tick. This proves both that the real path calls tick per
    // observation AND that an actual setImmediate yield propagates through
    // the path without corrupting processing.
    const originalTick = CooperativeYielder.prototype.tick;
    const tickSpy = vi
      .spyOn(CooperativeYielder.prototype, 'tick')
      .mockImplementation(async function (this: CooperativeYielder) {
        (this as unknown as { last: number }).last = Date.now() - 60_000;
        return originalTick.call(this);
      });

    const observationCount = 12;
    const payload: WebhookPartographPayload = {
      type: 'partograph',
      hospitalCode: '99903',
      observations: Array.from({ length: observationCount }, (_, i) => ({
        an: '68099001',
        externalObservationId: `yld-obs-${i + 1}`,
        observeDatetime: new Date(Date.parse('2026-07-17T01:00:00Z') + i * 3600_000).toISOString(),
        hourNo: i + 1,
        fetalHeartRate: 140,
        cervicalDilationCm: Math.min(4 + i, 10),
      })),
    };

    const result = await processPartographWebhook(db, hospitalId, payload, sse);
    expect(result.observationsAccepted).toBe(observationCount); // real path ran end-to-end
    expect(result.observationsSkipped).toEqual([]);

    // Wiring proof: one tick per observation in the transform loop.
    expect(tickSpy.mock.calls.length).toBeGreaterThanOrEqual(observationCount);

    // Behavior proof: with the budget forced elapsed, the real tick yielded
    // through the partograph path at least once (>= 1, count-agnostic).
    const yielders = new Set(tickSpy.mock.contexts as CooperativeYielder[]);
    const totalYields = [...yielders].reduce((n, y) => n + y.yields, 0);
    expect(totalYields).toBeGreaterThanOrEqual(1);
  });
});
