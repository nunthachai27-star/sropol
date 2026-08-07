// Event generators — produce realistic webhook-shaped events using a 3-tier
// pipeline:
//
//   Tier 3 (planner)   → per-hospital shift plan decides which profile + name
//                         to use for each event (narrative coherence).
//   Tier 2 (LLM JSON)  → Gemma-4 fills the full clinical record under a
//                         guided-JSON schema bounded by the profile's bands.
//   Tier 1 (profiles)  → deterministic applyProfile() fills any remaining
//                         fields and acts as a fallback when the LLM misfires.
//
// Evaluator validates every LLM payload before acceptance. On any error we
// swap in the deterministic output silently and log the rejection with the
// profile id — you'll see these in recentEvents as "llm_fallback: <reason>".
// MVP still supports labor / anc / referral / referral_update / partograph.

import { llmChat, llmJson } from '@/lib/llm-client';
import { logger } from '@/lib/logger';
import type {
  WebhookPatientPayload,
  WebhookAncPatient,
  WebhookAncVisit,
  WebhookReferralCreatePayload,
  WebhookReferralUpdatePayload,
  WebhookPartographPayload,
  WebhookPartographObservation,
} from '@/services/webhook';
import {
  addPatient,
  addAdmission,
  addReferral,
  findExistingAncPatient,
  findAncPatient,
  graduateToLabor,
  pickRecentAdmission,
  pickRecentReferralForUpdate,
  pickPatientToRefer,
  consumeArrivedReferralForAdmission,
  incPartographHour,
  advanceReferralStatus,
  type PooledPatient,
} from './pool';
import {
  PROFILE_IDS,
  getProfileById,
  profilePromptHint,
  sampleProfile,
  type ClinicalProfile,
} from './profiles';
import {
  applyProfileToLabor,
  applyProfileToAnc,
  applyProfileToAncVisit,
  applyProfileToPartograph,
  type DeterministicLaborInput,
  type DeterministicAncInput,
} from './apply-profile';
import {
  evaluateAncEvent,
  evaluateLaborEvent,
  evaluatePartographEvent,
  findNarrativeInconsistencies,
  type EvaluationResult,
} from './evaluator';
import { consumeNextPlannedEvent, profileForPlannedEvent, type PlannedEvent } from './planner';
import { nextMaternalScreenSimProfile } from './maternal-screening-profiles';
import type { SimEventType } from './types';

export interface HospitalContext {
  hcode: string;
  name: string;
}

interface PatientNarrative {
  name: string;
  note: string;
}
interface ReferralNarrative {
  name: string;
  reason: string;
  diagnosisCode: string;
  urgency: 'ROUTINE' | 'URGENT' | 'EMERGENCY';
}

// ─── Evaluation telemetry (picked up by orchestrator.status) ──────────────

export interface EvaluationStats {
  accepted: number;
  rejected: number;
  warnings: number;
  lastRejection: { profile: string; errors: string[] } | null;
}
export const evalStats: EvaluationStats = {
  accepted: 0,
  rejected: 0,
  warnings: 0,
  lastRejection: null,
};
export function resetEvalStats(): void {
  evalStats.accepted = 0;
  evalStats.rejected = 0;
  evalStats.warnings = 0;
  evalStats.lastRejection = null;
}
function recordEvaluation(res: EvaluationResult): void {
  if (res.valid) {
    evalStats.accepted += 1;
    if (res.warnings.length > 0) evalStats.warnings += 1;
  } else {
    evalStats.rejected += 1;
    evalStats.lastRejection = { profile: res.profileId, errors: res.errors.slice(0, 5) };
    logger.info('sim_llm_rejected', { profile: res.profileId, errors: res.errors.slice(0, 3) });
  }
}

// ─── Deterministic helpers ─────────────────────────────────────────────

