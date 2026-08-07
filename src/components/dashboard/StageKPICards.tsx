// StageKPICards — care-continuum 3-up strip. Each card links to its board
// (2026-07-09): the dashboard summarises, the boards operate. The delivered
// card is labeled by its real window (Bangkok month — it previously said
// "24h" over a monthly query).
'use client';

import Link from 'next/link';
import type { DashboardStageKPIs } from '@/types/api';

interface StageKPICardsProps {
  stageKPIs: DashboardStageKPIs;
}

interface StageCardProps {
  title: string;
  total: number;
  href: string;
  rows: Array<[string, number, string]>;
}

function StageCard({ title, total, href, rows }: StageCardProps) {
  return (
    <Link
      href={href}
      className="block border border-[var(--rule-strong)] bg-white p-3.5 transition-colors hover:bg-[var(--accent-navy-soft)]"
    >
      <div className="flex items-baseline justify-between">
        <div className="text-[15px] font-semibold text-[var(--ink-navy)]">{title}</div>
        <div className="font-mono text-[28px] font-semibold tabular-nums text-[var(--ink-navy)]">
          {total}
        </div>
      </div>
      <div className="mt-2.5 flex flex-col gap-1">
        {rows.map(([label, value, color]) => (
          <div
            key={label}
            className="flex items-center gap-2 font-mono text-[13px] text-[var(--ink-navy-dim)]"
          >
            <div style={{ width: 6, height: 6, background: color }} aria-hidden="true" />
            <div className="flex-1">{label}</div>
            <div className="font-semibold tabular-nums text-[var(--ink-navy)]">{value}</div>
          </div>
        ))}
      </div>
    </Link>
  );
}

export function StageKPICards({ stageKPIs }: StageKPICardsProps) {
  return (
    <div className="grid grid-cols-1 gap-2.5 md:grid-cols-3">
      <StageCard
        title="ANC กำลังติดตาม"
        total={stageKPIs.pregnancy.total}
        href="/pregnancies"
        rows={[
          ['LOW', stageKPIs.pregnancy.low, 'var(--risk-low)'],
          ['HR1', stageKPIs.pregnancy.hr1, 'var(--risk-medium)'],
          ['HR2', stageKPIs.pregnancy.hr2, 'var(--risk-medium)'],
          ['HR3', stageKPIs.pregnancy.hr3, 'var(--risk-high)'],
        ]}
      />
      <StageCard
        title="ในห้องคลอด"
        total={stageKPIs.labor.total}
        href="/hospitals"
        rows={[
          ['LOW', stageKPIs.labor.low, 'var(--risk-low)'],
          ['MED', stageKPIs.labor.medium, 'var(--risk-medium)'],
          ['HIGH', stageKPIs.labor.high, 'var(--risk-high)'],
        ]}
      />
      <StageCard
        title="คลอดแล้ว · เดือนนี้"
        total={stageKPIs.delivered.total}
        href="/outcomes"
        rows={[
          ['NORMAL', stageKPIs.delivered.normal, 'var(--risk-low)'],
          ['LOW APGAR', stageKPIs.delivered.lowApgar, 'var(--risk-medium)'],
          ['LBW', stageKPIs.delivered.lbw, 'var(--risk-high)'],
        ]}
      />
    </div>
  );
}
