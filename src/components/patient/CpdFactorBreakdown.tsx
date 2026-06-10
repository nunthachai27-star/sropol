// CpdFactorBreakdown — per-factor contribution to the CPD risk score.
// Redesigned 2026-04-21 (v3): semi-circular gauge for the total score,
// color-coded factor rows with an inline value, and a dashed missing-data
// pattern that's visually distinct from "present but 0 contribution". The
// goal is to let a clinician glance at this panel and identify which
// specific factor(s) are driving the risk.
'use client';

import { CheckCircle2, AlertTriangle, HelpCircle, Gauge } from 'lucide-react';
import { formatRelativeTime } from '@/lib/utils';
import { DEFAULT_PROVINCE_NAME } from '@/config/province';
import { CPD_FACTOR_WEIGHTS } from '@/config/risk-levels';

interface CpdFactorBreakdownProps {
  score: number;
  riskLevel: string; // 'LOW' | 'MEDIUM' | 'HIGH'
  factors: {
    gravida: number | null;
    ancCount: number | null;
    gaWeeks: number | null;
    heightCm: number | null;
    weightDiffKg: number | null;
    fundalHeightCm: number | null;
    usWeightG: number | null;
    hematocritPct: number | null;
  };
  missingFactors: string[];
  calculatedAt: string;
}

const FACTOR_MAX_SCORES: Record<string, number> = {
  gravida: 2,
  ancCount: 1.5,
  gaWeeks: 1.5,
  heightCm: 2,
  weightDiffKg: 2,
  fundalHeightCm: 2,
  usWeightG: 2,
  hematocritPct: 1.5,
};

const FACTOR_ORDER: (keyof CpdFactorBreakdownProps['factors'])[] = [
  'gravida',
  'ancCount',
  'gaWeeks',
  'heightCm',
  'weightDiffKg',
  'fundalHeightCm',
  'usWeightG',
  'hematocritPct',
];

const TOTAL_MAX_SCORE = Object.values(FACTOR_MAX_SCORES).reduce((sum, v) => sum + v, 0);

type FactorSeverity = 'normal' | 'partial' | 'abnormal' | 'missing';

function factorSeverity(
  contribution: number,
  maxScore: number,
  missing: boolean,
): FactorSeverity {
  if (missing) return 'missing';
  if (contribution <= 0) return 'normal';
  if (contribution < maxScore) return 'partial';
  return 'abnormal';
}

function severityColor(s: FactorSeverity): string {
  switch (s) {
    case 'abnormal': return 'var(--risk-high)';
    case 'partial':  return 'var(--risk-medium)';
    case 'missing':  return 'var(--ink-navy-muted)';
    default:         return 'var(--risk-low)';
  }
}

function severityBg(s: FactorSeverity): string {
  switch (s) {
    case 'abnormal': return 'color-mix(in srgb, #ef4444 10%, white)';
    case 'partial':  return 'color-mix(in srgb, #eab308 12%, white)';
    case 'missing':  return 'color-mix(in srgb, #6b7693 5%, white)';
    default:         return 'color-mix(in srgb, #22c55e 8%, white)';
  }
}

function riskTone(riskLevel: string): { color: string; label: string } {
  if (riskLevel === 'HIGH')   return { color: 'var(--risk-high)',   label: 'เสี่ยงสูง' };
  if (riskLevel === 'MEDIUM') return { color: 'var(--risk-medium)', label: 'เฝ้าระวัง' };
  return { color: 'var(--risk-low)', label: 'ปกติ' };
}

