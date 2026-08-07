// Dev-simulation maternal-screening profiles (Phase 6 Task H3,
// docs/superpowers/plans/2026-07-17-maternal-screening-hosxp.md).
//
// These profiles are the executable stand-in for the Pascal HOSxP sender
// (docs/hosxp/KKLRMSWebhookUnit.pas, Task H2), which cannot run in this
// repo. This file proves three things:
//
//   (a) every profile's `maternal_screening` transport object uses ONLY
//       keys the server actually accepts (`MS_KNOWN_TRANSPORT_KEYS`,
//       src/services/webhook.ts) — a stray key here would silently vanish
//       at the real ingest boundary instead of exercising anything.
//   (b) end-to-end fidelity: pushing a representative profile through the
//       REAL production ingest path (processWebhookPayload, on a PGlite DB,
//       with the ingest flag on) persists exactly the localTier /
//       emergencyAcuity / isComplete the profile's NAMED oracle case
//       declares in tests/fixtures/maternal-screen-clinical-cases.json.
//   (c) every profile's `oracleCase` names a case that actually exists in
//       that fixture, and every profile's `oracleInput` is a byte-for-byte
//       copy of that case's `input` — no clinical value here was invented
//       (GC — "no fabrication").

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import clinicalCases from '../../fixtures/maternal-screen-clinical-cases.json';
import { createTestDb } from '../../helpers/testDb';
import type { DatabaseAdapter } from '@/db/adapter';
import { SeedOrchestrator } from '@/db/seeds/index';
import { generateKey } from '@/lib/encryption';
import type { SseManager } from '@/lib/sse';
import {
  validatePayload,
  processWebhookPayload,
  MS_KNOWN_TRANSPORT_KEYS,
  type WebhookPayload,
  type WebhookPatientPayload,
} from '@/services/webhook';
import {
  MATERNAL_SCREEN_SIM_PROFILES,
  nextMaternalScreenSimProfile,
  resetMaternalScreenSimRotation,
  type MaternalScreenSimProfile,
} from '@/services/dev-simulation/maternal-screening-profiles';

process.env.ENCRYPTION_KEY = generateKey();

// ─── Oracle fixture helpers ────────────────────────────────────────────────

interface ClinicalCaseFixture {
  name: string;
  input: Record<string, unknown>;
  expect: {
    localTier: string;
    emergencyAcuity: string;
    isComplete: boolean;
  };
}
const ORACLE_CASES = clinicalCases as ClinicalCaseFixture[];

function findOracleCase(name: string): ClinicalCaseFixture {
  const found = ORACLE_CASES.find((c) => c.name === name);
  if (!found)
    throw new Error(`No oracle case named "${name}" in maternal-screen-clinical-cases.json`);
  return found;
}

// ─── Static profile-catalog checks (no DB) ─────────────────────────────────

describe('MATERNAL_SCREEN_SIM_PROFILES — static checks', () => {
  it('has at least 10 profiles', () => {
    expect(MATERNAL_SCREEN_SIM_PROFILES.length).toBeGreaterThanOrEqual(10);
  });

  it('(c) every profile references an oracle case name that actually exists in the fixture', () => {
    for (const profile of MATERNAL_SCREEN_SIM_PROFILES) {
      const exists = ORACLE_CASES.some((c) => c.name === profile.oracleCase);
      expect(
        exists,
        `profile "${profile.name}" references missing oracle case "${profile.oracleCase}"`,
      ).toBe(true);
    }
  });

  it("(c) every profile's oracleInput is copied verbatim from its named oracle case — no invented values", () => {
    for (const profile of MATERNAL_SCREEN_SIM_PROFILES) {
      const oracleCase = findOracleCase(profile.oracleCase);
      expect(
        profile.oracleInput,
        `profile "${profile.name}" vs oracle case "${profile.oracleCase}"`,
      ).toEqual(oracleCase.input);
    }
  });

  it("(a) every profile's screening object uses ONLY MS_KNOWN_TRANSPORT_KEYS keys", () => {
    for (const profile of MATERNAL_SCREEN_SIM_PROFILES) {
      for (const key of Object.keys(profile.screening)) {
        expect(
          MS_KNOWN_TRANSPORT_KEYS.has(key),
          `profile "${profile.name}" screening key "${key}" is not in MS_KNOWN_TRANSPORT_KEYS`,
        ).toBe(true);
      }
    }
  });

  it('every profile carries a required, strict-ISO-8601 assessed_at', () => {
    const strictIso = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}:\d{2})$/;
    for (const profile of MATERNAL_SCREEN_SIM_PROFILES) {
      expect(profile.screening.assessed_at, profile.name).toMatch(strictIso);
    }
  });

  it('every profile has a distinct source_pk prefix (no idempotency-key collisions across profiles)', () => {
    const prefixes = MATERNAL_SCREEN_SIM_PROFILES.map((p) => p.screening.source_pk);
    expect(new Set(prefixes).size).toBe(prefixes.length);
  });

  it('admissionContext (ga_weeks/ga_day/bp_*_admit) never leaks into the screening sub-object', () => {
    const admissionKeys = ['ga_weeks', 'ga_day', 'bp_systolic_admit', 'bp_diastolic_admit'];
    for (const profile of MATERNAL_SCREEN_SIM_PROFILES) {
      for (const key of admissionKeys) {
        expect(profile.screening, `profile "${profile.name}"`).not.toHaveProperty(key);
      }
    }
  });
});

