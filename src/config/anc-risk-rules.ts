// ANC risk classification rules — 4-tier model from provincial screening guidelines
import { AncRiskLevel } from '@/types/domain';

export interface AncRiskInput {
  age: number;
  heightCm: number;
  prePregnancyBmi: number;
  gravida: number;
  bpSystolic: number;
  bpDiastolic: number;
  o2Sat: number;
  hct: number;
  hb: number;
  hosxpRiskIds: number[];
  classifyingItems: { itemId: number; value: string }[];
  rhNegative: boolean;
  hbsAgPositive: boolean;
  syphilisPositive: boolean;
  hivPositive: boolean;
  thalassemiaDisease: boolean;
  niptHighRisk: boolean;
}

export interface AncRiskRule {
  id: string;
  level: 'HR1' | 'HR2' | 'HR3';
  labelTh: string;
  labelEn: string;
  source: 'computed' | 'hosxp_risk' | 'hosxp_classifying' | 'lab';
  evaluate: (data: AncRiskInput) => boolean;
}

export interface AncRiskLevelConfig {
  level: AncRiskLevel;
  labelTh: string;
  labelEn: string;
  color: string;
  bgColor: string;
  facilityTh: string;
  providerTh: string;
  action: string;
}

// Mapping from HOSxP anc_risk_id to lab boolean flags
// These IDs correspond to entries in the HOSxP anc_risk lookup table
export const HOSXP_RISK_TO_LAB_FLAGS: Record<number, keyof Pick<AncRiskInput, 'rhNegative' | 'hbsAgPositive' | 'syphilisPositive' | 'hivPositive' | 'thalassemiaDisease' | 'niptHighRisk'>> = {
  21: 'rhNegative',
  22: 'hbsAgPositive',
  23: 'syphilisPositive',
  24: 'hivPositive',
  25: 'thalassemiaDisease',
  26: 'niptHighRisk',
};

export const ANC_RISK_LEVEL_ORDER: Record<AncRiskLevel, number> = {
  [AncRiskLevel.LOW]: 0,
  [AncRiskLevel.HR1]: 1,
  [AncRiskLevel.HR2]: 2,
  [AncRiskLevel.HR3]: 3,
};

export const ANC_RISK_CONFIGS: Record<AncRiskLevel, AncRiskLevelConfig> = {
  [AncRiskLevel.LOW]: {
    level: AncRiskLevel.LOW,
    labelTh: 'ความเสี่ยงต่ำ',
    labelEn: 'Low Risk',
    color: '#22c55e',
    bgColor: '#dcfce7',
    facilityTh: 'รพ.สต.',
    providerTh: 'พยาบาล/จนท.',
    action: 'ฝากครรภ์ปกติ',
  },
  [AncRiskLevel.HR1]: {
    level: AncRiskLevel.HR1,
    labelTh: 'เสี่ยงสูง ระดับ 1',
    labelEn: 'High Risk 1',
    color: '#eab308',
    bgColor: '#fef9c3',
    facilityTh: 'รพ.ชุมชน',
    providerTh: 'แพทย์/พยาบาล',
    action: 'ฝากครรภ์ รพ.ชุมชน โดยแพทย์',
  },
  [AncRiskLevel.HR2]: {
    level: AncRiskLevel.HR2,
    labelTh: 'เสี่ยงสูง ระดับ 2',
    labelEn: 'High Risk 2',
    color: '#f97316',
    bgColor: '#ffedd5',
    facilityTh: 'รพช.แม่ข่าย/รพท.',
    providerTh: 'สูติแพทย์',
    action: 'ส่งพบสูติแพทย์ รพ.แม่ข่าย/รพท.',
  },
  [AncRiskLevel.HR3]: {
    level: AncRiskLevel.HR3,
    labelTh: 'เสี่ยงสูง ระดับ 3',
    labelEn: 'High Risk 3',
    color: '#ef4444',
    bgColor: '#fee2e2',
    facilityTh: 'รพ.จังหวัด/รพศ.',
    providerTh: 'สูติแพทย์/MFM',
    action: 'ส่งต่อ รพ.จังหวัด/รพศ. ดูแลโดย MFM',
  },
};

