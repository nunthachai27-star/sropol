// T32: Full-stack roundtrip — partograph webhook ingestion → patient API read.
//
// Why this test (and not real Playwright):
//   The repo has no playwright.config.ts at the root and no test-key fixture
//   wired into seeds, so a real browser E2E would need bootstrapping work that
//   exceeds this single task. This Vitest integration test covers the spirit
//   of T32 by exercising the EXACT code path that ships:
//     1. processPartographWebhook() — same service the live POST
//        /api/webhooks/patient-data route invokes once auth has passed
//        (see src/app/api/webhooks/patient-data/route.ts line 129).
//     2. GET /api/patients/[an]/partogram route handler — invoked directly,
//        same module the patient detail page hits via SWR.
//
// What it proves end-to-end:
//   - A `type: 'partograph'` webhook payload with moulding '+++' lands in
//     cached_partograph_observations with source_system='webhook'.
//   - The severity roll-up writes CRITICAL onto cached_patients.
//   - The patient detail API immediately returns the new observation,
//     CRITICAL severity, the corresponding rule-9 alert, and source='webhook'.
//
// Database: pglite (real Postgres dialect) so the production SQL — including
// the patient JOIN in the route handler — runs against the actual dialect.
//
// To upgrade this to a real Playwright spec in the future:
//   - Add playwright.config.ts (webServer: { command: 'npm run dev', url: ... }).
//   - Seed a known TEST_WEBHOOK_KEY in src/db/seeds when NODE_ENV=test or via
//     a Playwright global-setup file.
//   - Mirror the 3-step flow below, but POST through the live HTTP route and
//     navigate to /patients/<hcode>-<an> with `page.goto`.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import { createPgliteDb } from '../helpers/createPgliteDb';
import {
  processPartographWebhook,
  type WebhookPartographPayload,
} from '@/services/webhook';
import type { DatabaseAdapter } from '@/db/adapter';
import type { SseManager } from '@/lib/sse';
import type { PartogramResponse } from '@/types/api';

// SSE mock — same duck-typed pattern as the existing pglite tests.
class MockSseManager {
  public events: Array<{ event: string; data: unknown }> = [];
  broadcast(event: string, data: unknown): void {
    this.events.push({ event, data });
  }
}
function asSse(mock: MockSseManager): SseManager {
  return mock as unknown as SseManager;
}

// The route handler resolves its database via getDatabase() (singleton).
// Point it at the same pglite adapter we built so step 3 reads what step 2 wrote.
let testDb: DatabaseAdapter;

vi.mock('@/db/connection', () => ({
  getDatabase: async () => testDb,
}));

vi.mock('@/lib/ensure-init', () => ({
  ensureInit: async () => undefined,
}));

// Import AFTER mocks are registered.
import { GET as getPartogram } from '@/app/api/patients/[an]/partogram/route';

const HCODE = '10670';
const AN = 'AN-RT1';
const HID = uuidv4();
const PID = uuidv4();

