// PatientHeader — patient identity band. Redesigned 2026-04-21 (v3): navy
// gradient canvas with white-on-navy primary identifier, color-tinted chips
// for status/admission/weight, and a risk-colored CPD tile on the right that
// promotes the single most-important number to page-level prominence.
'use client';

import { ConnectionStatus } from '@/components/shared/ConnectionStatus';
import { formatThaiDate } from '@/lib/utils';
import { maskName } from '@/lib/pii-mask';
import { RiskLevel } from '@/types/domain';
import type { ConnectionStatus as ConnectionStatusEnum } from '@/types/domain';
import {
  User,
  Calendar,
  Scale,
  Hospital,
  Activity,
  AlertTriangle,
  ShieldCheck,
} from 'lucide-react';
import type { ReactNode } from 'react';

interface PatientHeaderProps {
  hn: string;
  an: string;
  name: string;
  age: number;
  admitDate: string;
  laborStatus: string;
  weightKg?: number | null;
  weightDiffKg?: number | null;
  hospital: {
    name: string;
    level: string;
    connectionStatus?: ConnectionStatusEnum;
    lastSyncAt?: string | null;
  };
  cpdScore?: {
    score: number;
    riskLevel: RiskLevel;
  } | null;
}

function weightDiffTone(diff: number): { color: string; label: string } {
  if (diff > 20) return { color: '#fca5a5', label: 'เกินเกณฑ์' };
  if (diff > 15) return { color: '#fde68a', label: 'ขอบเขต' };
  return { color: '#86efac', label: 'ปกติ' };
}

function Chip({
  icon,
  label,
  value,
  tone = 'default',
  highlight,
}: {
  icon: ReactNode;
  label: string;
  value: ReactNode;
  tone?: 'default' | 'accent' | 'warn' | 'ok';
  highlight?: string;
}) {
  const palette = {
    default: { bg: 'rgba(255,255,255,0.08)', fg: 'rgba(255,255,255,0.85)', label: 'rgba(255,255,255,0.55)' },
    accent:  { bg: 'rgba(255,232,154,0.14)', fg: '#ffe89a', label: 'rgba(255,232,154,0.75)' },
    warn:    { bg: 'rgba(252,165,165,0.14)', fg: '#fecaca', label: 'rgba(254,202,202,0.8)' },
    ok:      { bg: 'rgba(134,239,172,0.14)', fg: '#bbf7d0', label: 'rgba(187,247,208,0.8)' },
  }[tone];
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-sm px-2 py-0.5 font-mono text-[11px]"
      style={{ background: palette.bg, color: palette.fg }}
    >
      <span className="flex h-3 w-3 items-center justify-center" style={{ color: palette.label }}>
        {icon}
      </span>
      <span style={{ color: palette.label }}>{label}</span>
      <span className="font-semibold tabular-nums" style={{ color: highlight ?? palette.fg }}>
        {value}
      </span>
    </span>
  );
}

function CpdTile({ score, riskLevel }: { score: number; riskLevel: RiskLevel }) {
  // PGlite returns NUMERIC columns as strings in some code paths — coerce to
  // a real number so toFixed() can format the score.
  const scoreNum = typeof score === 'number' ? score : Number(score);
  const tone =
    riskLevel === RiskLevel.HIGH
      ? { bg: '#7f1d1d', accent: '#fecaca', label: 'เสี่ยงสูง', icon: <AlertTriangle className="h-4 w-4" /> }
      : riskLevel === RiskLevel.MEDIUM
        ? { bg: '#78350f', accent: '#fde68a', label: 'เฝ้าระวัง', icon: <AlertTriangle className="h-4 w-4" /> }
        : { bg: '#14532d', accent: '#bbf7d0', label: 'ปกติ', icon: <ShieldCheck className="h-4 w-4" /> };
  return (
    <div
      className="relative flex shrink-0 flex-col items-end justify-between gap-1 rounded-sm px-4 py-3"
      style={{
        background: `linear-gradient(135deg, ${tone.bg}, rgba(0,0,0,0.25))`,
        minWidth: 160,
        boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.12)',
      }}
    >
      <div
        className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.14em]"
        style={{ color: tone.accent }}
      >
        {tone.icon}
        CPD Score
      </div>
      <div className="flex items-baseline gap-1.5 tabular-nums" style={{ color: 'white' }}>
        <span
          className="font-mono text-[34px] font-bold leading-none"
          style={{ letterSpacing: '-0.03em' }}
        >
          {Number.isFinite(scoreNum) ? scoreNum.toFixed(scoreNum % 1 === 0 ? 0 : 2) : '—'}
        </span>
        <span className="font-mono text-[11px]" style={{ color: tone.accent }}>
          / 14.5
        </span>
      </div>
      <div
        className="font-mono text-[10px] font-semibold tracking-[0.12em]"
        style={{ color: tone.accent }}
      >
        {tone.label.toUpperCase()} · {riskLevel}
      </div>
    </div>
  );
}

