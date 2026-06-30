// browser-poll referral mapping — pure row→payload transform, no network.
import { describe, it, expect } from 'vitest';
import { mapReferral, mapReferralUrgency, SQL_REFEROUT_OB } from '@/lib/browser-poll';

describe('mapReferralUrgency', () => {
  it('maps HOSxP referout_emergency_type_id to urgency levels', () => {
    expect(mapReferralUrgency(3)).toBe('EMERGENCY');
    expect(mapReferralUrgency(2)).toBe('URGENT');
    expect(mapReferralUrgency(1)).toBe('ROUTINE');
    expect(mapReferralUrgency(null)).toBe('ROUTINE');
    expect(mapReferralUrgency('99')).toBe('ROUTINE');
  });
});

describe('mapReferral', () => {
  const row = {
    refer_number: 'REF-2026-0001',
    refer_date: '2026-06-28',
    hn: '000123',
    refer_hospcode: '10669',
    pdx: 'O14.1',
    pre_diagnosis: 'Severe preeclampsia',
    referout_emergency_type_id: 2,
    cid: '1409901066411',
    chwpart: '32',
    amppart: '01',
    tmbpart: '05',
    patient_name: 'นาง ทดสอบ ส่งต่อ',
  };

  it('maps a full HOSxP referout row to a referral payload', () => {
    expect(mapReferral(row)).toEqual({
      referralId: 'REF-2026-0001',
      hn: '000123',
      cid: '1409901066411',
      name: 'นาง ทดสอบ ส่งต่อ',
      toHospitalCode: '10669',
      reason: 'Severe preeclampsia',
      diagnosisCode: 'O14.1',
      urgencyLevel: 'URGENT',
      changwatCode: '32',
      amphurCode: '01',
      tambonCode: '05',
    });
  });

  it('returns null when the destination hcode is missing', () => {
    expect(mapReferral({ ...row, refer_hospcode: null })).toBeNull();
  });

  it('returns null when the CID is not 13 digits', () => {
    expect(mapReferral({ ...row, cid: '123' })).toBeNull();
  });

  it('SQL_REFEROUT_OB targets the referout table within a date window', () => {
    expect(SQL_REFEROUT_OB).toContain('referout');
    expect(SQL_REFEROUT_OB).toContain('refer_date');
  });
});
