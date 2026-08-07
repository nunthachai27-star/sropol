// Guards src/config/maternal-screen-rules.ts against silent drift from the
// Phase 0 clinical fixtures it mirrors:
//   - docs/clinical/maternal-screen-rules-v1.yaml   (19 LOCAL_PDF_TIER rules)
//   - docs/clinical/maternal-screen-acuity-v1.yaml  (7 EMERGENCY_ACUITY rules)
//
// The YAML files are parsed with small, targeted regexes rather than a full
// YAML parser (no `js-yaml` in package.json dependencies/devDependencies —
// see docs/superpowers/plans/2026-07-16-maternal-screening.md GC5 "config
// home"; this test intentionally avoids introducing an undeclared runtime
// dependency). Each regex targets one specific, stable shape in the fixture
// (a `  - id: FOO` list item, a `ruleSetVersion: "..."` scalar, or the
// `mandatoryFields:` block's `  - name` list) rather than attempting general
// YAML parsing.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  MATERNAL_SCREEN_RULE_SET_VERSION,
  MATERNAL_SCREEN_RULES,
  LOCAL_TIER_RANK,
  EMERGENCY_ACUITY_RANK,
  MANDATORY_SCREEN_FIELDS,
  STABILITY_DETERMINATION_FIELDS,
  matchRule,
  type MaternalScreenRule,
} from '@/config/maternal-screen-rules';
import type {
  MaternalScreenInput,
  MaternalScreenLocalTier,
  MaternalEmergencyAcuity,
} from '@/types/maternal-screening';

const RULES_YAML_PATH = join(process.cwd(), 'docs/clinical/maternal-screen-rules-v1.yaml');
const ACUITY_YAML_PATH = join(process.cwd(), 'docs/clinical/maternal-screen-acuity-v1.yaml');

const rulesYaml = readFileSync(RULES_YAML_PATH, 'utf8');
const acuityYaml = readFileSync(ACUITY_YAML_PATH, 'utf8');

/** Extract every `  - id: SOME-ID` rule-list entry from a fixture's `rules:` block. */
function extractRuleIds(yaml: string): string[] {
  const matches = [...yaml.matchAll(/^\s{2}-\s+id:\s*(\S+)\s*$/gm)];
  return matches.map((m) => m[1]);
}

/** Extract a top-level `ruleSetVersion: "..."` scalar from a fixture's `metadata:` block. */
function extractRuleSetVersion(yaml: string): string {
  const match = yaml.match(/ruleSetVersion:\s*"([^"]+)"/);
  if (!match) throw new Error('ruleSetVersion not found in fixture');
  return match[1];
}

/** Extract the `mandatoryFields:` list (a `- name` item per line) from maternal-screen-rules-v1.yaml. */
function extractMandatoryFields(yaml: string): string[] {
  const block = yaml.match(/^mandatoryFields:\n((?:\s{2}-\s*\S+\n?)+)/m);
  if (!block) throw new Error('mandatoryFields block not found in fixture');
  return [...block[1].matchAll(/^\s{2}-\s*(\S+)\s*$/gm)].map((m) => m[1]);
}

/** Extract the `stabilityDeterminationFields:` list from maternal-screen-acuity-v1.yaml. */
function extractStabilityDeterminationFields(yaml: string): string[] {
  const block = yaml.match(/^stabilityDeterminationFields:\n((?:\s{2}-\s*\S+\n?)+)/m);
  if (!block) throw new Error('stabilityDeterminationFields block not found in fixture');
  return [...block[1].matchAll(/^\s{2}-\s*(\S+)\s*$/gm)].map((m) => m[1]);
}

const yamlLocalTierRuleIds = extractRuleIds(rulesYaml);
const yamlAcuityRuleIds = extractRuleIds(acuityYaml);
const yamlAllRuleIds = [...yamlLocalTierRuleIds, ...yamlAcuityRuleIds];

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

