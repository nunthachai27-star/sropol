// AlertBar — persistent 4-tile ribbon with "ALL CLEAR" resting state.
// Redesigned 2026-04-21 per dashboard brief §4.2: never disappears, never causes layout jumps.
'use client';

import type { DashboardAlerts } from '@/types/api';
import { cn } from '@/lib/utils';

interface AlertBarProps {
  alerts: DashboardAlerts;
}

interface AlertTileProps {
  label: string;
  value: number;
  zeroLabel: string;
  detail: string;
}

function AlertTile({ label, value, zeroLabel, detail }: AlertTileProps) {
  const hot = value > 0;
  const color = hot ? 'var(--risk-high)' : 'var(--risk-low)';
  return (
    <div className="flex flex-1 items-center gap-3.5 border-r border-[var(--rule-strong)] px-4 py-2.5">
      <div style={{ width: 3, height: 28, background: color }} aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--ink-navy-muted)]">
          {label}
        </div>
        <div
          className={cn(
            'font-mono text-xs',
            hot ? 'text-[var(--ink-navy)]' : 'text-[var(--ink-navy-dim)]',
          )}
        >
          {hot ? detail : zeroLabel}
        </div>
      </div>
      <div
        className="font-mono text-[28px] font-semibold leading-none tabular-nums"
        style={{ color, letterSpacing: '-0.02em' }}
      >
        {value}
      </div>
    </div>
  );
}

export function AlertBar({ alerts }: AlertBarProps) {
  const total = alerts.referralAlerts + alerts.overdueAnc + alerts.inTransitReferrals;
  const hot = total > 0;
  const stateColor = hot ? 'var(--risk-high)' : 'var(--risk-low)';

  return (
    <div
      className={cn(
        'flex items-stretch border-b border-[var(--rule-strong)]',
        hot ? 'bg-gradient-to-r from-red-50 to-white' : 'bg-white',
      )}
    >
      {/* Leading state label */}
      <div className="flex min-w-[200px] items-center gap-2 border-r border-[var(--rule-strong)] px-5 py-2.5">
        <span
          style={{ background: stateColor }}
          className={cn(
            'h-1.5 w-1.5 rounded-full',
            hot && 'animate-pulse-hi',
          )}
          aria-hidden="true"
        />
        <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--ink-navy-dim)]">
          {hot ? 'ACTIVE ALERTS' : 'ALL CLEAR'}
        </span>
        <span
          className="ml-auto font-mono text-lg font-semibold tabular-nums"
          style={{ color: stateColor }}
        >
          {total}
        </span>
      </div>
      <AlertTile
        label="REFERRAL RECEIVED"
        value={alerts.referralAlerts}
        zeroLabel="ไม่มีการส่งต่อค้าง"
        detail="รอรับเคส · triage pending"
      />
      <AlertTile
        label="OVERDUE ANC"
        value={alerts.overdueAnc}
        zeroLabel="ANC ครบทุกราย"
        detail="ขาดนัด ANC เกิน 28 วัน"
      />
      <AlertTile
        label="IN-TRANSIT REFERRAL"
        value={alerts.inTransitReferrals}
        zeroLabel="ไม่มีรถรับส่งอยู่"
        detail="รถพยาบาลกำลังส่งเคส"
      />
    </div>
  );
}
