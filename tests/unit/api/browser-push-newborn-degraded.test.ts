// Newborn poison-row incident (hospitals 10998/11008, frozen cutoff since
// 2025-07): when the newborn persist step degrades, the route used to demote
// it to a bare 'Newborn persist failed (continuing).' warning with no error
// message and no counts — undiagnosable from the admin Sync Log. These tests
// drive the real route handler and assert:
//   (1) per-AN failures surface as a 'warning' step with failedAns counts
//       and reach the response JSON, and
//   (2) a hard processor failure produces a warning step that carries the
//       error message (first 120 chars) and the payload counts — mirroring
//       how persist_anc surfaces its warnings.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createTestDb } from '../../helpers/testDb';
import { SeedOrchestrator } from '@/db/seeds/index';
import type { DatabaseAdapter } from '@/db/adapter';
import { generateKey } from '@/lib/encryption';
import { testSessionUser } from '../../helpers/session';
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

// The route fires finalizeSyncRun without awaiting it (void ...), so poll
// briefly until the run leaves 'running' before asserting on its outcome.
async function finalizedRun(hid: string) {
  for (let i = 0; i < 50; i++) {
    const run = await getLatestSyncRun(hid);
    if (run && run.outcome !== 'running') return run;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error('sync run never finalized');
}

// Minimal-but-complete labour infant row as the browser gateway ships it.
function infantRow(an: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    ipt_labour_infant_id: 1,
    ipt_labour_id: 1,
    an,
    infant_number: 1,
    sex: 'F',
    birth_weight: 3100,
    body_length: 50,
    head_length: 33,
    temperature: 36.9,
    rr: 44,
    hr: 128,
    apgar_score_min1: 9,
    apgar_score_min5: 10,
    apgar_score_min10: 10,
    infant_check_ppv: 'N',
    infant_check_et_tube: 'N',
    infant_check_chest_pump: 'N',
    infant_check_oxygen_box: 'N',
    infant_check_narcan: 'N',
    infant_check_feed_milk: 'Y',
    infant_check_vitk: 'Y',
    infant_check_eyepaste: 'Y',
    infant_check_bcg: 'Y',
    infant_check_hepb: 'Y',
    infant_check_azt: 'N',
    infant_icd10: null,
    infant_hn: `NB-${an}`,
    infant_an: null,
    infant_dchstts: null,
    birth_date: '2026-07-01',
    birth_time: '09:00:00',
    ...overrides,
  };
}

async function seedJourneyWithAn(hid: string, journeyId: string, hn: string, an: string) {
  const now = new Date().toISOString();
  await db.execute(
    `INSERT INTO maternal_journeys (id, hospital_id, current_hospital_id, hn, name, cid, cid_hash, age, gravida, para, care_stage, anc_risk_level, anc_visit_count, registered_at, stage_changed_at, synced_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'enc-name', 'enc-cid', ?, 28, 1, 0, 'LABOR', 'LOW', 3, ?, ?, ?, ?, ?)`,
    [journeyId, hid, hid, hn, `hash-${journeyId}`, now, now, now, now, now],
  );
  await db.execute(
    `INSERT INTO cached_patients (id, hospital_id, hn, an, name, age, admit_date, labor_status, journey_id, synced_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'enc-name', 28, ?, 'ACTIVE', ?, ?, ?, ?)`,
    [`pat-${journeyId}`, hid, hn, an, now, journeyId, now, now, now],
  );
}

describe('POST /api/sync/browser-push — degraded newborn persist is diagnosable', () => {
  beforeEach(async () => {
    db = await createTestDb();
    await new SeedOrchestrator().run(db);
    mockSessionUser = testSessionUser({ hospitalCode: HCODE });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('per-AN failures mark persist_newborns as warning with failedAns in counts and response', async () => {
    const hid = await hospitalId();
    await seedJourneyWithAn(hid, 'j-nb-1', 'HN-NB-1', 'AN-NB-1');
    await seedJourneyWithAn(hid, 'j-nb-2', 'HN-NB-2', 'AN-NB-2');

    const res = await POST(
      jsonRequest({
        newborns: {
          infants: [
            // Poisoned AN: infant_hn overflows varchar(20) → per-row error.
            infantRow('AN-NB-1', { infant_hn: 'X'.repeat(30) }),
            infantRow('AN-NB-2'),
          ],
        },
      }) as never,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.newborns).toMatchObject({ upserted: 1, journeys: 1, failedAns: 1 });

    const run = await finalizedRun(hid);
    const step = run.steps.find((s) => s.name === 'persist_newborns' && s.status !== 'running');
    expect(step).toBeDefined();
    expect(step!.status).toBe('warning');
    expect(step!.counts).toMatchObject({ upserted: 1, journeys: 1, failedAns: 1 });
    expect(step!.message).toContain('1 AN(s) failed');
    expect(run.outcome).toBe('partial');

    // The healthy AN actually landed — the batch was not lost.
    const rows = await db.query<{ cnt: number }>(
      `SELECT COUNT(*) as cnt FROM cached_newborns WHERE journey_id = 'j-nb-2'`,
    );
    expect(Number(rows[0].cnt)).toBe(1);
  });

  it('hard processor failure surfaces the error message and payload counts in the warning step', async () => {
    const hid = await hospitalId();
    const real = db;
    // Both cached_patients resolutions crash: the infants pass is caught
    // inside processBrowserNewborns, the fallback pass then throws out of it
    // → the route's persist_newborns catch runs.
    const wrapped = Object.create(real) as DatabaseAdapter;
    wrapped.query = async <T>(sql: string, params?: unknown[]): Promise<T[]> => {
      if (sql.includes('FROM cached_patients')) {
        throw new Error('simulated cached_patients outage');
      }
      return real.query<T>(sql, params);
    };
    db = wrapped;

    const res = await POST(
      jsonRequest({
        newborns: {
          pregnancies: [
            {
              an: 'AN-HARD-1',
              mother_hn: 'HN-HARD-1',
              labor_date: '2026-07-01T00:00:00Z',
              child_count: 1,
              dead_child_count: 0,
              preg_number: 1,
              ga: 39,
            },
          ],
        },
      }) as never,
    );
    db = real;
    expect(res.status).toBe(200);

    const run = await finalizedRun(hid);
    const step = run.steps.find((s) => s.name === 'persist_newborns' && s.status !== 'running');
    expect(step).toBeDefined();
    expect(step!.status).toBe('warning');
    // Diagnosable: error message (not a bare 'failed') + payload counts.
    expect(step!.message).toContain('simulated cached_patients outage');
    expect(step!.message).not.toBe('Newborn persist failed (continuing).');
    expect(step!.counts).toMatchObject({ infants: 0, pregnancies: 1 });
    expect(run.outcome).toBe('partial');
  });
});
