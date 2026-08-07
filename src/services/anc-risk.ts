import {
  classifyAncRisk,
  ANC_RISK_CONFIGS,
  type AncRiskInput,
  type AncRiskLevelConfig,
} from '@/config/anc-risk-rules';

export interface AncRiskResult {
  level: import('@/types/domain').AncRiskLevel;
  triggeredRules: string[];
  recommendation: AncRiskLevelConfig;
  /** Mandatory ANC inputs (see MANDATORY_ANC_RISK_INPUTS) that were null. */
  missingRequired: string[];
  /** True when any mandatory input is missing — the assessment is not complete. */
  assessmentIncomplete: boolean;
}

export function evaluateAncRisk(input: AncRiskInput): AncRiskResult {
  const { level, triggeredRules, missingRequired } = classifyAncRisk(input);

  return {
    level,
    triggeredRules,
    recommendation: ANC_RISK_CONFIGS[level],
    missingRequired,
    assessmentIncomplete: missingRequired.length > 0,
  };
}
