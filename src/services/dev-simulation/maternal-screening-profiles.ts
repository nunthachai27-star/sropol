// Maternal labor-triage screening profiles for the dev-mode simulator
// (Phase 6 Task H3, docs/superpowers/plans/2026-07-17-maternal-screening-hosxp.md).
//
// STATUS: dev-only, shadow-validation aid. Reachable exclusively through the
// dev-simulation subsystem, which is itself gated end-to-end by
// `isSimulationEnabled()` (NODE_ENV-guarded — see src/lib/feature-flags.ts).
// Nothing here has any production reach.
//
// PURPOSE: the real sender for `maternal_screening` is the Pascal HOSxP unit
// (docs/hosxp/KKLRMSWebhookUnit.pas, Task H2) — it cannot run in this repo.
// These profiles are the EXECUTABLE stand-in: they let a simulated labor
// admission carry the exact same snake_case transport object a real hospital
// would send, so the shadow-validation cohort has real ingest→persist→
// summary traffic to review before any clinical sign-off.
//
// GC (no fabrication): every clinical value below is copied verbatim from a
// NAMED case in the approved 66-case clinical oracle,
// tests/fixtures/maternal-screen-clinical-cases.json — see `oracleCase` /
// `oracleInput` on each profile. `oracleInput` is the ONLY place a clinical
// value is typed in; `screening` (the wire object) and `admissionContext`
// (the sibling ga_weeks/ga_day/bp_*_admit fields on the labor payload, per
// spec §9.1 — NOT part of the screening sub-object) are DERIVED from it
// mechanically by `deriveTransportFromOracleInput()` below, using the same
// camelCase→snake_case field maps the server itself validates against
// (`MS_BOOLEAN_FIELD_MAP` / `MS_NUMERIC_FIELD_MAP` /
// `MATERNAL_SCREEN_ENUM_VALUES`, all re-exported from src/services/webhook.ts
// for this purpose) — so the mapping can never silently drift from the
// frozen transport contract (GC-H2).
//
// tests/unit/services/dev-simulation-maternal-screening.test.ts proves, via
// the REAL ingest path (processWebhookPayload on a PGlite DB), that a
// representative subset of these profiles round-trip to the exact
// localTier/emergencyAcuity the oracle case declares.

import {
  MS_BOOLEAN_FIELD_MAP,
  MS_NUMERIC_FIELD_MAP,
  type WebhookMaternalScreeningPayload,
  type WebhookPatientPayload,
} from '@/services/webhook';
import type { MaternalScreenInput } from '@/types/maternal-screening';

// ─── camelCase (oracle / MaternalScreenInput) → snake_case (wire) maps ────
//
// The boolean + numeric maps are INVERTED from webhook.ts's own
// snake→camel maps (single source of truth — never hand-duplicated). Only
// the enum-ish scalar fields (which webhook.ts keys by their snake_case
// transport name already) and the four admission-context fields (which
// live on the labor payload, not inside `maternal_screening` at all — spec
// §9.1) need a small local table.

function invertToSnakeCase(
  snakeToCamel: Readonly<Record<string, string>>,
): Readonly<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const [snake, camel] of Object.entries(snakeToCamel)) {
    out[camel] = snake;
  }
  return out;
}

const CAMEL_TO_SNAKE_BOOL = invertToSnakeCase(MS_BOOLEAN_FIELD_MAP);
const CAMEL_TO_SNAKE_NUMERIC = invertToSnakeCase(MS_NUMERIC_FIELD_MAP);

/** proteinuria_grade + the four true enum fields — transport key is spelled
 *  out here because, unlike the bool/numeric maps, webhook.ts keys
 *  `MATERNAL_SCREEN_ENUM_VALUES` by the snake_case name directly (there is
 *  no camel→snake map to invert for these). */
const ENUM_CAMEL_TO_SNAKE: Readonly<Partial<Record<keyof MaternalScreenInput, string>>> = {
  proteinuriaGrade: 'proteinuria_grade',
  headache: 'headache',
  bleedingRate: 'bleeding_rate',
  fetalTracingPattern: 'fetal_tracing_pattern',
  consciousness: 'consciousness',
  placentaLocationSource: 'placenta_location_source',
};

/** Admission BP / GA are NOT part of the `maternal_screening` transport
 *  object — spec §9.1 reuses them from the SAME labor payload's
 *  `ga_weeks` / `ga_day` / `bp_systolic_admit` / `bp_diastolic_admit`. An
 *  oracle case that assesses these fields therefore maps onto the labor
 *  payload, never onto `screening`. */
const ADMISSION_CONTEXT_CAMEL_TO_SNAKE: Readonly<
  Partial<Record<keyof MaternalScreenInput, keyof WebhookPatientPayload>>
> = {
  gaWeeks: 'ga_weeks',
  gaDays: 'ga_day',
  systolicBp: 'bp_systolic_admit',
  diastolicBp: 'bp_diastolic_admit',
};

