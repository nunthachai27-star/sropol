// AlertBar — persistent 4-tile ribbon with "ALL CLEAR" resting state.
// Redesigned 2026-04-21 per dashboard brief §4.2: never disappears, never causes layout jumps.
//
// Each tile has a hover tooltip explaining what the number actually counts —
// users were confused by the bare integers (e.g. "what does '3' next to
// REFERRAL RECEIVED mean?"). The copy mirrors the exact SQL definitions in
// services/dashboard.ts:getDashboardAlerts so the explanation can't drift
// out of sync with the metric without a code change.
'use client';

import type { ReactNode } from 'react';
import type { DashboardAlerts } from '@/types/api';
import { cn } from '@/lib/utils';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';

interface AlertBarProps {
  alerts: DashboardAlerts;
}

interface AlertTileProps {
  label: string;
  value: number;
  zeroLabel: string;
  detail: string;
  tooltipTitle: string;
  tooltipBody: ReactNode;
}

function AlertTile({
  label,
  value,
  zeroLabel,
  detail,
  tooltipTitle,
  tooltipBody,
}: AlertTileProps) {
  const hot = value > 0;
  const color = hot ? 'var(--risk-high)' : 'var(--risk-low)';
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <div
            tabIndex={0}
            aria-label={`${label}: ${value}. ${tooltipTitle}`}
            className="flex flex-1 cursor-help items-center gap-3.5 border-r border-[var(--rule-strong)] px-4 py-2.5 outline-none focus-visible:bg-[var(--accent-navy-soft)]"
          />
        }
      >
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
      </TooltipTrigger>
      <TooltipContent side="bottom" className="max-w-sm whitespace-normal text-left leading-snug">
        <div className="space-y-1">
          <div className="font-mono text-[10px] uppercase tracking-[0.14em] opacity-70">
            {label}
          </div>
          <div className="text-xs font-semibold">{tooltipTitle}</div>
          <div className="text-[11px] opacity-90">{tooltipBody}</div>
        </div>
      </TooltipContent>
    </Tooltip>
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
      {/* Leading state label — total alerts across the three categories. */}
      <Tooltip>
        <TooltipTrigger
          render={
            <div
              tabIndex={0}
              aria-label={`${hot ? 'ACTIVE ALERTS' : 'ALL CLEAR'}: ${total}`}
              className="flex min-w-[200px] cursor-help items-center gap-2 border-r border-[var(--rule-strong)] px-5 py-2.5 outline-none focus-visible:bg-[var(--accent-navy-soft)]"
            />
          }
        >
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
        </TooltipTrigger>
        <TooltipContent side="bottom" className="max-w-sm whitespace-normal text-left leading-snug">
          <div className="space-y-1">
            <div className="text-xs font-semibold">
              {hot ? 'สถานะรวม — มีเหตุการณ์เฝ้าระวัง' : 'สถานะรวม — ปลอดเหตุการณ์'}
            </div>
            <div className="text-[11px] opacity-90">
              ผลรวมของ 3 หมวดทางขวา — REFERRAL RECEIVED (เคสส่งต่อรอรับ) + OVERDUE ANC
              (ขาดนัด ANC เกิน 28 วัน) + IN-TRANSIT REFERRAL (รถพยาบาลกำลังเดินทาง).
              ถ้าเป็น 0 หมายความว่าไม่มีงานค้างต้องเฝ้าในระบบทั้งจังหวัด.
            </div>
          </div>
        </TooltipContent>
      </Tooltip>
      <AlertTile
        label="REFERRAL RECEIVED"
        value={alerts.referralAlerts}
        zeroLabel="ไม่มีการส่งต่อค้าง"
        detail="รอรับเคส · triage pending"
        tooltipTitle="เคสส่งต่อที่ รพ.ปลายทางยังไม่ได้รับ"
        tooltipBody={
          <>
            จำนวนเคสส่งต่อ (referral) ที่อยู่ในสถานะ <strong>INITIATED</strong> หรือ{' '}
            <strong>ACCEPTED</strong> — รพ.ต้นทางส่งต่อมาแล้ว แต่ รพ.ปลายทางยังไม่ขึ้นรถ
            (IN_TRANSIT) และยังไม่ถึง (ARRIVED). ปฏิบัติ: เร่ง triage เพื่อยืนยันรับหรือปฏิเสธ
            ภายในเวลาที่เหมาะสม.
          </>
        }
      />
      <AlertTile
        label="OVERDUE ANC"
        value={alerts.overdueAnc}
        zeroLabel="ANC ครบทุกราย"
        detail="ขาดนัด ANC เกิน 28 วัน"
        tooltipTitle="หญิงตั้งครรภ์ขาดนัด ANC เกิน 28 วัน"
        tooltipBody={
          <>
            จำนวนหญิงตั้งครรภ์ที่ยังอยู่ในระยะ <strong>PREGNANCY</strong>{' '}
            (ยังไม่คลอด/ไม่จำหน่าย) แต่นัด ANC ครั้งล่าสุดผ่านมาแล้ว <strong>มากกว่า 28 วัน</strong>{' '}
            (last_anc_date เกิน 28 วันจากวันนี้). ปฏิบัติ: ติดตามให้กลับมาตรวจครรภ์
            หรือเยี่ยมบ้านตามแนวทาง ANC ครบเกณฑ์.
          </>
        }
      />
      <AlertTile
        label="IN-TRANSIT REFERRAL"
        value={alerts.inTransitReferrals}
        zeroLabel="ไม่มีรถรับส่งอยู่"
        detail="รถพยาบาลกำลังส่งเคส"
        tooltipTitle="รถพยาบาลกำลังเดินทางส่งเคส"
        tooltipBody={
          <>
            จำนวนเคสส่งต่อสถานะ <strong>IN_TRANSIT</strong> — ขึ้นรถพยาบาลจาก รพ.ต้นทาง
            และกำลังเดินทางไป รพ.ปลายทาง ยังไม่ถึง (ARRIVED). ปฏิบัติ: เฝ้าระวังเหตุระหว่างทาง,
            พร้อมรับสายจาก รพ.ต้นทางหากผู้ป่วยมีอาการเปลี่ยน.
          </>
        }
      />
    </div>
  );
}