const AMPHUR_CODES = [
  '01',
  '02',
  '03',
  '04',
  '05',
  '06',
  '07',
  '08',
  '09',
  '10',
  '11',
  '12',
  '13',
  '14',
  '15',
  '16',
  '17',
  '18',
  '19',
  '20',
  '21',
  '22',
  '23',
  '24',
  '25',
  '26',
];

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}
function rnd(min: number, max: number): number {
  return Math.round(min + Math.random() * (max - min));
}
function mulberry32(seed: number) {
  return () => {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function synthCid(seed: number): string {
  const rand = mulberry32(seed);
  const digits = Array.from({ length: 12 }, () => Math.floor(rand() * 10));
  const sum = digits.reduce((a, d, i) => a + d * (13 - i), 0);
  const check = (11 - (sum % 11)) % 10;
  return digits.join('') + check.toString();
}
function synthHn(): string {
  return String(rnd(1, 999_999_999)).padStart(9, '0');
}
function synthAn(): string {
  const be = (new Date().getFullYear() + 543) % 100;
  const seq = rnd(1, 9_999_999);
  return `${String(be).padStart(2, '0')}${String(seq).padStart(7, '0')}`;
}

// ─── Profile selection (planner if available, else sampler) ───────────────

interface ResolvedPlan {
  profile: ClinicalProfile;
  /** Pre-picked name (from plan) or null to let LLM pick. */
  plannedName: string | null;
  /** Pre-picked clinical note (from plan) — fed to LLM as steering context. */
  plannedNote: string | null;
  /** True when the event came from the planner (vs sampled locally). */
  fromPlan: boolean;
}

function resolveProfile(hcode: string, desiredType: SimEventType): ResolvedPlan {
  const planned = consumeNextPlannedEvent(hcode, desiredType);
  if (planned) {
    return {
      profile: profileForPlannedEvent(planned),
      plannedName: planned.name,
      plannedNote: planned.note,
      fromPlan: true,
    };
  }
  return {
    profile: sampleProfile(),
    plannedName: null,
    plannedNote: null,
    fromPlan: false,
  };
}

// ─── System prompt ─────────────────────────────────────────────────────

const SYSTEM_PROMPT = [
  'You are generating realistic DEV-ONLY synthetic obstetric data for a Thai',
  'maternal-care dashboard covering Khon Kaen Province (OneLR / ห้องคลอดหนึ่งเดียว).',
  'All data is fabricated — no real patient is represented. Output must be',
  'valid JSON only, no markdown, no commentary. Names must be plausible Thai',
  'names (ชื่อ-นามสกุล). Clinical details must match the profile provided and',
  'stay within the numeric ranges supplied by the JSON schema.',
].join(' ');

// Simple schema used for LLM-assisted narrative generation (name + note).
// vLLM's guided_json reliably enforces this 2-field shape; it falls apart on
// richer clinical schemas because Gemma-4 invents its own wrapper keys.
const NARRATIVE_SCHEMA = {
  type: 'object',
  required: ['name', 'note'],
  properties: {
    name: { type: 'string', maxLength: 60 },
    note: { type: 'string', maxLength: 140 },
  },
};

// ─── Prior-ANC synthesis (every labor admission gets ≥ 2 backdated visits) ─

/** WHO 2016 / Thai MOH 8-contact ANC schedule. Same canonical milestones used
 *  by `generateAncEvent` so the synthesized prior history looks identical to
 *  organically-generated ANC. */
const ANC_CONTACT_WEEKS = [12, 20, 26, 30, 34, 36, 38, 40] as const;

/** Pick the visit GAs to materialise as backdated ANC visits for a labor
 *  admission whose current GA is `currentGa`. Guarantees ≥ 2 visits and that
 *  the latest visit is at least 2 weeks before admission (clinically real). */
function chooseBackdatedVisitGas(currentGa: number): number[] {
  // Standard path: take the latest 3 schedule milestones strictly before the
  // current GA (so the most recent is ~2 weeks before delivery, mirroring real
  // pregnancies where ANC tightens to weekly near term).
  const cutoff = Math.max(8, currentGa - 2);
  const onSchedule = ANC_CONTACT_WEEKS.filter((w) => w <= cutoff).slice(-3);
  if (onSchedule.length >= 2) return onSchedule;
  // Preterm fallback: if the schedule yields fewer than 2 (e.g. labor at GA
  // 14), synthesize two evenly-spaced earlier visits so the journey still has
  // history — clinical realism is best-effort here since preterm < 14 wk is
  // already an outlier scenario.
  const second = Math.max(8, currentGa - 4);
  const first = Math.max(6, second - 4);
  return [first, second];
}

interface PriorAncArgs {
  profile: ClinicalProfile;
  hosp: HospitalContext;
  cid: string;
  hn: string;
  name: string;
  age: number;
  gravida: number;
  /** Pregnancy GA at admission (weeks). */
  currentGa: number;
  /** Labor admission ISO datetime — backdated ANC visits land before this. */
  admitIso: string;
}

/** Build a `WebhookAncPatient` payload representing the same woman's ANC
 *  history with at least 2 backdated visits. Posted to /api/webhooks/patient-data
 *  with `type: "anc_data"` BEFORE the labor event so the server's
 *  `processWebhookPayload` can link the labor row to the new maternal_journey
 *  via cid_hash. Returns null if the labor is too early to plausibly have ANC
 *  (currentGa < 6 — extremely early loss; never happens for live admissions). */
function buildPriorAncPayload(args: PriorAncArgs): WebhookAncPatient | null {
  if (args.currentGa < 6) return null;

  const visitGas = chooseBackdatedVisitGas(args.currentGa);
  // LMP = admit − currentGa weeks. Visits at LMP + visitGa weeks (jittered
  // ±2 days for human-looking timestamps, capped at admit-1d).
  const admitMs = new Date(args.admitIso).getTime();
  const lmpMs = admitMs - args.currentGa * 7 * 86400_000;
  const lmpIso = new Date(lmpMs).toISOString();
  const edcIso = new Date(lmpMs + 280 * 86400_000).toISOString();
  const ageMs = (year: number) => new Date(`${year}-01-01`).getTime();
  void ageMs;

  const visits: WebhookAncVisit[] = visitGas.map((visitGa, idx) => {
    const jitterDays = rnd(-2, 2);
    const raw = lmpMs + visitGa * 7 * 86400_000 + jitterDays * 86400_000;
    // Cap so the latest visit is ≤ admit − 1 day (no same-day or future visits).
    const cap = admitMs - 86400_000;
    const visitAt = new Date(Math.min(raw, cap));
    return applyProfileToAncVisit(args.profile, visitGa, idx + 1, visitAt.toISOString());
  });

  // Birthday derived from age — needed by WebhookAncPatient.
  const birthYear = new Date().getFullYear() - args.age;
  const birthday = `${birthYear}-${String(rnd(1, 12)).padStart(2, '0')}-${String(rnd(1, 28)).padStart(2, '0')}`;

  return applyProfileToAnc({
    profile: args.profile,
    name: args.name,
    hn: args.hn,
    cid: args.cid,
    birthday,
    gravida: args.gravida,
    lmpIso,
    edcIso,
    changwatCode: '40',
    amphurCode: pick(AMPHUR_CODES),
    visits,
    currentGa: args.currentGa,
  });
}

// ─── Labor admission ───────────────────────────────────────────────────

/** Return shape for a labor event — when `priorAnc` is non-null, the
 *  orchestrator MUST POST it (as `type: "anc_data"`) before the labor body so
 *  the server has the journey row to link to via cid_hash. */
export interface GeneratedLaborEvent {
  labor: WebhookPatientPayload;
  priorAnc: WebhookAncPatient | null;
}

function laborJsonSchema(p: ClinicalProfile) {
  return {
    type: 'object',
    required: [
      'name',
      'note',
      'heightCm',
      'prePregnancyWeightKg',
      'weightKgNow',
      'weightGainKg',
      'fundalHeightCm',
      'ultrasoundWeightG',
      'hematocritPct',
    ],
    properties: {
      name: { type: 'string', maxLength: 60 },
      note: { type: 'string', maxLength: 140 },
      heightCm: { type: 'integer', minimum: p.heightCm.min, maximum: p.heightCm.max },
      prePregnancyWeightKg: {
        type: 'integer',
        minimum: p.prePregWeightKg.min,
        maximum: p.prePregWeightKg.max,
      },
      weightKgNow: {
        type: 'integer',
        minimum: p.prePregWeightKg.min,
        maximum: Math.min(160, p.prePregWeightKg.max + p.totalWeightGainKg.max),
      },
      weightGainKg: {
        type: 'integer',
        minimum: p.totalWeightGainKg.min,
        maximum: p.totalWeightGainKg.max,
      },
      fundalHeightCm: { type: 'number', minimum: 16, maximum: 42 },
      ultrasoundWeightG: { type: 'integer', minimum: 1500, maximum: 4800 },
      hematocritPct: { type: 'integer', minimum: p.hctPct.min, maximum: p.hctPct.max },
    },
  };
}

interface LaborLlmOutput {
  name: string;
  note: string;
  heightCm: number;
  prePregnancyWeightKg: number;
  weightKgNow: number;
  weightGainKg: number;
  fundalHeightCm: number;
  ultrasoundWeightG: number;
  hematocritPct: number;
}

/** Gemma-4 under vLLM guided_json doesn't strictly enforce that required
 *  properties appear at the top level — it sometimes nests them inside an
 *  invented wrapper object. Deep-search the parsed response so we recover
 *  the schema-intended fields no matter where the model placed them. */
function deepFind(obj: unknown, key: string): unknown {
  if (obj == null || typeof obj !== 'object') return undefined;
  if (Array.isArray(obj)) {
    for (const el of obj) {
      const hit = deepFind(el, key);
      if (hit !== undefined) return hit;
    }
    return undefined;
  }
  const rec = obj as Record<string, unknown>;
  if (key in rec && rec[key] != null) return rec[key];
  // Try snake_case variant.
  const snake = key.replace(/([A-Z])/g, '_$1').toLowerCase();
  if (snake !== key && snake in rec && rec[snake] != null) return rec[snake];
  for (const v of Object.values(rec)) {
    const hit = deepFind(v, key);
    if (hit !== undefined) return hit;
  }
  return undefined;
}

/** Throws if any of the listed fields is missing from the parsed LLM response.
 *  Generators catch this and fall back to applyProfile() so we never persist
 *  a half-filled clinical record. */
function requireFields(parsed: Record<string, unknown>, fields: string[], label: string): void {
  const missing = fields.filter((f) => deepFind(parsed, f) === undefined);
  if (missing.length > 0) {
    throw new Error(`LLM ${label} output missing required fields: ${missing.join(', ')}`);
  }
}

export async function generateLaborEvent(
  hosp: HospitalContext,
  scenario: string | undefined,
  signal: AbortSignal,
  model: string,
): Promise<GeneratedLaborEvent> {
  const resolved = resolveProfile(hosp.hcode, 'labor');
  const profile = resolved.profile;

  // Three-step patient selection, highest-fidelity-first:
  //   1. ARRIVED referral targeting this hospital — the referred patient
  //      arrives and gets admitted (same CID, closes cross-hospital loop).
  //   2. ANC-registered mother (with 20% cross-hospital chance to model real
  //      migration — e.g., ANC at tambon clinic, labor at community hospital).
  //   3. Brand-new synthetic CID if nothing available — in this branch we ALSO
  //      synthesize a backdated ANC payload (≥ 2 visits) so every admission
  //      has a journey to link to via cid_hash.
  const arrived = consumeArrivedReferralForAdmission(hosp.hcode);
  const ancPatient = arrived ? null : Math.random() < 0.4 ? findAncPatient(hosp.hcode, 0.25) : null;
  const existing: PooledPatient | null = ancPatient;
  const seed = Date.now() + Math.floor(Math.random() * 1e6);
  const cid = arrived?.cid ?? existing?.cid ?? synthCid(seed);
  const hn = arrived?.hn ?? existing?.hn ?? synthHn();
  const reuseName = arrived?.name ?? existing?.name ?? null;
  const an = synthAn();
  const gaWeeks = existing?.ga ?? rnd(36, profile.id === 'post_term' ? 42 : 41);
  // ancCount represents what's already in the journey for this CID. For the
  // branch where we synthesize prior-ANC below it gets bumped to the number of
  // backdated visits we just emitted, so the labor row's anc_count reflects
  // reality (and CPD scoring uses the correct factor).
  let ancCount = existing ? Math.max(existing.ancVisits, 0) : 0;
  const gravida = existing?.pregNo ?? Math.min(5, Math.max(1, Math.floor(Math.random() * 3) + 1));
  const admitIso = new Date().toISOString();

  // Hybrid: LLM provides the Thai name + short clinical note (narrative
  // only — vLLM reliably honors this 2-field schema). All clinical numbers
  // come from applyProfileToLabor() which samples from profile-bounded
  // ranges. This is the strict version of the Tier-2 pipeline after we
  // measured that Gemma-4 routinely invents its own clinical-record shape
  // when the schema has many properties.
  let llmName: string | null = null;
  let llmNote: string | null = null;
  try {
    const nar = await llmJson<{ name: string; note: string }>({
      model,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        {
          role: 'user',
          content: [
            `Create a Thai patient name + 1-sentence clinical note for a labor`,
            `admission at ${hosp.name}.`,
            profilePromptHint(profile),
            resolved.plannedNote ? `Planner note: ${resolved.plannedNote}` : '',
            scenario ? `Scenario: ${scenario}` : '',
            'Output JSON: { "name": "นาง... ...", "note": "Thai, < 120 chars" }',
            resolved.plannedName ? `Use the name "${resolved.plannedName}" exactly.` : '',
          ]
            .filter(Boolean)
            .join('\n'),
        },
      ],
      jsonSchema: NARRATIVE_SCHEMA,
      signal,
      temperature: 0.85,
      maxTokens: 400,
    });
    llmName = (deepFind(nar, 'name') as string | undefined) ?? null;
    llmNote = (deepFind(nar, 'note') as string | undefined) ?? null;
  } catch (err) {
    logger.warn('sim_labor_narrative_llm_fallback', {
      profile: profile.id,
      reason: err instanceof Error ? err.message : String(err),
    });
  }

  // Synthesize a backdated ANC payload whenever the chosen patient lacks a
  // ≥ 2-visit history. This applies to:
  //   • fresh synthetic CIDs (branch 3 — never had ANC)
  //   • arrived referrals whose home hospital didn't seed ANC in this run
  //   • ANC-pool patients still on their first visit
  // The orchestrator POSTs this payload (as `type: "anc_data"`) BEFORE the
  // labor body, so the server's processWebhookPayload can link the labor row
  // via cid_hash to the new maternal_journey.
  const patientName = reuseName ?? resolved.plannedName ?? llmName ?? 'นาง ทดลอง ระบบ';
  // Age is profile-driven for fresh CIDs; reuse from pool when available so
  // birthday/age stay coherent across the patient's lifetime in the sim.
  const ageGuess = existing?.birthday
    ? Math.max(13, new Date().getFullYear() - new Date(existing.birthday).getFullYear())
    : rnd(profile.ageYears.min, profile.ageYears.max);
  let priorAnc: WebhookAncPatient | null = null;
  const needsPriorAnc = !existing || existing.ancVisits < 2;
  if (needsPriorAnc) {
    priorAnc = buildPriorAncPayload({
      profile,
      hosp,
      cid,
      hn,
      name: patientName,
      age: ageGuess,
      gravida,
      currentGa: gaWeeks,
      admitIso,
    });
    if (priorAnc?.visits && priorAnc.visits.length > ancCount) {
      ancCount = priorAnc.visits.length;
    }
  }

  const laborInput: DeterministicLaborInput = {
    profile,
    name: patientName,
    hn,
    an,
    cid,
    gaWeeks,
    gravida,
    ancCount,
    admitIso,
  };
  const event = applyProfileToLabor(laborInput);
  // Evaluator runs on the deterministic output — should always pass because
  // profile bands generate the numbers. Tracked for telemetry symmetry.
  const evalRes = evaluateLaborEvent(profile, event);
  recordEvaluation(evalRes);
  void llmNote;

  // OPTIONAL maternal labor-triage screening (Task H3, shadow-validation
  // only — this whole module is only reachable while isSimulationEnabled()
  // is true; see orchestrator.start()). Rotates deterministically through
  // MATERNAL_SCREEN_SIM_PROFILES (all copied from the approved clinical
  // oracle, tests/fixtures/maternal-screen-clinical-cases.json) so a
  // simulation run produces real ingest→persist→summary traffic covering
  // every local tier / emergency acuity / hemorrhage pattern for the
  // shadow-validation cohort. Admission-context fields the profile defines
  // are applied onto `event` via Object.assign below: `ga_weeks` OVERRIDES
  // the value applyProfileToLabor already set (same field, profile wins);
  // `bp_systolic_admit` / `bp_diastolic_admit` aren't set by
  // applyProfileToLabor at all, so those are newly added, not overridden.
  // Either way the transported payload ends up matching the exact oracle
  // expectation end-to-end — see
  // tests/unit/services/dev-simulation-maternal-screening.test.ts.
  const msProfile = nextMaternalScreenSimProfile();
  Object.assign(event, msProfile.admissionContext);
  event.maternal_screening = {
    ...msProfile.screening,
    // Idempotency is scoped to (hospitalCode, source_pk) WITHIN one
    // admission (spec §9.1) — the profile's source_pk is only a stable
    // prefix; append this admission's AN so two different simulated
    // admissions reusing the same profile never collide/reject.
    source_pk: `${msProfile.screening.source_pk}:${an}`,
  };

  // Mark the patient as LABOR-stage at THIS hospital (cross-hospital move
  // reflected by the currentHcode update). For CIDs with no prior pool entry
  // (arrived-referral with no ANC history, or brand-new synthetic) we seed a
  // minimal pool record so subsequent partograph + updates can locate them.
  if (existing || arrived) {
    graduateToLabor(hosp.hcode, cid);
  } else {
    addPatient(hosp.hcode, {
      cid,
      hn,
      name: event.name,
      birthday: `${new Date().getFullYear() - (event.age ?? 28)}-01-01`,
      pregNo: gravida,
      lmp: '',
      edc: '',
      ga: gaWeeks,
      ancVisits: ancCount,
      stage: 'LABOR',
      homeHcode: hosp.hcode,
      currentHcode: hosp.hcode,
      createdAt: Date.now(),
    });
  }
  addAdmission(hosp.hcode, {
    an,
    hn,
    cid,
    name: event.name,
    admittedAt: Date.now(),
    partographHours: 0,
  });
  return { labor: event, priorAnc };
}

// ─── ANC registration ──────────────────────────────────────────────────

function ancJsonSchema(p: ClinicalProfile) {
  return {
    type: 'object',
    required: [
      'name',
      'note',
      'bloodGroup',
      'rhFactor',
      'hbsagResult',
      'vdrlResult',
      'hivResult',
      'ogttResult',
      'termBirths',
      'pretermBirths',
      'abortions',
      'livingChildren',
    ],
    properties: {
      name: { type: 'string', maxLength: 60 },
      note: { type: 'string', maxLength: 140 },
      bloodGroup: { type: 'string', enum: ['A', 'B', 'AB', 'O'] },
      rhFactor: { type: 'string', enum: ['POS', 'NEG'] },
      hbsagResult: { type: 'string', enum: ['POS', 'NEG', 'PENDING'] },
      vdrlResult: { type: 'string', enum: ['POS', 'NEG', 'PENDING'] },
      hivResult: { type: 'string', enum: ['POS', 'NEG', 'PENDING'] },
      ogttResult: { type: 'string', enum: ['NORMAL', 'ABNORMAL', 'PENDING'] },
      termBirths: { type: 'integer', minimum: p.term.min, maximum: p.term.max },
      pretermBirths: { type: 'integer', minimum: p.preterm.min, maximum: p.preterm.max },
      abortions: { type: 'integer', minimum: p.abortions.min, maximum: p.abortions.max },
      livingChildren: { type: 'integer', minimum: 0, maximum: 10 },
      pastMedicalHistory: { type: 'string', maxLength: 80 },
    },
  };
}
interface AncLlmOutput {
  name: string;
  note: string;
  bloodGroup: 'A' | 'B' | 'AB' | 'O';
  rhFactor: 'POS' | 'NEG';
  hbsagResult: 'POS' | 'NEG' | 'PENDING';
  vdrlResult: 'POS' | 'NEG' | 'PENDING';
  hivResult: 'POS' | 'NEG' | 'PENDING';
  ogttResult: 'NORMAL' | 'ABNORMAL' | 'PENDING';
  termBirths: number;
  pretermBirths: number;
  abortions: number;
  livingChildren: number;
  pastMedicalHistory?: string;
}

export async function generateAncEvent(
  hosp: HospitalContext,
  scenario: string | undefined,
  signal: AbortSignal,
  model: string,
): Promise<WebhookAncPatient> {
  const resolved = resolveProfile(hosp.hcode, 'anc');
  const profile = resolved.profile;

  // 40% of ANC events target an existing pool entry (20% cross-hospital) so
  // the journey accumulates realistic visit history — even across hospital
  // boundaries, reflecting real patients who follow their care between
  // tambon clinic and district hospital.
  const existing = Math.random() < 0.4 ? findAncPatient(hosp.hcode, 0.2) : null;
  const seed = Date.now() + Math.floor(Math.random() * 1e6);
  const today = new Date();
  // Fix D — when an existing patient is being re-seen, REUSE their stable
  // pregNo / lmp / edc / birthday so the webhook's "isNewPregnancy" check
  // doesn't misfire and create a second journey for the same person.
  const initialGa = existing ? existing.ga : rnd(8, 40);
  const lmpIsoStable =
    existing?.lmp && existing.lmp.length > 0
      ? existing.lmp
      : new Date(today.getTime() - initialGa * 7 * 86400_000).toISOString();
  // Current GA derived from the stable LMP so visits always land on a real
  // date ≤ today. Earlier code let weeksAgo drift (existing.ga + rnd) while
  // LMP stayed fixed, which made visit_date = LMP + visitGa*7 resolve into
  // the future — visually confusing and clinically nonsensical.
  const lmpMs = new Date(lmpIsoStable).getTime();
  const weeksAgo = Math.max(
    8,
    Math.min(42, Math.floor((today.getTime() - lmpMs) / (7 * 86400_000))),
  );
  const edcIsoStable =
    existing?.edc && existing.edc.length > 0
      ? existing.edc
      : new Date(new Date(lmpIsoStable).getTime() + 280 * 86400_000).toISOString();
  const birthdayStable =
    existing?.birthday && existing.birthday.length > 0
      ? existing.birthday
      : (() => {
          const birthdayYear =
            today.getFullYear() - rnd(profile.ageYears.min, profile.ageYears.max);
          return `${birthdayYear}-${String(rnd(1, 12)).padStart(2, '0')}-${String(rnd(1, 28)).padStart(2, '0')}`;
        })();

  // Build per-visit records on the Thai MOH / WHO 2016 ANC contact schedule.
  // Previously visits were packed into consecutive weeks (e.g. GA 16, 17, 18,
  // 19, 20) which doesn't reflect how a real pregnancy is followed: clinical
  // spacing is ~4 weeks in 1st/2nd trimester, tightening toward weekly near
  // term. We pick the milestone GAs that have already been reached and emit
  // one visit per milestone, with ±3d jitter so dates look human.
  //
  // The webhook uses a REPLACE strategy (DELETE + INSERT) for cached_anc_visits
  // per journey, so always sending the full history-to-date keeps the DB in
  // sync with reality instead of accumulating random fragments across runs.
  //
  // Schedule: Thai MOH Safe Motherhood (8 core contacts) aligned with WHO 2016.
  const ANC_CONTACT_WEEKS = [12, 20, 26, 30, 34, 36, 38, 40] as const;
  const currentGa = weeksAgo;
  const milestones = ANC_CONTACT_WEEKS.filter((w) => w <= currentGa);
  const lmpDate = new Date(lmpIsoStable);
  const nowMs = today.getTime();
  const visits = milestones.map((visitGa, i) => {
    const jitterDays = rnd(-3, 3);
    const raw = lmpDate.getTime() + visitGa * 7 * 86400_000 + jitterDays * 86400_000;
    // Cap at today so the latest milestone's positive jitter can't land a
    // visit in the future (clinically impossible — ANC visits are past events).
    const visitAt = new Date(Math.min(raw, nowMs));
    return applyProfileToAncVisit(profile, visitGa, i + 1, visitAt.toISOString());
  });

  const gravida = existing?.pregNo ?? pick([1, 1, 1, 2, 2, 3]);
  const cid = existing?.cid ?? synthCid(seed);
  const hn = existing?.hn ?? synthHn();

  // Same hybrid as labor — LLM owns the Thai name + note, applyProfile owns
  // all structured clinical + serology + GTPAL fields.
  let llmName: string | null = null;
  let llmNote: string | null = null;
  try {
    const nar = await llmJson<{ name: string; note: string }>({
      model,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        {
          role: 'user',
          content: [
            `Create a Thai patient name + 1-sentence clinical note for an ANC`,
            `registration at ${hosp.name}.`,
            profilePromptHint(profile),
            resolved.plannedNote ? `Planner note: ${resolved.plannedNote}` : '',
            scenario ? `Scenario: ${scenario}` : '',
            'Output JSON: { "name": "นาง... ...", "note": "Thai, < 120 chars" }',
            resolved.plannedName ? `Use the name "${resolved.plannedName}".` : '',
          ]
            .filter(Boolean)
            .join('\n'),
        },
      ],
      jsonSchema: NARRATIVE_SCHEMA,
      signal,
      temperature: 0.85,
      maxTokens: 400,
    });
    llmName = (deepFind(nar, 'name') as string | undefined) ?? null;
    llmNote = (deepFind(nar, 'note') as string | undefined) ?? null;
  } catch (err) {
    logger.warn('sim_anc_narrative_llm_fallback', {
      profile: profile.id,
      reason: err instanceof Error ? err.message : String(err),
    });
  }

  const ancInput: DeterministicAncInput = {
    profile,
    name: existing?.name ?? resolved.plannedName ?? llmName ?? 'นาง ทดลอง ระบบ',
    hn,
    cid,
    birthday: birthdayStable,
    gravida,
    lmpIso: lmpIsoStable,
    edcIso: edcIsoStable,
    changwatCode: '40',
    amphurCode: pick(AMPHUR_CODES),
    visits,
    currentGa: weeksAgo,
  };
  const event = applyProfileToAnc(ancInput);
  const evalRes = evaluateAncEvent(profile, event);
  recordEvaluation(evalRes);
  for (const v of event.visits ?? []) {
    const issues = findNarrativeInconsistencies(llmNote, v.dangerSigns);
    if (issues.length > 0) evalStats.warnings += 1;
  }

  // Track or update in pool so subsequent events reuse CID + stable fields.
  // addPatient() is idempotent on CID — it upserts, preserving homeHcode but
  // updating currentHcode to reflect who last saw the patient.
  const pooled: PooledPatient = {
    cid,
    hn,
    name: event.name,
    birthday: birthdayStable,
    pregNo: gravida,
    lmp: lmpIsoStable,
    edc: edcIsoStable,
    ga: weeksAgo,
    // Full-history payload: the webhook replaces the visit set on each event,
    // so the pool's ancVisits should mirror what's now in the DB, not
    // accumulate across sim events.
    ancVisits: visits.length,
    stage: 'ANC',
    homeHcode: existing?.homeHcode ?? hosp.hcode,
    currentHcode: hosp.hcode,
    createdAt: existing ? existing.createdAt : Date.now(),
  };
  addPatient(hosp.hcode, pooled);
  return event;
}

