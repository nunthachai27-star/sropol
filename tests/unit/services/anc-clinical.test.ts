import { describe, it, expect } from 'vitest';
import {
  sevBp,
  sevFhr,
  sevHb,
  sevUrineProtein,
  sevFetalMovement,
  nextContactDue,
  prePregnancyBmi,
  isLateFirstContact,
  overdueInvestigations,
  WHO_CONTACT_WEEKS,
  WHO_CONTACT_WINDOW_W,
  BP_SYS_HIGH,
  BP_DIA_HIGH,
  FHR_LOW,
  HB_LOW,
  HB_SEVERE,
} from '@/services/anc-clinical';

// These tests pin the clinical rules ported verbatim out of the journey detail
// page. Expected values for *present* readings are derived from the
// pre-extraction implementation and MUST NOT change (WHO containment T1 only
// touches null-handling). The null→'normal' assertions below were replaced
// 2026-07-14 (WHO containment T1): missing clinical data must be a distinct
// 'unknown' state, never rendered/treated as normal.

describe('anc-clinical severity bands', () => {
  describe('sevBp (systolic/diastolic)', () => {
    // Full case table from the T1 brief — evaluate present components
    // independently; report the highest severity provable from present
    // data; 'unknown' only when normality cannot be proven.
    it('is unknown when normality cannot be proven from present data', () => {
      expect(sevBp(null, null)).toBe('unknown');
      expect(sevBp(120, null)).toBe('unknown');
      expect(sevBp(null, 80)).toBe('unknown');
    });
    it('flags abnormal from a single present component, even if the other is missing', () => {
      expect(sevBp(200, null)).toBe('abnormal');
      expect(sevBp(null, 95)).toBe('abnormal');
    });
    it('flags borderline from a single present component, even if the other is missing', () => {
      expect(sevBp(132, null)).toBe('borderline');
    });
    it('flags abnormal at/above the high band (>=140 / >=90)', () => {
      expect(sevBp(140, 80)).toBe('abnormal');
      expect(sevBp(120, 90)).toBe('abnormal');
      expect(sevBp(160, 100)).toBe('abnormal');
      expect(sevBp(140, 90)).toBe('abnormal');
    });
    it('flags borderline in the amber band (130-139 / 85-89)', () => {
      expect(sevBp(130, 80)).toBe('borderline');
      expect(sevBp(139, 84)).toBe('borderline');
      expect(sevBp(120, 85)).toBe('borderline');
      expect(sevBp(130, 85)).toBe('borderline');
    });
    it('is normal below the amber band when both components are present', () => {
      expect(sevBp(129, 84)).toBe('normal');
      expect(sevBp(120, 80)).toBe('normal');
    });
  });

  describe('sevFhr', () => {
    it('is unknown for a missing reading', () => {
      expect(sevFhr(null)).toBe('unknown');
    });
    it('is normal inside 110-160 inclusive', () => {
      expect(sevFhr(110)).toBe('normal');
      expect(sevFhr(140)).toBe('normal');
      expect(sevFhr(160)).toBe('normal');
    });
    it('is abnormal outside 110-160', () => {
      expect(sevFhr(109)).toBe('abnormal');
      expect(sevFhr(161)).toBe('abnormal');
      expect(sevFhr(90)).toBe('abnormal');
    });
  });

  describe('sevHb', () => {
    it('is unknown for a missing reading', () => {
      expect(sevHb(null)).toBe('unknown');
    });
    it('is abnormal below the severe-anemia band (<9)', () => {
      expect(sevHb(8.9)).toBe('abnormal');
      expect(sevHb(7)).toBe('abnormal');
    });
    it('is borderline in the anemia band (9 to <11)', () => {
      expect(sevHb(9)).toBe('borderline');
      expect(sevHb(10.9)).toBe('borderline');
    });
    it('is normal at/above 11', () => {
      expect(sevHb(11)).toBe('normal');
      expect(sevHb(13)).toBe('normal');
    });
  });

  describe('sevUrineProtein', () => {
    it('is unknown when the result is missing or empty', () => {
      expect(sevUrineProtein(null)).toBe('unknown');
      expect(sevUrineProtein(undefined)).toBe('unknown');
      expect(sevUrineProtein('')).toBe('unknown');
    });
    it('is abnormal when the result contains a "+"', () => {
      expect(sevUrineProtein('+')).toBe('abnormal');
      expect(sevUrineProtein('2+')).toBe('abnormal');
      expect(sevUrineProtein('+++')).toBe('abnormal');
    });
    it('is normal otherwise', () => {
      expect(sevUrineProtein('NEG')).toBe('normal');
      expect(sevUrineProtein('TRACE')).toBe('normal');
    });
  });

  describe('sevFetalMovement', () => {
    it('is unknown when not recorded', () => {
      expect(sevFetalMovement(null)).toBe('unknown');
      expect(sevFetalMovement(undefined)).toBe('unknown');
    });
    it('is abnormal when reduced fetal movement is reported', () => {
      expect(sevFetalMovement(false)).toBe('abnormal');
    });
    it('is normal when fetal movement is confirmed ok', () => {
      expect(sevFetalMovement(true)).toBe('normal');
    });
  });

  it('exposes the threshold constants used by the trend rows', () => {
    expect(BP_SYS_HIGH).toBe(140);
    expect(BP_DIA_HIGH).toBe(90);
    expect(FHR_LOW).toBe(110);
    expect(HB_LOW).toBe(11);
    expect(HB_SEVERE).toBe(9);
  });
});

