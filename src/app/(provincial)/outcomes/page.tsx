// Outcomes — neonatal board. Rebuilt 2026-07-09: six KPI tiles (incl.
// multiples + resuscitation), real range windows (Bangkok month-to-date /
// 30d / all — the old page labeled an all-time query "เดือนนี้"), a
// six-month trend, per-hospital breakdown, and a recent-births drill-down
// with masked mother names linking to the journey. Air-traffic-control
// aesthetic: cool-slate frame, flush white panels, mono tabular numerics.
'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import useSWR from 'swr';
import { useSetBreadcrumbs } from '@/components/layout/BreadcrumbContext';
import { LoadingState } from '@/components/shared/LoadingState';
import { ErrorState } from '@/components/shared/ErrorState';
import { SectionLabel } from '@/components/dashboard/shared';
import { cn, formatThaiDate, formatThaiTime } from '@/lib/utils';
import { maskName } from '@/lib/pii-mask';
import { KpiTip } from '@/components/shared/KpiTip';
import { FlagChip } from '@/components/shared/FlagChip';
import { Activity, Baby, HeartPulse, Scale, Users, Weight } from 'lucide-react';
import type { OutcomesResponse, RecentBirthEntry } from '@/types/api';

// Hover copy for the KPI tiles — mirrors the SQL in services/newborn.ts so
// the explanation cannot drift from the metric.
const TILE_TIPS: Record<string, { title: string; body: string }> = {
  'kpi-total': {
    title: 'ทารกเกิดทั้งหมดในช่วงที่เลือก',
    body: 'นับจากบันทึกทารกแรกเกิด (labour_infant) ที่ซิงก์จาก HOSxP ตามวันเวลาเกิด — ครรภ์แฝดนับแยกรายทารก เปลี่ยนช่วงเวลาได้ที่ปุ่ม PERIOD',
  },
  'kpi-lbw': {
    title: 'ทารกน้ำหนักแรกเกิดน้อย (LBW)',
    body: 'น้ำหนักแรกเกิดต่ำกว่า 2,500 กรัม — ตัวชี้วัดอนามัยแม่และเด็กหลักของ สธ. เปอร์เซ็นต์คิดจากทารกทั้งหมดในช่วงเดียวกัน',
  },
  'kpi-apgar': {
    title: 'Apgar ที่ 5 นาที ต่ำกว่า 7',
    body: 'ใช้คะแนน Apgar นาทีที่ 5 (ตัวทำนายผลลัพธ์มาตรฐาน ไม่ใช่นาทีที่ 1) — ทารกกลุ่มนี้ควรได้รับการติดตามภาวะแทรกซ้อน',
  },
  'kpi-resus': {
    title: 'ทารกที่ได้รับการกู้ชีพแรกเกิด',
    body: 'มีการช่วยเหลืออย่างน้อยหนึ่งอย่าง: PPV / ใส่ท่อช่วยหายใจ / กดหน้าอก / ออกซิเจน / Narcan — จากแบบบันทึกห้องคลอด HOSxP',
  },
  'kpi-multiples': {
    title: 'ทารกจากครรภ์แฝด',
    body: 'ทารกลำดับที่ 2 ขึ้นไปของการคลอดเดียวกัน (infant_number > 1) — ครรภ์แฝดเป็นกลุ่มเสี่ยงที่ต้องวางแผนคลอดล่วงหน้า',
  },
  'kpi-avg-weight': {
    title: 'น้ำหนักแรกเกิดเฉลี่ย',
    body: 'ค่าเฉลี่ยน้ำหนักแรกเกิด (กรัม) ของทารกทุกคนในช่วงที่เลือก — ใช้ดูแนวโน้มโภชนาการมารดาในภาพรวม',
  },
};

const RANGE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'mtd', label: 'เดือนนี้' },
  { value: '30d', label: '30 วัน' },
  { value: 'all', label: 'ทั้งหมด' },
];

