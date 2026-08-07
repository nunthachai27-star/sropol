// Shared dashboard primitives — used by the redesigned 2026-04-21 main dashboard.
// Intentionally small, stateless, no data deps.
'use client';

import { cn } from '@/lib/utils';

// ─── RiskBar ─── proportional [low | med | high] strip
export function RiskBar({
  low,
  medium,
  high,
  height = 6,
  showNums = false,
  variant = 'light',
}: {
  low: number;
  medium: number;
  high: number;
  height?: number;
  showNums?: boolean;
  variant?: 'light' | 'kiosk';
}) {
  const total = Math.max(1, low + medium + high);
  const bg = variant === 'kiosk' ? 'bg-white/5' : 'bg-[var(--surface-sunken)]';
  const lowColor = variant === 'kiosk' ? 'var(--kiosk-low)' : 'var(--risk-low)';
  const medColor = variant === 'kiosk' ? 'var(--kiosk-med)' : 'var(--risk-medium)';
  const highColor = variant === 'kiosk' ? 'var(--kiosk-high)' : 'var(--risk-high)';

  const seg = (v: number, c: string) =>
    v > 0 ? <div style={{ flex: v, background: c }} /> : null;

  return (
    <div className="flex flex-col gap-1">
      <div
        className={cn('flex overflow-hidden', bg)}
        style={{ height, width: '100%' }}
      >
        {seg(low, lowColor)}
        {seg(medium, medColor)}
        {seg(high, highColor)}
      </div>
      {showNums && (
        <div className="flex gap-3 font-mono text-[13px]">
          <span style={{ color: lowColor }}>L {low}</span>
          <span style={{ color: medColor }}>M {medium}</span>
          <span style={{ color: highColor, fontWeight: 600 }}>H {high}</span>
        </div>
      )}
      <span className="sr-only">
        รวม {total} ราย: เสี่ยงต่ำ {low}, เสี่ยงปานกลาง {medium}, เสี่ยงสูง {high}
      </span>
    </div>
  );
}