beforeEach(async () => {
  testDb = await createPgliteDb();
  const now = new Date().toISOString();
  await testDb.execute(
    `INSERT INTO hospitals (id, hcode, name, level, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    [HID, HCODE, 'Roundtrip Test', 'M2', now, now],
  );
  await testDb.execute(
    `INSERT INTO cached_patients
       (id, hospital_id, hn, an, name, age, admit_date,
        labor_status, synced_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?, ?, ?)`,
    [PID, HID, 'HN-RT1', AN, 'enc', 28,
     '2026-04-19T06:00:00Z', now, now, now],
  );
});

afterEach(async () => {
  await testDb.close();
});

describe('partograph webhook → patient API roundtrip', () => {
  it('webhook with moulding "+++" surfaces as CRITICAL alert in patient API response', async () => {
    // ── Step 1: POST a partograph observation through the webhook handler. ──
    // (`processPartographWebhook` is the exact function the live route
    //  /api/webhooks/patient-data calls once auth has been validated.)
    const sse = new MockSseManager();
    const payload: WebhookPartographPayload = {
      type: 'partograph',
      hospitalCode: HCODE,
      observations: [{
        an: AN,
        externalObservationId: 'rt-obs-1',
        observeDatetime: '2026-04-19T08:00:00+07:00',
        hourNo: 1,
        fetalHeartRate: 140,
        cervicalDilationCm: 4,
        moulding: '+++', // rule 9 → CRITICAL
      }],
    };
    const ingestResult = await processPartographWebhook(
      testDb, HID, payload, asSse(sse),
    );
    expect(ingestResult.observationsAccepted).toBe(1);
    expect(ingestResult.observationsSkipped).toEqual([]);

    // The severity roll-up should write CRITICAL onto cached_patients.
    const patientRows = await testDb.query<{ partograph_severity: string | null }>(
      'SELECT partograph_severity FROM cached_patients WHERE id = ?',
      [PID],
    );
    expect(patientRows[0].partograph_severity).toBe('CRITICAL');

    // ── Step 2: Hit GET /api/patients/[hcode-an]/partogram. ──
    // This is exactly what the patient detail page calls via SWR.
    const res = await getPartogram(
      {} as never,
      { params: Promise.resolve({ an: `${HCODE}-${AN}` }) },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as PartogramResponse;

    // ── Step 3: Assert the response wires up correctly end-to-end. ──
    // Observation persisted with source='webhook'.
    expect(body.partogram.source).toBe('webhook');
    expect(body.partogram.observations).toHaveLength(1);
    expect(body.partogram.observations[0].moulding).toBe('+++');
    expect(body.partogram.observations[0].fetalHeartRate).toBe(140);
    expect(body.partogram.observations[0].cervicalDilationCm).toBe(4);

    // CDSS analysis ran and produced a CRITICAL moulding alert (rule 9).
    expect(body.partogram.severity.highest).toBe('CRITICAL');
    expect(body.partogram.severity.counts.critical).toBeGreaterThan(0);
    const mouldingCriticals = body.partogram.alerts.filter(
      (a) => a.section === 'MOULDING' && a.severity === 'CRITICAL',
    );
    expect(mouldingCriticals).toHaveLength(1);
    // Pascal-port rule 9: severe moulding ('+++') → CRITICAL with this Thai message.
    expect(mouldingCriticals[0].message).toBe('กะโหลกเกยกันรุนแรง (+++)');

    // Legacy entries[] populated for the cervix dilation reading.
    expect(body.partogram.entries).toHaveLength(1);
    expect(body.partogram.entries[0].dilationCm).toBe(4);

    // SSE broadcast happened on the NULL → CRITICAL transition.
    expect(sse.events.some(
      (e) => (e.data as Record<string, unknown>).type === 'partograph_severity_changed',
    )).toBe(true);
  });

  it('multi-observation payload: API returns observations in clinical order', async () => {
    // Two ordered observations submitted out of order in the payload — the
    // route handler must return them sorted by observe_datetime ASC so the
    // chart timeline renders correctly.
    const sse = new MockSseManager();
    await processPartographWebhook(testDb, HID, {
      type: 'partograph',
      hospitalCode: HCODE,
      observations: [
        {
          an: AN, externalObservationId: 'rt-late',
          observeDatetime: '2026-04-19T10:00:00+07:00',
          fetalHeartRate: 145, cervicalDilationCm: 6,
        },
        {
          an: AN, externalObservationId: 'rt-early',
          observeDatetime: '2026-04-19T08:00:00+07:00',
          fetalHeartRate: 140, cervicalDilationCm: 4,
        },
      ],
    }, asSse(sse));

    const res = await getPartogram(
      {} as never,
      { params: Promise.resolve({ an: `${HCODE}-${AN}` }) },
    );
    const body = (await res.json()) as PartogramResponse;

    expect(body.partogram.observations).toHaveLength(2);
    // pglite normalises TIMESTAMP fields to UTC ISO, so compare the wall-clock
    // instants rather than the raw string. 08:00:00+07:00 == 01:00:00Z, etc.
    const t0 = Date.parse(body.partogram.observations[0].observeDatetime);
    const t1 = Date.parse(body.partogram.observations[1].observeDatetime);
    expect(t0).toBe(Date.parse('2026-04-19T08:00:00+07:00'));
    expect(t1).toBe(Date.parse('2026-04-19T10:00:00+07:00'));
    expect(t0).toBeLessThan(t1);
    expect(Date.parse(body.partogram.lastObservedAt!))
      .toBe(Date.parse('2026-04-19T10:00:00+07:00'));
  });
});