describe('WHO 8-contact schedule', () => {
  it('uses the WHO 2016 target weeks with a ±1w window', () => {
    expect(WHO_CONTACT_WEEKS).toEqual([12, 20, 26, 30, 34, 36, 38, 40]);
    expect(WHO_CONTACT_WINDOW_W).toBe(1);
  });

  describe('nextContactDue', () => {
    // WHO containment T2 (2026-07-14): nextContactDue returns a discriminated
    // union so callers can distinguish "GA unknown — cannot evaluate the
    // schedule" from "genuinely complete" — both used to collapse to `null`,
    // which made the journey detail page render green "8 contacts complete"
    // for patients whose GA was never recorded.
    it('returns UNKNOWN_GA when current GA is unknown', () => {
      expect(nextContactDue(null, [])).toEqual({ status: 'UNKNOWN_GA' });
    });
    it('reports the first contact as upcoming before it is due', () => {
      expect(nextContactDue(8, [])).toEqual({
        status: 'NEXT',
        ga: 12,
        dueStatus: 'upcoming',
        weeksAway: 4,
      });
    });
    it('skips contacts already attended within the ±1w window', () => {
      // 27 counts as attending the week-26 contact (|27-26| <= 1).
      expect(nextContactDue(25, [12, 20, 27])).toEqual({
        status: 'NEXT',
        ga: 30,
        dueStatus: 'upcoming',
        weeksAway: 5,
      });
    });
    it('flags a contact due now when GA is within the window', () => {
      expect(nextContactDue(25, [12, 20])).toEqual({
        status: 'NEXT',
        ga: 26,
        dueStatus: 'due-now',
        weeksAway: 1,
      });
    });
    it('flags a missed contact as overdue', () => {
      expect(nextContactDue(30, [12, 20])).toEqual({
        status: 'NEXT',
        ga: 26,
        dueStatus: 'overdue',
        weeksAway: -4,
      });
    });
    it('returns COMPLETE once every scheduled contact is attended (GA known)', () => {
      expect(nextContactDue(41, [12, 20, 26, 30, 34, 36, 38, 40])).toEqual({
        status: 'COMPLETE',
      });
    });
  });
});