export function PatientHeader({
  hn,
  an,
  name,
  age,
  admitDate,
  laborStatus,
  weightKg,
  weightDiffKg,
  hospital,
  cpdScore,
}: PatientHeaderProps) {
  const showWeight = weightKg != null && weightDiffKg != null && weightKg > 0 && weightDiffKg > 0;
  const preWeight = showWeight ? weightKg - weightDiffKg : null;
  const weightTone = weightDiffKg != null && weightDiffKg > 15 ? weightDiffTone(weightDiffKg) : null;

  const statusMeta =
    laborStatus === 'ACTIVE'
      ? { bg: 'rgba(134,239,172,0.18)', fg: '#bbf7d0', label: 'คลอดอยู่', dot: '#4ade80' }
      : { bg: 'rgba(255,255,255,0.08)', fg: 'rgba(255,255,255,0.75)', label: 'คลอดแล้ว', dot: 'rgba(255,255,255,0.5)' };

  return (
    <div
      className="relative overflow-hidden px-6 py-4"
      style={{
        background:
          'linear-gradient(135deg, #0c1530 0%, #1e2a6a 55%, #2b3a8c 100%)',
        color: 'white',
      }}
    >
      {/* Decorative radial accent — provincial network signature */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage:
            'radial-gradient(circle at 95% 8%, rgba(255,232,154,0.18), transparent 45%), radial-gradient(circle at 3% 110%, rgba(87,196,255,0.14), transparent 55%)',
        }}
      />

      <div className="relative flex items-start justify-between gap-6">
        <div className="min-w-0 flex-1">
          {/* Primary identity row — name + status + AN/HN */}
          <div className="flex flex-wrap items-center gap-2.5">
            <h1
              className="truncate text-[24px] font-bold leading-tight"
              style={{ letterSpacing: '-0.015em', textShadow: '0 1px 2px rgba(0,0,0,0.3)' }}
            >
              {name ? maskName(name) : 'ไม่ทราบชื่อ'}
            </h1>
            <span
              className="inline-flex shrink-0 items-center gap-1.5 rounded-sm px-2 py-0.5 font-mono text-[10px] font-semibold tracking-[0.08em]"
              style={{ background: statusMeta.bg, color: statusMeta.fg }}
            >
              <span
                className="h-1.5 w-1.5 rounded-full"
                style={{
                  background: statusMeta.dot,
                  boxShadow: laborStatus === 'ACTIVE' ? `0 0 0 3px ${statusMeta.dot}33` : undefined,
                }}
              />
              {statusMeta.label}
            </span>
          </div>

          {/* Identifier chips */}
          <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
            <Chip
              icon={<User className="h-3 w-3" />}
              label="AN"
              value={an}
              tone="accent"
            />
            <Chip
              icon={<User className="h-3 w-3" />}
              label="HN"
              value={hn}
            />
            <Chip
              icon={<Calendar className="h-3 w-3" />}
              label="อายุ"
              value={<>{age}<span className="ml-0.5 font-normal opacity-70">ปี</span></>}
            />
            <Chip
              icon={<Activity className="h-3 w-3" />}
              label="Admit"
              value={formatThaiDate(new Date(admitDate))}
            />
            {showWeight && preWeight !== null && weightDiffKg !== null && (
              <Chip
                icon={<Scale className="h-3 w-3" />}
                label="น.น."
                tone={weightTone ? 'warn' : 'default'}
                value={
                  <>
                    <span className="opacity-75">{preWeight}</span>
                    <span className="mx-0.5 opacity-50">→</span>
                    <span>{weightKg}</span>
                    <span className="mx-0.5 opacity-50">=</span>
                    <span
                      style={{ color: weightTone?.color ?? '#bbf7d0' }}
                    >
                      +{weightDiffKg}
                    </span>
                    <span className="ml-0.5 text-[10px] opacity-60">กก.</span>
                  </>
                }
              />
            )}
          </div>

          {/* Hospital row — shown as a distinct bar under the chips */}
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span
              className="inline-flex items-center gap-1.5 rounded-sm px-2 py-0.5 font-mono text-[10px] tracking-[0.04em]"
              style={{
                background: 'rgba(255,255,255,0.09)',
                color: 'rgba(255,255,255,0.88)',
                boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.12)',
              }}
            >
              <Hospital className="h-3 w-3 opacity-70" />
              <span className="font-semibold">{hospital.name}</span>
              <span className="opacity-60">·{hospital.level}</span>
            </span>
            {hospital.connectionStatus && (
              <span
                className="inline-flex items-center gap-1.5 rounded-sm px-2 py-0.5 font-mono text-[10px]"
                style={{
                  background: 'rgba(255,255,255,0.06)',
                  color: 'rgba(255,255,255,0.78)',
                }}
              >
                <ConnectionStatus
                  status={hospital.connectionStatus}
                  lastSyncAt={hospital.lastSyncAt ?? null}
                  className="text-[10px]"
                />
              </span>
            )}
          </div>
        </div>

        {cpdScore && <CpdTile score={cpdScore.score} riskLevel={cpdScore.riskLevel} />}
      </div>
    </div>
  );
}
