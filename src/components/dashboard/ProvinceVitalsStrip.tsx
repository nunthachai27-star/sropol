// ProvinceVitalsStrip — merges the old SummaryCards + RiskDistributionChart
// into a single grid: total-with-risk-bar | HIGH | MED | LOW | 24h admissions.
// Replaces SummaryCards.tsx and RiskDistributionChart.tsx per the 2026-04-21 redesign.
//
// Each cell has a hover tooltip explaining what the number actually counts.
// Copy mirrors the SQL in services/dashboard.ts:getDashboardSummary and
// getDashboardTrends so the explanation can't drift from the metric without
// a code change. Same pattern as AlertBar above this strip.
'use client';

import type { ReactNode } from 'react';
import type { DashboardSummary, DashboardTrends } from '@/types/api';
import { RiskBar, StatCell, BarStrip } from './shared';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

interface ProvinceVitalsStripProps {
  summary: DashboardSummary;
  trends: DashboardTrends;
}

// Small wrapper that turns any cell into a tooltip trigger. The cell content
// is passed as `children`; the rendered div becomes the grid cell, so the
// outer `<Tooltip>` (a context-only React node) doesn't disturb the grid
// layout and the StatCell's own border-left rail still sits at the cell edge.
function CellWithTooltip({
  ariaLabel,
  title,
  body,
  children,
  className,
}: {
  ariaLabel: string;
  title: string;
  body: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <div
            tabIndex={0}
            aria-label={ariaLabel}
            className={
              'cursor-help outline-none focus-visible:bg-[var(--accent-navy-soft)]' +
              (className ? ` ${className}` : '')
            }
          />
        }
      >
        {children}
      </TooltipTrigger>
      <TooltipContent side="bottom" className="max-w-sm whitespace-normal text-left leading-snug">
        <div className="space-y-1">
          <div className="text-xs font-semibold">{title}</div>
          <div className="text-[11px] opacity-90">{body}</div>
        </div>
      </TooltipContent>
    </Tooltip>
  );
}