describe('prePregnancyBmi', () => {
  it('computes kg / m^2 rounded to one decimal', () => {
    expect(prePregnancyBmi(160, 56)).toBe(21.9);
    expect(prePregnancyBmi(170, 70)).toBe(24.2);
  });
  it('returns null when height or weight is missing', () => {
    expect(prePregnancyBmi(null, 56)).toBeNull();
    expect(prePregnancyBmi(160, null)).toBeNull();
  });
  it('rejects implausible height (<=100cm) and non-positive weight', () => {
    expect(prePregnancyBmi(100, 56)).toBeNull();
    expect(prePregnancyBmi(90, 56)).toBeNull();
    expect(prePregnancyBmi(160, 0)).toBeNull();
  });
});

describe('isLateFirstContact', () => {
  it('is true when the first ANC contact is at/after GA 10w (RTCOG < 10w target)', () => {
    expect(isLateFirstContact(10)).toBe(true);
    expect(isLateFirstContact(14)).toBe(true);
  });
  it('is false before GA 10w or when unknown', () => {
    expect(isLateFirstContact(9)).toBe(false);
    expect(isLateFirstContact(null)).toBe(false);
  });
});

describe('overdueInvestigations (RTCOG OB 66-029)', () => {
  const clear = {
    gaWeeks: null as number | null,
    anatomyScanDate: null as string | null,
    ogttResult: null as string | null,
    gbsResult: null as string | null,
    tdapGiven: false,
    mcvFl: null as number | null,
    dcipResult: null as string | null,
    hbEResult: null as string | null,
  };

  it('reports nothing in early pregnancy with no data', () => {
    expect(overdueInvestigations({ ...clear, gaWeeks: 10 })).toEqual([]);
  });

  it('reports nothing when GA is unknown (treated as 0)', () => {
    expect(overdueInvestigations({ ...clear, gaWeeks: null })).toEqual([]);
  });

  it('flags a missed thalassemia screen after GA 16', () => {
    const result = overdueInvestigations({ ...clear, gaWeeks: 20 });
    expect(result.map((r) => r.key)).toEqual(['thalassemia']);
    expect(result[0]).toMatchObject({ dueBy: '16w', severity: 'warn' });
  });

  it('flags every investigation, in order, for a term patient with nothing done', () => {
    const result = overdueInvestigations({ ...clear, gaWeeks: 38 });
    expect(result.map((r) => r.key)).toEqual([
      'anatomy_scan',
      'ogtt',
      'gbs',
      'tdap',
      'thalassemia',
    ]);
  });

  it('suppresses each check once its result/action is present', () => {
    const result = overdueInvestigations({
      gaWeeks: 38,
      anatomyScanDate: '2026-02-01',
      ogttResult: 'NORMAL',
      gbsResult: 'NEG',
      tdapGiven: true,
      mcvFl: 80,
      dcipResult: null,
      hbEResult: null,
    });
    expect(result).toEqual([]);
  });

  it('treats a PENDING OGTT/GBS as still overdue', () => {
    const ogtt = overdueInvestigations({ ...clear, gaWeeks: 31, ogttResult: 'PENDING' });
    expect(ogtt.map((r) => r.key)).toContain('ogtt');
    const gbs = overdueInvestigations({ ...clear, gaWeeks: 37, gbsResult: 'PENDING' });
    expect(gbs.map((r) => r.key)).toContain('gbs');
  });

  it('respects the GA boundaries (anatomy >22, ogtt >30, gbs/tdap thresholds)', () => {
    expect(overdueInvestigations({ ...clear, gaWeeks: 22 }).map((r) => r.key)).not.toContain(
      'anatomy_scan',
    );
    expect(overdueInvestigations({ ...clear, gaWeeks: 23 }).map((r) => r.key)).toContain(
      'anatomy_scan',
    );
    expect(overdueInvestigations({ ...clear, gaWeeks: 36 }).map((r) => r.key)).toContain('tdap');
    expect(overdueInvestigations({ ...clear, gaWeeks: 36 }).map((r) => r.key)).not.toContain('gbs');
    expect(overdueInvestigations({ ...clear, gaWeeks: 37 }).map((r) => r.key)).toContain('gbs');
  });
});
