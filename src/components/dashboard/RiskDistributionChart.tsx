// RiskDistributionChart — donut chart showing patient risk level distribution
'use client';

import {
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Tooltip,
} from 'recharts';
import type { DashboardSummary } from '@/types/api';
import { RISK_LEVELS } from '@/config/risk-levels';
import { RiskLevel } from '@/types/domain';

interface RiskDistributionChartProps {
  summary: DashboardSummary;
}

interface RiskSegment {
  name: string;
  labelTh: string;
  value: number;
  color: string;
}

function buildSegments(summary: DashboardSummary): RiskSegment[] {
  return [
    {
      name: 'HIGH',
      labelTh: RISK_LEVELS[RiskLevel.HIGH].labelTh,
      value: summary.totalHigh,
      color: RISK_LEVELS[RiskLevel.HIGH].color,
    },
    {
      name: 'MEDIUM',
      labelTh: RISK_LEVELS[RiskLevel.MEDIUM].labelTh,
      value: summary.totalMedium,
      color: RISK_LEVELS[RiskLevel.MEDIUM].color,
    },
    {
      name: 'LOW',
      labelTh: RISK_LEVELS[RiskLevel.LOW].labelTh,
      value: summary.totalLow,
      color: RISK_LEVELS[RiskLevel.LOW].color,
    },
  ];
}

function formatPercentage(value: number, total: number): string {
  if (total === 0) return '0%';
  return `${Math.round((value / total) * 100)}%`;
}

export function RiskDistributionChart({ summary }: RiskDistributionChartProps) {
  const segments = buildSegments(summary);
  const { totalActive } = summary;

  return (
    <div className="rounded-2xl bg-white p-6 shadow-[0_1px_3px_rgba(0,0,0,0.04),0_4px_12px_rgba(0,0,0,0.03)]">
      <h3 className="text-sm uppercase tracking-wider font-semibold text-slate-400">
        การกระจายระดับความเสี่ยง
      </h3>

      {totalActive === 0 ? (
        <div className="flex h-48 items-center justify-center text-sm text-slate-400">
          ไม่มีผู้คลอด
        </div>
      ) : (
        <>
          {/* Donut chart with center text */}
          <div className="relative mt-4" style={{ height: 200 }}>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={segments}
                  dataKey="value"
                  nameKey="labelTh"
                  cx="50%"
                  cy="50%"
                  innerRadius={55}
                  outerRadius={85}
                  paddingAngle={2}
                  animationDuration={800}
                >
                  {segments.map((seg) => (
                    <Cell key={seg.name} fill={seg.color} />
                  ))}
                </Pie>
                <Tooltip
                  formatter={(value, name) => [
                    `${value} ราย (${formatPercentage(Number(value), totalActive)})`,
                    name,
                  ]}
                />
              </PieChart>
            </ResponsiveContainer>

            {/* Center text overlay */}
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
              <span className="font-mono text-3xl font-bold text-slate-900">
                {totalActive}
              </span>
              <span className="text-sm text-slate-400">ผู้คลอด</span>
            </div>
          </div>

          {/* Custom legend */}
          <div className="mt-4 flex flex-col gap-2">
            {segments.map((seg) => (
              <div key={seg.name} className="flex items-center justify-between text-sm">
                <div className="flex items-center gap-2">
                  <span
                    className="inline-block h-2.5 w-2.5 rounded-full"
                    style={{ backgroundColor: seg.color }}
                    aria-hidden="true"
                  />
                  <span className="text-slate-600">{seg.labelTh}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="font-mono font-semibold text-slate-800">
                    {seg.value}
                  </span>
                  <span className="text-sm text-slate-400">
                    {formatPercentage(seg.value, totalActive)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