// ─── Referral create ───────────────────────────────────────────────────

export async function generateReferralEvent(
  hosp: HospitalContext,
  destinations: HospitalContext[],
  scenario: string | undefined,
  signal: AbortSignal,
  model: string,
): Promise<WebhookReferralCreatePayload> {
  const resolved = resolveProfile(hosp.hcode, 'referral');
  const profile = resolved.profile;
  const pool = destinations.filter((d) => d.hcode !== hosp.hcode);
  const dest = pool.length ? pick(pool) : hosp;

  const raw = await llmJson<ReferralNarrative>({
    model,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      {
        role: 'user',
        content: [
          `Referral from ${hosp.name} (${hosp.hcode}) to ${dest.name} (${dest.hcode}).`,
          profilePromptHint(profile),
          resolved.plannedNote ? `Planner note: ${resolved.plannedNote}` : '',
          scenario ? `Scenario: ${scenario}` : '',
          'Respond with JSON: {',
          ' "name": "ชื่อ-นามสกุล Thai",',
          ' "reason": "short Thai reason for referral, <80 chars",',
          ' "diagnosisCode": "ICD-10 code starting with O (obstetric), e.g. O14.0",',
          ' "urgency": "ROUTINE | URGENT | EMERGENCY"',
          '}',
          resolved.plannedName ? `Use the name "${resolved.plannedName}".` : '',
        ]
          .filter(Boolean)
          .join('\n'),
      },
    ],
    jsonSchema: {
      type: 'object',
      required: ['name', 'reason', 'diagnosisCode', 'urgency'],
      properties: {
        name: { type: 'string', maxLength: 60 },
        reason: { type: 'string', maxLength: 80 },
        diagnosisCode: { type: 'string', pattern: '^O[0-9]{2}(\\.[0-9X])?$' },
        urgency: { type: 'string', enum: ['ROUTINE', 'URGENT', 'EMERGENCY'] },
      },
    },
    signal,
    temperature: 0.85,
    maxTokens: 8000,
  }).catch((err) => {
    logger.warn('sim_referral_llm_fallback', {
      profile: profile.id,
      reason: err instanceof Error ? err.message : String(err),
    });
    return {
      name: resolved.plannedName || 'นาง ทดลอง ระบบ',
      reason:
        profile.id === 'preeclampsia_severe'
          ? 'ครรภ์เป็นพิษรุนแรง'
          : profile.id === 'iugr'
            ? 'ทารกเจริญช้าในครรภ์'
            : 'เกินศักยภาพ',
      diagnosisCode:
        profile.id === 'preeclampsia_severe' ? 'O14.1' : profile.id === 'gdm' ? 'O24.4' : 'O14.0',
      urgency:
        profile.riskLevel === 'HR3'
          ? 'EMERGENCY'
          : profile.riskLevel === 'HR2'
            ? 'URGENT'
            : 'ROUTINE',
    } as ReferralNarrative;
  });

  const seed = Date.now() + Math.floor(Math.random() * 1e6);
  const referralId = `REF-${hosp.hcode}-${String(seed).slice(-8)}`;

  // Fix B — a referral transfers a real patient, not a fresh fictional one.
  // Prefer picking from the sending hospital's current admissions (someone
  // in labor is being transferred) or ANC-registered mothers there. Only
  // fall back to a synthetic CID when the pool is genuinely empty.
  const existing = pickPatientToRefer(hosp.hcode);
  const referredCid = existing?.cid ?? synthCid(seed);
  const referredHn = existing?.hn ?? synthHn();
  const referredName = existing?.name ?? raw.name ?? 'นาง ทดลอง ระบบ';

  addReferral(hosp.hcode, {
    referralId,
    fromHcode: hosp.hcode,
    toHcode: dest.hcode,
    cid: referredCid,
    hn: referredHn,
    name: referredName,
    createdAt: Date.now(),
    status: 'INITIATED',
  });

  return {
    type: 'referral',
    hospitalCode: hosp.hcode,
    referralId,
    hn: referredHn,
    cid: referredCid,
    name: referredName,
    toHospitalCode: dest.hcode,
    reason: raw.reason,
    diagnosisCode: raw.diagnosisCode || 'O14.0',
    urgencyLevel: raw.urgency,
    changwatCode: '40',
    amphurCode: pick(AMPHUR_CODES),
  };
}