/** Small bordered mono flag in the risk palette. */
export default function OutcomesPage() {
  useSetBreadcrumbs([{ label: 'แดชบอร์ด', href: '/' }, { label: 'ผลลัพธ์ทารก' }]);

  const [range, setRange] = useState('mtd');
  const [hospitalFilter, setHospitalFilter] = useState('');
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const queryParams = useMemo(() => {
    const p = new URLSearchParams({ range });
    if (hospitalFilter) p.set('hospital_id', hospitalFilter);
    return p.toString();
  }, [range, hospitalFilter]);

  const { data, isLoading, error, mutate } = useSWR<OutcomesResponse>(
    `/api/dashboard/outcomes?${queryParams}`,
    {
      refreshInterval: 60000,
      keepPreviousData: true,
      onSuccess: () => setLastUpdated(new Date()),
    },
  );

  if (isLoading && !data) {
    return <LoadingState message="กำลังโหลดข้อมูลผลลัพธ์ทารก..." />;
  }

  if (error && !data) {
    return (
      <ErrorState
        message="เกิดข้อผิดพลาดในการโหลดข้อมูล กรุณาลองใหม่"
        detail={error instanceof Error ? error.message : String(error)}
        onRetry={() => mutate()}
      />
    );
  }

  const kpis = data ?? {
    totalBirths: 0,
    lbwCount: 0,
    lbwRate: 0,
    lowApgarCount: 0,
    avgBirthWeightG: 0,
    multiples: 0,
    resuscitated: 0,
    trend: [],
    byHospital: [],
    recent: [],
  };
  const rangeLabel = RANGE_OPTIONS.find((r) => r.value === range)?.label ?? range;
  const noDataYet = kpis.totalBirths === 0 && kpis.recent.length === 0;

  const tiles: Array<{
    key: string;
    testId: string;
    label: string;
    labelEn: string;
    value: number | string;
    sub: string;
    color: string;
    icon: React.ComponentType<{ className?: string }>;
  }> = [
    {
      key: 'total',
      testId: 'kpi-total',
      label: 'ทารกเกิดทั้งหมด',
      labelEn: 'TOTAL BIRTHS',
      value: kpis.totalBirths,
      sub: `ราย (${rangeLabel})`,
      color: 'var(--accent-navy)',
      icon: Baby,
    },
    {
      key: 'lbw',
      testId: 'kpi-lbw',
      label: 'น้ำหนักน้อย (LBW)',
      labelEn: 'LOW BIRTH WEIGHT',
      value: kpis.lbwCount,
      sub: `${kpis.lbwRate.toFixed(1)}% ของทารกทั้งหมด`,
      color: 'var(--risk-medium)',
      icon: Weight,
    },
    {
      key: 'apgar',
      testId: 'kpi-apgar',
      label: 'Apgar ต่ำ',
      labelEn: 'LOW APGAR',
      value: kpis.lowApgarCount,
      sub: 'ราย (Apgar 5 นาที < 7)',
      color: 'var(--risk-high)',
      icon: Activity,
    },
    {
      key: 'resus',
      testId: 'kpi-resus',
      label: 'ได้รับการกู้ชีพ',
      labelEn: 'RESUSCITATED',
      value: kpis.resuscitated,
      sub: 'ราย (PPV/ET/CPR/O₂)',
      color: 'var(--risk-medium)',
      icon: HeartPulse,
    },
    {
      key: 'multiples',
      testId: 'kpi-multiples',
      label: 'ครรภ์แฝด',
      labelEn: 'MULTIPLES',
      value: kpis.multiples,
      sub: 'ราย (ทารกคนที่ 2 ขึ้นไป)',
      color: 'var(--ink-navy-dim)',
      icon: Users,
    },
    {
      key: 'avgWeight',
      testId: 'kpi-avg-weight',
      label: 'น้ำหนักเฉลี่ย',
      labelEn: 'AVG WEIGHT',
      value: kpis.avgBirthWeightG > 0 ? kpis.avgBirthWeightG.toLocaleString() : '—',
      sub: 'กรัม',
      color: 'var(--risk-low)',
      icon: Scale,
    },
  ];

  const maxTrendBirths = Math.max(...kpis.trend.map((t) => t.births), 1);

  return (
    <div style={{ color: 'var(--ink-navy)', background: 'var(--surface-cool)' }}>
      {/* Header strip */}
      <div
        className="flex flex-wrap items-baseline gap-x-4 gap-y-1 bg-white px-5 py-2.5"
        style={{ borderBottom: '1px solid var(--rule-strong)' }}
      >
        <div>
          <div className="font-mono text-[12px] uppercase tracking-[0.18em] text-[var(--ink-navy-muted)]">
            PROVINCIAL REGISTRY · NEONATAL OUTCOMES
          </div>
          <h1
            className="mt-0.5 text-[26px] font-bold leading-tight tracking-tight"
            style={{ color: 'var(--ink-navy)' }}
          >
            ผลลัพธ์ทารก
          </h1>
        </div>
        <p className="font-mono text-[13px] text-[var(--ink-navy-muted)]">
          ตัวชี้วัดทารกแรกเกิดทั้งจังหวัด · ช่วง{rangeLabel}
        </p>
        <p className="ml-auto font-mono text-[12px] tracking-[0.08em] text-[var(--ink-navy-muted)]">
          อัปเดตล่าสุด{' '}
          <span className="tabular-nums text-[var(--ink-navy-dim)]">
            {lastUpdated ? formatThaiTime(lastUpdated) : '—'}
          </span>{' '}
          · รีเฟรชอัตโนมัติทุก 1 นาที
        </p>
      </div>

      {/* Controls — range chips + hospital filter */}
      <div
        className="flex flex-wrap items-center gap-3 bg-white px-5 py-2.5"
        style={{ borderBottom: '1px solid var(--rule-strong)' }}
      >
        <div className="flex items-center gap-1">
          <span className="font-mono text-[12px] uppercase tracking-[0.1em] text-[var(--ink-navy-muted)]">
            PERIOD:
          </span>
          {RANGE_OPTIONS.map((opt) => {
            const active = range === opt.value;
            return (
              <button
                key={opt.value}
                onClick={() => setRange(opt.value)}
                className={cn(
                  'rounded-sm border bg-white px-2.5 py-1 font-mono text-[13px] tracking-[0.06em] transition-colors',
                  active ? 'font-semibold' : 'font-normal',
                )}
                style={{
                  borderColor: active ? 'var(--accent-navy)' : 'var(--rule-strong)',
                  color: active ? 'var(--accent-navy)' : 'var(--ink-navy-dim)',
                  background: active ? 'var(--accent-navy-soft)' : 'white',
                }}
              >
                {opt.label}
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-1">
          <span className="font-mono text-[12px] uppercase tracking-[0.1em] text-[var(--ink-navy-muted)]">
            HOSPITAL:
          </span>
          <select
            data-testid="filter-hospital"
            value={hospitalFilter}
            onChange={(e) => setHospitalFilter(e.target.value)}
            className="h-7 max-w-[240px] rounded-sm border bg-white px-1.5 font-mono text-[13px] focus:border-[var(--accent-navy)] focus:outline-none"
            style={{
              borderColor: hospitalFilter ? 'var(--accent-navy)' : 'var(--rule-strong)',
              color: hospitalFilter ? 'var(--accent-navy)' : 'var(--ink-navy-dim)',
            }}
          >
            <option value="">ทุกโรงพยาบาล</option>
            {kpis.byHospital.map((h) => (
              <option key={h.id} value={h.id}>
                {h.name} ({h.births})
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* 01 — KPI tiles */}
      <div
        className="grid grid-cols-2 bg-white md:grid-cols-3 lg:grid-cols-6"
        style={{ borderBottom: '1px solid var(--rule-strong)' }}
      >
        {tiles.map((t, i) => {
          const Icon = t.icon;
          const tip = TILE_TIPS[t.testId];
          return (
            <KpiTip
              key={t.key}
              title={tip.title}
              body={tip.body}
              trigger={
                <div
                  data-testid={t.testId}
                  className="flex cursor-help flex-col gap-1.5 px-4 py-3"
                  style={{
                    borderLeft: `2px solid ${t.color}`,
                    borderRight: i < tiles.length - 1 ? '1px solid var(--rule-strong)' : undefined,
                  }}
                />
              }
            >
              <div className="flex items-center gap-2" style={{ color: t.color }}>
                <Icon className="h-3.5 w-3.5" />
                <div className="font-mono text-[12px] uppercase tracking-[0.12em] text-[var(--ink-navy-muted)]">
                  {t.labelEn}
                </div>
              </div>
              <div className="flex items-baseline gap-2">
                <span
                  className="font-mono text-[32px] font-semibold leading-none tabular-nums"
                  style={{ color: t.color, letterSpacing: '-0.02em' }}
                >
                  {t.value}
                </span>
                <span className="font-mono text-[12px] text-[var(--ink-navy-dim)]">{t.sub}</span>
              </div>
              <div className="text-[13px] text-[var(--ink-navy-dim)]">{t.label}</div>
            </KpiTip>
          );
        })}
      </div>

      {/* Honest empty state while the newborn sync backfills */}
      {noDataYet && (
        <div
          className="bg-white px-5 py-3 text-[14px]"
          style={{ borderBottom: '1px solid var(--rule-strong)', color: 'var(--ink-navy-dim)' }}
        >
          ยังไม่มีข้อมูลทารกจากการซิงก์ HOSxP ในช่วงที่เลือก —
          ระบบจะเติมข้อมูลย้อนหลังอัตโนมัติเมื่อรอบซิงก์ถัดไปทำงาน
        </div>
      )}

      {/* 02 — Trend + hospital breakdown */}
      <div
        className="grid gap-px bg-[var(--rule-strong)] lg:grid-cols-2"
        style={{ borderBottom: '1px solid var(--rule-strong)' }}
      >
        {/* Six-month trend */}
        <div className="bg-white px-5 py-3" data-testid="outcome-trend">
          <KpiTip
            title="แนวโน้มการเกิดรายเดือน"
            body="จำนวนทารกเกิดต่อเดือน (เดือนตามเวลาไทย) ย้อนหลัง 6 เดือน พร้อมจำนวน LBW ใต้แต่ละแท่ง — ไม่ขึ้นกับช่วงเวลาที่เลือกด้านบน แต่กรองตาม รพ.ได้"
            trigger={
              <div className="cursor-help font-mono text-[12px] uppercase tracking-[0.14em] text-[var(--ink-navy-muted)]" />
            }
          >
            BIRTHS · LAST 6 MONTHS
          </KpiTip>
          <div className="mt-2 flex h-[96px] items-end gap-2">
            {kpis.trend.map((t) => (
              <div key={t.month} className="flex flex-1 flex-col items-center gap-0.5">
                <span className="font-mono text-[12px] tabular-nums text-[var(--ink-navy-dim)]">
                  {t.births > 0 ? t.births : ''}
                </span>
                <div
                  className="w-full"
                  style={{
                    height: `${Math.max(2, (t.births / maxTrendBirths) * 56)}px`,
                    background: t.births > 0 ? 'var(--accent-navy)' : 'var(--surface-cool)',
                  }}
                />
                <span className="font-mono text-[11px] tabular-nums text-[var(--ink-navy-muted)]">
                  {t.month.slice(5)}/{t.month.slice(2, 4)}
                </span>
                <span
                  className="font-mono text-[11px] tabular-nums"
                  style={{ color: t.lbw > 0 ? 'var(--risk-medium)' : 'var(--ink-navy-muted)' }}
                >
                  {t.lbw > 0 ? `LBW ${t.lbw}` : '·'}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Per-hospital breakdown */}
        <div className="bg-white px-5 py-3" data-testid="hospital-outcomes">
          <KpiTip
            title="ผลลัพธ์รายโรงพยาบาล"
            body="จำนวนเกิด, LBW (จำนวนและร้อยละ), และ Apgar-5 < 7 ของแต่ละ รพ. ในช่วงเวลาที่เลือก — เรียงจาก รพ.ที่มีการเกิดมากที่สุด"
            trigger={
              <div className="cursor-help font-mono text-[12px] uppercase tracking-[0.14em] text-[var(--ink-navy-muted)]" />
            }
          >
            BY HOSPITAL · {rangeLabel}
          </KpiTip>
          <div className="mt-2">
            <div
              className="grid gap-2 border-b border-[var(--rule-strong)] pb-1 font-mono text-[12px] tracking-[0.1em] text-[var(--ink-navy-muted)]"
              style={{ gridTemplateColumns: '1fr 72px 104px 92px' }}
            >
              <div>HOSPITAL</div>
              <div className="text-right">BIRTHS</div>
              <div className="text-right">LBW</div>
              <div className="text-right">APGAR&lt;7</div>
            </div>
            {kpis.byHospital.length === 0 ? (
              <p className="py-4 text-center font-mono text-[13px] text-[var(--ink-navy-muted)]">
                — ไม่มีข้อมูลในช่วงที่เลือก —
              </p>
            ) : (
              kpis.byHospital.map((h) => (
                <div
                  key={h.hcode}
                  data-testid={`hospital-outcome-${h.hcode}`}
                  className="grid items-center gap-2 border-b py-1.5"
                  style={{
                    gridTemplateColumns: '1fr 72px 104px 92px',
                    borderColor: 'var(--rule-hair)',
                  }}
                >
                  <div className="truncate text-[14px] text-[var(--ink-navy)]">{h.name}</div>
                  <div className="text-right font-mono text-[14px] font-semibold tabular-nums">
                    {h.births}
                  </div>
                  <div
                    className="text-right font-mono text-[13px] tabular-nums"
                    style={{ color: h.lbw > 0 ? 'var(--risk-medium)' : 'var(--ink-navy-muted)' }}
                  >
                    {h.lbw} ({h.births > 0 ? ((h.lbw / h.births) * 100).toFixed(1) : '0.0'}%)
                  </div>
                  <div
                    className="text-right font-mono text-[13px] tabular-nums"
                    style={{
                      color: h.lowApgar > 0 ? 'var(--risk-high)' : 'var(--ink-navy-muted)',
                    }}
                  >
                    {h.lowApgar}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* 03 — Recent births */}
      <div className="bg-white px-5 pt-4 pb-6">
        <SectionLabel
          idx={3}
          right={
            <span>
              LATEST {kpis.recent.length} จาก {kpis.totalBirths} · {rangeLabel}
            </span>
          }
        >
          Recent births
        </SectionLabel>
        <div className="mt-2 border bg-white" style={{ borderColor: 'var(--rule-strong)' }}>
          <div className="overflow-x-auto">
            <div className="min-w-[980px]">
              <div
                className="grid gap-2 border-b border-[var(--rule-strong)] px-3 py-2 font-mono text-[12px] tracking-[0.1em] text-[var(--ink-navy-muted)]"
                style={{ gridTemplateColumns: '1.4fr 100px 148px 125px 100px 172px 1fr' }}
              >
                <div>MOTHER</div>
                <div>INFANT</div>
                <div>WEIGHT</div>
                <div>APGAR 1&apos;/5&apos;</div>
                <div>RESUS</div>
                <div>BORN</div>
                <div>HOSPITAL</div>
              </div>
              {kpis.recent.length === 0 ? (
                <div className="px-3 py-10 text-center">
                  <Baby className="mx-auto mb-2 h-8 w-8 text-[var(--ink-navy-muted)] opacity-50" />
                  <p className="font-mono text-[13px] text-[var(--ink-navy-muted)]">
                    ไม่มีการเกิดในช่วงที่เลือก
                  </p>
                </div>
              ) : (
                kpis.recent.map((b) => <BirthRow key={b.id} birth={b} />)
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function BirthRow({ birth: b }: { birth: RecentBirthEntry }) {
  const lbw = b.birthWeightG != null && b.birthWeightG < 2500;
  const lowApgar = b.apgar5min != null && b.apgar5min < 7;
  return (
    <Link
      href={`/pregnancies/${b.journeyId}`}
      data-testid={`birth-row-${b.id}`}
      data-low-apgar={lowApgar ? 'true' : 'false'}
      className="grid cursor-pointer items-center gap-2 border-b px-3 py-2 transition-colors hover:bg-[var(--accent-navy-soft)]"
      style={{
        gridTemplateColumns: '1.4fr 100px 148px 125px 100px 172px 1fr',
        borderColor: 'var(--rule-hair)',
        borderLeft: `3px solid ${lowApgar ? 'var(--risk-high)' : 'transparent'}`,
        minHeight: 44,
      }}
    >
      <div className="truncate text-[15px] font-medium text-[var(--ink-navy)]">
        {maskName(b.motherName)}
      </div>
      <div className="font-mono text-[13px] text-[var(--ink-navy-dim)]">
        #{b.infantNumber} · {b.sex ?? '—'}
      </div>
      <div className="flex items-center gap-1.5 font-mono text-[14px] tabular-nums">
        {b.birthWeightG != null ? `${b.birthWeightG.toLocaleString()} g` : '—'}
        {lbw && <FlagChip color="var(--risk-medium)">LBW</FlagChip>}
      </div>
      <div
        className="font-mono text-[14px] tabular-nums"
        style={{ color: lowApgar ? 'var(--risk-high)' : 'var(--ink-navy-dim)' }}
      >
        {b.apgar1min ?? '—'} / {b.apgar5min ?? '—'}
      </div>
      <div>
        {b.resuscitated ? (
          <FlagChip color="var(--risk-medium)">กู้ชีพ</FlagChip>
        ) : (
          <span className="font-mono text-[13px] text-[var(--ink-navy-muted)]">—</span>
        )}
      </div>
      <div className="font-mono text-[13px] tabular-nums text-[var(--ink-navy-dim)]">
        {formatThaiDate(b.bornAt)} {formatThaiTime(b.bornAt)}
      </div>
      <div className="truncate text-[13px] text-[var(--ink-navy-dim)]">{b.hospitalName}</div>
    </Link>
  );
}
