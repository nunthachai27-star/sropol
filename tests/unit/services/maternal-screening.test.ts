// Table-driven oracle + boundary + Global-Constraint tests for the pure
// maternal-screening rule engine (src/services/maternal-screening.ts, Task 3).
//
// The 66-case fixture tests/fixtures/maternal-screen-clinical-cases.json is the
// clinical ORACLE (64 clinical cases + 2 "P0-GAP" cases that deliberately PIN
// current provisional behavior awaiting Phase 0 sign-off — see
// docs/clinical/maternal-screen-acuity-v1.yaml decisions
// T1-VOICE-MODERATE-STABLE / T1-BLEEDINGRATE-NONE): for every case the engine
// must reproduce localTier,
// emergencyAcuity, isComplete, suspectedConditions, matchedRuleIds, and
// missingRequiredFields. Set-valued expectations (suspected/matched/missing)
// are compared order-insensitively.
//
// Plus explicit §12.1 boundary assertions and the binding Global Constraints:
//   GC1 — all-unknown input ⇒ NO_LOCAL_MATCH / UNKNOWN / isComplete:false,
//         never a normal/stable result; missing data never fabricates STABLE.
//   GC4 — concealed abruption flags without visible bleeding; a normal FHR/BP
//         never downgrades a proven instability.

import { describe, it, expect } from 'vitest';
import clinicalCases from '../../fixtures/maternal-screen-clinical-cases.json';
import { evaluateMaternalScreen, normalizeProteinuriaGrade } from '@/services/maternal-screening';
import type { MaternalScreenInput, ProteinuriaGrade } from '@/types/maternal-screening';

const EVALUATED_AT = '2026-07-16T00:00:00.000Z';

/**
 * A fully-unassessed baseline input. Each fixture case supplies a PARTIAL
 * input; we merge it over this base so the engine always receives a complete
 * `MaternalScreenInput` (mirrors the config test's `baseInput`).
 */
const baseInput: MaternalScreenInput = {
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
  return { ...baseInput, ...partial };
}

interface OracleCase {
  name: string;
  input: Partial<MaternalScreenInput>;
  expect: {
    localTier: string;
    emergencyAcuity: string;
    isComplete: boolean;
    suspectedConditions: string[];
    matchedRuleIds: string[];
    missingRequiredFields: string[];
  };
}

const cases = clinicalCases as unknown as OracleCase[];

describe('evaluateMaternalScreen — clinical oracle (fixture-driven)', () => {
  it('fixture has the full 66-case oracle set (64 clinical + 2 pinned P0-GAP cases)', () => {
    expect(cases).toHaveLength(66);
  });

  it.each(cases.map((c) => [c.name, c] as const))('%s', (_name, testCase) => {
    const result = evaluateMaternalScreen(makeInput(testCase.input), EVALUATED_AT);
    const expected = testCase.expect;

    // Scalar axes — exact.
    expect(result.localTier).toBe(expected.localTier);
    expect(result.emergencyAcuity).toBe(expected.emergencyAcuity);
    expect(result.isComplete).toBe(expected.isComplete);

    // Set-valued axes — order-insensitive.
    expect(new Set(result.suspectedConditions)).toEqual(new Set(expected.suspectedConditions));
    expect(new Set(result.matches.map((m) => m.ruleId))).toEqual(new Set(expected.matchedRuleIds));
    expect(new Set(result.missingRequiredFields)).toEqual(new Set(expected.missingRequiredFields));

    // Cardinality guards — a Set comparison alone would mask duplicates.
    expect(result.suspectedConditions).toHaveLength(new Set(expected.suspectedConditions).size);
    expect(result.matches).toHaveLength(expected.matchedRuleIds.length);
    expect(result.missingRequiredFields).toHaveLength(expected.missingRequiredFields.length);

    // Provenance is always stamped.
    expect(result.ruleSetVersion).toBe('0.1.0-provisional');
    expect(result.evaluatedAt).toBe(EVALUATED_AT);
  });
});

