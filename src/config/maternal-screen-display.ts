// Maternal labor-triage screening — display tokens (colors + Thai labels),
// modeled on src/config/anc-risk-display.ts. NEW module per GC-U4: this does
// NOT extend risk-levels.ts (CPD-specific) and does NOT reuse
// cdss-presentation.ts's tokens or location — `localTier`/`emergencyAcuity`/
// `suspectedConditions` are a distinct vocabulary from ANC (`AncRiskLevel`)
// and partograph (`CdssSeverity`) severity (GC3, src/types/maternal-screening.ts).
//
// GC-U1 (binding — do not "fix" this by adding green):
// The underlying rule set (`MATERNAL_SCREEN_RULE_SET_VERSION`,
// src/config/maternal-screen-rules.ts) is `PROVISIONAL_UNAPPROVED` — no
// clinician has signed off on it (docs/clinical/maternal-screen-rules-v1.yaml,
// maternal-screen-acuity-v1.yaml both carry `approvedBy: null`). Because of
// that, NOTHING in this file may render green/reassuring, including the
// "nothing wrong found" states: `NO_LOCAL_MATCH` and `STABLE` deliberately
// render in the same muted neutral as `UNKNOWN` — NOT `var(--risk-low)`, not
// `#22c55e`, not any green — because a provisional, unapproved rule set
// cannot be trusted to assert "this patient is fine" with a reassuring color.
// Muted here means "the local rules found nothing / could not determine",
// not "confirmed normal". Introducing green anywhere in this file is a
// Phase-0 clinical sign-off decision (tracked in the plan's Phase-0 open
// decisions), never a routine styling change — see
// tests/unit/config/maternal-screen-display.test.ts for the regression lock.
//
// GC-W1/GC-U1 (kiosk records, Phase 5 W2): `--kiosk-low` (src/app/globals.css)
// is a green (`#4fb58a`) used elsewhere for "confirmed low risk" — it is
// BANNED from `MATERNAL_SCREEN_TIER_COLOR_KIOSK` and
// `EMERGENCY_ACUITY_COLOR_KIOSK` below for the exact same provisional-rule-set
// reason as the light-mode Records above. Muted/dim states use
// `var(--kiosk-dim)`, never `var(--kiosk-low)`, while the rule set remains
// unapproved.
//
// All Records below are typed `Record<EnumType, string>` (not
// `Record<string, string>`) so the compiler enforces totality over every
// union member in src/types/maternal-screening.ts — a new enum member fails
// `tsc --noEmit` here until this file is updated.
import type {
  MaternalScreenLocalTier,
  MaternalEmergencyAcuity,
  SuspectedMaternalCondition,
} from '@/types/maternal-screening';

/** Thai label for each `localTier` value (spec §10.2). */
export const MATERNAL_SCREEN_TIER_LABEL_TH: Record<MaternalScreenLocalTier, string> = {
  LOCAL_MILD: 'ระดับเฝ้าระวัง (ท้องถิ่น)',
  LOCAL_MODERATE: 'ระดับปานกลาง (ท้องถิ่น)',
  LOCAL_SEVERE: 'ระดับรุนแรง (ท้องถิ่น)',
  NO_LOCAL_MATCH: 'ไม่เข้าเกณฑ์ท้องถิ่น',
};

/**
 * Chip color for each `localTier` value. `NO_LOCAL_MATCH` is the muted
 * neutral, never green (GC-U1) — "no local tier matched" is not the same as
 * "confirmed normal" under a provisional, unapproved rule set.
 */
export const MATERNAL_SCREEN_TIER_COLOR: Record<MaternalScreenLocalTier, string> = {
  LOCAL_SEVERE: 'var(--risk-high)',
  LOCAL_MODERATE: '#f97316', // orange — CDSS-ALERT hue precedent, distinct from ANC/CPD palettes (GC-U2/GC3)
  LOCAL_MILD: 'var(--risk-medium)',
  NO_LOCAL_MATCH: 'var(--ink-navy-muted)',
};

