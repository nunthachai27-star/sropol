// ShiftSummary — "this shift vs. last" temporal signal for the coordinator.
// Lives in zone 06 of the redesigned dashboard. Wired to DashboardTrends as of
// 2026-04-21; previously showed static placeholder data.
'use client';

import type { DashboardTrends } from '@/types/api';

interface ShiftSummaryProps {
  trends: DashboardTrends;
}

export function ShiftSummary({ trends }: ShiftSummaryProps) {
  const { currentShift, previousShift } = trends;
  const rows: Array<[string, number, number]> = [
    ['ADMISSIONS', currentShift.admissions, previousShift.admissions],
    ['DELIVERED', currentShift.delivered, previousShift.delivered],
    ['REFERRED', currentShift.referred, previousShift.referred],
  ];

  return (
    <div className="border border-[var(--rule-strong)] bg-white p-4">
      <div className="flex items-center justify-between">
        <div className="font-mono text-[12px] uppercase tracking-[0.14em] text-[var(--ink-navy-muted)]">
          SHIFT SUMMARY
        </div>
        <div
          className="font-mono text-[12px] text-[var(--ink-navy-dim)]"
          title={`เวรปัจจุบันเริ่ม ${new Date(currentShift.windowStart).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' })}`}
        >
          {currentShift.label || '—'}
        </div>
      </div>
      <div className="mt-2.5 grid grid-cols-3 gap-2.5">
        {rows.map(([label, c, p]) => (
          <div key={label}>
            <div className="font-mono text-[11px] uppercase tracking-[0.12em] text-[var(--ink-navy-muted)]">
              {label}
            </div>
            <div className="flex items-baseline gap-1.5">
              <div className="font-mono text-[26px] font-semibold leading-none text-[var(--ink-navy)] tabular-nums">
                {c}
              </div>
              <div className="font-mono text-[12px] text-[var(--ink-navy-muted)]">
                vs {p} last
              </div>
            </div>
          </div>
        ))}
      </div>
      {previousShift.label && (
        <div className="mt-2 border-t border-[var(--rule-hair)] pt-1.5 font-mono text-[11px] text-[var(--ink-navy-muted)]">
          เปรียบเทียบกับ {previousShift.label}
        </div>
      )}
    </div>
  );
}