describe('evaluateMaternalScreen — §12.1 boundary thresholds', () => {
  const only = (partial: Partial<MaternalScreenInput>) =>
    evaluateMaternalScreen(makeInput(partial), EVALUATED_AT);

  it('SBP mild boundary: 139 no match, 140 mild', () => {
    expect(only({ systolicBp: 139 }).localTier).toBe('NO_LOCAL_MATCH');
    expect(only({ systolicBp: 140 }).localTier).toBe('LOCAL_MILD');
  });

  it('SBP moderate boundary: 149 mild, 150 moderate', () => {
    expect(only({ systolicBp: 149 }).localTier).toBe('LOCAL_MILD');
    expect(only({ systolicBp: 150 }).localTier).toBe('LOCAL_MODERATE');
  });

  it('SBP severe boundary: 159 moderate, 160 severe', () => {
    expect(only({ systolicBp: 159 }).localTier).toBe('LOCAL_MODERATE');
    expect(only({ systolicBp: 160 }).localTier).toBe('LOCAL_SEVERE');
  });

  it('DBP boundaries: 89 none, 90 mild, 99 mild, 100 moderate, 109 moderate, 110 severe', () => {
    expect(only({ diastolicBp: 89 }).localTier).toBe('NO_LOCAL_MATCH');
    expect(only({ diastolicBp: 90 }).localTier).toBe('LOCAL_MILD');
    expect(only({ diastolicBp: 99 }).localTier).toBe('LOCAL_MILD');
    expect(only({ diastolicBp: 100 }).localTier).toBe('LOCAL_MODERATE');
    expect(only({ diastolicBp: 109 }).localTier).toBe('LOCAL_MODERATE');
    expect(only({ diastolicBp: 110 }).localTier).toBe('LOCAL_SEVERE');
  });

  it('creatinine is strictly greater than 1.1: 1.10 no match, 1.11 severe', () => {
    expect(only({ creatinineMgDl: 1.1 }).localTier).toBe('NO_LOCAL_MATCH');
    expect(only({ creatinineMgDl: 1.11 }).localTier).toBe('LOCAL_SEVERE');
  });

  it('platelets strictly less than 100000: 100000 no match, 99999 severe', () => {
    expect(only({ plateletPerUl: 100000 }).localTier).toBe('NO_LOCAL_MATCH');
    expect(only({ plateletPerUl: 99999 }).localTier).toBe('LOCAL_SEVERE');
  });

  it('FHR normal band inclusive 110-160 (with bleeding present): 109/161 add abruptio, 110/160 do not', () => {
    const withBleeding = (fhr: number) =>
      only({ vaginalBleeding: true, fetalHeartRateBpm: fhr }).suspectedConditions;
    expect(withBleeding(109)).toContain('ABRUPTIO_PLACENTAE');
    expect(withBleeding(110)).not.toContain('ABRUPTIO_PLACENTAE');
    expect(withBleeding(160)).not.toContain('ABRUPTIO_PLACENTAE');
    expect(withBleeding(161)).toContain('ABRUPTIO_PLACENTAE');
  });

  it('local APH threshold GA>=26 + bleeding: 25+6 no APH rule, 26+0 fires APH-GA26', () => {
    const below = only({ gaWeeks: 25, gaDays: 6, vaginalBleeding: true });
    const at = only({ gaWeeks: 26, gaDays: 0, vaginalBleeding: true });
    expect(below.suspectedConditions).not.toContain('ANTEPARTUM_HEMORRHAGE');
    expect(at.suspectedConditions).toContain('ANTEPARTUM_HEMORRHAGE');
    // Below-threshold bleeding is never downgraded away from LOCAL_SEVERE
    // (previa pattern still fires) — GC4.
    expect(below.localTier).toBe('LOCAL_SEVERE');
  });

  it('proteinuria overlap resolves to severe: ONE_PLUS mild, TWO_PLUS severe', () => {
    expect(only({ proteinuriaGrade: 'ONE_PLUS' }).localTier).toBe('LOCAL_MILD');
    expect(only({ proteinuriaGrade: 'TWO_PLUS' }).localTier).toBe('LOCAL_SEVERE');
  });

  it('emergency-acuity numeric boundaries: SpO2 95 unknown / 94 urgent; pulse 120 unknown / 121 urgent', () => {
    expect(only({ oxygenSaturationPct: 95 }).emergencyAcuity).toBe('UNKNOWN');
    expect(only({ oxygenSaturationPct: 94 }).emergencyAcuity).toBe('URGENT');
    expect(only({ maternalPulseBpm: 120 }).emergencyAcuity).toBe('UNKNOWN');
    expect(only({ maternalPulseBpm: 121 }).emergencyAcuity).toBe('URGENT');
  });
});

