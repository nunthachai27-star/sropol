// Boundary validation for the ANC webhook payload — rejects an invalid
// declared riskLevel, non-integer riskItemIds, and unparseable dates before
// they ever reach the canonical-risk resolution / journey write.
import { describe, it, expect } from 'vitest';
import { validateAncPayload } from '@/services/webhook';

const VALID_CID = '1100500090006';

function payload(patient: Record<string, unknown>) {
  return { patients: [{ name: 'นางทดสอบ', cid: VALID_CID, hn: 'HN1', pregNo: 1, ...patient }] };
}

describe('validateAncPayload risk/date validation', () => {
  it('rejects a riskLevel outside the enum', () => {
    const r = validateAncPayload(payload({ riskLevel: 'HIGH' }));
    expect(r.valid).toBe(false);
    expect(r.error).toMatch(/riskLevel/);
  });

  it('accepts the four canonical levels and absent riskLevel', () => {
    for (const level of ['LOW', 'HR1', 'HR2', 'HR3', undefined]) {
      expect(validateAncPayload(payload({ riskLevel: level })).valid).toBe(true);
    }
  });

  it('rejects non-integer riskItemIds', () => {
    expect(validateAncPayload(payload({ riskItemIds: [1, 'x'] })).valid).toBe(false);
    expect(validateAncPayload(payload({ riskItemIds: [1, 2.5] })).valid).toBe(false);
    expect(validateAncPayload(payload({ riskItemIds: [3, 16] })).valid).toBe(true);
  });

  it('rejects unparseable dates', () => {
    expect(validateAncPayload(payload({ lmp: 'ไม่ใช่วันที่' })).valid).toBe(false);
    expect(validateAncPayload(payload({ edc: '2026-13-45' })).valid).toBe(false);
    expect(validateAncPayload(payload({ lmp: '2026-01-15', edc: null })).valid).toBe(true);
  });
});