describe('nextMaternalScreenSimProfile — deterministic rotation', () => {
  beforeEach(() => resetMaternalScreenSimRotation());

  it('rotates through the full catalog in order and wraps around deterministically', () => {
    const n = MATERNAL_SCREEN_SIM_PROFILES.length;
    const drawn = Array.from({ length: n * 2 }, () => nextMaternalScreenSimProfile());
    for (let i = 0; i < n; i++) {
      expect(drawn[i]).toBe(MATERNAL_SCREEN_SIM_PROFILES[i]);
      expect(drawn[i + n]).toBe(MATERNAL_SCREEN_SIM_PROFILES[i]);
    }
  });
});

// ─── End-to-end fidelity: profile → real ingest path → persisted result ───

class MockSseManager {
  events: Array<{ event: string; data: unknown }> = [];
  broadcast(event: string, data: unknown): void {
    this.events.push({ event, data });
  }
}
function asSse(mock: MockSseManager): SseManager {
  return mock as unknown as SseManager;
}

describe('profile fidelity through the REAL ingest path (processWebhookPayload, PGlite)', () => {
  let db: DatabaseAdapter;
  let sse: MockSseManager;
  let hospitalId: string;

  beforeEach(async () => {
    db = await createTestDb();
    await new SeedOrchestrator().run(db);
    sse = new MockSseManager();
    vi.stubEnv('MATERNAL_SCREEN_INGEST_ENABLED', 'true');

    const now = new Date().toISOString();
    hospitalId = uuidv4();
    await db.execute(
      `INSERT INTO hospitals (id, hcode, name, level, is_active, connection_status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [hospitalId, '99902', 'รพ.ทดสอบจำลอง (Dev-Sim H3)', 'M2', true, 'UNKNOWN', now, now],
    );
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await db.close();
  });

  async function ingest(
    patient: WebhookPatientPayload,
  ): Promise<Awaited<ReturnType<typeof processWebhookPayload>>> {
    const payload: WebhookPayload = { hospitalCode: '99902', patients: [patient] };
    const validation = validatePayload(payload);
    expect(validation.valid, validation.error).toBe(true);
    return processWebhookPayload(db, hospitalId, validation.payload!, asSse(sse));
  }

  interface SummaryRow {
    maternal_screen_local_tier: string | null;
    maternal_screen_emergency_acuity: string | null;
    maternal_screen_is_complete: boolean | null;
  }
  async function summaryFor(an: string): Promise<SummaryRow> {
    const rows = await db.query<SummaryRow>(
      `SELECT maternal_screen_local_tier, maternal_screen_emergency_acuity, maternal_screen_is_complete
         FROM cached_patients WHERE hospital_id = ? AND an = ?`,
      [hospitalId, an],
    );
    expect(rows).toHaveLength(1);
    return rows[0];
  }

  /** A minimal, otherwise-legacy-shaped labor patient carrying exactly the
   *  profile's admission-context fields + maternal_screening object — the
   *  same shape generators.ts's generateLaborEvent() wires onto a real
   *  simulated labor payload (src/services/dev-simulation/generators.ts).
   *  hn/an are capped at 20 chars (src/db/tables/cached-patients.ts). */
  function patientForProfile(profile: MaternalScreenSimProfile, an: string): WebhookPatientPayload {
    return {
      hn: `H${an}`,
      an,
      name: 'นาง ทดสอบ จำลอง',
      cid: '0000000000021',
      age: 28,
      admit_date: '2026-07-17T06:00:00+07:00',
      labor_status: 'ACTIVE',
      ...profile.admissionContext,
      maternal_screening: profile.screening,
    };
  }

  // Representative subset (task requires ≥ 3): a BP-driven local tier, the
  // GA≥26 antepartum-hemorrhage threshold, a multi-pattern hemorrhage case
  // (vasa previa), both non-STABLE acuity axes (EMERGENCY via shock,
  // URGENT via tachycardia), and the fully-unassessed baseline. Between
  // them these exercise every code path in
  // deriveTransportFromOracleInput/the admissionContext override.
  const REPRESENTATIVE_PROFILE_NAMES = [
    'local-severe-sbp-160',
    'severe-aph-ga26-bleeding',
    'vasa-previa-pattern',
    'emergency-shock-signs',
    'urgent-maternal-tachycardia',
    'all-unknown-incomplete',
  ] as const;

  for (const profileName of REPRESENTATIVE_PROFILE_NAMES) {
    it(`(b) profile "${profileName}" round-trips to its named oracle case's localTier/emergencyAcuity/isComplete`, async () => {
      const profile = MATERNAL_SCREEN_SIM_PROFILES.find((p) => p.name === profileName);
      expect(
        profile,
        `profile "${profileName}" must exist in MATERNAL_SCREEN_SIM_PROFILES`,
      ).toBeDefined();
      const oracleCase = findOracleCase(profile!.oracleCase);

      // hn/an are capped at 20 chars (src/db/tables/cached-patients.ts) —
      // derive a short, still-distinct AN from the profile's index rather
      // than its (long, descriptive) name.
      const an = `SIM${String(MATERNAL_SCREEN_SIM_PROFILES.indexOf(profile!)).padStart(2, '0')}`;
      const result = await ingest(patientForProfile(profile!, an));

      expect(result.maternalScreenIngestErrors ?? []).toEqual([]);
      expect(result.maternalScreenAssessments).toBe(1);

      const summary = await summaryFor(an);
      expect(summary.maternal_screen_local_tier).toBe(oracleCase.expect.localTier);
      expect(summary.maternal_screen_emergency_acuity).toBe(oracleCase.expect.emergencyAcuity);
      expect(summary.maternal_screen_is_complete).toBe(oracleCase.expect.isComplete);
    });
  }
});