describe('evaluateMaternalScreen — Global Constraints', () => {
  it('GC1: all-unknown input is NO_LOCAL_MATCH / UNKNOWN / incomplete — never normal/stable', () => {
    const result = evaluateMaternalScreen({ ...baseInput }, EVALUATED_AT);
    expect(result.localTier).toBe('NO_LOCAL_MATCH');
    expect(result.emergencyAcuity).toBe('UNKNOWN');
    expect(result.emergencyAcuity).not.toBe('STABLE');
    expect(result.isComplete).toBe(false);
    expect(result.suspectedConditions).toEqual([]);
    expect(result.matches).toEqual([]);
    expect(result.missingRequiredFields).toHaveLength(11);
  });

  it('GC1: STABLE requires every stability field assessed; a single missing acuity field ⇒ UNKNOWN', () => {
    const allSix = {
      shockSignsPresent: false,
      consciousness: 'ALERT' as const,
      oxygenSaturationPct: 98,
      maternalPulseBpm: 80,
      bleedingRate: 'SPOTTING' as const,
      fetalTracingPattern: 'REASSURING' as const,
    };
    expect(evaluateMaternalScreen(makeInput(allSix), EVALUATED_AT).emergencyAcuity).toBe('STABLE');
    // Drop one stability field back to unassessed → UNKNOWN, not STABLE.
    expect(
      evaluateMaternalScreen(makeInput({ ...allSix, bleedingRate: 'UNKNOWN' }), EVALUATED_AT)
        .emergencyAcuity,
    ).toBe('UNKNOWN');
  });

  it('GC1: isComplete is orthogonal to severity — a proven LOCAL_SEVERE coexists with isComplete:false', () => {
    const result = evaluateMaternalScreen(makeInput({ plateletPerUl: 50000 }), EVALUATED_AT);
    expect(result.localTier).toBe('LOCAL_SEVERE');
    expect(result.isComplete).toBe(false);
    expect(result.missingRequiredFields.length).toBeGreaterThan(0);
  });

  it('GC4: concealed abruption flags without any visible vaginal bleeding', () => {
    const result = evaluateMaternalScreen(
      makeInput({
        vaginalBleeding: false,
        concealedBleedingSuspected: true,
        uterineTenderness: true,
      }),
      EVALUATED_AT,
    );
    expect(result.localTier).toBe('LOCAL_SEVERE');
    expect(result.suspectedConditions).toContain('ABRUPTIO_PLACENTAE');
    expect(result.matches.map((m) => m.ruleId)).toContain('APH-ABRUPTIO-PATTERN');
  });

  it('GC4: a normal FHR does not lower a proven EMERGENCY acuity from shock signs', () => {
    const result = evaluateMaternalScreen(
      makeInput({
        shockSignsPresent: true,
        fetalHeartRateBpm: 140,
        fetalTracingPattern: 'REASSURING',
      }),
      EVALUATED_AT,
    );
    expect(result.emergencyAcuity).toBe('EMERGENCY');
  });

  it('GC4: contradictory heavy bleeding with vaginalBleeding:false still escalates to EMERGENCY (concealed-safety)', () => {
    const result = evaluateMaternalScreen(
      makeInput({ vaginalBleeding: false, bleedingRate: 'HEAVY' }),
      EVALUATED_AT,
    );
    expect(result.emergencyAcuity).toBe('EMERGENCY');
  });

  it('GC4: highest-rank acuity wins — EMERGENCY (sinusoidal) beats URGENT (pulse)', () => {
    const result = evaluateMaternalScreen(
      makeInput({ maternalPulseBpm: 130, fetalTracingPattern: 'SINUSOIDAL' }),
      EVALUATED_AT,
    );
    expect(result.emergencyAcuity).toBe('EMERGENCY');
    expect(result.matches.map((m) => m.ruleId)).toEqual(
      expect.arrayContaining(['EA-FETAL-SINUSOIDAL-EMERGENCY', 'EA-PULSE-HIGH-URGENT']),
    );
  });

  it('determinism: same input + evaluatedAt yields an identical result', () => {
    const input = makeInput({ systolicBp: 165, headache: 'SEVERE', vaginalBleeding: true });
    const a = evaluateMaternalScreen(input, EVALUATED_AT);
    const b = evaluateMaternalScreen(input, EVALUATED_AT);
    expect(a).toEqual(b);
  });

  it('matches carry evidence assembled from the fields the rule read', () => {
    const result = evaluateMaternalScreen(makeInput({ systolicBp: 160 }), EVALUATED_AT);
    const severe = result.matches.find((m) => m.ruleId === 'PE-BP-SEVERE-SBP-160');
    expect(severe).toBeDefined();
    expect(severe?.evidence).toEqual([{ field: 'systolicBp', value: 160 }]);
  });

  it('GC1: a numeric NaN (e.g. from Number("n/a")) counts as unassessed, never a normal value', () => {
    // Fully-assessed-normal EXCEPT oxygenSaturationPct is NaN (garbage upstream
    // parse). NaN must not read as assessed-normal: the field is both a
    // stability-determination field (=> acuity must NOT be STABLE) and a
    // mandatory field is unaffected here, so we also assert a NaN in a MANDATORY
    // numeric field forces isComplete:false.
    const stableExceptNaNSpo2 = evaluateMaternalScreen(
      makeInput({
        shockSignsPresent: false,
        consciousness: 'ALERT',
        oxygenSaturationPct: Number('n/a'), // NaN
        maternalPulseBpm: 80,
        bleedingRate: 'SPOTTING',
        fetalTracingPattern: 'REASSURING',
      }),
      EVALUATED_AT,
    );
    // No acuity rule fires on NaN SpO2 (NaN < 95 is false), and STABLE is
    // withheld because a stability field is unassessed → UNKNOWN, not STABLE.
    expect(stableExceptNaNSpo2.emergencyAcuity).not.toBe('STABLE');
    expect(stableExceptNaNSpo2.emergencyAcuity).toBe('UNKNOWN');

    // A NaN in a MANDATORY numeric field makes the screen incomplete: NaN
    // behaves like missing, so the field is reported in missingRequiredFields.
    const otherwiseComplete = evaluateMaternalScreen(
      makeInput({
        gaWeeks: 30,
        gaDays: 0,
        systolicBp: 110,
        diastolicBp: 70,
        proteinuriaGrade: 'NEGATIVE',
        headache: 'NONE',
        vaginalBleeding: false,
        fetalHeartRateBpm: Number('garbage'), // NaN — a mandatory field
        maternalPulseBpm: 80,
        consciousness: 'ALERT',
        shockSignsPresent: false,
      }),
      EVALUATED_AT,
    );
    expect(otherwiseComplete.isComplete).toBe(false);
    expect(otherwiseComplete.missingRequiredFields).toContain('fetalHeartRateBpm');
  });
});

