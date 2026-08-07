// BedTile — clinical bed card with severity accent, cervix-dilation progress,
// time-in-labor, last-observation freshness, and in-charge doctor.
// Design: ui-ux-pro-max healthcare-ops dashboard pattern. Severity is encoded
// via color AND position (left-edge bar) AND text so it's still distinguishable
// under color-blindness or monochrome printing (WCAG color-not-only).
//
// NOTE (Phase 6 Task H4, docs/superpowers/plans/2026-07-17-maternal-screening-hosxp.md):
// this compact tile deliberately does NOT render the maternal-screen tier/
// acuity pills — no room in this card's layout. BedTileFull is the ward's
// working view and is where the pills live (see BedTileFull.tsx's
// `maternalScreenSummary` prop / `bed-maternal-screen` slot).
'use client';

import { useState } from 'react';
import { Lock, Clock, Stethoscope, Activity } from 'lucide-react';
import { cn, calculateAge, formatRelativeTime } from '@/lib/utils';
import { maskName } from '@/lib/pii-mask';
import type { BedOccupancy } from '@/types/maternity-ward';

export interface BedTileProps {
  bedno: string;
  bedLock: 'Y' | 'N' | null;
  occupant?: BedOccupancy | null;
  onClick?: (an: string) => void;
  /** Live-tick "now" in ms. Passed down so all tiles share a single render cadence. */
  now?: number;
}

type Severity = 'critical' | 'warning' | 'normal' | 'unknown';

interface SeverityToken {
  accent: string; // left-edge bar color
  dot: string; // status dot bg
  ring: string; // hover/focus ring
  label: string; // Thai label for sr-only + tooltip
  bar: string; // progress-bar filled color
}

const SEVERITY: Record<Severity, SeverityToken> = {
  critical: {
    accent: 'bg-rose-500',
    dot: 'bg-rose-500',
    ring: 'focus:ring-rose-500',
    label: 'เสี่ยงสูง',
    bar: 'bg-rose-500',
  },
  warning: {
    accent: 'bg-amber-500',
    dot: 'bg-amber-500',
    ring: 'focus:ring-amber-500',
    label: 'เฝ้าระวัง',
    bar: 'bg-amber-500',
  },
  normal: {
    accent: 'bg-emerald-500',
    dot: 'bg-emerald-500',
    ring: 'focus:ring-emerald-500',
    label: 'ปกติ',
    bar: 'bg-emerald-500',
  },
  // "unknown" = no active partograph yet; keep the accent bar barely visible
  // so it doesn't compete with the clinical signals in the room.
  unknown: {
    accent: 'bg-slate-200',
    dot: 'bg-slate-300',
    ring: 'focus:ring-emerald-500',
    label: 'ยังไม่ประเมิน',
    bar: 'bg-slate-400',
  },
};

function safeAge(birthday: string | null): number | null {
  if (!birthday) return null;
  const d = new Date(birthday);
  if (Number.isNaN(d.getTime())) return null;
  return calculateAge(d);
}

function fullName(o: BedOccupancy): string {
  const raw = [o.pname, o.fname, o.lname].filter(Boolean).join(' ').trim();
  if (!raw) return 'ไม่ระบุชื่อ';
  return maskName(raw);
}

