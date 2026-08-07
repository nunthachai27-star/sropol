// MaternalScreenCell — compact chip pair for the two maternal labor-triage
// screening axes (Phase 5 W2,
// docs/superpowers/plans/2026-07-16-maternal-screening-ward.md Task W2).
//
// GC-W2 (binding): this cell is a SEPARATE column/slot from `PartographCell`
// — it never merges `localTier`/`emergencyAcuity` into `partographSeverity`/
// `CdssSeverity`, `AncRiskLevel`, or CPD `RISK_LEVELS`. Own `data-*`
// attributes, own component.
//
// GC-W1/GC-U1 (binding — do not "fix" this by adding green): the underlying
// rule set is `PROVISIONAL_UNAPPROVED` — NOTHING here may render green,
// including the kiosk palette's `--kiosk-low`. Colors come exclusively from
// `src/config/maternal-screen-display.ts` via the `TOKEN[value] ??
// FALLBACK` lookup (mirrors MaternalScreeningCard's TierChip/AcuityChip
// recipe) — never inline hex, never risk-levels.ts / cdss-presentation.ts.
//
// GC-W5: read-only propagation of already-computed props. No client-side
// re-derivation, no engine calls.
'use client';

import { cn } from '@/lib/utils';
import type { MaternalScreenLocalTier, MaternalEmergencyAcuity } from '@/types/maternal-screening';
import {
  MATERNAL_SCREEN_TIER_LABEL_TH,
  MATERNAL_SCREEN_TIER_COLOR,
  MATERNAL_SCREEN_TIER_COLOR_KIOSK,
  EMERGENCY_ACUITY_LABEL_TH,
  EMERGENCY_ACUITY_COLOR,
  EMERGENCY_ACUITY_COLOR_KIOSK,
  MATERNAL_SCREEN_FALLBACK_COLOR,
  MATERNAL_SCREEN_FALLBACK_COLOR_KIOSK,
} from '@/config/maternal-screen-display';
import { formatRelativeAge } from '@/lib/relative-time';

export interface MaternalScreenCellProps {
  tier: MaternalScreenLocalTier | null;
  acuity: MaternalEmergencyAcuity | null;
  isComplete: boolean | null;
  assessedAt: string | null;
  variant?: 'light' | 'kiosk';
}

const WRAPPER_TITLE = 'การคัดกรองท้องถิ่น (โหมดเงา — ยังไม่ได้รับการรับรอง)';
const INCOMPLETE_TITLE = 'การประเมินไม่สมบูรณ์';

function TierChip({
  tier,
  variant,
}: {
  tier: MaternalScreenLocalTier;
  variant: 'light' | 'kiosk';
}) {
  const isKiosk = variant === 'kiosk';
  const table = isKiosk ? MATERNAL_SCREEN_TIER_COLOR_KIOSK : MATERNAL_SCREEN_TIER_COLOR;
  const fallback = isKiosk ? MATERNAL_SCREEN_FALLBACK_COLOR_KIOSK : MATERNAL_SCREEN_FALLBACK_COLOR;
  const color = table[tier] ?? fallback;
  return (
    <span
      data-testid="maternal-screen-tier-chip"
      data-tier={tier}
      className={cn(
        'inline-block border px-1 py-0.5 font-mono font-semibold tracking-[0.03em]',
        isKiosk ? 'text-[11px]' : 'text-[10px]',
      )}
      style={{ color, borderColor: color, background: 'transparent' }}
    >
      {MATERNAL_SCREEN_TIER_LABEL_TH[tier] ?? tier}
    </span>
  );
}

function AcuityChip({
  acuity,
  variant,
}: {
  acuity: MaternalEmergencyAcuity;
  variant: 'light' | 'kiosk';
}) {
  const isKiosk = variant === 'kiosk';
  const table = isKiosk ? EMERGENCY_ACUITY_COLOR_KIOSK : EMERGENCY_ACUITY_COLOR;
  const fallback = isKiosk ? MATERNAL_SCREEN_FALLBACK_COLOR_KIOSK : MATERNAL_SCREEN_FALLBACK_COLOR;
  const color = table[acuity] ?? fallback;
  return (
    <span
      data-testid="maternal-screen-acuity-chip"
      data-acuity={acuity}
      className={cn(
        'inline-block border px-1 py-0.5 font-mono font-semibold tracking-[0.03em]',
        isKiosk ? 'text-[11px]' : 'text-[10px]',
      )}
      style={{ color, borderColor: color, background: 'transparent' }}
    >
      {EMERGENCY_ACUITY_LABEL_TH[acuity] ?? acuity}
    </span>
  );
}

/**
 * Compact tier + acuity chip pair for the high-risk list. Renders nothing
 * when both axes are null (flag-off rows, or rows with no screening data
 * yet) — the caller does not need to conditionally mount this component.
 */
export function MaternalScreenCell({
  tier,
  acuity,
  isComplete,
  assessedAt,
  variant = 'light',
}: MaternalScreenCellProps) {
  if (tier === null && acuity === null) return null;

  const isKiosk = variant === 'kiosk';
  const ageColor = isKiosk ? 'var(--kiosk-dim)' : 'var(--ink-navy-muted)';
  // Incomplete dot uses the medium/amber severity token (never green, never
  // the high/red token reserved for the emergency acuity chip) — mirrors
  // MaternalScreeningCard's history-row incomplete dot.
  const dotColor = isKiosk ? 'var(--kiosk-med)' : 'var(--risk-medium)';

  return (
    <div
      data-testid="maternal-screen-cell"
      title={WRAPPER_TITLE}
      className="flex flex-wrap items-center gap-1"
    >
      {tier !== null && <TierChip tier={tier} variant={variant} />}
      {acuity !== null && <AcuityChip acuity={acuity} variant={variant} />}
      {isComplete === false && (
        <span
          data-testid="maternal-screen-incomplete-dot"
          title={INCOMPLETE_TITLE}
          className="inline-block h-1.5 w-1.5 shrink-0 rounded-full"
          style={{ background: dotColor }}
        />
      )}
      {assessedAt !== null && (
        <span
          data-testid="maternal-screen-cell-age"
          className="font-mono text-[10px]"
          style={{ color: ageColor }}
        >
          {formatRelativeAge(assessedAt, 'short')}
        </span>
      )}
    </div>
  );
}