describe('normalizeProteinuriaGrade — accepted source spellings (Task 7 boundary helper)', () => {
  const map: Array<[string, ProteinuriaGrade]> = [
    ['negative', 'NEGATIVE'],
    ['NEG', 'NEGATIVE'],
    ['none', 'NEGATIVE'],
    ['0', 'NEGATIVE'],
    ['-', 'NEGATIVE'],
    ['ลบ', 'NEGATIVE'],
    ['ไม่พบ', 'NEGATIVE'],
    ['trace', 'TRACE'],
    ['Trace', 'TRACE'],
    ['tr', 'TRACE'],
    ['1+', 'ONE_PLUS'],
    ['+', 'ONE_PLUS'],
    ['one plus', 'ONE_PLUS'],
    ['2+', 'TWO_PLUS'],
    ['++', 'TWO_PLUS'],
    ['3+', 'THREE_PLUS'],
    ['+++', 'THREE_PLUS'],
    ['4+', 'FOUR_PLUS'],
    ['++++', 'FOUR_PLUS'],
    ['  2+  ', 'TWO_PLUS'],
    ['UNKNOWN', 'UNKNOWN'],
    ['ONE_PLUS', 'ONE_PLUS'],
  ];

  it.each(map)('normalizes %s → %s', (raw, expected) => {
    expect(normalizeProteinuriaGrade(raw)).toBe(expected);
  });

  it('unknown/blank/null/undefined map to UNKNOWN (never NEGATIVE) — GC1', () => {
    expect(normalizeProteinuriaGrade(null)).toBe('UNKNOWN');
    expect(normalizeProteinuriaGrade(undefined)).toBe('UNKNOWN');
    expect(normalizeProteinuriaGrade('')).toBe('UNKNOWN');
    expect(normalizeProteinuriaGrade('   ')).toBe('UNKNOWN');
    expect(normalizeProteinuriaGrade('5+')).toBe('UNKNOWN');
    expect(normalizeProteinuriaGrade('gibberish')).toBe('UNKNOWN');
  });
});