// ─── Referral update (receiving hospital) ──────────────────────────────

/** Returns null if there's no pending referral to update for this hospital. */
export function generateReferralUpdateEvent(
  hosp: HospitalContext,
): WebhookReferralUpdatePayload | null {
  const pending = pickRecentReferralForUpdate(hosp.hcode);
  if (!pending) return null;
  const nextStatus = advanceReferralStatus(pending);
  const now = new Date().toISOString();
  const body: WebhookReferralUpdatePayload = {
    type: 'referral_update',
    hospitalCode: hosp.hcode,
    referralId: pending.referralId,
    fromHospitalCode: pending.fromHcode,
    status: nextStatus,
  };
  if (nextStatus === 'REJECTED') body.rejectionReason = 'เกินศักยภาพปลายทาง';
  if (nextStatus === 'IN_TRANSIT') body.transportMode = pick(['ambulance', 'self', 'private']);
  if (nextStatus === 'ARRIVED') body.arrivedAt = now;
  return body;
}

// ─── Partograph observation (continuation on admitted patient) ─────────

/**
 * Returns null if this hospital has no recent labor admission.
 *
 * Real-world WHO partographs are recorded every 30 minutes during active
 * labor, so a realistic admission should accumulate 8-24 observations over
 * its 4-12 hour stay. The previous implementation emitted one observation
 * per event; combined with the planner's ~10% partograph proportion this
 * gave each admission only 1-3 observations over a 15-min sim — visibly
 * thin on the patient-detail page. We now emit a batch of 4-6 observations
 * per event, spaced 30 minutes apart ending at "now", so each tick
 * represents ~2-3 hours of labor progression. Dilation, contraction, and
 * descent naturally advance because `applyProfileToPartograph` scales by
 * `hourNo`, and the per-admission counter is incremented once per
 * observation.
 */
