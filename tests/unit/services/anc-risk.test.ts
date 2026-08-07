import { describe, it, expect } from 'vitest';
import { evaluateAncRisk } from '@/services/anc-risk';
import { AncRiskLevel } from '@/types/domain';
import type { AncRiskInput } from '@/config/anc-risk-rules';

const baseInput: AncRiskInput = {
  age: 25,
  heightCm: 160,
  prePregnancyBmi: 22,
  gravida: 2,
  bpSystolic: 120,
  bpDiastolic: 80,
  o2Sat: 98,
  hct: 36,
  hb: 12,
  hosxpRiskIds: [],
  classifyingItems: [],
  rhNegative: false,
  hbsAgPositive: false,
  syphilisPositive: false,
  hivPositive: false,
  thalassemiaDisease: false,
  niptHighRisk: false,
};

describe('ANC Risk Service', () => {
  describe('evaluateAncRisk', () => {
    it('returns LOW when no risk factors', () => {
      const result = evaluateAncRisk(baseInput);
      expect(result.level).toBe(AncRiskLevel.LOW);
      expect(result.triggeredRules).toEqual([]);
      expect(result.recommendation.facilityTh).toBe('รพ.สต.');
    });

    it('returns HR1 for age < 17', () => {
      const result = evaluateAncRisk({ ...baseInput, age: 16 });
      expect(result.level).toBe(AncRiskLevel.HR1);
      expect(result.triggeredRules).toContain('hr1_age');
      expect(result.recommendation.facilityTh).toBe('รพ.ชุมชน');
    });

    it('returns HR2 when HR2 rule triggers (overrides HR1)', () => {
      const result = evaluateAncRisk({ ...baseInput, age: 16, hivPositive: true });
      expect(result.level).toBe(AncRiskLevel.HR2);
      expect(result.triggeredRules).toContain('hr1_age');
      expect(result.triggeredRules).toContain('hr2_hiv');
      expect(result.recommendation.facilityTh).toBe('รพช.แม่ข่าย/รพท.');
    });

    it('returns HR3 as highest level when multiple levels trigger', () => {
      const result = evaluateAncRisk({
        ...baseInput,
        age: 36,
        hivPositive: true,
        prePregnancyBmi: 42,
      });
      expect(result.level).toBe(AncRiskLevel.HR3);
      expect(result.triggeredRules).toContain('hr1_age');
      expect(result.triggeredRules).toContain('hr2_hiv');
      expect(result.triggeredRules).toContain('hr3_bmi');
      expect(result.recommendation.facilityTh).toBe('รพ.จังหวัด/รพศ.');
    });

    it('returns all triggered rules even at lower levels', () => {
      const result = evaluateAncRisk({
        ...baseInput,
        age: 16,
        heightCm: 140,
        prePregnancyBmi: 17,
      });
      expect(result.level).toBe(AncRiskLevel.HR1);
      expect(result.triggeredRules.length).toBe(3);
      expect(result.triggeredRules).toContain('hr1_age');
      expect(result.triggeredRules).toContain('hr1_height');
      expect(result.triggeredRules).toContain('hr1_bmi_low');
    });

    it('recommendation includes Thai provider info', () => {
      const result = evaluateAncRisk({ ...baseInput, prePregnancyBmi: 42 });
      expect(result.recommendation.providerTh).toBe('สูติแพทย์/MFM');
    });

    // ─── T3: completeness propagation ─────────────────────────────────────────
    it('marks the assessment complete when all mandatory inputs are present', () => {
      const result = evaluateAncRisk(baseInput);
      expect(result.assessmentIncomplete).toBe(false);
      expect(result.missingRequired).toEqual([]);
    });

    it('marks the assessment incomplete and lists the missing mandatory inputs', () => {
      const result = evaluateAncRisk({ ...baseInput, o2Sat: null, hct: null, hb: null });
      expect(result.assessmentIncomplete).toBe(true);
      expect(result.missingRequired).toEqual(expect.arrayContaining(['o2Sat', 'hct', 'hb']));
      expect(result.missingRequired).not.toContain('heightCm');
    });
  });
});
