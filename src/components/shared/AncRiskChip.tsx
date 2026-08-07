// ANC risk chip — bordered mono chip in the shared risk palette. Used by the
// referrals board (via components/referrals/chips) and the pregnancies board.
'use client';

import { ANC_RISK_COLOR, ANC_RISK_FALLBACK_COLOR } from '@/config/anc-risk-display';

export function AncRiskChip({ level }: { level: string }) {
  const color = ANC_RISK_COLOR[level] ?? ANC_RISK_FALLBACK_COLOR;
  return (
    <span
      data-risk={level}
      className="inline-block border px-1 py-px font-mono text-[12px] font-semibold tracking-[0.04em]"
      style={{ color, borderColor: color, background: 'transparent' }}
    >
      {level}
    </span>
  );
}
