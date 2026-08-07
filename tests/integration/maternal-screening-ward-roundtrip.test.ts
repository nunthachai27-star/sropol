// Phase 5 / Task W3 — the end-to-end exit gate for the maternal-screening
// ward surface (docs/superpowers/plans/2026-07-16-maternal-screening-ward.md,
// spec §11 Phase 5). ONE test file proving the full production chain:
//
//   browser-push webhook ingest (the REAL /api/sync/browser-push handler —
//   the only sync path that runs in production, see browser-only sync memo)
//     → DB: maternal_screening_assessments row (server-evaluated tier/acuity)
//     → DB: cached_patients maternal_screen_* summary columns
//     → the REAL GET /api/dashboard/high-risk handler carrying the four
//       maternalScreen* projections (W1)
//     → SseManager singleton broadcast of maternal_screen_state_changed
//       (Task 8; the route uses SseManager.getInstance() internally, so the
//       spy MUST target the singleton — parameter injection never reaches it).
//
// Flag matrix covered (all resolved server-side, per-request):
//   1. INGEST=true + EVENTS=true (UI default ON) — the whole chain lights up.
//   2. INGEST=true, EVENTS unset — DB + API still work, NO screening event
//      (events are FAIL CLOSED and gate ONLY the broadcast half).
//   3. INGEST=true, UI=false — ingest still writes the DB columns (display
//      gate is independent), but the high-risk API nulls all four fields
//      (GC-W3 server-side gate).
//
// Route-driving pattern copied from
// tests/unit/api/browser-push-maternal-screening.test.ts (vi.mock of
// @/db/connection, @/lib/auth, @/lib/ensure-init BEFORE the route imports;
// ENCRYPTION_KEY before encryption use); roundtrip shape modeled on
// tests/integration/partograph-webhook-to-api-roundtrip.test.ts; the
// singleton-spy pattern from tests/integration/webhook-security-boundary.test.ts.
import { describe, it, expect, beforeEach, afterEach, vi, type MockInstance } from 'vitest';
import { createTestDb } from '../helpers/testDb';
import { SeedOrchestrator } from '@/db/seeds/index';
import type { DatabaseAdapter } from '@/db/adapter';
import { generateKey } from '@/lib/encryption';
import { testSessionUser } from '../helpers/session';
import { SseManager } from '@/lib/sse';
import type {
  HighRiskPatient,
  HighRiskPatientsResponse,
  MaternalScreenStateChangedEvent,
} from '@/types/api';

process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY ?? generateKey();

let db: DatabaseAdapter;
let mockSessionUser: Record<string, unknown> | null = null;

vi.mock('@/db/connection', () => ({ getDatabase: async () => db }));
vi.mock('@/lib/auth', () => ({
  auth: async () => (mockSessionUser ? { user: mockSessionUser } : null),
}));
vi.mock('@/lib/ensure-init', () => ({ ensureInit: async () => {} }));

// Import AFTER the mocks are registered (vi.mock is hoisted above these).
import { POST as browserPush } from '@/app/api/sync/browser-push/route';
import { GET as getHighRisk } from '@/app/api/dashboard/high-risk/route';

const HCODE = '10670';
const AN = 'RT-MSAN-1';
const ASSESSED_AT = new Date(Date.now() - 5 * 60_000).toISOString();