describe('maternal-screen-rules config', () => {
  it('fixture sanity: YAML has 19 local-tier rules and 7 acuity rules', () => {
    expect(yamlLocalTierRuleIds).toHaveLength(19);
    expect(yamlAcuityRuleIds).toHaveLength(7);
  });

  it('rule-ID set exactly matches the union of both YAML fixtures (no drift)', () => {
    const configIds = MATERNAL_SCREEN_RULES.map((r) => r.id).sort();
    const yamlIds = [...yamlAllRuleIds].sort();
    expect(configIds).toEqual(yamlIds);
  });

  it('has no duplicate rule IDs', () => {
    const ids = MATERNAL_SCREEN_RULES.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every rule has a non-empty purpose and controllingSourceId', () => {
    for (const rule of MATERNAL_SCREEN_RULES) {
      expect(rule.purpose, `rule ${rule.id} missing purpose`).toBeTruthy();
      expect(rule.controllingSourceId, `rule ${rule.id} missing controllingSourceId`).toBeTruthy();
    }
  });

  it('every LOCAL_PDF_TIER rule declares localTier and condition; every EMERGENCY_ACUITY rule declares emergencyAcuity', () => {
    for (const rule of MATERNAL_SCREEN_RULES) {
      if (rule.purpose === 'LOCAL_PDF_TIER') {
        expect(rule.localTier, `rule ${rule.id} missing localTier`).toBeTruthy();
        expect(rule.condition, `rule ${rule.id} missing condition`).toBeTruthy();
        expect(
          rule.emergencyAcuity,
          `rule ${rule.id} unexpectedly has emergencyAcuity`,
        ).toBeUndefined();
      } else if (rule.purpose === 'EMERGENCY_ACUITY') {
        expect(rule.emergencyAcuity, `rule ${rule.id} missing emergencyAcuity`).toBeTruthy();
        expect(rule.localTier, `rule ${rule.id} unexpectedly has localTier`).toBeUndefined();
      }
    }
  });

  it('MATERNAL_SCREEN_RULE_SET_VERSION equals both YAML fixtures ruleSetVersion', () => {
    const rulesVersion = extractRuleSetVersion(rulesYaml);
    const acuityVersion = extractRuleSetVersion(acuityYaml);
    expect(rulesVersion).toBe(acuityVersion);
    expect(MATERNAL_SCREEN_RULE_SET_VERSION).toBe(rulesVersion);
    expect(MATERNAL_SCREEN_RULE_SET_VERSION).toBe('0.1.0-provisional');
  });

  it('MANDATORY_SCREEN_FIELDS matches the YAML mandatoryFields list exactly (order-sensitive)', () => {
    const yamlFields = extractMandatoryFields(rulesYaml);
    expect(yamlFields).toHaveLength(11);
    expect([...MANDATORY_SCREEN_FIELDS]).toEqual(yamlFields);
  });

  it('STABILITY_DETERMINATION_FIELDS matches the acuity YAML stabilityDeterminationFields list exactly (order-sensitive)', () => {
    const yamlFields = extractStabilityDeterminationFields(acuityYaml);
    expect(yamlFields).toHaveLength(6);
    expect([...STABILITY_DETERMINATION_FIELDS]).toEqual(yamlFields);
  });

  describe('LOCAL_TIER_RANK', () => {
    const expectedKeys: MaternalScreenLocalTier[] = [
      'NO_LOCAL_MATCH',
      'LOCAL_MILD',
      'LOCAL_MODERATE',
      'LOCAL_SEVERE',
    ];

    it('is total over MaternalScreenLocalTier', () => {
      expect(Object.keys(LOCAL_TIER_RANK).sort()).toEqual([...expectedKeys].sort());
    });

    it('is strictly ordered NO_LOCAL_MATCH < LOCAL_MILD < LOCAL_MODERATE < LOCAL_SEVERE', () => {
      const ranks = expectedKeys.map((k) => LOCAL_TIER_RANK[k]);
      for (let i = 1; i < ranks.length; i++) {
        expect(ranks[i]).toBeGreaterThan(ranks[i - 1]);
      }
    });
  });

  describe('EMERGENCY_ACUITY_RANK', () => {
    const expectedKeys: MaternalEmergencyAcuity[] = ['UNKNOWN', 'STABLE', 'URGENT', 'EMERGENCY'];

    it('is total over MaternalEmergencyAcuity', () => {
      expect(Object.keys(EMERGENCY_ACUITY_RANK).sort()).toEqual([...expectedKeys].sort());
    });

    it('is strictly ordered UNKNOWN < STABLE < URGENT < EMERGENCY', () => {
      const ranks = expectedKeys.map((k) => EMERGENCY_ACUITY_RANK[k]);
      for (let i = 1; i < ranks.length; i++) {
        expect(ranks[i]).toBeGreaterThan(ranks[i - 1]);
      }
    });
  });

  describe('matchRule — GC1 null-guard (a rule must not fire on a null/UNKNOWN component)', () => {
    it('no rule fires against the fully-unassessed baseline input', () => {
      const fired = MATERNAL_SCREEN_RULES.filter((rule) => matchRule(rule, baseInput));
      expect(fired.map((r) => r.id)).toEqual([]);
    });

    it('numeric "<" is null-guarded (does not fall through to JS null-coerces-to-0)', () => {
      const rule = MATERNAL_SCREEN_RULES.find((r) => r.id === 'PE-LAB-SEVERE-PLATELET-100K')!;
      expect(matchRule(rule, { ...baseInput, plateletPerUl: null })).toBe(false);
      expect(matchRule(rule, { ...baseInput, plateletPerUl: 99999 })).toBe(true);
      expect(matchRule(rule, { ...baseInput, plateletPerUl: 100000 })).toBe(false);
    });

    it('numeric ">" is null-guarded and strict (creatinine exactly 1.1 is not severe)', () => {
      const rule = MATERNAL_SCREEN_RULES.find((r) => r.id === 'PE-LAB-SEVERE-CREATININE-1_1')!;
      expect(matchRule(rule, { ...baseInput, creatinineMgDl: null })).toBe(false);
      expect(matchRule(rule, { ...baseInput, creatinineMgDl: 1.1 })).toBe(false);
      expect(matchRule(rule, { ...baseInput, creatinineMgDl: 1.11 })).toBe(true);
    });

    it('GA >= 26 AND bleeding requires both assessed; unknown GA never fires APH-GA26', () => {
      const rule = MATERNAL_SCREEN_RULES.find((r) => r.id === 'APH-GA26-VAGINAL-BLEEDING')!;
      expect(matchRule(rule, { ...baseInput, gaWeeks: null, vaginalBleeding: true })).toBe(false);
      expect(matchRule(rule, { ...baseInput, gaWeeks: 25, vaginalBleeding: true })).toBe(false);
      expect(matchRule(rule, { ...baseInput, gaWeeks: 26, vaginalBleeding: true })).toBe(true);
      expect(matchRule(rule, { ...baseInput, gaWeeks: 26, vaginalBleeding: null })).toBe(false);
    });

    it('"in" is null-guarded against the UNKNOWN enum sentinel', () => {
      const rule = MATERNAL_SCREEN_RULES.find((r) => r.id === 'PE-PROT-SEVERE-2TO3PLUS')!;
      expect(matchRule(rule, { ...baseInput, proteinuriaGrade: 'UNKNOWN' })).toBe(false);
      expect(matchRule(rule, { ...baseInput, proteinuriaGrade: 'TWO_PLUS' })).toBe(true);
    });

    it('APH-PREVIA-PATTERN "!=" deliberately fires when abdominalOrBackPain is unassessed (GC1 permissive exception, ref 7.5-11)', () => {
      const rule = MATERNAL_SCREEN_RULES.find((r) => r.id === 'APH-PREVIA-PATTERN')!;
      expect(
        matchRule(rule, { ...baseInput, vaginalBleeding: true, abdominalOrBackPain: null }),
      ).toBe(true);
      expect(
        matchRule(rule, { ...baseInput, vaginalBleeding: true, abdominalOrBackPain: false }),
      ).toBe(true);
      expect(
        matchRule(rule, { ...baseInput, vaginalBleeding: true, abdominalOrBackPain: true }),
      ).toBe(false);
      // The other conjunct (vaginalBleeding) is still ordinarily null-guarded.
      expect(
        matchRule(rule, { ...baseInput, vaginalBleeding: null, abdominalOrBackPain: false }),
      ).toBe(false);
    });

    it('APH-ABRUPTIO-PATTERN fires on concealed bleeding alone (visible bleeding not required, GC4)', () => {
      const rule = MATERNAL_SCREEN_RULES.find((r) => r.id === 'APH-ABRUPTIO-PATTERN')!;
      expect(
        matchRule(rule, {
          ...baseInput,
          vaginalBleeding: false,
          concealedBleedingSuspected: true,
          uterineTenderness: true,
        }),
      ).toBe(true);
    });
  });

  it('rule count matches the documented 19 local-tier + 7 acuity total', () => {
    expect(MATERNAL_SCREEN_RULES).toHaveLength(26);
    expect(
      MATERNAL_SCREEN_RULES.filter((r: MaternalScreenRule) => r.purpose === 'LOCAL_PDF_TIER'),
    ).toHaveLength(19);
    expect(
      MATERNAL_SCREEN_RULES.filter((r: MaternalScreenRule) => r.purpose === 'EMERGENCY_ACUITY'),
    ).toHaveLength(7);
  });
});
