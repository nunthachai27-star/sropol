// Task 8 (maternal labor-triage screening) — read API + gated SSE
// state-change event, docs/superpowers/plans/2026-07-16-maternal-screening.md.
//
// Three independent surfaces are proven here, per the task's test list:
//   1. GET /api/patients/{an}/maternal-screenings — shape, pagination
//      (limit/cursor), and supersession/correction markers.
//   2. Tenant isolation — hospital A can never read hospital B's rows, even
//      when both hospitals happen to reuse the same AN string.
//   3. `shouldEmitMaternalScreenTransition` (pure, DB-free) + the gated
//      POST-COMMIT broadcast wired into webhook.ts's Task 7 ingest block:
//      flag OFF ⇒ no broadcast, a `duplicate` replay ⇒ no broadcast, an
//      identical re-evaluation ⇒ no broadcast, a real transition ⇒ exactly
//      one `maternal_screen_state_changed` event. The transition is decided
//      on the store's PROJECTED post-save summary (never the incoming
//      assessment's own result), so a backfilled OLDER assessment that does
//      not change the summary broadcasts nothing, and a real transition's
//      event carries the projected values.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import { createTestDb } from '../helpers/testDb';
import { testSessionUser } from '../helpers/session';
import type { DatabaseAdapter } from '@/db/adapter';
import { SeedOrchestrator } from '@/db/seeds/index';
import { generateKey } from '@/lib/encryption';
import { UserRole } from '@/types/domain';
import type { SseManager } from '@/lib/sse';
import {
  validatePayload,
  processWebhookPayload,
  type WebhookPayload,
  type WebhookPatientPayload,
  type WebhookMaternalScreeningPayload,
} from '@/services/webhook';
import {
  saveMaternalScreenAssessment,
  type SaveMaternalScreenParams,
} from '@/services/maternal-screening-store';
import {
  shouldEmitMaternalScreenTransition,
  buildMaternalScreenStateChangedEvent,
} from '@/services/maternal-screening-events';
import type { MaternalScreenInput } from '@/types/maternal-screening';
import type { MaternalScreenAssessmentsResponse } from '@/types/api';

process.env.ENCRYPTION_KEY = generateKey();

// ─────────────────────────────────────────────────────────────────────────
// Section 1/2 fixtures — GET route + tenant isolation
// ─────────────────────────────────────────────────────────────────────────

let testDb: DatabaseAdapter;
let mockSessionUser: Record<string, unknown> | null = null;

vi.mock('@/db/connection', () => ({
  getDatabase: async () => testDb,
}));
vi.mock('@/lib/ensure-init', () => ({
  ensureInit: async () => undefined,
}));
vi.mock('@/lib/auth', () => ({
  auth: async () => (mockSessionUser ? { user: mockSessionUser } : null),
}));

// Import the route under test AFTER the mocks are registered.
import { GET } from '@/app/api/patients/[an]/maternal-screenings/route';

// Fully-unassessed baseline — same convention as the Task 6/7 test files:
// every nullable field null, every categorical discriminant 'UNKNOWN'.
const BASE_INPUT: MaternalScreenInput = {
  gaWeeks: null,
  gaDays: null,
  piHDiagnosed: null,
  systolicBp: null,
  diastolicBp: null,
  proteinuriaGrade: 'UNKNOWN',
  creatinineMgDl: null,
  creatinineBaselineMgDl: null,
  plateletPerUl: null,
  astIuL: null,
  altIuL: null,
  urineOutputMlPerHour: null,
  headache: 'UNKNOWN',
  blurredVision: null,
  epigastricPain: null,
  pulmonaryEdema: null,
  rightUpperQuadrantPain: null,
  vaginalBleeding: null,
  estimatedBleedingMl: null,
  bleedingRate: 'UNKNOWN',
  concealedBleedingSuspected: null,
  abdominalOrBackPain: null,
  uterineTenderness: null,
  frequentContractions: null,
  contractionDurationExceedsInterval: null,
  suprapubicTenderness: null,
  bandlsRing: null,
  membranesRuptured: null,
  abnormalPresentation: null,
  fetalHeartRateBpm: null,
  fetalTracingPattern: 'UNKNOWN',
  maternalPulseBpm: null,
  respiratoryRatePerMin: null,
  oxygenSaturationPct: null,
  consciousness: 'UNKNOWN',
  shockSignsPresent: null,
  placentaPreviaExcluded: null,
  placentaLocationSource: 'UNKNOWN',
};