// Semi-circular gauge for total score. Renders a 180° arc with the risk-tone
// fill spanning 0..score/max, plus the numeric score centered inside.
function ScoreGauge({
  score,
  riskLevel,
  maxScore,
}: {
  score: number;
  riskLevel: string;
  maxScore: number;
}) {
  // PGlite NUMERIC → string coercion guard.
  const scoreNum = typeof score === 'number' ? score : Number(score);
  const tone = riskTone(riskLevel);
  const pct = Math.min((Number.isFinite(scoreNum) ? scoreNum : 0) / maxScore, 1);

  // Arc parameters
  const size = 140;
  const strokeWidth = 14;
  const cx = size / 2;
  const cy = size / 2 + 8; // push down so label fits
  const radius = (size - strokeWidth) / 2;

  const startAngle = Math.PI; // 180°
  const endAngle = 2 * Math.PI; // 360°
  const sweep = endAngle - startAngle;

  const angleAt = (p: number) => startAngle + sweep * p;

  const polarToCartesian = (angle: number) => {
    return {
      x: cx + radius * Math.cos(angle),
      y: cy + radius * Math.sin(angle),
    };
  };

  const buildArcPath = (p: number) => {
    if (p <= 0) return '';
    const start = polarToCartesian(startAngle);
    const end = polarToCartesian(angleAt(p));
    const largeArc = p > 0.5 ? 1 : 0;
    return `M ${start.x} ${start.y} A ${radius} ${radius} 0 ${largeArc} 1 ${end.x} ${end.y}`;
  };

  const trackPath = `M ${polarToCartesian(startAngle).x} ${polarToCartesian(startAngle).y}
     A ${radius} ${radius} 0 1 1 ${polarToCartesian(endAngle).x} ${polarToCartesian(endAngle).y}`;

  return (
    <div className="relative flex shrink-0 flex-col items-center" style={{ width: size }}>
      <svg width={size} height={size * 0.7} viewBox={`0 0 ${size} ${size * 0.7 + 8}`}>
        {/* Track */}
        <path
          d={trackPath}
          fill="none"
          stroke="var(--rule-hair)"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
        />
        {/* Progress */}
        <path
          d={buildArcPath(pct)}
          fill="none"
          stroke={tone.color}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
        />
        {/* Center label — score */}
        <text
          x={cx}
          y={cy - 4}
          textAnchor="middle"
          fontFamily="monospace"
          fontSize={30}
          fontWeight={700}
          fill="var(--ink-navy)"
          style={{ letterSpacing: '-0.03em' }}
        >
          {Number.isFinite(scoreNum) ? scoreNum.toFixed(scoreNum % 1 === 0 ? 0 : 2) : '—'}
        </text>
        <text
          x={cx}
          y={cy + 14}
          textAnchor="middle"
          fontFamily="monospace"
          fontSize={10}
          fill="var(--ink-navy-muted)"
          letterSpacing="0.1em"
        >
          / {maxScore}
        </text>
      </svg>
      <div
        className="mt-1 inline-flex items-center gap-1 rounded-sm px-2 py-0.5 font-mono text-[10px] font-bold tracking-[0.12em] text-white"
        style={{ background: tone.color }}
      >
        <AlertTriangle className="h-2.5 w-2.5" />
        {tone.label.toUpperCase()} · {riskLevel}
      </div>
    </div>
  );
}

function FactorRow({
  nameTh,
  contribution,
  maxScore,
  missing,
}: {
  nameTh: string;
  contribution: number;
  maxScore: number;
  missing: boolean;
}) {
  const sev = factorSeverity(contribution, maxScore, missing);
  const color = severityColor(sev);
  const bg = severityBg(sev);

  const icon =
    sev === 'abnormal' ? <AlertTriangle className="h-3 w-3" />
    : sev === 'missing' ? <HelpCircle className="h-3 w-3" />
    : sev === 'normal' ? <CheckCircle2 className="h-3 w-3" />
    : <AlertTriangle className="h-3 w-3" />;

  const pct = maxScore > 0 ? Math.min(contribution / maxScore, 1) * 100 : 0;

  return (
    <div
      className="flex items-center gap-2 px-2.5 py-1.5"
      style={{
        background: bg,
        borderLeft: `3px solid ${color}`,
      }}
    >
      <span style={{ color }}>{icon}</span>
      <span className="flex-1 text-[12px] text-[var(--ink-navy-dim)]">{nameTh}</span>
      {/* Contribution bar — visually encodes how much this factor pushed the
          score toward its maximum contribution (which maps to abnormal). */}
      <div
        className="relative h-2 w-24 shrink-0 overflow-hidden rounded-full"
        style={{ background: 'var(--rule-hair)' }}
      >
        <div
          className="absolute left-0 top-0 h-full transition-all"
          style={{
            width: missing ? 0 : `${pct}%`,
            background: color,
          }}
        />
      </div>
      <span
        className="inline-flex w-16 shrink-0 items-center justify-end rounded-sm px-1.5 py-0.5 font-mono text-[10px] font-bold tabular-nums"
        style={{
          color: sev === 'normal' || sev === 'missing' ? color : 'white',
          background: sev === 'normal' || sev === 'missing' ? 'transparent' : color,
        }}
      >
        {missing ? '—' : `+${contribution}/${maxScore}`}
      </span>
    </div>
  );
}

