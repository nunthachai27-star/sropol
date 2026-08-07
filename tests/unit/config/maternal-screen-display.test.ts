// Guards src/config/maternal-screen-display.ts:
//   1. Totality — every Record export covers every member of the union type
//      it displays (a new enum member must fail this test until the config
//      is updated, mirroring the compiler enforcement from the `Record<EnumType, string>`
//      annotations themselves).
//   2. GC-U1 regression lock — because the underlying rule set is
//      `PROVISIONAL_UNAPPROVED`, no color VALUE exported from this config may
//      be green (not `var(--risk-low)`, not `#22c55e`/`#16a34a`/`#dcfce7`, not
//      any CSS `green` keyword) — including `STABLE` and `NO_LOCAL_MATCH`,
//      which render in the same muted neutral as `UNKNOWN`. This check scans
//      the exported VALUES (not source comments, which legitimately discuss
//      "green" in prose explaining the rule).
//   3. GC-W1 (Phase 5 W2) — the kiosk Records
//      (`MATERNAL_SCREEN_TIER_COLOR_KIOSK`, `EMERGENCY_ACUITY_COLOR_KIOSK`)
//      get the same totality + no-green treatment, PLUS an explicit
//      `var(--kiosk-low)` ban — that var is a green
//      (`#4fb58a`, src/app/globals.css) that GREEN_PATTERNS above would not
//      otherwise catch.
import { describe, it, expect } from 'vitest';
import {
  MATERNAL_SCREEN_TIER_LABEL_TH,
  MATERNAL_SCREEN_TIER_COLOR,
  EMERGENCY_ACUITY_LABEL_TH,
  EMERGENCY_ACUITY_COLOR,
  MATERNAL_SCREEN_FALLBACK_COLOR,
  SUSPECTED_CONDITION_LABEL_TH,
  MATERNAL_SCREEN_TIER_COLOR_KIOSK,
  EMERGENCY_ACUITY_COLOR_KIOSK,
  MATERNAL_SCREEN_FALLBACK_COLOR_KIOSK,
} from '@/config/maternal-screen-display';
import type {
  MaternalScreenLocalTier,
  MaternalEmergencyAcuity,
  SuspectedMaternalCondition,
} from '@/types/maternal-screening';

// Authoritative member lists, mirroring the union declarations in
// src/types/maternal-screening.ts. Union types have no runtime
// representation, so these explicit arrays are how a *test* can assert
// totality (the compiler already enforces it structurally via the `Record<E, string>`
// annotations in the config file itself; this is the redundant runtime lock).
const ALL_LOCAL_TIERS: MaternalScreenLocalTier[] = [
  'LOCAL_MILD',
  'LOCAL_MODERATE',
  'LOCAL_SEVERE',
  'NO_LOCAL_MATCH',
];

const ALL_EMERGENCY_ACUITIES: MaternalEmergencyAcuity[] = [
  'STABLE',
  'URGENT',
  'EMERGENCY',
  'UNKNOWN',
];

const ALL_SUSPECTED_CONDITIONS: SuspectedMaternalCondition[] = [
  'PREECLAMPSIA',
  'ANTEPARTUM_HEMORRHAGE',
  'ABRUPTIO_PLACENTAE',
  'PLACENTA_PREVIA',
  'UTERINE_RUPTURE',
  'VASA_PREVIA',
];

/** Forbidden green tokens (GC-U1). Matched case-insensitively against each exported value. */
const GREEN_PATTERNS: RegExp[] = [
  /var\(--risk-low\)/i,
  /#22c55e/i,
  /#16a34a/i,
  /#dcfce7/i,
  /\bgreen\b/i,
  // GC-W1 (Phase 5 W2): `--kiosk-low` (#4fb58a, src/app/globals.css) is the
  // kiosk-palette green — banned from the maternal-screen kiosk records.
  /var\(--kiosk-low\)/i,
];

function assertNotGreen(label: string, value: string): void {
  for (const pattern of GREEN_PATTERNS) {
    expect(pattern.test(value), `${label} = "${value}" must not match ${pattern}`).toBe(false);
  }
}