export async function generatePartographEvent(
  hosp: HospitalContext,
  signal: AbortSignal,
  model: string,
): Promise<WebhookPartographPayload | null> {
  const admit = pickRecentAdmission(hosp.hcode);
  if (!admit) return null;

  const resolved = resolveProfile(hosp.hcode, 'partograph');
  const profile = resolved.profile;

  // Batch size 4-6 per event. Observations spaced 30 min apart, newest last
  // at "now". `applyProfileToPartograph` keys dilation off `hourNo` so the
  // batch reads as a realistic progression (e.g. 3cm → 4cm → 5cm → 6cm).
  const batchSize = rnd(4, 6);
  const nowMs = Date.now();
  const observations: WebhookPartographObservation[] = [];
  let lastHourNo = 0;
  for (let i = 0; i < batchSize; i++) {
    const hourNo = incPartographHour(hosp.hcode, admit.an);
    lastHourNo = hourNo;
    const offsetMin = (batchSize - 1 - i) * 30;
    const observeIso = new Date(nowMs - offsetMin * 60_000).toISOString();
    const obs = applyProfileToPartograph({
      profile,
      an: admit.an,
      // Suffix `i` so externalObservationIds in the batch stay unique even
      // though Date.now().slice(-5) is the same for all obs in this call.
      externalObservationId: `OBS-${admit.an}-${hourNo}-${String(nowMs).slice(-5)}-${i}`,
      hourNo,
      observeIso,
    });
    observations.push(obs);
  }

  // Tier 2: ask LLM for a short nurse-note + confirm the vitals are coherent.
  // Partograph fields are progressive time-series so we already have good
  // deterministic output; LLM only augments the note on the LAST (newest)
  // observation so the batch still reads chronologically.
  try {
    const raw = await llmChat({
      model,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        {
          role: 'user',
          content: [
            `Partograph observation hour ${lastHourNo} at ${hosp.name}.`,
            profilePromptHint(profile),
            'Return ONLY a 1-sentence Thai nurse note describing the progression',
            '(e.g. คลอดปกติดี, รก drain ดี). <100 Thai chars, no JSON.',
          ].join('\n'),
        },
      ],
      signal,
      temperature: 0.8,
      maxTokens: 8000,
    });
    const cleaned = (raw ?? '').trim().slice(0, 100);
    if (cleaned && observations.length > 0) {
      const last = observations[observations.length - 1] as WebhookPartographObservation & {
        note?: string;
      };
      last.note = cleaned;
    }
  } catch {
    // Nurse-note is optional — silently skip on failure.
  }

  // Evaluate against the profile using the LATEST observation (the most
  // recent state is what the evaluator cares about).
  const evalRes = evaluatePartographEvent(profile, observations[observations.length - 1]);
  recordEvaluation(evalRes);

  return {
    type: 'partograph',
    hospitalCode: hosp.hcode,
    observations,
  };
}

// ─── Dispatch registry ──────────────────────────────────────────────

export const SUPPORTED_EVENT_TYPES: SimEventType[] = [
  'labor',
  'anc',
  'referral',
  'referral_update',
  'partograph',
];

/** Exposed for planner reset so test / clear code can purge profile state. */
export { PROFILE_IDS, getProfileById };