export function ProvinceVitalsStrip({ summary, trends }: ProvinceVitalsStripProps) {
  return (
    <div
      className="grid border-b border-[var(--rule-strong)] bg-white"
      style={{ gridTemplateColumns: '1.2fr 1fr 1fr 1fr 1.6fr' }}
    >
      {/* Total + inline risk bar */}
      <CellWithTooltip
        ariaLabel={`ACTIVE LABOR · PROVINCE: ${summary.totalActive} เคส (เสี่ยงต่ำ ${summary.totalLow}, เสี่ยงปานกลาง ${summary.totalMedium}, เสี่ยงสูง ${summary.totalHigh})`}
        title="ผู้ป่วยในห้องคลอดทั้งจังหวัด"
        body={
          <>
            จำนวนผู้ป่วยที่ยังอยู่ในห้องคลอด (<strong>labor_status = ACTIVE</strong>) รวมทุก รพ. ใน
            จ.ขอนแก่นที่เปิดใช้งานในระบบ KK-LRMS. ตัวเลข{' '}
            <strong>+N ราย/24h</strong> = จำนวนรับใหม่ในรอบ 24 ชม.ที่ผ่านมา.
            แถบสีด้านล่างเป็นสัดส่วนตามระดับความเสี่ยง CPD ของ score ล่าสุด — LOW (เขียว) /
            MED (ส้ม) / HIGH (แดง). คะแนน CPD คำนวณจาก src/services/cpd-score.ts.
          </>
        }
      >
        <div className="border-r border-[var(--rule-strong)] px-5 py-4">
          <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--ink-navy-muted)]">
            ACTIVE LABOR · PROVINCE
          </div>
          <div className="mt-1.5 flex items-baseline gap-2.5">
            <div
              className="font-mono text-[44px] font-semibold leading-none text-[var(--ink-navy)] tabular-nums"
              style={{ letterSpacing: '-0.02em' }}
            >
              {summary.totalActive}
            </div>
            <div className="font-mono text-[11px] text-[var(--ink-navy-dim)]">เคสในห้องคลอด</div>
            <div
              className="ml-auto font-mono text-[11px]"
              style={{ color: 'var(--ink-navy-muted)' }}
            >
              +{trends.newByRisk24h.total} ราย/24h
            </div>
          </div>
          <div className="mt-2.5">
            <RiskBar
              low={summary.totalLow}
              medium={summary.totalMedium}
              high={summary.totalHigh}
              height={6}
            />
            <div className="mt-1.5 flex justify-between font-mono text-[10px] text-[var(--ink-navy-muted)]">
              <span>
                <span style={{ color: 'var(--risk-low)' }}>■</span> LOW {summary.totalLow}
              </span>
              <span>
                <span style={{ color: 'var(--risk-medium)' }}>■</span> MED {summary.totalMedium}
              </span>
              <span>
                <span style={{ color: 'var(--risk-high)' }}>■</span> HIGH {summary.totalHigh}
              </span>
            </div>
          </div>
        </div>
      </CellWithTooltip>

      <CellWithTooltip
        ariaLabel={`HIGH RISK: ${summary.totalHigh} เคส, รับใหม่ ${trends.newByRisk24h.high} ใน 24 ชั่วโมง`}
        title="ผู้ป่วยเสี่ยงสูง (CPD HIGH)"
        body={
          <>
            ผู้ป่วย <strong>labor_status = ACTIVE</strong> ที่ <strong>CPD score ล่าสุด</strong>{' '}
            อยู่ในเกณฑ์ HIGH ตาม src/config/risk-levels.ts. ▲ <strong>+N</strong> = รับใหม่ใน 24
            ชม.ล่าสุดที่ปัจจุบันอยู่ในระดับนี้. ปฏิบัติ: เฝ้าระวังใกล้ชิด พร้อมส่งต่อ รพ.ที่มี
            ศักยภาพสูงกว่าถ้าจำเป็น.
          </>
        }
      >
        <StatCell
          label="HIGH RISK"
          value={summary.totalHigh}
          delta={trends.newByRisk24h.high}
          color="var(--risk-high)"
        />
      </CellWithTooltip>

      <CellWithTooltip
        ariaLabel={`MEDIUM: ${summary.totalMedium} เคส, รับใหม่ ${trends.newByRisk24h.medium} ใน 24 ชั่วโมง`}
        title="ผู้ป่วยเสี่ยงปานกลาง (CPD MEDIUM)"
        body={
          <>
            ผู้ป่วย <strong>labor_status = ACTIVE</strong> ที่ CPD score ล่าสุดอยู่ในเกณฑ์ MEDIUM. ▲{' '}
            <strong>+N</strong> = รับใหม่ใน 24 ชม.ล่าสุดที่ปัจจุบันอยู่ในระดับนี้. ปฏิบัติ:
            ติดตามดูแลตามแนวทาง, ทบทวนคะแนน CPD ถ้าอาการเปลี่ยน.
          </>
        }
      >
        <StatCell
          label="MEDIUM"
          value={summary.totalMedium}
          delta={trends.newByRisk24h.medium}
          color="var(--risk-medium)"
        />
      </CellWithTooltip>

      <CellWithTooltip
        ariaLabel={`LOW: ${summary.totalLow} เคส, รับใหม่ ${trends.newByRisk24h.low} ใน 24 ชั่วโมง`}
        title="ผู้ป่วยเสี่ยงต่ำ (CPD LOW)"
        body={
          <>
            ผู้ป่วย <strong>labor_status = ACTIVE</strong> ที่ CPD score ล่าสุดอยู่ในเกณฑ์ LOW (ปกติ).
            ▲ <strong>+N</strong> = รับใหม่ใน 24 ชม.ล่าสุดที่ปัจจุบันอยู่ในระดับนี้.
          </>
        }
      >
        <StatCell
          label="LOW"
          value={summary.totalLow}
          delta={trends.newByRisk24h.low}
          color="var(--risk-low)"
        />
      </CellWithTooltip>

      {/* 24h admissions */}
      <CellWithTooltip
        ariaLabel={`ADMISSIONS · LAST 24H: ${trends.admissionsToday} today, avg ${trends.admissions7dAvg.toFixed(1)} per day`}
        title="รับเข้าห้องคลอดในรอบ 24 ชั่วโมง"
        body={
          <>
            กราฟแท่งแสดงจำนวนผู้ป่วยรับเข้าใหม่ <strong>ทุกชั่วโมงตลอด 24 ชม.ล่าสุด</strong>{' '}
            (เวลาประเทศไทย, Asia/Bangkok).{' '}
            <strong>{trends.admissionsToday} today</strong> = รับเข้าตั้งแต่ 00:00 ของวันนี้.{' '}
            <strong>avg {trends.admissions7dAvg.toFixed(1)}</strong> = ค่าเฉลี่ยรับเข้าต่อวันใน 7
            วันที่ผ่านมา. ถ้า today สูงกว่า avg อย่างเห็นได้ชัด แสดงว่ามีการรับเข้าผิดปกติ
            ควรตรวจสอบสาเหตุ.
          </>
        }
      >
        <div className="border-l border-[var(--rule-strong)] px-5 py-3">
          <div className="flex items-baseline justify-between">
            <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--ink-navy-muted)]">
              ADMISSIONS · LAST 24H
            </div>
            <div className="font-mono text-[11px] text-[var(--ink-navy-dim)]">
              <span className="font-semibold text-[var(--ink-navy)]">{trends.admissionsToday}</span>{' '}
              today · avg {trends.admissions7dAvg.toFixed(1)}
            </div>
          </div>
          <div className="mt-1.5">
            <BarStrip values={trends.admissions24h} width={280} height={26} color="var(--accent-navy)" />
            <div className="mt-0.5 flex justify-between font-mono text-[9px] text-[var(--ink-navy-muted)]">
              <span>−24h</span>
              <span>−18h</span>
              <span>−12h</span>
              <span>−6h</span>
              <span>NOW</span>
            </div>
          </div>
        </div>
      </CellWithTooltip>
    </div>
  );
}