export const ANC_RISK_RULES: AncRiskRule[] = [
  // --- HR1 rules ---
  { id: 'hr1_age', level: 'HR1', labelTh: 'อายุ < 17 ปี หรือ ≥ 35 ปี', labelEn: 'Age <17 or >=35', source: 'computed', evaluate: (d) => d.age < 17 || d.age >= 35 },
  { id: 'hr1_bmi_low', level: 'HR1', labelTh: 'BMI < 18.5', labelEn: 'BMI <18.5 (underweight)', source: 'computed', evaluate: (d) => d.prePregnancyBmi < 18.5 },
  { id: 'hr1_bmi_high', level: 'HR1', labelTh: 'BMI ≥ 23 (< 30)', labelEn: 'BMI >=23 and <30 (overweight)', source: 'computed', evaluate: (d) => d.prePregnancyBmi >= 23 && d.prePregnancyBmi < 30 },
  { id: 'hr1_o2sat', level: 'HR1', labelTh: 'O2sat < 95%', labelEn: 'O2 saturation <95%', source: 'computed', evaluate: (d) => d.o2Sat < 95 },
  { id: 'hr1_height', level: 'HR1', labelTh: 'ส่วนสูง < 145 ซม.', labelEn: 'Height <145cm', source: 'computed', evaluate: (d) => d.heightCm < 145 },
  { id: 'hr1_vaginal_bleeding', level: 'HR1', labelTh: 'เลือดออกทางช่องคลอด', labelEn: 'Vaginal bleeding', source: 'hosxp_classifying', evaluate: (d) => d.classifyingItems.some((i) => i.itemId === 1 && i.value === 'Y') },
  { id: 'hr1_previous_stillbirth', level: 'HR1', labelTh: 'เคยมีทารกตายในครรภ์/เสียชีวิตแรกเกิด', labelEn: 'Previous stillbirth/neonatal death', source: 'hosxp_risk', evaluate: (d) => d.hosxpRiskIds.includes(1) },
  { id: 'hr1_previous_lbw', level: 'HR1', labelTh: 'เคยคลอดน้ำหนัก <2500g หรือ >4000g', labelEn: 'Previous birth weight <2500g or >4000g', source: 'hosxp_risk', evaluate: (d) => d.hosxpRiskIds.includes(2) },
  { id: 'hr1_preeclampsia_hx', level: 'HR1', labelTh: 'ประวัติครรภ์เป็นพิษ (ตนเอง/ครอบครัว)', labelEn: 'History of preeclampsia (self/family)', source: 'hosxp_risk', evaluate: (d) => d.hosxpRiskIds.includes(3) },
  { id: 'hr1_gdm_hx', level: 'HR1', labelTh: 'ประวัติเบาหวานในครรภ์ (ตนเอง/ครอบครัว)', labelEn: 'History of GDM (self/family)', source: 'hosxp_risk', evaluate: (d) => d.hosxpRiskIds.includes(4) },
  { id: 'hr1_abnormal_exam', level: 'HR1', labelTh: 'ตรวจร่างกายพบความผิดปกติ', labelEn: 'Abnormal physical examination', source: 'hosxp_classifying', evaluate: (d) => d.classifyingItems.some((i) => i.itemId === 2 && i.value === 'Y') },

  // --- HR2 rules ---
  { id: 'hr2_bmi', level: 'HR2', labelTh: 'BMI 30-40', labelEn: 'BMI 30-40 (obese)', source: 'computed', evaluate: (d) => d.prePregnancyBmi >= 30 && d.prePregnancyBmi < 40 },
  { id: 'hr2_bp', level: 'HR2', labelTh: 'ความดัน Diastolic ≥90 หรือ Systolic ≥140', labelEn: 'BP: Diastolic >=90 or Systolic >=140', source: 'computed', evaluate: (d) => d.bpDiastolic >= 90 || d.bpSystolic >= 140 },
  { id: 'hr2_gravida', level: 'HR2', labelTh: 'ครรภ์ที่ 5 เป็นต้นไป', labelEn: 'Gravida >=5', source: 'computed', evaluate: (d) => d.gravida >= 5 },
  { id: 'hr2_rh_negative', level: 'HR2', labelTh: 'Rh Negative', labelEn: 'Rh Negative', source: 'lab', evaluate: (d) => d.rhNegative },
  { id: 'hr2_hbsag', level: 'HR2', labelTh: 'HBsAg positive', labelEn: 'Hepatitis B positive', source: 'lab', evaluate: (d) => d.hbsAgPositive },
  { id: 'hr2_syphilis', level: 'HR2', labelTh: 'Syphilis positive', labelEn: 'Syphilis positive', source: 'lab', evaluate: (d) => d.syphilisPositive },
  { id: 'hr2_hiv', level: 'HR2', labelTh: 'HIV positive', labelEn: 'HIV positive', source: 'lab', evaluate: (d) => d.hivPositive },
  { id: 'hr2_thalassemia', level: 'HR2', labelTh: 'Thalassemia disease', labelEn: 'Thalassemia disease', source: 'lab', evaluate: (d) => d.thalassemiaDisease },
  { id: 'hr2_previous_preterm', level: 'HR2', labelTh: 'ประวัติคลอดก่อนกำหนด (<37 wks)', labelEn: 'Previous preterm delivery (<37 wks)', source: 'hosxp_risk', evaluate: (d) => d.hosxpRiskIds.includes(5) },
  { id: 'hr2_previous_csection', level: 'HR2', labelTh: 'เคยผ่าตัดคลอด/ผ่าตัดมดลูก', labelEn: 'Previous C-section or uterine surgery', source: 'hosxp_risk', evaluate: (d) => d.hosxpRiskIds.includes(6) },
  { id: 'hr2_chronic_disease', level: 'HR2', labelTh: 'โรคประจำตัว (ความดัน/เบาหวาน/ไทรอยด์/โลหิตจาง/จิตเวช)', labelEn: 'Chronic disease (HT/DM/thyroid/anemia/psychiatric)', source: 'hosxp_risk', evaluate: (d) => d.hosxpRiskIds.includes(7) },
  { id: 'hr2_substance_abuse', level: 'HR2', labelTh: 'ติดสารเสพติด/สุรา/บุหรี่', labelEn: 'Substance abuse/alcohol/smoking', source: 'hosxp_risk', evaluate: (d) => d.hosxpRiskIds.includes(8) },
  { id: 'hr2_miscarriage', level: 'HR2', labelTh: 'เคยแท้ง ≥3 ครั้ง หรือแท้งไตรมาสที่ 2', labelEn: '>=3 miscarriages or 2nd trimester miscarriage', source: 'hosxp_risk', evaluate: (d) => d.hosxpRiskIds.includes(9) },
  { id: 'hr2_twin_dcda', level: 'HR2', labelTh: 'Twin DCDA', labelEn: 'Twin DCDA', source: 'hosxp_risk', evaluate: (d) => d.hosxpRiskIds.includes(10) },
  { id: 'hr2_chromosomal', level: 'HR2', labelTh: 'เคยคลอดทารกโครโมโซมผิดปกติ/พิการแต่กำเนิด', labelEn: 'Previous chromosomal/congenital abnormality', source: 'hosxp_risk', evaluate: (d) => d.hosxpRiskIds.includes(11) },
  { id: 'hr2_gyn_surgery', level: 'HR2', labelTh: 'ประวัติผ่าตัดทางนรีเวช', labelEn: 'Previous gynecologic surgery', source: 'hosxp_risk', evaluate: (d) => d.hosxpRiskIds.includes(12) },

  // --- HR3 rules ---
  { id: 'hr3_bmi', level: 'HR3', labelTh: 'BMI ≥ 40', labelEn: 'BMI >=40 (morbidly obese)', source: 'computed', evaluate: (d) => d.prePregnancyBmi >= 40 },
  { id: 'hr3_anemia', level: 'HR3', labelTh: 'Severe anemia (Hct<28% หรือ Hb<9)', labelEn: 'Severe anemia (Hct<28% or Hb<9)', source: 'computed', evaluate: (d) => d.hct < 28 || d.hb < 9 },
  { id: 'hr3_nipt', level: 'HR3', labelTh: 'NIPT หรือ Quad test high risk', labelEn: 'NIPT or Quad test high risk', source: 'lab', evaluate: (d) => d.niptHighRisk },
  { id: 'hr3_twin_mcda', level: 'HR3', labelTh: 'Twin MCDA/MADA หรือ Triplet ขึ้นไป', labelEn: 'Twin MCDA/MADA or Triplet+', source: 'hosxp_risk', evaluate: (d) => d.hosxpRiskIds.includes(13) },
  { id: 'hr3_abnormal_us', level: 'HR3', labelTh: 'ผลตรวจทารกในครรภ์ผิดปกติ (Abnormal U/S)', labelEn: 'Abnormal fetal ultrasound', source: 'hosxp_risk', evaluate: (d) => d.hosxpRiskIds.includes(14) },
  { id: 'hr3_pelvic_mass', level: 'HR3', labelTh: 'มีก้อนในอุ้งเชิงกราน', labelEn: 'Pelvic mass', source: 'hosxp_risk', evaluate: (d) => d.hosxpRiskIds.includes(15) },
  { id: 'hr3_placenta_accreta', level: 'HR3', labelTh: 'ภาวะรกเกาะแน่น', labelEn: 'Placenta accreta', source: 'hosxp_risk', evaluate: (d) => d.hosxpRiskIds.includes(16) },
  { id: 'hr3_heart_disease', level: 'HR3', labelTh: 'โรคหัวใจ WHO ≥2', labelEn: 'Heart disease WHO class >=2', source: 'hosxp_risk', evaluate: (d) => d.hosxpRiskIds.includes(17) },
  { id: 'hr3_renal_autoimmune', level: 'HR3', labelTh: 'โรคไต/APS/SLE', labelEn: 'Renal disease/APS/SLE', source: 'hosxp_risk', evaluate: (d) => d.hosxpRiskIds.includes(18) },
  { id: 'hr3_uncontrolled_psych', level: 'HR3', labelTh: 'โรคจิตเวชที่ควบคุมไม่ได้', labelEn: 'Uncontrolled psychiatric disease', source: 'hosxp_risk', evaluate: (d) => d.hosxpRiskIds.includes(19) },
  { id: 'hr3_beyond_capability', level: 'HR3', labelTh: 'โรคทางอายุรกรรมที่เกินศักยภาพ รพ.แม่ข่าย', labelEn: 'Medical condition beyond facility capability', source: 'hosxp_risk', evaluate: (d) => d.hosxpRiskIds.includes(20) },
];

export function classifyAncRisk(input: AncRiskInput): { level: AncRiskLevel; triggeredRules: string[] } {
  const triggered: string[] = [];
  let highestLevel = AncRiskLevel.LOW;

  for (const rule of ANC_RISK_RULES) {
    if (rule.evaluate(input)) {
      triggered.push(rule.id);
      const ruleLevel = AncRiskLevel[rule.level as keyof typeof AncRiskLevel];
      if (ANC_RISK_LEVEL_ORDER[ruleLevel] > ANC_RISK_LEVEL_ORDER[highestLevel]) {
        highestLevel = ruleLevel;
      }
    }
  }

  return { level: highestLevel, triggeredRules: triggered };
}