function makeInput(partial: Partial<MaternalScreenInput>): MaternalScreenInput {
  return { ...BASE_INPUT, ...partial };
}

/** Complete severe-preeclampsia pattern — every mandatory field assessed. */
const SEVERE_COMPLETE_INPUT = makeInput({
  gaWeeks: 34,
  gaDays: 2,
  systolicBp: 165,
  diastolicBp: 112,
  proteinuriaGrade: 'TWO_PLUS',
  headache: 'SEVERE',
  vaginalBleeding: false,
  fetalHeartRateBpm: 140,
  maternalPulseBpm: 88,
  consciousness: 'ALERT',
  shockSignsPresent: false,
});

/** Complete mild pattern — deliberately DIFFERENT tier from the above. */
const MILD_COMPLETE_INPUT = makeInput({
  gaWeeks: 34,
  gaDays: 2,
  systolicBp: 142,
  diastolicBp: 80,
  proteinuriaGrade: 'NEGATIVE',
  headache: 'NONE',
  vaginalBleeding: false,
  fetalHeartRateBpm: 140,
  maternalPulseBpm: 88,
  consciousness: 'ALERT',
  shockSignsPresent: false,
});

const HCODE_A = '10670';
const HCODE_B = '10995';

async function hospitalIdFor(db: DatabaseAdapter, hcode: string): Promise<string> {
  const rows = await db.query<{ id: string }>('SELECT id FROM hospitals WHERE hcode = ?', [hcode]);
  expect(rows).toHaveLength(1);
  return rows[0].id;
}