// Parse HOSxP's separate regdate (YYYY-MM-DD) + regtime (HH:mm:ss) into an ISO
// string so we can compute hours-in-labor. Returns null if unparseable.
function parseAdmitAt(regdate: string, regtime: string | null): Date | null {
  if (!regdate) return null;
  const t = regtime && /^\d{2}:\d{2}/.test(regtime) ? regtime : '00:00:00';
  const d = new Date(`${regdate}T${t}`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function hoursSince(d: Date, nowMs: number): number {
  return Math.max(0, Math.floor((nowMs - d.getTime()) / 3_600_000));
}

// Severity classification — gated on a RECENT partograph observation so
// postpartum or admission-only patients (who have no active labor chart) stay
// neutral instead of being falsely flagged. The CDSS roll-up will replace this
// heuristic in Task 30+; until then we only surface severity when there is
// evidence of an active, actively-charted labor.
function classifySeverity(o: BedOccupancy, nowMs: number): Severity {
  const { last_cervix_cm: cx, last_observation_at: obsIso } = o;
  if (!obsIso) return 'unknown';
  const obsMs = Date.parse(obsIso);
  if (!Number.isFinite(obsMs)) return 'unknown';
  const obsAgeHrs = (nowMs - obsMs) / 3_600_000;
  // Not actively charted in the last 8 hours → treat as neutral/recovery.
  if (obsAgeHrs > 8) return 'unknown';

  const admit = parseAdmitAt(o.regdate, o.regtime);
  const hrsInLabor = admit ? Math.max(0, (nowMs - admit.getTime()) / 3_600_000) : 0;

  // Stalled: long labor, no cervical progress.
  if (hrsInLabor >= 16 && (cx === null || cx < 4)) return 'critical';
  if (hrsInLabor >= 10 && (cx === null || cx < 4)) return 'warning';
  // Late-active: near delivery — normal but high priority.
  if (cx !== null && cx >= 8) return 'normal';
  // Active labor with mid-stage cervix — routine monitoring.
  return 'normal';
}

function formatAdmitClock(date: Date | null): string | null {
  if (!date) return null;
  return date.toLocaleTimeString('th-TH', {
    timeZone: 'Asia/Bangkok',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function SeverityDot({ severity }: { severity: Severity }) {
  return (
    <span
      role="img"
      aria-label={SEVERITY[severity].label}
      title={SEVERITY[severity].label}
      className={cn(
        'inline-block h-2.5 w-2.5 rounded-full ring-2 ring-white',
        SEVERITY[severity].dot,
      )}
    />
  );
}

// Horizontal progress bar for cervical dilation (0-10cm). Using a bar in
// addition to the numeric conveys progress pre-attentively — nurses can scan
// a ward and pick out the 8-10cm cases instantly.
function CervixBar({ cm }: { cm: number | null }) {
  if (cm === null) {
    return (
      <div className="flex items-center gap-2 text-xs text-slate-400">
        <span className="block h-1.5 flex-1 rounded-full bg-slate-100" aria-hidden />
        <span className="tabular-nums">— ซม</span>
      </div>
    );
  }
  const pct = Math.min(100, Math.max(0, (cm / 10) * 100));
  // 8+ cm = near-delivery → emphasize in emerald even if overall severity differs.
  const barColor = cm >= 8 ? 'bg-emerald-500' : cm >= 4 ? 'bg-amber-500' : 'bg-sky-500';
  return (
    <div className="flex items-center gap-2" aria-label={`ปากมดลูก ${cm} เซนติเมตร`}>
      <div className="relative h-1.5 flex-1 rounded-full bg-slate-100">
        <div
          className={cn('absolute inset-y-0 left-0 rounded-full', barColor)}
          style={{ width: `${pct}%` }}
          aria-hidden
        />
      </div>
      <span className="shrink-0 text-xs font-semibold tabular-nums text-slate-700">{cm} ซม</span>
    </div>
  );
}

export function BedTile({ bedno, bedLock, occupant, onClick, now }: BedTileProps) {
  // Mount-stamped fallback so the component stays pure-during-render when no
  // `now` prop is supplied (e.g. in unit tests). Real callers pass `now` from
  // the page's tick state so all tiles re-render in sync.
  const [mountNow] = useState(() => Date.now());
  const isLocked = bedLock === 'Y';
  const isOccupied = !isLocked && occupant != null;

  if (isLocked) {
    return (
      <div
        aria-label={`เตียง ${bedno} ล็อก`}
        className="flex min-h-[140px] flex-col items-center justify-center rounded-lg border border-slate-200 bg-slate-50 p-3 text-slate-400"
      >
        <Lock className="h-5 w-5" aria-hidden />
        <span className="mt-1.5 text-xs font-medium">ล็อก</span>
        <span className="sr-only">{`เตียง ${bedno}`}</span>
        <span className="mt-2 text-sm font-semibold tabular-nums text-slate-500">{bedno}</span>
      </div>
    );
  }

  if (!isOccupied) {
    return (
      <div
        aria-label={`เตียง ${bedno} ว่าง`}
        className="flex min-h-[140px] flex-col items-center justify-center rounded-lg border border-dashed border-slate-200 bg-slate-50/60 p-3 text-slate-400"
      >
        <span className="text-xs font-medium tracking-wide">ว่าง</span>
        <span className="sr-only">{`เตียง ${bedno}`}</span>
        <span className="mt-2 text-sm font-semibold tabular-nums text-slate-500">{bedno}</span>
      </div>
    );
  }

  const nowMs = now ?? mountNow;
  const severity = classifySeverity(occupant, nowMs);
  const tokens = SEVERITY[severity];
  const age = safeAge(occupant.birthday);
  const name = fullName(occupant);
  const { gravida, ga, last_cervix_cm: cervix, incharge_doctor_name: doc, hn } = occupant;
  const admitAt = parseAdmitAt(occupant.regdate, occupant.regtime);
  const hrsInLabor = admitAt ? hoursSince(admitAt, nowMs) : null;
  const admitClock = formatAdmitClock(admitAt);
  const isActivelyCharted = severity !== 'unknown';

  return (
    <button
      type="button"
      onClick={() => onClick?.(occupant.an)}
      aria-label={`เตียง ${bedno}`}
      title={`${name} · ${tokens.label} · รหัสรับ ${occupant.an}`}
      className={cn(
        'group relative flex min-h-[140px] w-full flex-col overflow-hidden rounded-lg border border-slate-200 bg-white text-left',
        'shadow-sm transition-all duration-150 ease-out',
        'hover:-translate-y-px hover:border-slate-300 hover:shadow-md',
        'focus:outline-none focus:ring-2 focus:ring-offset-1',
        tokens.ring,
        'motion-reduce:transform-none motion-reduce:transition-none',
      )}
    >
      {/* Left-edge severity accent bar — conveys status pre-attentively */}
      <span aria-hidden className={cn('absolute inset-y-0 left-0 w-1', tokens.accent)} />

      <div className="flex flex-col gap-1.5 pl-4 pr-3 py-2.5">
        {/* Header: bed # · HN · severity dot */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2 text-[11px] font-semibold uppercase tracking-wide tabular-nums text-slate-500">
            <span>{`เตียง ${bedno}`}</span>
            {hn && (
              <>
                <span aria-hidden className="text-slate-300">
                  ·
                </span>
                <span className="truncate text-slate-400 normal-case">{`HN ${hn}`}</span>
              </>
            )}
          </div>
          <SeverityDot severity={severity} />
        </div>

        {/* Patient name — primary info */}
        <div className="min-w-0">
          <div className="truncate text-[15px] font-semibold leading-tight text-slate-900">
            {name}
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-slate-500">
            {age !== null && (
              <span className="tabular-nums">
                <span className="font-medium text-slate-700">{age}</span> ปี
              </span>
            )}
            {(gravida !== null || ga !== null) && (
              <>
                <span aria-hidden className="text-slate-300">
                  ·
                </span>
                <span className="font-mono text-[11px] tabular-nums text-slate-700">
                  {gravida !== null && <span>{`G${gravida}`}</span>}
                  {gravida !== null && ga !== null && (
                    <span aria-hidden className="mx-0.5 text-slate-300">
                      /
                    </span>
                  )}
                  {ga !== null && <span>{`GA${ga}`}</span>}
                </span>
              </>
            )}
            {admitClock && (
              <>
                <span aria-hidden className="text-slate-300">
                  ·
                </span>
                <span
                  className="inline-flex items-center gap-0.5 tabular-nums text-slate-500"
                  title={`รับเข้า ${occupant.regdate} ${admitClock}`}
                >
                  <Clock className="h-3 w-3 text-slate-400" aria-hidden />
                  {admitClock}
                </span>
              </>
            )}
          </div>
        </div>

        {/* Cervix dilation progress — the headline clinical metric */}
        <CervixBar cm={cervix} />

        {/* Footer row: time-in-labor chip + in-charge doctor */}
        <div className="mt-auto flex items-center justify-between gap-2 text-[11px] text-slate-500">
          {hrsInLabor !== null ? (
            <span
              className="inline-flex items-center gap-1 rounded-md bg-slate-50 px-1.5 py-0.5 tabular-nums ring-1 ring-slate-200/60"
              title="เวลาตั้งแต่รับเข้าห้องคลอด"
            >
              <Clock className="h-3 w-3 text-slate-400" aria-hidden />
              <span className="font-medium text-slate-700">{hrsInLabor}</span>
              <span className="text-slate-500">ชม</span>
            </span>
          ) : (
            <span />
          )}
          {doc && (
            <span className="flex min-w-0 items-center gap-1" title={`แพทย์เจ้าของไข้: ${doc}`}>
              <Stethoscope className="h-3 w-3 shrink-0 text-slate-400" aria-hidden />
              <span className="truncate">{doc}</span>
            </span>
          )}
        </div>

        {/* Partograph freshness strip — always rendered so the row height is
            stable across tiles (prevents reflow during SWR revalidation). */}
        <div className="flex items-center gap-1 border-t border-slate-100 pt-1.5 text-[10px]">
          <Activity
            className={cn('h-3 w-3', isActivelyCharted ? 'text-emerald-500' : 'text-slate-300')}
            aria-hidden
          />
          {occupant.last_observation_at ? (
            <span className="text-slate-500">
              สังเกตล่าสุด{' '}
              <span
                className={cn(
                  'tabular-nums',
                  isActivelyCharted ? 'text-slate-700' : 'text-slate-400',
                )}
              >
                {formatRelativeTime(occupant.last_observation_at)}
              </span>
            </span>
          ) : (
            <span className="text-slate-400">ยังไม่มี partograph</span>
          )}
          {/* AN kept in the button title only (see <button title> below) so it
              doesn't compete with the drawer header for getByText matches. */}
        </div>
      </div>
    </button>
  );
}
