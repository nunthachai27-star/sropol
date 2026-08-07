// Task 7 (maternal labor-triage screening) — flag-gated webhook ingest
// integration tests on the shared PGlite harness.
//
// Proves, through the REAL production processor (processWebhookPayload — the
// same function both /api/webhooks/patient-data and /api/sync/browser-push
// call):
//   • GC7 backward compatibility — a legacy payload without
//     `maternal_screening` produces the exact pre-Task-7 result shape and
//     writes no assessment;
//   • flag OFF (default) — the object is ignored entirely: no validation, no
//     evaluation, no write, no new response keys;
//   • flag ON — a severe-APH payload persists an assessment + summary with
//     the server-evaluated LOCAL_SEVERE result and expected rule IDs, and an
//     idempotent replay creates no duplicate;
//   • validation (spec §9.2) — impossible values, bad enums, and bad
//     timestamps are rejected with actionable `patients[i].…` errors and
//     write NOTHING, while clinically-extreme-but-possible values pass;
//   • error isolation — one patient's bad screening never aborts the batch.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import { createTestDb } from '../helpers/testDb';
import type { DatabaseAdapter } from '@/db/adapter';
import { SeedOrchestrator } from '@/db/seeds/index';
import { generateKey } from '@/lib/encryption';
import type { SseManager } from '@/lib/sse';
import {
  validatePayload,
  processWebhookPayload,
  type WebhookPayload,
  type WebhookPatientPayload,
  type WebhookMaternalScreeningPayload,
} from '@/services/webhook';
import { evaluateMaternalScreen } from '@/services/maternal-screening';
import type { MaternalScreenInput } from '@/types/maternal-screening';

process.env.ENCRYPTION_KEY = generateKey();

// ─── Test doubles / helpers ───

class MockSseManager {
  public events: Array<{ event: string; data: unknown }> = [];
  broadcast(event: string, data: unknown): void {
    this.events.push({ event, data });
  }
}
function asSse(mock: MockSseManager): SseManager {
  return mock as unknown as SseManager;
}

/** pg json columns may come back pre-parsed; SQL text needs JSON.parse. */
function asJson(value: unknown): unknown {
  return typeof value === 'string' ? JSON.parse(value) : value;
}

const ASSESSED_AT = new Date(Date.now() - 5 * 60_000).toISOString(); // 5 min ago

function basePatient(overrides: Partial<WebhookPatientPayload> = {}): WebhookPatientPayload {
  return {
    hn: 'MSHN-001',
    an: 'MSAN-001',
    name: 'นาง ทดสอบ คัดกรอง',
    cid: '0000000000021',
    age: 30,
    gravida: 2,
    para: 1,
    ga_weeks: 34,
    ga_day: 2,
    anc_count: 6,
    admit_date: '2026-07-16T06:00:00+07:00',
    bp_systolic_admit: 88,
    bp_diastolic_admit: 54,
    labor_status: 'ACTIVE',
    ...overrides,
  };
}

/**
 * Severe antepartum hemorrhage picture: visible bleeding at GA 34⁺² with an
 * abruptio-pattern (pain + tenderness + fetal tachycardia), HEAVY bleeding
 * rate, shock signs, tachycardia, and low SpO2. Expected server evaluation:
 * localTier LOCAL_SEVERE, emergencyAcuity EMERGENCY.
 */
