// HighRiskPatientList — primary zone on the redesigned 2026-04-21 dashboard.
// Dense tabular view with partograph severity, vitals freshness, and clinical note.
// Kiosk mode: HN/AN only (no names) per privacy decision in the design chat.
'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { cn, formatRelativeTime, buildPatientId } from '@/lib/utils';
import { maskName } from '@/lib/pii-mask';
import type { CdssSeverity } from '@/types/api';
import type { MaternalScreenLocalTier, MaternalEmergencyAcuity } from '@/types/maternal-screening';
import { PartographCell, SectionLabel } from './shared';
import { MaternalScreenCell } from './MaternalScreenCell';

export interface HighRiskPatient {
  an: string;
  hn: string;
  name: string;
  age: number | null;
  gaWeeks: number | null;
  cpdScore: number;
  riskLevel: string;
  hospital: string;
  hcode: string;
  admitDate: string | null;
  lastVitalAt: string | null;
  partographSeverity?: CdssSeverity | null;
  partographAlertCount?: number | null;
  note?: string | null;
  // GC3: maternal labor-triage screening axes — a separate vocabulary from
  // partographSeverity/CdssSeverity above (never merge). Rendering these is
  // W2; this task only keeps the local copy in sync with src/types/api.ts.
  maternalScreenLocalTier?: MaternalScreenLocalTier | null;
  maternalScreenEmergencyAcuity?: MaternalEmergencyAcuity | null;
  maternalScreenIsComplete?: boolean | null;
  maternalScreenAssessedAt?: string | null;
}

export interface HighRiskPatientListProps {
  patients: HighRiskPatient[];
  isLoading?: boolean;
  variant?: 'light' | 'kiosk';
  maxRows?: number;
  /** ANC pressure shown in the empty state — with a quiet labor floor the
   *  panel would otherwise read as "nothing to watch" while high-risk
   *  pregnancies are approaching term. */
  ancFallback?: { hr3: number; dueSoon: number } | null;
  /** True population counts for the header/tab badges. The patients array is
   *  a row-limited fetch, so deriving counts from its length undercounts once
   *  the roster exceeds the cap — callers that hold real COUNTs (dashboard
   *  summary, per-hospital counts) pass them here. */
  totalActive?: number | null;
  totalHigh?: number | null;
}

function RiskChip({ riskLevel, variant }: { riskLevel: string; variant: 'light' | 'kiosk' }) {
  const isKiosk = variant === 'kiosk';
  const color =
    riskLevel === 'HIGH'
      ? isKiosk
        ? 'var(--kiosk-high)'
        : 'var(--risk-high)'
      : riskLevel === 'MEDIUM'
        ? isKiosk
          ? 'var(--kiosk-med)'
          : 'var(--risk-medium)'
        : isKiosk
          ? 'var(--kiosk-low)'
          : 'var(--risk-low)';

  return (
    <span
      data-risk={riskLevel}
      className={cn(
        'inline-block border px-1.5 py-0.5 text-center font-mono text-[13px] font-semibold tracking-[0.04em]',
        isKiosk && riskLevel === 'HIGH' && 'shadow-[0_0_8px_var(--kiosk-high)]',
      )}
      style={{
        color,
        borderColor: color,
        background: 'transparent',
      }}
    >
      {riskLevel}
    </span>
  );
}