/** Thai label for each `emergencyAcuity` value (spec §10.2). */
export const EMERGENCY_ACUITY_LABEL_TH: Record<MaternalEmergencyAcuity, string> = {
  EMERGENCY: 'ฉุกเฉิน',
  URGENT: 'เร่งด่วน',
  STABLE: 'คงที่ (โหมดเงา)',
  UNKNOWN: 'ไม่ทราบ (ข้อมูลไม่พอ)',
};

/**
 * Chip color for each `emergencyAcuity` value. `STABLE` is deliberately the
 * SAME muted neutral as `UNKNOWN` (GC-U1) — under a `PROVISIONAL_UNAPPROVED`
 * rule set, "stable" is not rendered as reassuring green; it is rendered
 * exactly as neutrally as "we don't know". Confirmed-good (green) coloring
 * for `STABLE` is a Phase-0 clinical sign-off decision, not a default.
 */
export const EMERGENCY_ACUITY_COLOR: Record<MaternalEmergencyAcuity, string> = {
  EMERGENCY: 'var(--risk-high)',
  URGENT: 'var(--risk-medium)',
  STABLE: 'var(--ink-navy-muted)', // NOT green — GC-U1; see header comment
  UNKNOWN: 'var(--ink-navy-muted)',
};

/** Fallback chip color for any value not covered above (should be unreachable — totality is compiler-enforced). */
export const MATERNAL_SCREEN_FALLBACK_COLOR = 'var(--ink-navy-muted)';

/**
 * Kiosk (dark-theme) chip color for each `localTier` value (Phase 5 W2,
 * `docs/superpowers/plans/2026-07-16-maternal-screening-ward.md` GC-W1/GC-W4).
 * Mirrors `MATERNAL_SCREEN_TIER_COLOR` but sourced from `--kiosk-*` vars —
 * `--kiosk-low` (green) is NEVER used here; `NO_LOCAL_MATCH` uses the same
 * muted `--kiosk-dim` as the light-mode fallback, never a distinct
 * "confirmed-good" color (GC-U1).
 */
export const MATERNAL_SCREEN_TIER_COLOR_KIOSK: Record<MaternalScreenLocalTier, string> = {
  LOCAL_SEVERE: 'var(--kiosk-high)',
  LOCAL_MODERATE: 'var(--kiosk-med)',
  LOCAL_MILD: 'var(--kiosk-med)',
  NO_LOCAL_MATCH: 'var(--kiosk-dim)',
};

/**
 * Kiosk (dark-theme) chip color for each `emergencyAcuity` value (Phase 5
 * W2). `STABLE` is deliberately the same muted `--kiosk-dim` as `UNKNOWN` —
 * NOT `--kiosk-low` — for the same GC-U1 reason as `EMERGENCY_ACUITY_COLOR`.
 */
export const EMERGENCY_ACUITY_COLOR_KIOSK: Record<MaternalEmergencyAcuity, string> = {
  EMERGENCY: 'var(--kiosk-high)',
  URGENT: 'var(--kiosk-med)',
  STABLE: 'var(--kiosk-dim)', // NOT --kiosk-low (green) — GC-U1/GC-W1
  UNKNOWN: 'var(--kiosk-dim)',
};

/** Kiosk fallback chip color for any value not covered above. Never `--kiosk-low`. */
export const MATERNAL_SCREEN_FALLBACK_COLOR_KIOSK = 'var(--kiosk-dim)';

/**
 * Thai label for each `SuspectedMaternalCondition` member, prefixed as
 * "suspected" ("สงสัย") — never presented as a confirmed diagnosis (GC4,
 * spec §6.2).
 */
export const SUSPECTED_CONDITION_LABEL_TH: Record<SuspectedMaternalCondition, string> = {
  PREECLAMPSIA: 'สงสัยภาวะครรภ์เป็นพิษ',
  ANTEPARTUM_HEMORRHAGE: 'สงสัยภาวะเลือดออกก่อนคลอด',
  ABRUPTIO_PLACENTAE: 'สงสัยรกลอกตัวก่อนกำหนด',
  PLACENTA_PREVIA: 'สงสัยรกเกาะต่ำ',
  UTERINE_RUPTURE: 'สงสัยมดลูกแตก',
  VASA_PREVIA: 'สงสัยหลอดเลือดเกาะต่ำ (vasa previa)',
};
