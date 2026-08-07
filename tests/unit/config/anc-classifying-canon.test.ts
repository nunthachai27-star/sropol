// Canonical Khon Kaen ANC classifying catalog — single source for the
// item→level mapping that browser-poll, the webhook processor, and the
// (dormant) polling rules engine must all agree on. Mirrors GetANCRiskLevel
// in docs/hosxp/KKLRMSWebhookUnit.pas. The catalog table
// person_anc_classifying_item is confirmed identical at every hospital.
import { describe, it, expect } from 'vitest';
import { ANC_CLASSIFYING_CANON, classifyAncItems } from '@/config/anc-classifying-canon';

describe('ANC classifying canon', () => {
  it('has all 18 provincial items with the Pascal level mapping', () => {
    expect(ANC_CLASSIFYING_CANON).toHaveLength(18);
    const levelOf = (id: number) => ANC_CLASSIFYING_CANON.find((i) => i.id === id)?.level;
    for (const id of [1, 2, 3, 5, 7, 8, 9, 11]) expect(levelOf(id)).toBe('HR1');
    for (const id of [4, 6, 10, 12, 13, 14]) expect(levelOf(id)).toBe('HR2');
    for (const id of [15, 16, 17, 18]) expect(levelOf(id)).toBe('HR3');
  });

  it('classifyAncItems: highest level wins, labels resolved in Thai', () => {
    const res = classifyAncItems([3, 13, 16]);
    expect(res.level).toBe('HR3'); // 16 = โรคหัวใจ
    expect(res.labels).toHaveLength(3);
    expect(res.labels.some((l) => /หัวใจ/.test(l))).toBe(true);
  });

  it('classifyAncItems: empty → LOW; unknown item → HR1 safe default with placeholder label', () => {
    expect(classifyAncItems([]).level).toBe('LOW');
    const res = classifyAncItems([99]);
    expect(res.level).toBe('HR1');
    expect(res.labels[0]).toContain('99');
  });
});
