// Task 7 review (IMPORTANT 1) — maternal-screening ingest observability on the
// PRODUCTION browser-push path. processWebhookPayload already returns
// maternalScreen* counters, but /api/sync/browser-push previously kept only
// processed/newAdmissions/discharges/transfers, so a flag-ON invalid screening
// produced HTTP 200, a "success" sync step, a silently-lost assessment, and
// zero operator trace. This test drives the REAL route handler and asserts the
// counters reach (1) the response JSON, (2) the persisted persist_labor sync
// step, and (3) a logger.warn when a screening is rejected.
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { createTestDb } from '../../helpers/testDb';
import { SeedOrchestrator } from '@/db/seeds/index';
import type { DatabaseAdapter } from '@/db/adapter';
import { generateKey } from '@/lib/encryption';
import { testSessionUser } from '../../helpers/session';
import { logger } from '@/lib/logger';
import { getLatestSyncRun } from '@/services/sync/progress-store';

process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY ?? generateKey();

let db: DatabaseAdapter;
let mockSessionUser: Record<string, unknown> | null = null;

vi.mock('@/db/connection', () => ({ getDatabase: async () => db }));
vi.mock('@/lib/auth', () => ({
  auth: async () => (mockSessionUser ? { user: mockSessionUser } : null),
}));
vi.mock('@/lib/ensure-init', () => ({ ensureInit: async () => {} }));

import { POST } from '@/app/api/sync/browser-push/route';

const HCODE = '10670';
const ASSESSED_AT = new Date(Date.now() - 5 * 60_000).toISOString();

function jsonRequest(body: unknown): Request {
  return new Request('http://test/api/sync/browser-push', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function hospitalId(): Promise<string> {
  const rows = await db.query<{ id: string }>('SELECT id FROM hospitals WHERE hcode = ?', [HCODE]);
  return rows[0].id;
}

/** Severe-APH screening (localTier LOCAL_SEVERE, acuity EMERGENCY). */
function severeAphScreening(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    source_pk: 'BP-SCR-0001',
    assessed_at: ASSESSED_AT,
    vaginal_bleeding: true,
    bleeding_rate: 'HEAVY',
    abdominal_or_back_pain: true,
    uterine_tenderness: true,
    fetal_heart_rate_bpm: 170,
    fetal_tracing_pattern: 'NON_REASSURING',
    maternal_pulse_bpm: 128,
    oxygen_saturation_pct: 92,
    shock_signs_present: true,
    ...overrides,
  };
}

function laborPatient(screening: Record<string, unknown>): Record<string, unknown> {
  return {
    hn: 'BP-MS-1',
    an: 'BP-MSAN-1',
    name: 'นาง ทดสอบ คัดกรอง เบราว์เซอร์',
    cid: '1007000100131',
    age: 30,
    ga_weeks: 34,
    ga_day: 2,
    admit_date: '2026-07-16T06:00:00+07:00',
    bp_systolic_admit: 88,
    bp_diastolic_admit: 54,
    labor_status: 'ACTIVE',
    maternal_screening: screening,
  };
}

describe('POST /api/sync/browser-push — maternal-screening ingest counters (Task 7 review)', () => {
  beforeEach(async () => {
    db = await createTestDb();
    await new SeedOrchestrator().run(db);
    mockSessionUser = testSessionUser({ hospitalCode: HCODE });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('surfaces maternalScreen* counters in the response and the persist_labor sync step when the flag is ON', async () => {
    vi.stubEnv('MATERNAL_SCREEN_INGEST_ENABLED', 'true');

    const res = await POST(
      jsonRequest({ labor: { patients: [laborPatient(severeAphScreening())] } }) as never,
    );
    expect(res.status).toBe(200);
    const body = await res.json();

    // (1) Response JSON — the counters are no longer dropped on browser-push.
    expect(body.labor.maternalScreenAssessments).toBe(1);
    expect(body.labor.maternalScreenDuplicates).toBe(0);
    expect(body.labor.maternalScreenIngestErrors).toEqual([]);

    // The assessment was actually persisted with the server-evaluated tier.
    const hid = await hospitalId();
    const rows = await db.query<{ local_tier: string; emergency_acuity: string }>(
      `SELECT local_tier, emergency_acuity FROM maternal_screening_assessments WHERE hospital_id = ?`,
      [hid],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].local_tier).toBe('LOCAL_SEVERE');
    expect(rows[0].emergency_acuity).toBe('EMERGENCY');

    // (2) Persisted sync step (admin Sync Log) carries the numeric counts.
    // Multiple persist_labor steps exist (running → terminal); take the last.
    const run = await getLatestSyncRun(hid);
    const laborSteps = run!.steps.filter((s) => s.name === 'persist_labor');
    const laborStep = laborSteps.at(-1);
    expect(laborStep).toBeDefined();
    expect(laborStep!.status).toBe('success');
    expect(laborStep!.counts).toMatchObject({
      maternalScreenAssessments: 1,
      maternalScreenDuplicates: 0,
      maternalScreenErrors: 0,
    });
  });

  it('records an invalid screening as an error, marks the step a warning, and logs a warn (IMPORTANT 1)', async () => {
    vi.stubEnv('MATERNAL_SCREEN_INGEST_ENABLED', 'true');
    const warnSpy = vi.spyOn(logger, 'warn');

    const res = await POST(
      jsonRequest({
        labor: { patients: [laborPatient(severeAphScreening({ bleeding_rate: 'GUSHING' }))] },
      }) as never,
    );
    expect(res.status).toBe(200);
    const body = await res.json();

    // Nothing written, but the drop is now VISIBLE on this browser-only path.
    expect(body.labor.maternalScreenAssessments).toBe(0);
    expect(body.labor.maternalScreenIngestErrors).toHaveLength(1);
    expect(body.labor.maternalScreenIngestErrors[0]).toContain('bleeding_rate');

    const hid = await hospitalId();
    const stored = await db.query(
      `SELECT id FROM maternal_screening_assessments WHERE hospital_id = ?`,
      [hid],
    );
    expect(stored).toHaveLength(0);

    // (2) Sync step downgraded to warning with an error count.
    const run = await getLatestSyncRun(hid);
    const laborStep = run!.steps.filter((s) => s.name === 'persist_labor').at(-1);
    expect(laborStep!.status).toBe('warning');
    expect(laborStep!.counts).toMatchObject({ maternalScreenErrors: 1 });

    // (3) Greppable operator trace — PHI-free field-error strings.
    expect(warnSpy).toHaveBeenCalledWith(
      'maternal_screen_webhook_ingest_rejected',
      expect.objectContaining({ hospitalId: hid }),
    );
  });

  it('does NOT surface maternalScreen* keys or warn when the ingest flag is OFF (GC7 unchanged)', async () => {
    // Flag deliberately unset.
    const warnSpy = vi.spyOn(logger, 'warn');
    const res = await POST(
      jsonRequest({ labor: { patients: [laborPatient(severeAphScreening())] } }) as never,
    );
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.labor.maternalScreenAssessments).toBeUndefined();
    expect(body.labor.maternalScreenIngestErrors).toBeUndefined();

    const hid = await hospitalId();
    const stored = await db.query(
      `SELECT id FROM maternal_screening_assessments WHERE hospital_id = ?`,
      [hid],
    );
    expect(stored).toHaveLength(0);
    expect(warnSpy).not.toHaveBeenCalledWith(
      'maternal_screen_webhook_ingest_rejected',
      expect.anything(),
    );
  });
});