export function CpdFactorBreakdown({
  score,
  riskLevel,
  factors,
  missingFactors,
  calculatedAt,
}: CpdFactorBreakdownProps) {
  const missingCount = missingFactors.length;

  return (
    <div
      className="rounded-sm border"
      style={{ borderColor: 'var(--rule-strong)' }}
    >
      {/* Header strip with gauge on the right */}
      <div
        className="flex items-center gap-3 border-b px-3 py-2"
        style={{
          borderColor: 'var(--rule-strong)',
          background: 'linear-gradient(135deg, var(--accent-navy-soft) 0%, white 60%)',
        }}
      >
        <Gauge className="h-4 w-4" style={{ color: 'var(--accent-navy)' }} />
        <div className="flex-1">
          <h3 className="font-mono text-[12px] font-bold uppercase tracking-[0.12em] text-[var(--ink-navy)]">
            วิเคราะห์ปัจจัยเสี่ยง CPD
          </h3>
          <p className="font-mono text-[10px] text-[var(--ink-navy-muted)]">
            Cephalopelvic Disproportion · คะแนนรวม {Number(score)} / {TOTAL_MAX_SCORE}
          </p>
        </div>
        {missingCount > 0 && (
          <span
            className="inline-flex items-center gap-1 rounded-sm border px-1.5 py-0.5 font-mono text-[10px] font-bold tracking-[0.06em]"
            style={{
              color: 'var(--ink-navy-muted)',
              borderColor: 'var(--ink-navy-muted)',
              background: 'white',
            }}
          >
            <HelpCircle className="h-2.5 w-2.5" />
            {missingCount} ไม่มีข้อมูล
          </span>
        )}
      </div>

      {/* Gauge + legend row */}
      <div
        className="flex flex-wrap items-center justify-between gap-4 border-b px-3 py-3"
        style={{ borderColor: 'var(--rule-strong)' }}
      >
        <ScoreGauge score={score} riskLevel={riskLevel} maxScore={TOTAL_MAX_SCORE} />
        <div className="flex flex-1 flex-wrap gap-3 text-[11px]">
          <LegendSwatch color="var(--risk-low)" label="ปกติ · 0 คะแนน" />
          <LegendSwatch color="var(--risk-medium)" label="บางส่วน · 0 < คะแนน < max" />
          <LegendSwatch color="var(--risk-high)" label="ผิดปกติเต็ม · max คะแนน" />
          <LegendSwatch color="var(--ink-navy-muted)" label="ไม่มีข้อมูล" dashed />
        </div>
      </div>

      {/* Factor list — dense, colored rows */}
      <div className="flex flex-col gap-0.5 p-2">
        {FACTOR_ORDER.map((key) => {
          const factorConfig = CPD_FACTOR_WEIGHTS[key];
          const maxScore = FACTOR_MAX_SCORES[key];
          const isMissing = missingFactors.includes(key);
          // The API returns the CONTRIBUTION (post-evaluate), not the raw
          // clinical value, in `factors[key]`. See services/sync/cpd-persist.ts
          // where the `factor_*` columns are written from
          // `result.factorScores.*`. Trust what the API gave us.
          const stored = factors[key];
          const contribution = !isMissing && stored !== null ? Number(stored) : 0;
          return (
            <FactorRow
              key={key}
              nameTh={factorConfig.nameTh}
              contribution={contribution}
              maxScore={maxScore}
              missing={isMissing}
            />
          );
        })}
      </div>

      <div
        className="flex items-center justify-between border-t px-3 py-1.5 font-mono text-[10px] text-[var(--ink-navy-muted)]"
        style={{ borderColor: 'var(--rule-hair)' }}
      >
        <span>คำนวณเมื่อ {formatRelativeTime(calculatedAt)}</span>
        <span>CPD score · จ.{DEFAULT_PROVINCE_NAME}</span>
      </div>
    </div>
  );
}

function LegendSwatch({
  color,
  label,
  dashed,
}: {
  color: string;
  label: string;
  dashed?: boolean;
}) {
  return (
    <span className="inline-flex items-center gap-1.5 font-mono text-[10px] text-[var(--ink-navy-muted)]">
      <span
        className="inline-block h-2.5 w-4"
        style={{
          background: dashed ? undefined : color,
          borderLeft: dashed ? `3px dashed ${color}` : `3px solid ${color}`,
        }}
      />
      {label}
    </span>
  );
}