let anSeq = 0;
async function seedAdmission(db: DatabaseAdapter, hospitalId: string, an: string): Promise<string> {
  const id = uuidv4();
  const now = new Date().toISOString();
  anSeq += 1;
  await db.execute(
    `INSERT INTO cached_patients
       (id, hospital_id, hn, an, name, age, admit_date, labor_status, synced_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, hospitalId, `HN-${anSeq}`, an, 'enc-name', 28, now, 'ACTIVE', now, now, now],
  );
  return id;
}

function saveParams(
  hospitalId: string,
  laborAdmissionId: string,
  overrides: Partial<SaveMaternalScreenParams> = {},
): SaveMaternalScreenParams {
  return {
    hospitalId,
    laborAdmissionId,
    sourceSystem: 'MANUAL_UI',
    sourcePk: null,
    assessedAt: '2026-07-16T07:00:00.000Z',
    assessedBy: 'nurse-001',
    input: SEVERE_COMPLETE_INPUT,
    evaluatedAt: '2026-07-16T08:00:00.000Z',
    ...overrides,
  };
}

async function callRoute(
  hcode: string,
  an: string,
  query = '',
): Promise<{
  status: number;
  body: MaternalScreenAssessmentsResponse | { error: string; code: string };
}> {
  const url = `http://localhost/api/patients/${hcode}-${an}/maternal-screenings${query}`;
  const res = await GET(
    // Route only reads request.nextUrl.searchParams — a plain fetch Request
    // is enough (NextRequest wraps it lazily via the App Router in prod).
    { nextUrl: new URL(url) } as never,
    { params: Promise.resolve({ an: `${hcode}-${an}` }) },
  );
  return { status: res.status, body: await res.json() };
}

describe('GET /api/patients/[an]/maternal-screenings (Task 8)', () => {
  let hospitalAId: string;
  let hospitalBId: string;

  beforeEach(async () => {
    testDb = await createTestDb();
    await new SeedOrchestrator().run(testDb);
    hospitalAId = await hospitalIdFor(testDb, HCODE_A);
    hospitalBId = await hospitalIdFor(testDb, HCODE_B);
    mockSessionUser = testSessionUser({ hospitalCode: HCODE_A, role: UserRole.NURSE });
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await testDb.close();
  });

  it('returns an empty, well-shaped response when the admission has no assessments', async () => {
    await seedAdmission(testDb, hospitalAId, 'AN-EMPTY');
    const { status, body } = await callRoute(HCODE_A, 'AN-EMPTY');
    expect(status).toBe(200);
    expect(body).toEqual({ latest: null, history: [], nextCursor: null, uiEnabled: true });
  });

  // ─── uiEnabled (Task U1, GC-U3): server-computed from MATERNAL_SCREEN_UI_ENABLED ───

  // Operator decision 2026-07-16: shadow-labeled read-only UI defaults ON.
  it('uiEnabled defaults to true when MATERNAL_SCREEN_UI_ENABLED is unset', async () => {
    vi.stubEnv('MATERNAL_SCREEN_UI_ENABLED', '');
    await seedAdmission(testDb, hospitalAId, 'AN-UI-DEFAULT');
    const { status, body } = await callRoute(HCODE_A, 'AN-UI-DEFAULT');
    expect(status).toBe(200);
    expect((body as MaternalScreenAssessmentsResponse).uiEnabled).toBe(true);
  });

  it('uiEnabled is false when MATERNAL_SCREEN_UI_ENABLED=false (explicit opt-out)', async () => {
    vi.stubEnv('MATERNAL_SCREEN_UI_ENABLED', 'false');
    await seedAdmission(testDb, hospitalAId, 'AN-UI-OFF');
    const { status, body } = await callRoute(HCODE_A, 'AN-UI-OFF');
    expect(status).toBe(200);
    expect((body as MaternalScreenAssessmentsResponse).uiEnabled).toBe(false);
  });

  it('404s for an AN that does not exist at all', async () => {
    const { status, body } = await callRoute(HCODE_A, 'AN-NOPE');
    expect(status).toBe(404);
    expect((body as { code: string }).code).toBe('NOT_FOUND');
  });

  it('returns the latest summary + full detail for a single assessment', async () => {
    const admissionId = await seedAdmission(testDb, hospitalAId, 'AN-ONE');
    const saved = await saveMaternalScreenAssessment(
      testDb,
      saveParams(hospitalAId, admissionId, { sourcePk: 'SP-1' }),
    );

    const { status, body } = await callRoute(HCODE_A, 'AN-ONE');
    expect(status).toBe(200);
    const r = body as MaternalScreenAssessmentsResponse;

    expect(r.history).toHaveLength(1);
    expect(r.latest).not.toBeNull();
    expect(r.latest).toEqual(r.history[0]);
    expect(r.latest?.id).toBe(saved.assessmentId);
    expect(r.latest?.localTier).toBe(saved.localTier);
    expect(r.latest?.emergencyAcuity).toBe(saved.emergencyAcuity);
    expect(r.latest?.isComplete).toBe(saved.isComplete);
    expect(r.latest?.ruleSetVersion).toBe(saved.ruleSetVersion);
    expect(r.latest?.supersedesId).toBeNull();
    expect(r.latest?.sourceSystem).toBe('MANUAL_UI');
    expect(r.latest?.sourcePk).toBe('SP-1');
    expect(r.latest?.assessedBy).toBe('nurse-001');
    // Raw normalized input snapshot round-trips exactly (GC6).
    expect(r.latest?.input).toEqual(SEVERE_COMPLETE_INPUT);
    expect(Array.isArray(r.latest?.matches)).toBe(true);
    expect(Array.isArray(r.latest?.missingRequiredFields)).toBe(true);
    expect(Array.isArray(r.latest?.suspectedConditions)).toBe(true);
    expect(r.nextCursor).toBeNull();
  });

  it('surfaces a correction as the latest row and marks the supersession chain in history', async () => {
    const admissionId = await seedAdmission(testDb, hospitalAId, 'AN-CORR');
    const original = await saveMaternalScreenAssessment(
      testDb,
      saveParams(hospitalAId, admissionId, {
        sourcePk: 'SP-ORIG',
        input: SEVERE_COMPLETE_INPUT,
        assessedAt: '2026-07-16T07:00:00.000Z',
      }),
    );
    const correction = await saveMaternalScreenAssessment(
      testDb,
      saveParams(hospitalAId, admissionId, {
        sourcePk: 'SP-CORR',
        input: MILD_COMPLETE_INPUT,
        assessedAt: '2026-07-16T07:30:00.000Z',
        supersedesId: original.assessmentId,
      }),
    );
    expect(correction.status).toBe('corrected');
    expect(correction.localTier).not.toBe(original.localTier); // sanity: it actually changed

    const { status, body } = await callRoute(HCODE_A, 'AN-CORR');
    expect(status).toBe(200);
    const r = body as MaternalScreenAssessmentsResponse;

    // latest mirrors the correction, not the original.
    expect(r.latest?.id).toBe(correction.assessmentId);
    expect(r.latest?.localTier).toBe(correction.localTier);
    expect(r.latest?.supersedesId).toBe(original.assessmentId);

    // history carries BOTH rows, newest (by assessedAt) first, with the
    // correction marker intact on each.
    expect(r.history).toHaveLength(2);
    expect(r.history[0].id).toBe(correction.assessmentId);
    expect(r.history[0].supersedesId).toBe(original.assessmentId);
    expect(r.history[1].id).toBe(original.assessmentId);
    expect(r.history[1].supersedesId).toBeNull();
  });

  it('paginates history via limit/cursor without gaps or duplicates', async () => {
    const admissionId = await seedAdmission(testDb, hospitalAId, 'AN-PAGE');
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) {
      const saved = await saveMaternalScreenAssessment(
        testDb,
        saveParams(hospitalAId, admissionId, {
          sourcePk: `SP-PAGE-${i}`,
          assessedAt: new Date(Date.UTC(2026, 6, 16, 7, i, 0)).toISOString(),
        }),
      );
      ids.push(saved.assessmentId);
    }
    // Newest assessedAt first ⇒ reverse insertion order.
    const expectedOrder = [...ids].reverse();

    const page1 = await callRoute(HCODE_A, 'AN-PAGE', '?limit=2');
    expect(page1.status).toBe(200);
    const r1 = page1.body as MaternalScreenAssessmentsResponse;
    expect(r1.history.map((h) => h.id)).toEqual(expectedOrder.slice(0, 2));
    expect(r1.nextCursor).not.toBeNull();

    const page2 = await callRoute(HCODE_A, 'AN-PAGE', `?limit=2&cursor=${r1.nextCursor}`);
    const r2 = page2.body as MaternalScreenAssessmentsResponse;
    expect(r2.history.map((h) => h.id)).toEqual(expectedOrder.slice(2, 4));
    expect(r2.nextCursor).not.toBeNull();

    const page3 = await callRoute(HCODE_A, 'AN-PAGE', `?limit=2&cursor=${r2.nextCursor}`);
    const r3 = page3.body as MaternalScreenAssessmentsResponse;
    expect(r3.history.map((h) => h.id)).toEqual(expectedOrder.slice(4, 5));
    expect(r3.nextCursor).toBeNull();
  });

  it('bounds an out-of-range limit and rejects a malformed cursor', async () => {
    const admissionId = await seedAdmission(testDb, hospitalAId, 'AN-BOUND');
    for (let i = 0; i < 3; i++) {
      await saveMaternalScreenAssessment(
        testDb,
        saveParams(hospitalAId, admissionId, {
          sourcePk: `SP-BOUND-${i}`,
          assessedAt: new Date(Date.UTC(2026, 6, 16, 7, i, 0)).toISOString(),
        }),
      );
    }
    // limit=1000 clamps to the max (100) — still returns exactly the 3 rows.
    const big = await callRoute(HCODE_A, 'AN-BOUND', '?limit=1000');
    expect((big.body as MaternalScreenAssessmentsResponse).history).toHaveLength(3);

    const badCursor = await callRoute(HCODE_A, 'AN-BOUND', '?cursor=not-a-real-cursor');
    expect(badCursor.status).toBe(400);
    expect((badCursor.body as { code: string }).code).toBe('BAD_REQUEST');

    // A crafted, well-shaped cursor with an absurd 20-digit offset is bounded
    // and rejected as invalid — it must never reach the DB as OFFSET 1e20.
    const hugeCursor = Buffer.from('o:99999999999999999999', 'utf8').toString('base64url');
    const overflow = await callRoute(HCODE_A, 'AN-BOUND', `?cursor=${hugeCursor}`);
    expect(overflow.status).toBe(400);
    expect((overflow.body as { code: string }).code).toBe('BAD_REQUEST');
  });

  // ─── Tenant isolation ───

  it('never leaks hospital B assessments to a caller scoped to hospital A, even under a colliding AN', async () => {
    const sharedAn = 'AN-SHARED-0001';
    const admissionA = await seedAdmission(testDb, hospitalAId, sharedAn);
    const admissionB = await seedAdmission(testDb, hospitalBId, sharedAn);

    const savedA = await saveMaternalScreenAssessment(
      testDb,
      saveParams(hospitalAId, admissionA, { sourcePk: 'SP-A', input: MILD_COMPLETE_INPUT }),
    );
    const savedB = await saveMaternalScreenAssessment(
      testDb,
      saveParams(hospitalBId, admissionB, { sourcePk: 'SP-B', input: SEVERE_COMPLETE_INPUT }),
    );
    expect(savedA.assessmentId).not.toBe(savedB.assessmentId);

    // Session is scoped to hospital A throughout this describe block.
    const { status, body } = await callRoute(HCODE_A, sharedAn);
    expect(status).toBe(200);
    const r = body as MaternalScreenAssessmentsResponse;
    expect(r.history).toHaveLength(1);
    expect(r.latest?.id).toBe(savedA.assessmentId);
    expect(r.latest?.id).not.toBe(savedB.assessmentId);
  });

  it('404s when a hospital-A caller requests an AN that only exists at hospital B', async () => {
    const admissionB = await seedAdmission(testDb, hospitalBId, 'AN-ONLY-B');
    await saveMaternalScreenAssessment(
      testDb,
      saveParams(hospitalBId, admissionB, { sourcePk: 'SP-ONLY-B' }),
    );

    const { status, body } = await callRoute(HCODE_A, 'AN-ONLY-B');
    expect(status).toBe(404);
    expect((body as { code: string }).code).toBe('NOT_FOUND');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Section 3a — shouldEmitMaternalScreenTransition / buildMaternalScreenStateChangedEvent
// (pure, DB-free)
// ─────────────────────────────────────────────────────────────────────────

describe('shouldEmitMaternalScreenTransition (pure)', () => {
  it('emits for the very first assessment (prev axes null)', () => {
    expect(
      shouldEmitMaternalScreenTransition(
        { localTier: null, emergencyAcuity: null },
        { localTier: 'LOCAL_MILD', emergencyAcuity: 'STABLE' },
      ),
    ).toBe(true);
  });

  it('does not emit for an identical re-evaluation', () => {
    expect(
      shouldEmitMaternalScreenTransition(
        { localTier: 'LOCAL_SEVERE', emergencyAcuity: 'EMERGENCY' },
        { localTier: 'LOCAL_SEVERE', emergencyAcuity: 'EMERGENCY' },
      ),
    ).toBe(false);
  });

  it('emits when only localTier changes', () => {
    expect(
      shouldEmitMaternalScreenTransition(
        { localTier: 'LOCAL_MILD', emergencyAcuity: 'STABLE' },
        { localTier: 'LOCAL_SEVERE', emergencyAcuity: 'STABLE' },
      ),
    ).toBe(true);
  });

  it('emits when only emergencyAcuity changes', () => {
    expect(
      shouldEmitMaternalScreenTransition(
        { localTier: 'LOCAL_MILD', emergencyAcuity: 'STABLE' },
        { localTier: 'LOCAL_MILD', emergencyAcuity: 'URGENT' },
      ),
    ).toBe(true);
  });
});

describe('buildMaternalScreenStateChangedEvent (pure)', () => {
  it('shapes a PHI-free, snake_case-typed payload per spec §10.4', () => {
    const event = buildMaternalScreenStateChangedEvent({
      patientId: 'admission-id-123',
      previous: { localTier: null, emergencyAcuity: null },
      localTier: 'LOCAL_SEVERE',
      emergencyAcuity: 'EMERGENCY',
      isComplete: true,
      suspectedConditions: ['ABRUPTIO_PLACENTAE'],
      assessedAt: '2026-07-16T07:00:00.000Z',
    });
    expect(event).toEqual({
      type: 'maternal_screen_state_changed',
      patientId: 'admission-id-123',
      previousLocalTier: null,
      localTier: 'LOCAL_SEVERE',
      previousEmergencyAcuity: null,
      emergencyAcuity: 'EMERGENCY',
      isComplete: true,
      suspectedConditions: ['ABRUPTIO_PLACENTAE'],
      assessedAt: '2026-07-16T07:00:00.000Z',
    });
    // No name/cid/free-text keys anywhere on the payload (GC6 PHI guard).
    expect(Object.keys(event)).not.toEqual(expect.arrayContaining(['name', 'cid']));
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Section 3b — gated POST-COMMIT broadcast, exercised through the REAL
// production webhook ingest path (processWebhookPayload), same MockSseManager
// pattern as tests/integration/webhook-maternal-screening.test.ts (Task 7).
// ─────────────────────────────────────────────────────────────────────────

class MockSseManager {
  public events: Array<{ event: string; data: unknown }> = [];
  broadcast(event: string, data: unknown): void {
    this.events.push({ event, data });
  }
}
function asSse(mock: MockSseManager): SseManager {
  return mock as unknown as SseManager;
}

function basePatient(overrides: Partial<WebhookPatientPayload> = {}): WebhookPatientPayload {
  return {
    hn: 'MSHN-T8',
    an: 'MSAN-T8',
    name: 'นาง ทดสอบ เหตุการณ์',
    cid: '0000000000021',
    age: 30,
    admit_date: '2026-07-16T06:00:00+07:00',
    bp_systolic_admit: 88,
    bp_diastolic_admit: 54,
    labor_status: 'ACTIVE',
    ...overrides,
  };
}

/** Severe antepartum-hemorrhage transport pattern — server evaluation:
 *  localTier LOCAL_SEVERE, emergencyAcuity EMERGENCY (same fixture family as
 *  tests/integration/webhook-maternal-screening.test.ts). */
function severeAphScreening(
  overrides: Partial<WebhookMaternalScreeningPayload> = {},
): WebhookMaternalScreeningPayload {
  return {
    source_pk: 'T8-SCR-0001',
    assessed_at: '2026-07-16T06:30:00+07:00',
    assessed_by: 'RN ทดสอบ',
    pih_diagnosed: false,
    proteinuria_grade: 'negative',
    headache: 'NONE',
    blurred_vision: false,
    epigastric_pain: false,
    pulmonary_edema: false,
    right_upper_quadrant_pain: false,
    vaginal_bleeding: true,
    estimated_bleeding_ml: 800,
    bleeding_rate: 'HEAVY',
    concealed_bleeding_suspected: false,
    abdominal_or_back_pain: true,
    uterine_tenderness: true,
    frequent_contractions: false,
    contraction_duration_exceeds_interval: false,
    suprapubic_tenderness: false,
    bandls_ring: false,
    membranes_ruptured: false,
    abnormal_presentation: false,
    fetal_heart_rate_bpm: 170,
    fetal_tracing_pattern: 'NON_REASSURING',
    maternal_pulse_bpm: 128,
    respiratory_rate_per_min: 24,
    oxygen_saturation_pct: 92,
    consciousness: 'ALERT',
    shock_signs_present: true,
    placenta_previa_excluded: null,
    placenta_location_source: null,
    ...overrides,
  };
}

/** Entirely-normal transport picture (all six stability fields assessed) —
 *  server evaluation: localTier NO_LOCAL_MATCH, emergencyAcuity STABLE. A
 *  deliberately DIFFERENT state from severeAphScreening's
 *  LOCAL_SEVERE/EMERGENCY, for transition/backfill tests. */
function stableScreening(
  overrides: Partial<WebhookMaternalScreeningPayload> = {},
): WebhookMaternalScreeningPayload {
  return {
    source_pk: 'T8-SCR-STABLE-0001',
    assessed_at: '2026-07-16T06:30:00+07:00',
    assessed_by: 'RN ทดสอบ',
    pih_diagnosed: false,
    proteinuria_grade: 'negative',
    headache: 'NONE',
    blurred_vision: false,
    epigastric_pain: false,
    pulmonary_edema: false,
    right_upper_quadrant_pain: false,
    vaginal_bleeding: false,
    estimated_bleeding_ml: 0,
    bleeding_rate: 'SPOTTING',
    concealed_bleeding_suspected: false,
    abdominal_or_back_pain: false,
    uterine_tenderness: false,
    frequent_contractions: false,
    contraction_duration_exceeds_interval: false,
    suprapubic_tenderness: false,
    bandls_ring: false,
    membranes_ruptured: false,
    abnormal_presentation: false,
    fetal_heart_rate_bpm: 140,
    fetal_tracing_pattern: 'REASSURING',
    maternal_pulse_bpm: 80,
    respiratory_rate_per_min: 16,
    oxygen_saturation_pct: 98,
    consciousness: 'ALERT',
    shock_signs_present: false,
    placenta_previa_excluded: null,
    placenta_location_source: null,
    ...overrides,
  };
}

describe('webhook.ts gated maternal_screen_state_changed broadcast (Task 8)', () => {
  let db: DatabaseAdapter;
  let sse: MockSseManager;
  let hospitalId: string;

  beforeEach(async () => {
    db = await createTestDb();
    await new SeedOrchestrator().run(db);
    sse = new MockSseManager();

    const now = new Date().toISOString();
    hospitalId = uuidv4();
    await db.execute(
      `INSERT INTO hospitals (id, hcode, name, level, is_active, connection_status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [hospitalId, '99902', 'รพ.ทดสอบเหตุการณ์ (Webhook)', 'M2', true, 'UNKNOWN', now, now],
    );
    // Ingest itself must be ON for anything to be saved at all — the events
    // flag is stubbed per-test below.
    vi.stubEnv('MATERNAL_SCREEN_INGEST_ENABLED', 'true');
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await db.close();
  });

  async function process(
    patients: WebhookPatientPayload[],
  ): Promise<Awaited<ReturnType<typeof processWebhookPayload>>> {
    const payload: WebhookPayload = { hospitalCode: '99902', patients };
    const validation = validatePayload(payload);
    expect(validation.valid).toBe(true);
    return processWebhookPayload(db, hospitalId, validation.payload!, asSse(sse));
  }

  function stateChangedEvents(): Array<{ event: string; data: unknown }> {
    return sse.events.filter(
      (e) => (e.data as { type?: string })?.type === 'maternal_screen_state_changed',
    );
  }

  it('flag OFF (default): a transition-worthy assessment persists but broadcasts nothing', async () => {
    // MATERNAL_SCREEN_EVENTS_ENABLED deliberately NOT stubbed — fail-closed default.
    await process([basePatient({ maternal_screening: severeAphScreening() })]);

    const assessments = await db.query<{ id: string }>(
      'SELECT id FROM maternal_screening_assessments',
    );
    expect(assessments).toHaveLength(1); // ingest still worked
    expect(stateChangedEvents()).toHaveLength(0); // but nothing broadcast
  });

  it('flag ON: the first assessment on an admission (prev null) is a transition and broadcasts once', async () => {
    vi.stubEnv('MATERNAL_SCREEN_EVENTS_ENABLED', 'true');
    await process([basePatient({ maternal_screening: severeAphScreening() })]);

    const events = stateChangedEvents();
    expect(events).toHaveLength(1);
    expect(events[0].event).toBe('patient-update');
    const data = events[0].data as {
      type: string;
      previousLocalTier: string | null;
      localTier: string;
      previousEmergencyAcuity: string | null;
      emergencyAcuity: string;
      assessedAt: string;
      patientId: string;
    };
    expect(data.previousLocalTier).toBeNull();
    expect(data.previousEmergencyAcuity).toBeNull();
    expect(data.localTier).toBe('LOCAL_SEVERE');
    expect(data.emergencyAcuity).toBe('EMERGENCY');
    expect(typeof data.patientId).toBe('string');
    expect(data.patientId.length).toBeGreaterThan(0);

    // patientId is the cached_patients admission id, not the AN/HN (PHI-free).
    const admissionRow = await db.query<{ id: string }>(
      'SELECT id FROM cached_patients WHERE hospital_id = ? AND an = ?',
      [hospitalId, 'MSAN-T8'],
    );
    expect(data.patientId).toBe(admissionRow[0].id);
  });

  it('flag ON: a duplicate replay (same source_pk) broadcasts nothing', async () => {
    vi.stubEnv('MATERNAL_SCREEN_EVENTS_ENABLED', 'true');
    await process([basePatient({ maternal_screening: severeAphScreening() })]);
    expect(stateChangedEvents()).toHaveLength(1);

    sse.events = []; // clear — isolate the replay's behavior
    await process([basePatient({ maternal_screening: severeAphScreening() })]); // identical source_pk
    expect(stateChangedEvents()).toHaveLength(0);
  });

  it('flag ON: a second assessment landing on the SAME state (different source_pk) broadcasts nothing', async () => {
    vi.stubEnv('MATERNAL_SCREEN_EVENTS_ENABLED', 'true');
    await process([basePatient({ maternal_screening: severeAphScreening() })]);
    expect(stateChangedEvents()).toHaveLength(1);

    sse.events = [];
    await process([
      basePatient({
        maternal_screening: severeAphScreening({ source_pk: 'T8-SCR-0002' }), // new row, same clinical picture
      }),
    ]);
    expect(stateChangedEvents()).toHaveLength(0);
  });

  it('flag ON: a backfilled OLDER assessment that does not change the projected summary broadcasts nothing', async () => {
    vi.stubEnv('MATERNAL_SCREEN_EVENTS_ENABLED', 'true');
    // The NEWER severe assessment arrives first and becomes (and stays) the
    // projected summary.
    await process([basePatient({ maternal_screening: severeAphScreening() })]); // assessed 06:30+07:00
    expect(stateChangedEvents()).toHaveLength(1);

    sse.events = [];
    // A would-be-downgrading assessment assessed BEFORE the severe one is
    // backfilled AFTER it. It persists as history but does not become latest:
    // cached_patients and the read API still say LOCAL_SEVERE/EMERGENCY, so
    // emitting its NO_LOCAL_MATCH/STABLE picture would announce a state that
    // contradicts everything persisted.
    await process([
      basePatient({
        maternal_screening: stableScreening({
          source_pk: 'T8-SCR-BACKFILL',
          assessed_at: '2026-07-16T05:00:00+07:00', // OLDER than 06:30
        }),
      }),
    ]);

    // The backfilled row WAS stored…
    const rows = await db.query<{ id: string }>('SELECT id FROM maternal_screening_assessments');
    expect(rows).toHaveLength(2);
    // …but nothing was broadcast, and the summary still mirrors the newer row.
    expect(stateChangedEvents()).toHaveLength(0);
    const summary = await db.query<{
      maternal_screen_local_tier: string;
      maternal_screen_emergency_acuity: string;
    }>(
      `SELECT maternal_screen_local_tier, maternal_screen_emergency_acuity
         FROM cached_patients WHERE hospital_id = ? AND an = ?`,
      [hospitalId, 'MSAN-T8'],
    );
    expect(summary[0].maternal_screen_local_tier).toBe('LOCAL_SEVERE');
    expect(summary[0].maternal_screen_emergency_acuity).toBe('EMERGENCY');
  });

  it('flag ON: a NEWER assessment that changes the summary broadcasts once, carrying the PROJECTED post-save values', async () => {
    vi.stubEnv('MATERNAL_SCREEN_EVENTS_ENABLED', 'true');
    await process([basePatient({ maternal_screening: severeAphScreening() })]); // assessed 06:30+07:00
    expect(stateChangedEvents()).toHaveLength(1);

    sse.events = [];
    const NEWER_ASSESSED_AT = '2026-07-16T08:00:00+07:00';
    await process([
      basePatient({
        maternal_screening: stableScreening({
          source_pk: 'T8-SCR-NEWER-STABLE',
          assessed_at: NEWER_ASSESSED_AT, // NEWER than 06:30 — becomes latest
        }),
      }),
    ]);

    const events = stateChangedEvents();
    expect(events).toHaveLength(1);
    const data = events[0].data as {
      previousLocalTier: string | null;
      localTier: string;
      previousEmergencyAcuity: string | null;
      emergencyAcuity: string;
      isComplete: boolean;
      suspectedConditions: string[];
      assessedAt: string;
    };
    expect(data.previousLocalTier).toBe('LOCAL_SEVERE');
    expect(data.previousEmergencyAcuity).toBe('EMERGENCY');
    // The event carries the PROJECTED (now-latest) summary values — exactly
    // what cached_patients and the read API's `latest` now say.
    expect(data.localTier).toBe('NO_LOCAL_MATCH');
    expect(data.emergencyAcuity).toBe('STABLE');
    expect(data.suspectedConditions).toEqual([]);
    expect(new Date(data.assessedAt).getTime()).toBe(new Date(NEWER_ASSESSED_AT).getTime());
  });
});