// ─── StatCell ─── label / value / delta with accent left rail
export function StatCell({
  label,
  value,
  delta,
  color,
  className,
}: {
  label: string;
  value: number | string;
  delta?: number | null;
  color?: string;
  className?: string;
}) {
  const deltaColor =
    delta == null
      ? 'var(--ink-navy-muted)'
      : delta > 0
        ? 'var(--risk-high)'
        : delta < 0
          ? 'var(--risk-low)'
          : 'var(--ink-navy-muted)';
  const deltaStr =
    delta == null ? '' : (delta > 0 ? '▲ +' : delta < 0 ? '▼ ' : '· ') + Math.abs(delta);

  return (
    <div
      className={cn('flex flex-col gap-0.5 px-4 py-3', className)}
      style={{ borderLeft: `2px solid ${color || 'var(--accent-navy)'}` }}
    >
      <div className="font-mono text-[12px] uppercase tracking-[0.12em] text-[var(--ink-navy-muted)]">
        {label}
      </div>
      <div className="flex items-baseline gap-2">
        <div
          className="font-mono text-[28px] font-semibold leading-none text-[var(--ink-navy)] tabular-nums"
        >
          {value}
        </div>
        {delta != null && (
          <div className="font-mono text-[13px]" style={{ color: deltaColor }}>
            {deltaStr}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── SectionLabel ─── "01 / HIGH RISK" header
export function SectionLabel({
  idx,
  children,
  right,
}: {
  idx: number;
  children: React.ReactNode;
  right?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between pb-1.5">
      <div className="flex items-baseline gap-2">
        <span className="font-mono text-[12px] font-bold tracking-[0.14em] text-[var(--accent-navy)]">
          {String(idx).padStart(2, '0')}
        </span>
        <span className="text-[13px] font-semibold uppercase tracking-[0.14em] text-[var(--ink-navy)]">
          {children}
        </span>
      </div>
      {right && (
        <div className="font-mono text-[12px] tracking-[0.1em] text-[var(--ink-navy-muted)]">
          {right}
        </div>
      )}
    </div>
  );
}

// ─── PartographCell ─── 4-bar severity indicator (maps HOSxP CdssSeverity)
type PartographSeverity = 'INFO' | 'WARN' | 'ALERT' | 'CRITICAL' | null | undefined;

export function PartographCell({
  severity,
  count,
  variant = 'light',
}: {
  severity: PartographSeverity;
  count?: number;
  variant?: 'light' | 'kiosk';
}) {
  const isHigh = severity === 'ALERT' || severity === 'CRITICAL';
  const isWarn = severity === 'WARN';
  const lightColor = isHigh
    ? 'var(--risk-high)'
    : isWarn
      ? 'var(--risk-medium)'
      : 'var(--risk-low)';
  const kioskColor = isHigh
    ? 'var(--kiosk-high)'
    : isWarn
      ? 'var(--kiosk-med)'
      : 'var(--kiosk-low)';
  const color = variant === 'kiosk' ? kioskColor : lightColor;
  const filled = isHigh ? 4 : isWarn ? 3 : 2;
  const label = isHigh ? 'ALERT' : isWarn ? 'WARN' : 'OK';
  const inactiveBg =
    variant === 'kiosk' ? 'var(--kiosk-rule)' : 'var(--rule-hair)';

  return (
    <div className="flex items-center gap-1.5">
      <div className="flex gap-[2px]">
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            style={{
              width: 5,
              height: 14,
              background: i < filled ? color : inactiveBg,
              boxShadow: variant === 'kiosk' && i < filled ? `0 0 8px ${color}` : 'none',
            }}
          />
        ))}
      </div>
      <span className="font-mono text-[12px] tracking-[0.06em]" style={{ color }}>
        {label}
      </span>
      {count != null && count > 0 && (
        <span
          className="font-mono text-[12px]"
          style={{ color: variant === 'kiosk' ? 'var(--kiosk-dim)' : 'var(--ink-navy-muted)' }}
        >
          ·{count}
        </span>
      )}
    </div>
  );
}

// ─── BarStrip ─── tiny SVG histogram (for 24h admissions)
export function BarStrip({
  values,
  width = 280,
  height = 26,
  color = 'var(--accent-navy)',
}: {
  values: number[];
  width?: number;
  height?: number;
  color?: string;
}) {
  if (values.length === 0) return null;
  const max = Math.max(...values, 1);
  const bw = width / values.length;
  return (
    <svg width={width} height={height} className="block" role="img" aria-label="24-hour admissions">
      {values.map((v, i) => (
        <rect
          key={i}
          x={i * bw + 0.5}
          y={height - (v / max) * (height - 2)}
          width={Math.max(1, bw - 1)}
          height={(v / max) * (height - 2)}
          fill={color}
          opacity={v === 0 ? 0.2 : 0.85}
        />
      ))}
    </svg>
  );
}

// ─── EkgRibbon ─── signature motion across the top of kiosk
export function EkgRibbon({
  color = 'var(--kiosk-accent)',
  height = 22,
  opacity = 0.55,
}: {
  color?: string;
  height?: number;
  opacity?: number;
}) {
  const seg = 'l 20,0 l 4,-2 l 2,2 l 4,-6 l 2,12 l 4,-14 l 2,6 l 10,0 l 4,-2 l 20,0';
  const d = `M 0,${height / 2} ` + (seg + ' ').repeat(12);
  return (
    <div className="relative w-full overflow-hidden" style={{ height }}>
      <svg
        width="100%"
        height={height}
        viewBox={`0 0 800 ${height}`}
        preserveAspectRatio="none"
        className="block"
        aria-hidden="true"
      >
        <path
          d={d}
          fill="none"
          stroke={color}
          strokeWidth="1.4"
          opacity={opacity}
          strokeDasharray="600"
          className="animate-ekg"
        />
      </svg>
    </div>
  );
}