function jsonRequest(body: unknown): Request {
  return new Request('http://test/api/sync/browser-push', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/**
 * Severe-APH screening (server evaluates localTier LOCAL_SEVERE, acuity
 * EMERGENCY). Deliberately INCOMPLETE: proteinuria_grade, headache and
 * consciousness are never sent, so three MANDATORY_SCREEN_FIELDS stay
 * unassessed and the engine yields isComplete=false — a proven severe result
 * coexisting with an incomplete screen (GC1 orthogonality, spec §6.2).
 */
function severeAphScreening(): Record<string, unknown> {
  return {
    source_pk: 'RT-SCR-0001',
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
  };
}

/** ACTIVE labor admission (the high-risk roster only lists labor_status='ACTIVE'). */
function laborPatient(screening: Record<string, unknown>): Record<string, unknown> {
  return {
    hn: 'RT-MS-1',
    an: AN,
    name: 'นาง ทดสอบ เอ็กซิตเกต วอร์ด',
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

interface CachedPatientSummaryRow {
  id: string;
  maternal_screen_local_tier: string | null;
  maternal_screen_emergency_acuity: string | null;
  maternal_screen_is_complete: boolean | null;
  maternal_screen_assessed_at: string | Date | null;
}

async function cachedPatientSummary(): Promise<CachedPatientSummaryRow> {
  const rows = await db.query<CachedPatientSummaryRow>(
    `SELECT cp.id, cp.maternal_screen_local_tier, cp.maternal_screen_emergency_acuity,
            cp.maternal_screen_is_complete, cp.maternal_screen_assessed_at
       FROM cached_patients cp
       INNER JOIN hospitals h ON h.id = cp.hospital_id
      WHERE h.hcode = ? AND cp.an = ?`,
    [HCODE, AN],
  );
  expect(rows).toHaveLength(1);
  return rows[0];
}

async function assessmentRows(): Promise<Array<{ local_tier: string; emergency_acuity: string }>> {
  return db.query<{ local_tier: string; emergency_acuity: string }>(
    `SELECT a.local_tier, a.emergency_acuity
       FROM maternal_screening_assessments a
       INNER JOIN hospitals h ON h.id = a.hospital_id
      WHERE h.hcode = ?`,
    [HCODE],
  );
}

/** Only the maternal_screen_state_changed broadcasts — other patient-update
 *  types (e.g. new_admission) legitimately fire on the same push. */
function screeningEvents(
  spy: MockInstance<(event: string, data: unknown) => void>,
): MaternalScreenStateChangedEvent[] {
  return spy.mock.calls
    .filter(
      ([event, data]) =>
        event === 'patient-update' &&
        (data as { type?: string } | null)?.type === 'maternal_screen_state_changed',
    )
    .map(([, data]) => data as MaternalScreenStateChangedEvent);
}

async function pushSeverePatient(): Promise<Response> {
  const res = await browserPush(
    jsonRequest({ labor: { patients: [laborPatient(severeAphScreening())] } }) as never,
  );
  expect(res.status).toBe(200);
  return res;
}

async function highRiskPatient(): Promise<HighRiskPatient> {
  const res = await getHighRisk();
  expect(res.status).toBe(200);
  const body = (await res.json()) as HighRiskPatientsResponse;
  const patient = body.patients.find((p) => p.an === AN);
  expect(patient).toBeDefined();
  return patient!;
}

describe('maternal-screening ward roundtrip — browser-push → DB → high-risk API → SSE (W3 exit gate)', () => {
  let sseSpy: MockInstance<(event: string, data: unknown) => void>;

  beforeEach(async () => {
    db = await createTestDb();
    await new SeedOrchestrator().run(db);
    mockSessionUser = testSessionUser({ hospitalCode: HCODE });
    // The route resolves SseManager.getInstance() itself — spy on the
    // singleton BEFORE the push so every broadcast in the request is captured.
    sseSpy = vi.spyOn(SseManager.getInstance(), 'broadcast');
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    await db.close(); // no-op on the shared PGlite harness, kept per convention
  });

  it('full chain with ingest + events ON: assessment row, summary columns, high-risk projection, state-change broadcast', async () => {
    vi.stubEnv('MATERNAL_SCREEN_INGEST_ENABLED', 'true');
    vi.stubEnv('MATERNAL_SCREEN_EVENTS_ENABLED', 'true');
    // Guard against an ambient CI export of MATERNAL_SCREEN_UI_ENABLED=false;
    // stubbing undefined exercises the default-ON path deterministically.
    vi.stubEnv('MATERNAL_SCREEN_UI_ENABLED', undefined);

    const res = await pushSeverePatient();
    const body = await res.json();
    expect(body.labor.maternalScreenAssessments).toBe(1);
    expect(body.labor.maternalScreenIngestErrors).toEqual([]);

    // (a) The assessment row landed with the SERVER-evaluated tier/acuity.
    const assessments = await assessmentRows();
    expect(assessments).toHaveLength(1);
    expect(assessments[0].local_tier).toBe('LOCAL_SEVERE');
    expect(assessments[0].emergency_acuity).toBe('EMERGENCY');

    // (b) The cached_patients summary columns were projected (direct SELECT).
    const summary = await cachedPatientSummary();
    expect(summary.maternal_screen_local_tier).toBe('LOCAL_SEVERE');
    expect(summary.maternal_screen_emergency_acuity).toBe('EMERGENCY');
    expect(summary.maternal_screen_is_complete).toBe(false);
    expect(new Date(summary.maternal_screen_assessed_at!).toISOString()).toBe(ASSESSED_AT);

    // (c) The real dashboard high-risk API carries the four W1 projections.
    const patient = await highRiskPatient();
    expect(patient.maternalScreenLocalTier).toBe('LOCAL_SEVERE');
    expect(patient.maternalScreenEmergencyAcuity).toBe('EMERGENCY');
    // The fixture omits proteinuria_grade / headache / consciousness →
    // three mandatory fields unassessed → incomplete despite the severe result.
    expect(patient.maternalScreenIsComplete).toBe(false);
    expect(patient.maternalScreenAssessedAt).toBe(ASSESSED_AT);

    // (d) Exactly one gated post-commit state-change broadcast, carrying the
    // PROJECTED summary values (null previous axes: first-ever assessment).
    const events = screeningEvents(sseSpy);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: 'maternal_screen_state_changed',
      patientId: summary.id,
      previousLocalTier: null,
      localTier: 'LOCAL_SEVERE',
      previousEmergencyAcuity: null,
      emergencyAcuity: 'EMERGENCY',
      isComplete: false,
    });
  });

  it('events flag OFF (unset): DB write and high-risk projection still hold, but NO maternal_screen_state_changed broadcast', async () => {
    vi.stubEnv('MATERNAL_SCREEN_INGEST_ENABLED', 'true');
    // Guarantee "unset" even if the ambient environment carries the flag —
    // events are FAIL CLOSED (only the literal 'true' enables them).
    vi.stubEnv('MATERNAL_SCREEN_EVENTS_ENABLED', undefined);

    await pushSeverePatient();

    // Ingest half unaffected: assessment row + summary columns present.
    expect(await assessmentRows()).toHaveLength(1);
    const summary = await cachedPatientSummary();
    expect(summary.maternal_screen_local_tier).toBe('LOCAL_SEVERE');
    expect(summary.maternal_screen_emergency_acuity).toBe('EMERGENCY');

    // Read API half unaffected (UI flag still default ON).
    const patient = await highRiskPatient();
    expect(patient.maternalScreenLocalTier).toBe('LOCAL_SEVERE');
    expect(patient.maternalScreenEmergencyAcuity).toBe('EMERGENCY');

    // Only the SCREENING event type must be absent — other patient-update
    // broadcasts (new admission etc.) legitimately fire on the same push.
    expect(screeningEvents(sseSpy)).toHaveLength(0);
  });

  it('UI flag OFF: ingest still writes the DB columns, but the high-risk API nulls all four maternalScreen* fields (GC-W3)', async () => {
    vi.stubEnv('MATERNAL_SCREEN_INGEST_ENABLED', 'true');
    vi.stubEnv('MATERNAL_SCREEN_UI_ENABLED', 'false');

    await pushSeverePatient();

    // Ingest is independent of the display gate — the columns ARE written.
    expect(await assessmentRows()).toHaveLength(1);
    const summary = await cachedPatientSummary();
    expect(summary.maternal_screen_local_tier).toBe('LOCAL_SEVERE');
    expect(summary.maternal_screen_emergency_acuity).toBe('EMERGENCY');

    // But the server-side gate nulls the projection on the read API.
    const patient = await highRiskPatient();
    expect(patient.maternalScreenLocalTier).toBeNull();
    expect(patient.maternalScreenEmergencyAcuity).toBeNull();
    expect(patient.maternalScreenIsComplete).toBeNull();
    expect(patient.maternalScreenAssessedAt).toBeNull();
  });
});