function severeAphScreening(
  overrides: Partial<WebhookMaternalScreeningPayload> = {},
): WebhookMaternalScreeningPayload {
  return {
    source_pk: 'SCR-APH-0001',
    assessed_at: ASSESSED_AT,
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

/** The §6.1 input the transport above must map to (same-payload GA + admit BP). */
const EXPECTED_SEVERE_APH_INPUT: MaternalScreenInput = {
  gaWeeks: 34,
  gaDays: 2,
  piHDiagnosed: false,
  systolicBp: 88,
  diastolicBp: 54,
  proteinuriaGrade: 'NEGATIVE',
  creatinineMgDl: null,
  creatinineBaselineMgDl: null,
  plateletPerUl: null,
  astIuL: null,
  altIuL: null,
  urineOutputMlPerHour: null,
  headache: 'NONE',
  blurredVision: false,
  epigastricPain: false,
  pulmonaryEdema: false,
  rightUpperQuadrantPain: false,
  vaginalBleeding: true,
  estimatedBleedingMl: 800,
  bleedingRate: 'HEAVY',
  concealedBleedingSuspected: false,
  abdominalOrBackPain: true,
  uterineTenderness: true,
  frequentContractions: false,
  contractionDurationExceedsInterval: false,
  suprapubicTenderness: false,
  bandlsRing: false,
  membranesRuptured: false,
  abnormalPresentation: false,
  fetalHeartRateBpm: 170,
  fetalTracingPattern: 'NON_REASSURING',
  maternalPulseBpm: 128,
  respiratoryRatePerMin: 24,
  oxygenSaturationPct: 92,
  consciousness: 'ALERT',
  shockSignsPresent: true,
  placentaPreviaExcluded: null,
  placentaLocationSource: 'UNKNOWN',
};

const EXPECTED_SEVERE_APH_RULE_IDS = [
  'APH-GA26-VAGINAL-BLEEDING',
  'APH-ABRUPTIO-PATTERN',
  'EA-SHOCK-SIGNS-EMERGENCY',
  'EA-BLEEDING-HEAVY-EMERGENCY',
  'EA-OXYGEN-SAT-LOW-URGENT',
  'EA-PULSE-HIGH-URGENT',
  'EA-FETAL-NON-REASSURING-URGENT',
];

interface AssessmentRow {
  id: string;
  labor_admission_id: string;
  hospital_id: string;
  journey_id: string | null;
  source_system: string;
  source_pk: string | null;
  assessed_by: string | null;
  input_json: unknown;
  local_tier: string;
  emergency_acuity: string;
  is_complete: boolean;
  suspected_conditions_json: unknown;
  matches_json: unknown;
  rule_set_version: string;
  supersedes_id: string | null;
}

interface SummaryRow {
  id: string;
  journey_id: string | null;
  maternal_screen_local_tier: string | null;
  maternal_screen_emergency_acuity: string | null;
  maternal_screen_condition_codes: string | null;
  maternal_screen_is_complete: boolean | null;
  maternal_screen_rule_set_version: string | null;
}

describe('Webhook maternal screening ingest (Task 7)', () => {
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
      [hospitalId, '99901', 'รพ.ทดสอบคัดกรอง (Webhook)', 'M2', true, 'UNKNOWN', now, now],
    );
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await db.close();
  });

  async function process(
    patients: WebhookPatientPayload[],
  ): Promise<Awaited<ReturnType<typeof processWebhookPayload>>> {
    const payload: WebhookPayload = { hospitalCode: '99901', patients };
    const validation = validatePayload(payload);
    expect(validation.valid).toBe(true);
    return processWebhookPayload(db, hospitalId, validation.payload!, asSse(sse));
  }

  function assessmentRows(): Promise<AssessmentRow[]> {
    return db.query<AssessmentRow>(
      `SELECT * FROM maternal_screening_assessments ORDER BY created_at`,
    );
  }

  async function summaryFor(an: string): Promise<SummaryRow> {
    const rows = await db.query<SummaryRow>(
      `SELECT id, journey_id, maternal_screen_local_tier, maternal_screen_emergency_acuity,
              maternal_screen_condition_codes, maternal_screen_is_complete,
              maternal_screen_rule_set_version
         FROM cached_patients WHERE hospital_id = ? AND an = ?`,
      [hospitalId, an],
    );
    expect(rows).toHaveLength(1);
    return rows[0];
  }

  // ─── Backward compatibility (GC7) ───

  describe('backward compatibility (GC7)', () => {
    it('a legacy payload WITHOUT maternal_screening processes exactly as before and writes no assessment', async () => {
      const result = await process([basePatient()]);

      // EXACT legacy shape — proves no new keys leak into legacy responses.
      expect(result).toEqual({
        patientsProcessed: 1,
        newAdmissions: 1,
        discharges: 0,
        transfers: 0,
        deleted: 0,
      });

      expect(await assessmentRows()).toHaveLength(0);
      const summary = await summaryFor('MSAN-001');
      expect(summary.maternal_screen_local_tier).toBeNull();
      expect(summary.maternal_screen_emergency_acuity).toBeNull();
    });

    it('a legacy payload stays legacy-shaped even when the ingest flag is ON', async () => {
      vi.stubEnv('MATERNAL_SCREEN_INGEST_ENABLED', 'true');
      const result = await process([basePatient()]);
      expect(result).toEqual({
        patientsProcessed: 1,
        newAdmissions: 1,
        discharges: 0,
        transfers: 0,
        deleted: 0,
      });
      expect(await assessmentRows()).toHaveLength(0);
    });
  });

  // ─── Flag OFF (default) ───

  describe('flag OFF (default)', () => {
    it('ignores maternal_screening entirely: no assessment row, summary untouched, legacy result shape', async () => {
      // Flag deliberately NOT set — fail-closed default.
      const result = await process([basePatient({ maternal_screening: severeAphScreening() })]);

      expect(result).toEqual({
        patientsProcessed: 1,
        newAdmissions: 1,
        discharges: 0,
        transfers: 0,
        deleted: 0,
      });
      expect(await assessmentRows()).toHaveLength(0);
      const summary = await summaryFor('MSAN-001');
      expect(summary.maternal_screen_local_tier).toBeNull();
      expect(summary.maternal_screen_is_complete).toBeNull();
    });

    it('ignores even an INVALID maternal_screening when the flag is off (no validation runs)', async () => {
      const result = await process([
        basePatient({
          maternal_screening: severeAphScreening({
            oxygen_saturation_pct: 130, // impossible — but the flag is off
            assessed_at: 'not-a-timestamp',
          }),
        }),
      ]);
      expect(result).toEqual({
        patientsProcessed: 1,
        newAdmissions: 1,
        discharges: 0,
        transfers: 0,
        deleted: 0,
      });
      expect(await assessmentRows()).toHaveLength(0);
    });
  });

  // ─── Flag ON: severe APH end-to-end ───

  describe('flag ON — severe antepartum hemorrhage', () => {
    beforeEach(() => {
      vi.stubEnv('MATERNAL_SCREEN_INGEST_ENABLED', 'true');
    });

    it('persists assessment + summary with server-evaluated LOCAL_SEVERE/EMERGENCY and the expected rule IDs', async () => {
      const result = await process([basePatient({ maternal_screening: severeAphScreening() })]);

      expect(result.maternalScreenAssessments).toBe(1);
      expect(result.maternalScreenDuplicates).toBe(0);
      expect(result.maternalScreenIngestErrors).toEqual([]);

      const rows = await assessmentRows();
      expect(rows).toHaveLength(1);
      const row = rows[0];

      // Attached to the just-upserted cached_patients row + its journey.
      const summary = await summaryFor('MSAN-001');
      expect(row.labor_admission_id).toBe(summary.id);
      expect(row.journey_id).toBe(summary.journey_id);
      expect(row.hospital_id).toBe(hospitalId);
      expect(row.source_system).toBe('WEBHOOK');
      expect(row.source_pk).toBe('SCR-APH-0001');
      expect(row.assessed_by).toBe('RN ทดสอบ');

      // Transport → §6.1 mapping, including same-payload GA + admit BP reuse
      // and the pih_diagnosed → piHDiagnosed boundary casing.
      expect(asJson(row.input_json)).toEqual(EXPECTED_SEVERE_APH_INPUT);

      // Server-side evaluation result (GC2 — never client-supplied).
      expect(row.local_tier).toBe('LOCAL_SEVERE');
      expect(row.emergency_acuity).toBe('EMERGENCY');
      const matches = asJson(row.matches_json) as Array<{ ruleId: string }>;
      expect(matches.map((m) => m.ruleId)).toEqual(EXPECTED_SEVERE_APH_RULE_IDS);
      expect(asJson(row.suspected_conditions_json)).toEqual([
        'ANTEPARTUM_HEMORRHAGE',
        'ABRUPTIO_PLACENTAE',
      ]);

      // Store must agree with the engine's own evaluation of the same input.
      const engine = evaluateMaternalScreen(EXPECTED_SEVERE_APH_INPUT, new Date().toISOString());
      expect(row.local_tier).toBe(engine.localTier);
      expect(row.emergency_acuity).toBe(engine.emergencyAcuity);
      expect(matches.map((m) => m.ruleId)).toEqual(engine.matches.map((m) => m.ruleId));
      expect(row.is_complete).toBe(engine.isComplete);

      // Summary projection on cached_patients (same transaction — GC6).
      expect(summary.maternal_screen_local_tier).toBe('LOCAL_SEVERE');
      expect(summary.maternal_screen_emergency_acuity).toBe('EMERGENCY');
      expect(summary.maternal_screen_condition_codes).toContain('ANTEPARTUM_HEMORRHAGE');
      expect(summary.maternal_screen_rule_set_version).toBe(engine.ruleSetVersion);
    });

    it('an idempotent replay of the same source_pk creates no duplicate through the full webhook path', async () => {
      const patient = basePatient({ maternal_screening: severeAphScreening() });

      const first = await process([patient]);
      expect(first.maternalScreenAssessments).toBe(1);

      const replay = await process([patient]);
      expect(replay.maternalScreenAssessments).toBe(0);
      expect(replay.maternalScreenDuplicates).toBe(1);
      expect(replay.maternalScreenIngestErrors).toEqual([]);

      expect(await assessmentRows()).toHaveLength(1);
    });

    it('accepts clinically-extreme-but-possible values (SBP 240, platelets 5000/µL)', async () => {
      const result = await process([
        basePatient({
          bp_systolic_admit: 240,
          bp_diastolic_admit: 130,
          maternal_screening: severeAphScreening({
            source_pk: 'SCR-EXTREME-0001',
            platelet_per_ul: 5000,
          }),
        }),
      ]);
      expect(result.maternalScreenIngestErrors).toEqual([]);
      expect(result.maternalScreenAssessments).toBe(1);

      const rows = await assessmentRows();
      const input = asJson(rows[0].input_json) as MaternalScreenInput;
      expect(input.systolicBp).toBe(240);
      expect(input.plateletPerUl).toBe(5000);
    });
  });

  // ─── Flag ON: validation (spec §9.2) ───

  describe('flag ON — validation rejects and writes nothing', () => {
    beforeEach(() => {
      vi.stubEnv('MATERNAL_SCREEN_INGEST_ENABLED', 'true');
    });

    async function expectRejected(
      screening: WebhookMaternalScreeningPayload,
      messagePart: string,
      patientOverrides: Partial<WebhookPatientPayload> = {},
    ): Promise<void> {
      const result = await process([
        basePatient({ ...patientOverrides, maternal_screening: screening }),
      ]);

      // Actionable, field-addressed error in the repo's patients[i] shape.
      expect(result.maternalScreenAssessments).toBe(0);
      expect(result.maternalScreenIngestErrors).toHaveLength(1);
      expect(result.maternalScreenIngestErrors![0]).toContain('patients[0]');
      expect(result.maternalScreenIngestErrors![0]).toContain(messagePart);

      // Writes NOTHING: no assessment row, no partial summary update…
      expect(await assessmentRows()).toHaveLength(0);
      const summary = await summaryFor('MSAN-001');
      expect(summary.maternal_screen_local_tier).toBeNull();
      expect(summary.maternal_screen_emergency_acuity).toBeNull();
      expect(summary.maternal_screen_is_complete).toBeNull();

      // …while the patient's own upsert is untouched (batch not aborted).
      expect(result.patientsProcessed).toBe(1);
    }

    it('rejects a bad enum value (bleeding_rate GUSHING)', async () => {
      await expectRejected(severeAphScreening({ bleeding_rate: 'GUSHING' }), 'bleeding_rate');
    });

    it('rejects an unknown/misspelled key instead of silently dropping the finding (review IMPORTANT 2)', async () => {
      // Typo: `shock_sign_present` (missing the plural "s"). Without an
      // allowlist this would leave shockSignsPresent null and silently drop a
      // real EMERGENCY finding with a 200 + written assessment.
      const withTypo = {
        ...severeAphScreening({ shock_signs_present: null }),
        shock_sign_present: true,
      } as unknown as WebhookMaternalScreeningPayload;
      await expectRejected(withTypo, 'shock_sign_present');
    });

    it('rejects a non-ISO assessed_at (locale date "07/16/2026") — strict ISO-8601 only (review MINOR 3)', async () => {
      await expectRejected(
        severeAphScreening({ assessed_at: '07/16/2026' as unknown as string }),
        'assessed_at',
      );
    });

    it('rejects an offset-less (ambiguous local) assessed_at', async () => {
      await expectRejected(
        severeAphScreening({ assessed_at: '2026-07-16T07:55:00' }),
        'assessed_at',
      );
    });

    it('rejects an impossible number (SpO2 130%)', async () => {
      await expectRejected(
        severeAphScreening({ oxygen_saturation_pct: 130 }),
        'oxygen_saturation_pct',
      );
    });

    it('rejects an impossible admission BP (negative systolic) when reused as a screening input', async () => {
      await expectRejected(severeAphScreening(), 'bp_systolic_admit', {
        bp_systolic_admit: -50,
      });
    });

    it('rejects a malformed assessed_at timestamp', async () => {
      await expectRejected(severeAphScreening({ assessed_at: 'not-a-timestamp' }), 'assessed_at');
    });

    it('rejects an assessed_at further than the future tolerance', async () => {
      await expectRejected(
        severeAphScreening({
          assessed_at: new Date(Date.now() + 48 * 3_600_000).toISOString(),
        }),
        'assessed_at',
      );
    });

    it('rejects a non-boolean value for a three-state boolean field', async () => {
      await expectRejected(
        severeAphScreening({
          vaginal_bleeding: 'yes' as unknown as boolean,
        }),
        'vaginal_bleeding',
      );
    });

    it('rejects placenta_previa_excluded=true without approved provenance (spec §9.1)', async () => {
      await expectRejected(
        severeAphScreening({ placenta_previa_excluded: true, placenta_location_source: null }),
        'placenta_previa_excluded',
      );
    });

    it('rejects an oversized maternal_screening object', async () => {
      await expectRejected(
        severeAphScreening({
          assessed_by: 'x'.repeat(20_000),
        } as WebhookMaternalScreeningPayload),
        'maximum size',
      );
    });

    it('truncates a long echoed sender value in validation errors — a misrouted free-text never lands verbatim in the response/logs (review MINOR 2)', async () => {
      // Simulates a misrouted free-text value (e.g. a name/phone note) landing
      // in an enum field. The rejection stays actionable (field name + value
      // prefix + reported length) but never echoes the full value.
      const misrouted =
        'นาง สมมุติ นามสมมุติ โทร 081-000-0000 นัดติดตามอาการเลือดออกซ้ำในสัปดาห์หน้า';
      expect(misrouted.length).toBeGreaterThan(40);

      const result = await process([
        basePatient({
          maternal_screening: severeAphScreening({ bleeding_rate: misrouted }),
        }),
      ]);

      expect(result.maternalScreenAssessments).toBe(0);
      expect(result.maternalScreenIngestErrors).toHaveLength(1);
      const err = result.maternalScreenIngestErrors![0];
      expect(err).toContain('patients[0]');
      expect(err).toContain('bleeding_rate');
      expect(err).toContain('truncated'); // sender is told the echo is partial
      expect(err).not.toContain(misrouted); // the full value never appears
      // Nothing was written (same no-partial-write contract as every rejection).
      expect(await assessmentRows()).toHaveLength(0);
    });
  });

  // ─── Flag ON: per-patient error isolation ───

  describe('flag ON — error isolation', () => {
    it('one patient’s invalid screening never aborts the batch or the other patient’s assessment', async () => {
      vi.stubEnv('MATERNAL_SCREEN_INGEST_ENABLED', 'true');

      const bad = basePatient({
        maternal_screening: severeAphScreening({ bleeding_rate: 'GUSHING' }),
      });
      const good = basePatient({
        hn: 'MSHN-002',
        an: 'MSAN-002',
        name: 'นาง ปกติ คัดกรอง',
        cid: '1100500010001',
        maternal_screening: severeAphScreening({ source_pk: 'SCR-APH-0002' }),
      });

      const result = await process([bad, good]);

      expect(result.patientsProcessed).toBe(2); // both patient rows upserted
      expect(result.maternalScreenAssessments).toBe(1);
      expect(result.maternalScreenIngestErrors).toHaveLength(1);
      expect(result.maternalScreenIngestErrors![0]).toContain('patients[0]');

      const rows = await assessmentRows();
      expect(rows).toHaveLength(1);
      const goodSummary = await summaryFor('MSAN-002');
      expect(rows[0].labor_admission_id).toBe(goodSummary.id);
      expect(goodSummary.maternal_screen_local_tier).toBe('LOCAL_SEVERE');

      const badSummary = await summaryFor('MSAN-001');
      expect(badSummary.maternal_screen_local_tier).toBeNull();
    });

    it('makes a screening riding an action:delete patient operator-visible instead of silently skipping it (review MINOR 5)', async () => {
      vi.stubEnv('MATERNAL_SCREEN_INGEST_ENABLED', 'true');

      // Seed the admission first so the delete has something to remove.
      await process([basePatient()]);

      const result = await process([
        basePatient({ action: 'delete', maternal_screening: severeAphScreening() }),
      ]);

      // The screening was NOT written, but the drop is reported (not silent).
      expect(result.maternalScreenAssessments).toBe(0);
      expect(result.maternalScreenIngestErrors).toHaveLength(1);
      expect(result.maternalScreenIngestErrors![0]).toContain('patients[0]');
      expect(result.maternalScreenIngestErrors![0]).toContain("action:'delete'");
      expect(await assessmentRows()).toHaveLength(0);
    });
  });
});