describe('maternal-screen-display config', () => {
  describe('totality', () => {
    it('MATERNAL_SCREEN_TIER_LABEL_TH covers every MaternalScreenLocalTier member', () => {
      expect(Object.keys(MATERNAL_SCREEN_TIER_LABEL_TH).sort()).toEqual(
        [...ALL_LOCAL_TIERS].sort(),
      );
      for (const tier of ALL_LOCAL_TIERS) {
        expect(typeof MATERNAL_SCREEN_TIER_LABEL_TH[tier]).toBe('string');
        expect(MATERNAL_SCREEN_TIER_LABEL_TH[tier].length).toBeGreaterThan(0);
      }
    });

    it('MATERNAL_SCREEN_TIER_COLOR covers every MaternalScreenLocalTier member', () => {
      expect(Object.keys(MATERNAL_SCREEN_TIER_COLOR).sort()).toEqual([...ALL_LOCAL_TIERS].sort());
      for (const tier of ALL_LOCAL_TIERS) {
        expect(typeof MATERNAL_SCREEN_TIER_COLOR[tier]).toBe('string');
        expect(MATERNAL_SCREEN_TIER_COLOR[tier].length).toBeGreaterThan(0);
      }
    });

    it('EMERGENCY_ACUITY_LABEL_TH covers every MaternalEmergencyAcuity member', () => {
      expect(Object.keys(EMERGENCY_ACUITY_LABEL_TH).sort()).toEqual(
        [...ALL_EMERGENCY_ACUITIES].sort(),
      );
      for (const acuity of ALL_EMERGENCY_ACUITIES) {
        expect(typeof EMERGENCY_ACUITY_LABEL_TH[acuity]).toBe('string');
        expect(EMERGENCY_ACUITY_LABEL_TH[acuity].length).toBeGreaterThan(0);
      }
    });

    it('EMERGENCY_ACUITY_COLOR covers every MaternalEmergencyAcuity member', () => {
      expect(Object.keys(EMERGENCY_ACUITY_COLOR).sort()).toEqual(
        [...ALL_EMERGENCY_ACUITIES].sort(),
      );
      for (const acuity of ALL_EMERGENCY_ACUITIES) {
        expect(typeof EMERGENCY_ACUITY_COLOR[acuity]).toBe('string');
        expect(EMERGENCY_ACUITY_COLOR[acuity].length).toBeGreaterThan(0);
      }
    });

    it('SUSPECTED_CONDITION_LABEL_TH covers every SuspectedMaternalCondition member', () => {
      expect(Object.keys(SUSPECTED_CONDITION_LABEL_TH).sort()).toEqual(
        [...ALL_SUSPECTED_CONDITIONS].sort(),
      );
      for (const condition of ALL_SUSPECTED_CONDITIONS) {
        expect(typeof SUSPECTED_CONDITION_LABEL_TH[condition]).toBe('string');
        expect(SUSPECTED_CONDITION_LABEL_TH[condition].length).toBeGreaterThan(0);
        // GC4: suspected, never a bare diagnosis label.
        expect(SUSPECTED_CONDITION_LABEL_TH[condition]).toMatch(/สงสัย/);
      }
    });

    it('MATERNAL_SCREEN_TIER_COLOR_KIOSK covers every MaternalScreenLocalTier member', () => {
      expect(Object.keys(MATERNAL_SCREEN_TIER_COLOR_KIOSK).sort()).toEqual(
        [...ALL_LOCAL_TIERS].sort(),
      );
      for (const tier of ALL_LOCAL_TIERS) {
        expect(typeof MATERNAL_SCREEN_TIER_COLOR_KIOSK[tier]).toBe('string');
        expect(MATERNAL_SCREEN_TIER_COLOR_KIOSK[tier].length).toBeGreaterThan(0);
      }
    });

    it('EMERGENCY_ACUITY_COLOR_KIOSK covers every MaternalEmergencyAcuity member', () => {
      expect(Object.keys(EMERGENCY_ACUITY_COLOR_KIOSK).sort()).toEqual(
        [...ALL_EMERGENCY_ACUITIES].sort(),
      );
      for (const acuity of ALL_EMERGENCY_ACUITIES) {
        expect(typeof EMERGENCY_ACUITY_COLOR_KIOSK[acuity]).toBe('string');
        expect(EMERGENCY_ACUITY_COLOR_KIOSK[acuity].length).toBeGreaterThan(0);
      }
    });
  });

  describe('GC-U1 — nothing renders green', () => {
    it('no MATERNAL_SCREEN_TIER_COLOR value is green, including NO_LOCAL_MATCH', () => {
      for (const tier of ALL_LOCAL_TIERS) {
        assertNotGreen(`MATERNAL_SCREEN_TIER_COLOR.${tier}`, MATERNAL_SCREEN_TIER_COLOR[tier]);
      }
    });

    it('no EMERGENCY_ACUITY_COLOR value is green, including STABLE', () => {
      for (const acuity of ALL_EMERGENCY_ACUITIES) {
        assertNotGreen(`EMERGENCY_ACUITY_COLOR.${acuity}`, EMERGENCY_ACUITY_COLOR[acuity]);
      }
    });

    it('STABLE and NO_LOCAL_MATCH render identically to the muted fallback (never a distinct "confirmed-good" color)', () => {
      expect(EMERGENCY_ACUITY_COLOR.STABLE).toBe(MATERNAL_SCREEN_FALLBACK_COLOR);
      expect(EMERGENCY_ACUITY_COLOR.UNKNOWN).toBe(MATERNAL_SCREEN_FALLBACK_COLOR);
      expect(MATERNAL_SCREEN_TIER_COLOR.NO_LOCAL_MATCH).toBe(MATERNAL_SCREEN_FALLBACK_COLOR);
    });

    it('MATERNAL_SCREEN_FALLBACK_COLOR is the shared muted var, never green', () => {
      expect(MATERNAL_SCREEN_FALLBACK_COLOR).toBe('var(--ink-navy-muted)');
      assertNotGreen('MATERNAL_SCREEN_FALLBACK_COLOR', MATERNAL_SCREEN_FALLBACK_COLOR);
    });

    it('no label value anywhere in the config contains the word "green"', () => {
      const allLabels = [
        ...Object.values(MATERNAL_SCREEN_TIER_LABEL_TH),
        ...Object.values(EMERGENCY_ACUITY_LABEL_TH),
        ...Object.values(SUSPECTED_CONDITION_LABEL_TH),
      ];
      for (const label of allLabels) {
        expect(/\bgreen\b/i.test(label)).toBe(false);
      }
    });

    it('no MATERNAL_SCREEN_TIER_COLOR_KIOSK value is green, including NO_LOCAL_MATCH, and never equals --kiosk-low', () => {
      for (const tier of ALL_LOCAL_TIERS) {
        const value = MATERNAL_SCREEN_TIER_COLOR_KIOSK[tier];
        assertNotGreen(`MATERNAL_SCREEN_TIER_COLOR_KIOSK.${tier}`, value);
        expect(value).not.toBe('var(--kiosk-low)');
      }
    });

    it('no EMERGENCY_ACUITY_COLOR_KIOSK value is green, including STABLE, and never equals --kiosk-low', () => {
      for (const acuity of ALL_EMERGENCY_ACUITIES) {
        const value = EMERGENCY_ACUITY_COLOR_KIOSK[acuity];
        assertNotGreen(`EMERGENCY_ACUITY_COLOR_KIOSK.${acuity}`, value);
        expect(value).not.toBe('var(--kiosk-low)');
      }
    });

    it('kiosk STABLE and NO_LOCAL_MATCH render identically to the kiosk muted fallback (never --kiosk-low)', () => {
      expect(EMERGENCY_ACUITY_COLOR_KIOSK.STABLE).toBe(MATERNAL_SCREEN_FALLBACK_COLOR_KIOSK);
      expect(EMERGENCY_ACUITY_COLOR_KIOSK.UNKNOWN).toBe(MATERNAL_SCREEN_FALLBACK_COLOR_KIOSK);
      expect(MATERNAL_SCREEN_TIER_COLOR_KIOSK.NO_LOCAL_MATCH).toBe(
        MATERNAL_SCREEN_FALLBACK_COLOR_KIOSK,
      );
    });

    it('MATERNAL_SCREEN_FALLBACK_COLOR_KIOSK is the shared kiosk-dim var, never --kiosk-low', () => {
      expect(MATERNAL_SCREEN_FALLBACK_COLOR_KIOSK).toBe('var(--kiosk-dim)');
      assertNotGreen('MATERNAL_SCREEN_FALLBACK_COLOR_KIOSK', MATERNAL_SCREEN_FALLBACK_COLOR_KIOSK);
    });
  });
});