export interface MaternalScreenTransportDerivation {
  /** `maternal_screening` sub-object fields EXCLUDING the plumbing keys
   *  (`source_pk`/`assessed_at`/`assessed_by`), which the profile assembly
   *  step below adds — those are transport metadata, not clinical values,
   *  so they don't need to trace to an oracle case. */
  screening: Omit<WebhookMaternalScreeningPayload, 'source_pk' | 'assessed_at' | 'assessed_by'>;
  /** Sibling labor-payload fields (never inside `screening`). */
  admissionContext: Pick<
    WebhookPatientPayload,
    'ga_weeks' | 'ga_day' | 'bp_systolic_admit' | 'bp_diastolic_admit'
  >;
}

/**
 * Mechanically converts a (partial) oracle case `input` — camelCase,
 * `MaternalScreenInput`-shaped — into the snake_case wire shapes the real
 * sender emits. Throws at module load if a field has no known mapping
 * (fail fast rather than silently drop a copied clinical value).
 */
export function deriveTransportFromOracleInput(
  oracleInput: Partial<MaternalScreenInput>,
): MaternalScreenTransportDerivation {
  const screening: Record<string, unknown> = {};
  const admissionContext: Record<string, unknown> = {};

  for (const [camelKey, rawValue] of Object.entries(oracleInput)) {
    if (rawValue === undefined) continue;

    if (camelKey in ADMISSION_CONTEXT_CAMEL_TO_SNAKE) {
      const snakeKey = ADMISSION_CONTEXT_CAMEL_TO_SNAKE[camelKey as keyof MaternalScreenInput]!;
      admissionContext[snakeKey] = rawValue;
      continue;
    }
    if (camelKey in CAMEL_TO_SNAKE_BOOL) {
      screening[CAMEL_TO_SNAKE_BOOL[camelKey]] = rawValue;
      continue;
    }
    if (camelKey in CAMEL_TO_SNAKE_NUMERIC) {
      screening[CAMEL_TO_SNAKE_NUMERIC[camelKey]] = rawValue;
      continue;
    }
    if (camelKey in ENUM_CAMEL_TO_SNAKE) {
      const snakeKey = ENUM_CAMEL_TO_SNAKE[camelKey as keyof MaternalScreenInput]!;
      screening[snakeKey] = rawValue;
      continue;
    }

    throw new Error(
      `deriveTransportFromOracleInput: oracle field "${camelKey}" has no known camelCase→snake_case ` +
        'mapping (checked MS_BOOLEAN_FIELD_MAP / MS_NUMERIC_FIELD_MAP from src/services/webhook.ts, ' +
        "this file's ENUM_CAMEL_TO_SNAKE, and ADMISSION_CONTEXT_CAMEL_TO_SNAKE) — add it there before " +
        'referencing it in a maternal-screening sim profile.',
    );
  }

  return {
    screening: screening as MaternalScreenTransportDerivation['screening'],
    admissionContext: admissionContext as MaternalScreenTransportDerivation['admissionContext'],
  };
}

// ─── Profile catalog ──────────────────────────────────────────────────────

interface MaternalScreenSimProfileDef {
  /** Short slug used in logs/tests — not a clinical value. */
  name: string;
  /** Exact case `name` from tests/fixtures/maternal-screen-clinical-cases.json
   *  — verified to exist by a paired programmatic test. */
  oracleCase: string;
  /** Verbatim copy of that case's `input` (see GC header above). */
  oracleInput: Partial<MaternalScreenInput>;
  /** Stable per-profile idempotency-key prefix; the wiring step (generators.ts)
   *  appends the simulated admission's AN so replays stay scoped to ONE
   *  admission (spec §9.1 idempotency — reusing a source_pk across two
   *  different admissions is a sender error). */
  sourcePk: string;
}