function admitTime(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleTimeString('th-TH', {
    timeZone: 'Asia/Bangkok',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function vitalFreshness(iso: string | null): { text: string; stale: boolean } {
  if (!iso) return { text: 'no data', stale: true };
  return { text: formatRelativeTime(iso) ?? '—', stale: false };
}

function SkeletonRow({ variant }: { variant: 'light' | 'kiosk' }) {
  const barBg = variant === 'kiosk' ? 'bg-white/10' : 'bg-slate-200';
  return (
    <div
      className="grid items-center gap-2 border-b px-2 py-2"
      style={{
        gridTemplateColumns: '62px 130px 1fr 44px 44px 150px 58px 80px 110px 140px 220px',
        borderColor: variant === 'kiosk' ? 'var(--kiosk-rule)' : 'var(--rule-hair)',
      }}
    >
      {Array.from({ length: 11 }).map((_, i) => (
        <div key={i} className={cn('h-3 animate-pulse rounded', barBg)} />
      ))}
    </div>
  );
}

export function HighRiskPatientList({
  patients,
  isLoading = false,
  variant = 'light',
  maxRows,
  ancFallback,
  totalActive,
  totalHigh,
}: HighRiskPatientListProps) {
  const router = useRouter();
  const [tab, setTab] = useState<'high' | 'all'>('high');

  const sorted = useMemo(() => [...patients].sort((a, b) => b.cpdScore - a.cpdScore), [patients]);

  const shown = useMemo(() => {
    const base = tab === 'high' ? sorted.filter((p) => p.riskLevel === 'HIGH') : sorted;
    return maxRows ? base.slice(0, maxRows) : base;
  }, [sorted, tab, maxRows]);

  const counts = useMemo(
    () => ({
      high: totalHigh ?? sorted.filter((p) => p.riskLevel === 'HIGH').length,
      total: totalActive ?? sorted.length,
    }),
    [sorted, totalActive, totalHigh],
  );

  const isKiosk = variant === 'kiosk';
  const ruleStrong = isKiosk ? 'var(--kiosk-rule)' : 'var(--rule-strong)';
  const ruleHair = isKiosk ? 'var(--kiosk-rule)' : 'var(--rule-hair)';
  const ink = isKiosk ? 'var(--kiosk-ink)' : 'var(--ink-navy)';
  const inkDim = isKiosk ? 'var(--kiosk-dim)' : 'var(--ink-navy-dim)';
  const inkMuted = isKiosk ? 'var(--kiosk-dim)' : 'var(--ink-navy-muted)';
  const accent = isKiosk ? 'var(--kiosk-accent)' : 'var(--accent-navy)';

  // Column widths — kiosk drops name + note (privacy + space).
  // 'screen' (GC-W2) is a SEPARATE slot from 'partograph' — maternal
  // labor-triage screening axes never merge into partograph severity.
  const columns = isKiosk
    ? [
        { key: 'risk', label: 'RISK', w: 72 },
        { key: 'anhn', label: 'AN / HN', w: 140 },
        { key: 'ga', label: 'GA', w: 50 },
        { key: 'cpd', label: 'CPD', w: 50 },
        { key: 'hospital', label: 'HOSPITAL', w: 0 }, // flex 1
        { key: 'admit', label: 'ADMIT', w: 70 },
        { key: 'partograph', label: 'PARTOGRAPH', w: 120 },
        { key: 'screen', label: 'คัดกรอง (เงา)', w: 130 },
      ]
    : [
        { key: 'risk', label: 'RISK', w: 62 },
        { key: 'anhn', label: 'AN / HN', w: 130 },
        { key: 'patient', label: 'PATIENT', w: 0 }, // flex 1
        { key: 'ga', label: 'GA', w: 44 },
        { key: 'cpd', label: 'CPD', w: 44 },
        { key: 'hospital', label: 'HOSPITAL', w: 150 },
        { key: 'admit', label: 'ADMIT', w: 58 },
        { key: 'vital', label: 'LAST VITAL', w: 80 },
        { key: 'partograph', label: 'PARTOGRAPH', w: 110 },
        { key: 'screen', label: 'คัดกรอง (เงา)', w: 140 },
        { key: 'note', label: 'NOTE', w: 220 },
      ];

  // `minmax(180px, 1fr)` — not plain `1fr` — so a flex column shrinks below
  // its content's intrinsic min-size. Without this, a long truncated patient
  // name (which has `white-space: nowrap`) expanded the auto-min past the
  // header's, and each row resolved `1fr` to a different width — breaking
  // column alignment row-to-row (each row is its own grid container). The
  // 180px floor keeps the patient name readable when total width overflows.
  const gridCols = columns.map((c) => (c.w === 0 ? 'minmax(180px, 1fr)' : `${c.w}px`)).join(' ');

  return (
    <div>
      <SectionLabel idx={1} right={<span>AUTO-SORT · HIGH → MED · {counts.total} ACTIVE</span>}>
        High-risk &amp; Active labor
      </SectionLabel>

      {/* Tabs */}
      {!isKiosk && (
        <div className="mt-2.5 mb-2.5 flex gap-0 border-b" style={{ borderColor: ruleHair }}>
          {[
            { k: 'high', l: 'HIGH-RISK ONLY', n: counts.high },
            { k: 'all', l: 'ALL ACTIVE', n: counts.total },
          ].map((x) => (
            <button
              key={x.k}
              onClick={() => setTab(x.k as 'high' | 'all')}
              className={cn(
                'border-b-2 bg-transparent px-3.5 py-2 font-mono text-[13px] tracking-[0.08em]',
                tab === x.k ? 'font-semibold' : 'font-normal',
              )}
              style={{
                borderColor: tab === x.k ? accent : 'transparent',
                color: tab === x.k ? accent : inkMuted,
              }}
            >
              {x.l} <span style={{ color: inkMuted, fontWeight: 400 }}>· {x.n}</span>
            </button>
          ))}
        </div>
      )}

      {/* Table */}
      <div className="overflow-x-auto">
        {/* Header */}
        <div
          className="grid gap-2 border-t border-b px-2 py-2 font-mono text-[12px] tracking-[0.1em]"
          style={{
            gridTemplateColumns: gridCols,
            color: inkMuted,
            borderColor: ruleStrong,
          }}
        >
          {columns.map((c) => (
            <div key={c.key}>{c.label}</div>
          ))}
        </div>

        {/* Body */}
        {isLoading ? (
          <>
            {Array.from({ length: 5 }).map((_, i) => (
              <SkeletonRow key={i} variant={variant} />
            ))}
          </>
        ) : shown.length === 0 ? (
          <div
            className="border-b px-2 py-8 text-center font-mono text-[13px]"
            style={{ color: inkMuted, borderColor: ruleHair }}
          >
            <div>ไม่มีผู้คลอดเสี่ยงสูงในห้องคลอดขณะนี้</div>
            {ancFallback && (ancFallback.hr3 > 0 || ancFallback.dueSoon > 0) && (
              <div className="mt-2 flex flex-wrap items-center justify-center gap-x-3 gap-y-1">
                <span>เฝ้าระวังล่วงหน้า:</span>
                <Link
                  href="/pregnancies?risk=HR3"
                  className="underline decoration-dotted underline-offset-2"
                  style={{ color: 'var(--risk-high)' }}
                >
                  ครรภ์เสี่ยงสูง HR3 {ancFallback.hr3} ราย
                </Link>
                <Link
                  href="/pregnancies?cohort=due_soon"
                  className="underline decoration-dotted underline-offset-2"
                  style={{ color: 'var(--risk-medium)' }}
                >
                  ใกล้คลอด ≤14 วัน {ancFallback.dueSoon} ราย
                </Link>
              </div>
            )}
          </div>
        ) : (
          shown.map((p, i) => {
            const isHigh = p.riskLevel === 'HIGH';
            const isCritical = isHigh || p.partographSeverity === 'CRITICAL';
            const freshness = vitalFreshness(p.lastVitalAt);
            return (
              <div
                key={p.an}
                data-testid="patient-row"
                onClick={() => router.push(`/patients/${buildPatientId(p.hcode, p.an)}`)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    router.push(`/patients/${buildPatientId(p.hcode, p.an)}`);
                  }
                }}
                tabIndex={0}
                role="button"
                className={cn(
                  'grid cursor-pointer items-center gap-2 border-b px-2 text-sm transition-colors',
                  !isKiosk && 'hover:bg-slate-50',
                  isKiosk && 'hover:bg-white/5',
                )}
                style={{
                  gridTemplateColumns: gridCols,
                  height: isKiosk ? 56 : 44,
                  borderColor: ruleHair,
                  background:
                    i === 0 && isCritical
                      ? isKiosk
                        ? 'linear-gradient(to right, rgba(224,92,92,0.18), transparent 60%)'
                        : 'linear-gradient(to right, rgba(239,68,68,0.08), transparent 40%)'
                      : 'transparent',
                }}
              >
                <div>
                  <RiskChip riskLevel={p.riskLevel} variant={variant} />
                </div>
                <div className="font-mono" style={{ color: ink, fontSize: isKiosk ? 14 : 12 }}>
                  <div className="font-semibold">{p.an}</div>
                  <div
                    className="font-normal"
                    style={{ color: inkMuted, fontSize: isKiosk ? 11 : 10 }}
                  >
                    HN {p.hn}
                  </div>
                </div>
                {!isKiosk && (
                  <div style={{ color: ink, fontSize: 13 }}>
                    <div className="truncate">
                      {p.name ? maskName(p.name) : <span style={{ color: inkMuted }}>ไม่ระบุ</span>}
                    </div>
                    <div className="font-mono" style={{ color: inkMuted, fontSize: 11 }}>
                      {p.age != null ? `อายุ ${p.age}` : '—'}
                    </div>
                  </div>
                )}
                <div
                  className="font-mono tabular-nums"
                  style={{ color: ink, fontSize: isKiosk ? 18 : 13 }}
                >
                  {p.gaWeeks != null ? (
                    <>
                      {p.gaWeeks}
                      <span style={{ color: inkMuted, fontSize: isKiosk ? 11 : 10 }}>w</span>
                    </>
                  ) : (
                    '—'
                  )}
                </div>
                <div
                  className="font-mono font-semibold tabular-nums"
                  style={{
                    color:
                      p.cpdScore >= 6
                        ? isKiosk
                          ? 'var(--kiosk-high)'
                          : 'var(--risk-high)'
                        : p.cpdScore >= 4
                          ? isKiosk
                            ? 'var(--kiosk-med)'
                            : 'var(--risk-medium)'
                          : isKiosk
                            ? 'var(--kiosk-low)'
                            : 'var(--risk-low)',
                    fontSize: isKiosk ? 20 : 13,
                    textShadow:
                      isKiosk && p.cpdScore >= 4
                        ? `0 0 8px ${p.cpdScore >= 6 ? 'var(--kiosk-high)' : 'var(--kiosk-med)'}`
                        : 'none',
                  }}
                >
                  {p.cpdScore}
                </div>
                <div className="truncate" style={{ color: ink, fontSize: isKiosk ? 14 : 12 }}>
                  {p.hospital}
                </div>
                <div className="font-mono" style={{ color: ink, fontSize: isKiosk ? 14 : 12 }}>
                  {admitTime(p.admitDate)}
                </div>
                {!isKiosk && (
                  <div
                    className="font-mono"
                    style={{
                      color: freshness.stale ? inkMuted : inkDim,
                      fontSize: 11,
                    }}
                  >
                    {freshness.text}
                  </div>
                )}
                <div>
                  <PartographCell
                    severity={p.partographSeverity ?? null}
                    count={p.partographAlertCount ?? 0}
                    variant={variant}
                  />
                </div>
                <div>
                  <MaternalScreenCell
                    tier={p.maternalScreenLocalTier ?? null}
                    acuity={p.maternalScreenEmergencyAcuity ?? null}
                    isComplete={p.maternalScreenIsComplete ?? null}
                    assessedAt={p.maternalScreenAssessedAt ?? null}
                    variant={variant}
                  />
                </div>
                {!isKiosk && (
                  <div
                    className="truncate font-mono"
                    style={{ color: inkDim, fontSize: 11 }}
                    title={p.note ?? undefined}
                  >
                    {p.note ?? ''}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
