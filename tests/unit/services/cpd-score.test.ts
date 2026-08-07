// T060: CPD score service tests — TDD: write tests FIRST
import { describe, it, expect } from 'vitest';
import {
  calculateCpdScore,
  handleMissingFactors,
  generateRecommendation,
} from '@/services/cpd-score';
import { RiskLevel } from '@/types/domain';
import type { CpdFactors } from '@/types/domain';
import { classifyRiskLevel, isHighRisk } from '@/config/risk-levels';

describe('CPD Score Service', () => {
  describe('calculateCpdScore', () => {
    it('returns correct total score with all 8 factors — high risk scenario', () => {
      // Primigravida (2) + ANC<4 (1.5) + GA>=40 (1.5) + height<150 (2) +
      // weightDiff>20 (2) + fundalHeight>36 (2) + usWeight>3500 (2) + hct<30 (1.5)
      const factors: CpdFactors = {
        gravida: 1,
        ancCount: 2,
        gaWeeks: 41,
        heightCm: 148,
        weightDiffKg: 22,
        fundalHeightCm: 38,
        usWeightG: 3800,
        hematocritPct: 28,
      };
      const result = calculateCpdScore(factors);
      expect(result.score).toBe(14.5);
      expect(result.riskLevel).toBe(RiskLevel.HIGH);
      expect(result.missingFactors).toEqual([]);
    });

    it('returns zero score when all factors are normal', () => {
      const factors: CpdFactors = {
        gravida: 3, // not primigravida → 0
        ancCount: 5, // >= 4 → 0
        gaWeeks: 37, // < 40 → 0
        heightCm: 160, // >= 155 → 0
        weightDiffKg: 10, // <= 15 → 0
        fundalHeightCm: 32, // <= 34 → 0
        usWeightG: 2800, // <= 3000 → 0
        hematocritPct: 35, // >= 30 → 0
      };
      const result = calculateCpdScore(factors);
      expect(result.score).toBe(0);
      expect(result.riskLevel).toBe(RiskLevel.LOW);
    });

    it('returns medium-range score for borderline values', () => {
      // Primigravida (2) + ANC<4 (1.5) + GA>=40 (1.5) + height 150-155 (1) = 6
      const factors: CpdFactors = {
        gravida: 1,
        ancCount: 3,
        gaWeeks: 40,
        heightCm: 153,
        weightDiffKg: 10,
        fundalHeightCm: 30,
        usWeightG: 2500,
        hematocritPct: 35,
      };
      const result = calculateCpdScore(factors);
      expect(result.score).toBe(6);
      expect(result.riskLevel).toBe(RiskLevel.MEDIUM);
    });

    it('handles partial factors and returns lower score with missing list', () => {
      // Only provide 3 factors: gravida=1 (2) + ancCount=2 (1.5) + gaWeeks=41 (1.5) = 5
      const partial: Partial<CpdFactors> = {
        gravida: 1,
        ancCount: 2,
        gaWeeks: 41,
      };
      const result = calculateCpdScore(partial);
      expect(result.score).toBe(5);
      expect(result.riskLevel).toBe(RiskLevel.MEDIUM);
      expect(result.missingFactors).toContain('heightCm');
      expect(result.missingFactors).toContain('weightDiffKg');
      expect(result.missingFactors).toContain('fundalHeightCm');
      expect(result.missingFactors).toContain('usWeightG');
      expect(result.missingFactors).toContain('hematocritPct');
      expect(result.missingFactors.length).toBe(5);
    });

    it('returns individual factor scores in result', () => {
      const factors: CpdFactors = {
        gravida: 1, // 2
        ancCount: 5, // 0
        gaWeeks: 38, // 0
        heightCm: 148, // 2
        weightDiffKg: 18, // 1 (>15, <=20)
        fundalHeightCm: 35, // 1 (>34, <=36)
        usWeightG: 3200, // 1 (>3000, <=3500)
        hematocritPct: 28, // 1.5
      };
      const result = calculateCpdScore(factors);
      expect(result.factorScores.gravida).toBe(2);
      expect(result.factorScores.ancCount).toBe(0);
      expect(result.factorScores.gaWeeks).toBe(0);
      expect(result.factorScores.heightCm).toBe(2);
      expect(result.factorScores.weightDiffKg).toBe(1);
      expect(result.factorScores.fundalHeightCm).toBe(1);
      expect(result.factorScores.usWeightG).toBe(1);
      expect(result.factorScores.hematocritPct).toBe(1.5);
      expect(result.score).toBe(8.5);
      expect(result.riskLevel).toBe(RiskLevel.MEDIUM);
    });
  });

  describe('classifyRiskLevel boundaries', () => {
    it('score 4.99 is LOW', () => {
      expect(classifyRiskLevel(4.99)).toBe(RiskLevel.LOW);
    });

    it('score 5 is MEDIUM', () => {
      expect(classifyRiskLevel(5)).toBe(RiskLevel.MEDIUM);
    });

    it('score 9.5 is MEDIUM', () => {
      expect(classifyRiskLevel(9.5)).toBe(RiskLevel.MEDIUM);
    });

    it('score 10 is HIGH', () => {
      expect(classifyRiskLevel(10)).toBe(RiskLevel.HIGH);
    });

    it('score 0 is LOW', () => {
      expect(classifyRiskLevel(0)).toBe(RiskLevel.LOW);
    });
  });

  describe('isHighRisk', () => {
    // isHighRisk is the single, config-derived predicate the UI uses to decide
    // whether to fire the high-risk alert — no bare numeric literals at the
    // call sites. Its boundary must track the HIGH classification exactly.
    it('is false just below the HIGH boundary (9.99)', () => {
      expect(isHighRisk(9.99)).toBe(false);
    });

    it('is true at the HIGH boundary (10)', () => {
      expect(isHighRisk(10)).toBe(true);
    });

    it('is true above the boundary', () => {
      expect(isHighRisk(14)).toBe(true);
    });

    it('is false for low scores', () => {
      expect(isHighRisk(0)).toBe(false);
    });

    it('agrees with classifyRiskLevel', () => {
      for (const score of [0, 4.99, 5, 9.99, 10, 14.5]) {
        expect(isHighRisk(score)).toBe(classifyRiskLevel(score) === RiskLevel.HIGH);
      }
    });
  });

  describe('handleMissingFactors', () => {
    it('returns empty array when all factors present', () => {
      const factors: CpdFactors = {
        gravida: 1,
        ancCount: 2,
        gaWeeks: 38,
        heightCm: 155,
        weightDiffKg: 10,
        fundalHeightCm: 32,
        usWeightG: 2800,
        hematocritPct: 35,
      };
      const result = handleMissingFactors(factors);
      expect(result).toEqual([]);
    });

    it('identifies missing factors from partial data', () => {
      const partial: Partial<CpdFactors> = {
        gravida: 1,
        heightCm: 155,
      };
      const result = handleMissingFactors(partial);
      expect(result).toContain('ancCount');
      expect(result).toContain('gaWeeks');
      expect(result).toContain('weightDiffKg');
      expect(result).toContain('fundalHeightCm');
      expect(result).toContain('usWeightG');
      expect(result).toContain('hematocritPct');
      expect(result.length).toBe(6);
    });
  });

  describe('generateRecommendation', () => {
    it('returns Thai referral text for HIGH risk', () => {
      const rec = generateRecommendation(RiskLevel.HIGH);
      expect(rec).toBe('ควรประสานส่งต่อทันที!');
    });

    it('returns monitoring text for MEDIUM risk', () => {
      const rec = generateRecommendation(RiskLevel.MEDIUM);
      expect(rec).toBe('เฝ้าระวังใกล้ชิด, เตรียมพร้อมส่งต่อ');
    });

    it('returns routine text for LOW risk', () => {
      const rec = generateRecommendation(RiskLevel.LOW);
      expect(rec).toBe('ติดตามปกติ');
    });
  });
});