// Covers, by exact task requirement: one of each local tier (MILD/MODERATE/
// SEVERE), the GA≥26 antepartum-hemorrhage threshold, concealed abruptio,
// uterine rupture, vasa previa, EMERGENCY-by-shock, URGENT-by-tachycardia,
// and the fully-unassessed UNKNOWN/incomplete baseline.
const PROFILE_DEFS: readonly MaternalScreenSimProfileDef[] = [
  {
    name: 'local-mild-proteinuria-1plus',
    oracleCase: 'proteinuria ONE_PLUS alone is local mild',
    oracleInput: { proteinuriaGrade: 'ONE_PLUS' },
    sourcePk: 'SIM-MS-LOCAL-MILD-PROTEINURIA',
  },
  {
    name: 'local-moderate-headache-mild',
    oracleCase: 'mild (tolerable) headache alone is local moderate (PDF moderate clinical cell)',
    oracleInput: { headache: 'MILD' },
    sourcePk: 'SIM-MS-LOCAL-MODERATE-HEADACHE',
  },
  {
    name: 'local-severe-sbp-160',
    oracleCase: 'SBP 160 alone is local severe',
    oracleInput: { systolicBp: 160 },
    sourcePk: 'SIM-MS-LOCAL-SEVERE-SBP160',
  },
  {
    name: 'severe-aph-ga26-bleeding',
    oracleCase: 'bleeding at GA 26+0 meets local APH threshold and previa pattern also fires',
    oracleInput: { gaWeeks: 26, gaDays: 0, vaginalBleeding: true },
    sourcePk: 'SIM-MS-APH-GA26-BLEEDING',
  },
  {
    name: 'concealed-abruptio',
    oracleCase: 'concealed abruption with no visible vaginal bleeding still flags the pattern',
    oracleInput: {
      vaginalBleeding: false,
      concealedBleedingSuspected: true,
      uterineTenderness: true,
    },
    sourcePk: 'SIM-MS-CONCEALED-ABRUPTIO',
  },
  {
    name: 'uterine-rupture-pattern',
    oracleCase: 'suspected uterine rupture from intra-abdominal signs with no vaginal bleeding',
    oracleInput: { vaginalBleeding: false, suprapubicTenderness: true, bandlsRing: true },
    sourcePk: 'SIM-MS-UTERINE-RUPTURE',
  },
  {
    name: 'vasa-previa-pattern',
    oracleCase:
      'vasa-previa-compatible bleeding with ruptured membranes and sinusoidal tracing (also flags abruptio and previa patterns by conservative design)',
    oracleInput: {
      vaginalBleeding: true,
      membranesRuptured: true,
      fetalTracingPattern: 'SINUSOIDAL',
    },
    sourcePk: 'SIM-MS-VASA-PREVIA',
  },
  {
    name: 'emergency-shock-signs',
    oracleCase: 'normal FHR does not downgrade maternal instability from shock signs',
    oracleInput: {
      shockSignsPresent: true,
      fetalHeartRateBpm: 140,
      fetalTracingPattern: 'REASSURING',
    },
    sourcePk: 'SIM-MS-EMERGENCY-SHOCK',
  },
  {
    name: 'urgent-maternal-tachycardia',
    oracleCase: 'maternal pulse 121 alone is urgent acuity',
    oracleInput: { maternalPulseBpm: 121 },
    sourcePk: 'SIM-MS-URGENT-PULSE121',
  },
  {
    name: 'all-unknown-incomplete',
    oracleCase: 'all-unknown input never yields a normal/stable result',
    oracleInput: {},
    sourcePk: 'SIM-MS-ALL-UNKNOWN',
  },
];

export interface MaternalScreenSimProfile {
  name: string;
  oracleCase: string;
  oracleInput: Partial<MaternalScreenInput>;
  /** Full `maternal_screening` wire object (source_pk here is a stable
   *  per-profile PREFIX — see PROFILE_DEFS.sourcePk — the wiring step in
   *  generators.ts appends the admission's AN before sending). */
  screening: WebhookMaternalScreeningPayload;
  admissionContext: Pick<
    WebhookPatientPayload,
    'ga_weeks' | 'ga_day' | 'bp_systolic_admit' | 'bp_diastolic_admit'
  >;
}

// Fixed, deterministic anchor — NOT Date.now(). The dev-simulation subsystem
// has no injectable clock convention (generateLaborEvent's own admit_date is
// a plain `new Date().toISOString()` call at generation time); per H3's
// scope note, profile-level `assessed_at` is therefore a fixed ISO string
// rather than threading a clock through this module. A fixed PAST timestamp
// is always transport-valid (the server only bounds `assessed_at` in the
// FUTURE direction — spec §9.2 / MATERNAL_SCREEN_ASSESSED_AT_MAX_FUTURE_MS).
const SIM_ASSESSED_AT_ANCHOR_MS = Date.parse('2026-07-17T06:00:00+07:00');

export const MATERNAL_SCREEN_SIM_PROFILES: readonly MaternalScreenSimProfile[] = PROFILE_DEFS.map(
  (def, index) => {
    const { screening, admissionContext } = deriveTransportFromOracleInput(def.oracleInput);
    return {
      name: def.name,
      oracleCase: def.oracleCase,
      oracleInput: def.oracleInput,
      admissionContext,
      screening: {
        ...screening,
        source_pk: def.sourcePk,
        // One minute apart per profile — deterministic, never colliding,
        // never Date.now().
        assessed_at: new Date(SIM_ASSESSED_AT_ANCHOR_MS + index * 60_000).toISOString(),
        assessed_by: 'SIM',
      },
    };
  },
);

// ─── Deterministic rotation (wiring helper for generators.ts) ─────────────
//
// Mirrors the subsystem's existing telemetry-counter style (evalStats in
// generators.ts): a small module-level counter with a paired reset, rather
// than threading state through every call site.

let rotationIndex = 0;

/** Returns the next profile in a stable round-robin so a simulation run
 *  exercises every oracle-backed clinical picture roughly evenly. */
export function nextMaternalScreenSimProfile(): MaternalScreenSimProfile {
  const profile = MATERNAL_SCREEN_SIM_PROFILES[rotationIndex % MATERNAL_SCREEN_SIM_PROFILES.length];
  rotationIndex += 1;
  return profile;
}

export function resetMaternalScreenSimRotation(): void {
  rotationIndex = 0;
}
