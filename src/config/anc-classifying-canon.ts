// Canonical Khon Kaen ANC risk-classifying catalog (เกณฑ์คัดกรองหญิงตั้งครรภ์
// ตามความเสี่ยง จ.ขอนแก่น) — the provincial person_anc_classifying_item table,
// confirmed identical at every hospital in the network. Item→level mapping
// mirrors GetANCRiskLevel in docs/hosxp/KKLRMSWebhookUnit.pas; this module is
// the single source shared by the browser sync client, the webhook processor,
// and the polling rules engine so the three can never disagree.

export type AncClassifyingLevel = 'HR1' | 'HR2' | 'HR3';

export interface AncClassifyingCanonItem {
  /** person_anc_classifying_item_id in HOSxP. */
  id: number;
  labelTh: string;
  level: AncClassifyingLevel;
}

export const ANC_CLASSIFYING_CANON: AncClassifyingCanonItem[] = [
  { id: 1, labelTh: 'เคยมีทารกตายในครรภ์', level: 'HR1' },
  { id: 2, labelTh: 'เคยแท้งเอง 3 ครั้งขึ้นไป', level: 'HR1' },
  { id: 3, labelTh: 'เคยคลอดบุตรน้ำหนัก < 2,500 กรัม', level: 'HR1' },
  { id: 4, labelTh: 'เคยคลอดบุตรน้ำหนัก > 4,000 กรัม', level: 'HR2' },
  { id: 5, labelTh: 'เคยครรภ์เป็นพิษ', level: 'HR1' },
  { id: 6, labelTh: 'เคยผ่าตัดคลอด/ผ่าตัดมดลูก', level: 'HR2' },
  { id: 7, labelTh: 'ครรภ์แฝด', level: 'HR1' },
  { id: 8, labelTh: 'อายุน้อยกว่า 17 ปี', level: 'HR1' },
  { id: 9, labelTh: 'อายุมากกว่า 35 ปี', level: 'HR1' },
  { id: 10, labelTh: 'Rh Negative', level: 'HR2' },
  { id: 11, labelTh: 'เลือดออกทางช่องคลอด', level: 'HR1' },
  { id: 12, labelTh: 'ก้อนในอุ้งเชิงกราน', level: 'HR2' },
  { id: 13, labelTh: 'ความดัน Diastolic > 90 mmHg', level: 'HR2' },
  { id: 14, labelTh: 'เบาหวาน', level: 'HR2' },
  { id: 15, labelTh: 'โรคไต', level: 'HR3' },
  { id: 16, labelTh: 'โรคหัวใจ', level: 'HR3' },
  { id: 17, labelTh: 'ติดยาเสพติด/สุรา', level: 'HR3' },
  { id: 18, labelTh: 'โรคอายุรกรรม (โลหิตจาง/ไทรอยด์/SLE)', level: 'HR3' },
];

const BY_ID = new Map(ANC_CLASSIFYING_CANON.map((i) => [i.id, i]));

const LEVEL_ORDER: Record<'LOW' | AncClassifyingLevel, number> = {
  LOW: 0,
  HR1: 1,
  HR2: 2,
  HR3: 3,
};

export interface AncClassificationResult {
  level: 'LOW' | AncClassifyingLevel;
  /** Thai labels of the checked items, in input order. */
  labels: string[];
}

/**
 * Classify a woman from her checked person_anc_classifying item IDs.
 * Highest level wins; unknown items fall back to HR1 (safe default, same as
 * the Pascal implementation) with a code placeholder label.
 */
export function classifyAncItems(itemIds: number[]): AncClassificationResult {
  let max: 'LOW' | AncClassifyingLevel = 'LOW';
  const labels: string[] = [];
  for (const id of itemIds) {
    const item = BY_ID.get(id);
    const level = item?.level ?? 'HR1';
    labels.push(item?.labelTh ?? `รายการเสี่ยงรหัส ${id}`);
    if (LEVEL_ORDER[level] > LEVEL_ORDER[max]) max = level;
  }
  return { level: max, labels };
}
