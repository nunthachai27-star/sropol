// Pregnancies — provincial ANC board. Rebuilt 2026-07-09: clickable risk +
// ops-cohort KPI strips fed by DB-wide counts (due-soon / overdue-EDC /
// missed-ANC / low-visits / near-term / LTFU worklist), DUE column with
// countdown chips, follow-up aging on LAST ANC, sort control (due-soonest
// default), hospital filter, and honest search. Keeps the dashboard's
// air-traffic-control aesthetic: cool slate surfaces, navy accents, mono
// tabular numerics, dense rows.
'use client';

import { useState, useMemo, useEffect } from 'react';
import { debounceLeadingTrailing, SSE_REFRESH_DEBOUNCE_MS } from '@/lib/debounce';
import Link from 'next/link';
import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import useSWR from 'swr';
import { useSSE } from '@/hooks/useSSE';
import { useSetBreadcrumbs } from '@/components/layout/BreadcrumbContext';
import { LoadingState } from '@/components/shared/LoadingState';
import { ErrorState } from '@/components/shared/ErrorState';
import { SectionLabel, RiskBar } from '@/components/dashboard/shared';
import { AncRiskChip } from '@/components/shared/AncRiskChip';
import { KpiTip } from '@/components/shared/KpiTip';
import { FlagChip } from '@/components/shared/FlagChip';
import { formatThaiDate, formatThaiTime, formatRelativeTime } from '@/lib/utils';
import { maskName } from '@/lib/pii-mask';
import { ANC_RISK_LABEL_TH } from '@/config/anc-risk-display';
import {
  ANC_OPS,
  classifyAncFollowup,
  classifyEdcDue,
  type AncFollowupClass,
  type EdcDueClass,
} from '@/config/anc-ops';
import { Baby, ChevronLeft, ChevronRight, Search, X } from 'lucide-react';
import type { JourneyListItem, JourneyListResponse } from '@/types/api';

type AncRisk = 'LOW' | 'HR1' | 'HR2' | 'HR3';

const DAY_MS = 24 * 3600_000;

// Day-count helpers kept outside components (react-hooks/purity: no direct
// Date.now() during render) — same pattern as lib/utils formatRelativeTime.
function daysUntil(iso: string): number {
  return Math.round((new Date(iso).getTime() - Date.now()) / DAY_MS);
}
function daysSince(iso: string): number {
  return Math.floor((Date.now() - new Date(iso).getTime()) / DAY_MS);
}

/** Small bordered mono flag — due/follow-up/age markers in the risk palette. */
function ageFlag(age: number): 'teen' | 'ama' | undefined {
  if (age < ANC_OPS.teenAgeUnder) return 'teen';
  if (age >= ANC_OPS.advancedMaternalAgeMin) return 'ama';
  return undefined;
}

/** DUE cell content — EDC date plus a countdown/overdue chip. */
function DueCell({ edc, due }: { edc: string | null; due: EdcDueClass }) {
  if (!edc) return <span className="text-[var(--ink-navy-muted)]">—</span>;
  const deltaDays = daysUntil(edc);
  return (
    <div className="flex flex-col items-start gap-0.5 leading-tight">
      <span className="font-mono text-[13px] tabular-nums text-[var(--ink-navy-dim)]">
        {formatThaiDate(edc)}
      </span>
      {due === 'overdue' ? (
        <FlagChip color="var(--risk-high)">เกินกำหนด {Math.abs(deltaDays)} วัน</FlagChip>
      ) : due === 'dueSoon' ? (
        <FlagChip color="var(--risk-medium)">ครบกำหนดใน {Math.max(deltaDays, 0)} วัน</FlagChip>
      ) : (
        <span className="font-mono text-[12px] text-[var(--ink-navy-muted)]">
          อีก {deltaDays} วัน
        </span>
      )}
    </div>
  );
}

/** LAST ANC cell — visit date plus the follow-up aging state. */
function LastAncCell({
  lastAncDate,
  followup,
}: {
  lastAncDate: string | null;
  followup: AncFollowupClass;
}) {
  if (!lastAncDate) return <span className="text-[var(--ink-navy-muted)]">—</span>;
  const sinceDays = daysSince(lastAncDate);
  return (
    <div className="flex flex-col items-start gap-0.5 leading-tight">
      <span className="text-[13px] text-[var(--ink-navy-dim)]">{formatThaiDate(lastAncDate)}</span>
      {followup === 'critical' ? (
        <FlagChip color="var(--risk-high)">ใกล้หลุดติดตาม · {sinceDays} วัน</FlagChip>
      ) : followup === 'warn' ? (
        <FlagChip color="var(--risk-medium)">ห่างนัด {sinceDays} วัน</FlagChip>
      ) : (
        <span className="font-mono text-[12px] text-[var(--ink-navy-muted)]">
          {formatRelativeTime(lastAncDate)}
        </span>
      )}
    </div>
  );
}

// Hover copy for the KPI strips — mirrors journey-list.ts SQL and the
// thresholds in config/anc-ops.ts + anc-freshness.ts so it cannot drift.
const RISK_TIPS: Record<string, string> = {
  LOW: 'หญิงตั้งครรภ์ที่ผลคัดกรองความเสี่ยง ANC อยู่ระดับปกติ ติดตามตามนัดมาตรฐาน คลิกเพื่อกรองรายการ',
  HR1: 'ความเสี่ยงระดับ 1 จากแบบคัดกรอง ANC ของ HOSxP — ติดตามใกล้ชิดขึ้น คลิกเพื่อกรองรายการ',
  HR2: 'ความเสี่ยงระดับ 2 — ควรพบแพทย์ตามแนวทางครรภ์เสี่ยง คลิกเพื่อกรองรายการ',
  HR3: 'ความเสี่ยงสูงสุด — ควรฝากครรภ์/คลอดใน รพ.ที่มีศักยภาพ คลิกเพื่อกรองรายการ',
};

const COHORT_TIPS: Record<string, { title: string; body: string }> = {
  'kpi-due-soon': {
    title: `ครบกำหนดคลอดภายใน ${ANC_OPS.dueSoonDays} วัน`,
    body: `EDC อยู่ภายใน ${ANC_OPS.dueSoonDays} วันข้างหน้า (รวมที่เลยกำหนดแล้ว) — ภาระงานห้องคลอดที่กำลังมาถึง ใช้วางแผนเตียงและการส่งต่อ คลิกเพื่อกรองรายการ`,
  },
  'kpi-overdue-edc': {
    title: 'เลยกำหนดคลอดแล้วยังไม่คลอด',
    body: 'EDC ผ่านมาแล้วแต่ยังไม่มีบันทึกคลอด (ระบบตัดออกจากทะเบียนอัตโนมัติเมื่อเกิน 14 วัน) — ควรตรวจสอบสถานะจริงกับ รพ. คลิกเพื่อกรองรายการ',
  },
  'kpi-anc-stale': {
    title: `ห่างนัด ANC เกิน ${ANC_OPS.followupWarnDays} วัน`,
    body: `นัดล่าสุดผ่านมาเกิน ${ANC_OPS.followupWarnDays} วัน แต่ยังไม่ถึงเกณฑ์หลุดการติดตาม (60 วัน) — ช่วงเวลาทองของการตามกลับมาตรวจ คลิกเพื่อกรองรายการ`,
  },
  'kpi-low-visits': {
    title: `ฝากครรภ์ไม่ครบเกณฑ์ ${ANC_OPS.minVisits} ครั้ง`,
    body: `อายุครรภ์ ≥ ${ANC_OPS.minVisitsGaWeeks} สัปดาห์แล้ว แต่จำนวนครั้ง ANC ยังน้อยกว่า ${ANC_OPS.minVisits} ครั้งตามเกณฑ์คุณภาพ ANC ของ สธ. คลิกเพื่อกรองรายการ`,
  },
  'kpi-near-term': {
    title: `อายุครรภ์ ≥ ${ANC_OPS.nearTermGaWeeks} สัปดาห์`,
    body: `กลุ่มใกล้คลอด (GA ≥ ${ANC_OPS.nearTermGaWeeks}w) — ตัวเลขเดียวกับ KPI ใกล้คลอดของหน้าโรงพยาบาลแม่ข่าย ใช้เตรียมแผนรับคลอด คลิกเพื่อกรองรายการ`,
  },
  'kpi-ltfu': {
    title: 'หลุดการติดตาม (60–120 วัน)',
    body: `ขาดนัดเกิน 60 วันจนถูกตัดออกจากทะเบียน active แต่ยังไม่เกิน ${ANC_OPS.ltfuWindowDays} วัน — รายชื่อสำหรับตามกลับเข้าระบบก่อนปิดเคส คลิกเพื่อเปิดรายการ`,
  },
};

const SORT_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'due', label: 'ใกล้กำหนดคลอด' },
  { value: 'ga', label: 'GA มาก → น้อย' },
  { value: 'last_anc', label: 'ขาดนัดนานสุด' },
  { value: 'newest', label: 'ลงทะเบียนล่าสุด' },
];

const GRID_COLUMNS = '118px 1.4fr 82px 64px 72px 60px 170px 170px 1fr';

function PregnanciesBoard() {
  useSetBreadcrumbs([{ label: 'แดชบอร์ด', href: '/' }, { label: 'ฝากครรภ์' }]);

  // Deep links from the dashboard alert ribbon land pre-filtered
  // (e.g. /pregnancies?cohort=anc_stale).
  const searchParams = useSearchParams();
  const riskParam = searchParams.get('risk');
  const [page, setPage] = useState(1);
  const [riskFilter, setRiskFilter] = useState<'' | AncRisk>(
    riskParam === 'LOW' || riskParam === 'HR1' || riskParam === 'HR2' || riskParam === 'HR3'
      ? riskParam
      : '',
  );
  const [cohortFilter, setCohortFilter] = useState(searchParams.get('cohort') ?? '');
  const [hospitalFilter, setHospitalFilter] = useState('');
  const [sortBy, setSortBy] = useState('due');
  const [search, setSearch] = useState('');
  // Debounced term actually sent to the server — matches HN prefix, decrypted
  // patient name, or hospital name (see journey-list.ts).
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  useEffect(() => {
    const handle = setTimeout(() => {
      setDebouncedQuery(search.trim());
      setPage(1); // a new search always restarts at the first page
    }, 400);
    return () => clearTimeout(handle);
  }, [search]);

  const queryParams = useMemo(() => {
    const p = new URLSearchParams({
      stage: 'PREGNANCY',
      page: String(page),
      per_page: '20',
      sort: sortBy,
    });
    if (riskFilter) p.set('risk_level', riskFilter);
    if (cohortFilter) p.set('cohort', cohortFilter);
    if (hospitalFilter) p.set('hospital_id', hospitalFilter);
    if (debouncedQuery) p.set('q', debouncedQuery);
    return p.toString();
  }, [page, sortBy, riskFilter, cohortFilter, hospitalFilter, debouncedQuery]);

  const { data, isLoading, error, mutate } = useSWR<JourneyListResponse>(
    `/api/journeys?${queryParams}`,
    // keepPreviousData: paging/searching swaps the key but should not flash the
    // full-page loader — the previous rows stay until the next payload lands.
    {
      refreshInterval: 30000,
      keepPreviousData: true,
      onSuccess: () => setLastUpdated(new Date()),
    },
  );

  // Real-time refresh on webhook/sync activity. Without this the table waits
  // up to 30s for the poll interval, which feels broken during simulation.
  // Debounced (leading+trailing) so continuous multi-hospital sync cycles
  // can't turn every SSE event into a refetch (2026-07-17 incident).
  const refresh = useMemo(
    () => debounceLeadingTrailing(() => void mutate(), SSE_REFRESH_DEBOUNCE_MS),
    [mutate],
  );
  useSSE({ onPatientUpdate: refresh, onSyncComplete: refresh });

  const journeys = useMemo(() => data?.journeys ?? [], [data?.journeys]);
  // DB-wide breakdowns — independent of pagination and the risk/cohort/q
  // filters; null/undefined renders em-dashes rather than page-bound figures.
  const counts = data?.counts ?? null;
  const opsCounts = data?.opsCounts ?? null;
  const hospitalCounts = data?.hospitalCounts ?? [];

  const hasActiveFilters = Boolean(riskFilter || cohortFilter || hospitalFilter || debouncedQuery);

  const clearFilters = () => {
    setRiskFilter('');
    setCohortFilter('');
    setHospitalFilter('');
    setSearch('');
    setDebouncedQuery('');
    setPage(1);
  };

  if (isLoading && !data) {
    return <LoadingState message="กำลังโหลดข้อมูลฝากครรภ์..." />;
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

  const pagination = data?.pagination ?? { total: 0, page: 1, perPage: 20, totalPages: 1 };

  const riskCells = [
    { k: 'LOW' as const, v: counts?.low, color: 'var(--risk-low)' },
    { k: 'HR1' as const, v: counts?.hr1, color: 'var(--risk-medium)' },
    { k: 'HR2' as const, v: counts?.hr2, color: 'var(--risk-medium)' },
    { k: 'HR3' as const, v: counts?.hr3, color: 'var(--risk-high)' },
  ];

  const opsCells: Array<{
    testId: string;
    k: string;
    labelTh: string;
    v: number | undefined;
    color: string;
    cohort: string;
  }> = [
    {
      testId: 'kpi-due-soon',
      k: `DUE ≤${ANC_OPS.dueSoonDays}D`,
      labelTh: 'ใกล้ครบกำหนดคลอด',
      v: opsCounts?.dueSoon,
      color: 'var(--accent-navy)',
      cohort: 'due_soon',
    },
    {
      testId: 'kpi-overdue-edc',
      k: 'OVERDUE EDC',
      labelTh: 'เกินกำหนดคลอด',
      v: opsCounts?.overdueEdc,
      color: 'var(--risk-high)',
      cohort: 'overdue_edc',
    },
    {
      testId: 'kpi-anc-stale',
      k: 'MISSED ANC',
      labelTh: `ห่างนัดเกิน ${ANC_OPS.followupWarnDays} วัน`,
      v: opsCounts?.ancStale,
      color: 'var(--risk-medium)',
      cohort: 'anc_stale',
    },
    {
      testId: 'kpi-low-visits',
      k: `ANC <${ANC_OPS.minVisits}`,
      labelTh: `ฝากครรภ์ไม่ครบเกณฑ์ (GA≥${ANC_OPS.minVisitsGaWeeks})`,
      v: opsCounts?.lowVisits,
      color: 'var(--risk-medium)',
      cohort: 'low_visits',
    },
    {
      testId: 'kpi-near-term',
      k: `GA ≥${ANC_OPS.nearTermGaWeeks}W`,
      labelTh: 'ใกล้คลอด',
      v: opsCounts?.nearTerm,
      color: 'var(--ink-navy-dim)',
      cohort: 'near_term',
    },
    {
      testId: 'kpi-ltfu',
      k: 'LTFU',
      labelTh: 'หลุดการติดตาม (60–120 วัน)',
      v: opsCounts?.ltfu,
      color: 'var(--risk-high)',
      cohort: 'ltfu',
    },
  ];

  return (
    <div style={{ color: 'var(--ink-navy)', background: 'var(--surface-cool)' }}>
      {/* Page header strip */}
      <div
        className="bg-white px-5 py-2.5"
        style={{ borderBottom: '1px solid var(--rule-strong)' }}
      >
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <div>
            <div className="font-mono text-[12px] uppercase tracking-[0.18em] text-[var(--ink-navy-muted)]">
              PROVINCIAL REGISTRY · ANC
            </div>
            <h1
              className="mt-0.5 text-[26px] font-bold leading-tight tracking-tight"
              style={{ color: 'var(--ink-navy)' }}
            >
              ฝากครรภ์ (ANC)
            </h1>
          </div>
          <p className="font-mono text-[13px] text-[var(--ink-navy-muted)]">
            ทะเบียนหญิงตั้งครรภ์ทั้งจังหวัด ·{' '}
            <span className="font-semibold text-[var(--ink-navy)] tabular-nums">
              {counts ? counts.total : pagination.total}
            </span>{' '}
            ราย
          </p>
          <p className="ml-auto font-mono text-[12px] tracking-[0.08em] text-[var(--ink-navy-muted)]">
            อัปเดตล่าสุด{' '}
            <span className="tabular-nums text-[var(--ink-navy-dim)]">
              {lastUpdated ? formatThaiTime(lastUpdated) : '—'}
            </span>{' '}
            · รีเฟรชอัตโนมัติทุก 30 วิ
          </p>
        </div>
        <p className="mt-1 text-[12px] text-[var(--ink-navy-muted)]">
          ไม่รวมรายที่คลอดแล้ว · GA เกิน 42 สัปดาห์ · หรือขาดการติดตามเกิน 60 วัน
          (ดูรายขาดติดตามได้ที่ช่อง LTFU)
        </p>
      </div>

      {/* 01 — Province-wide risk strip (DB-wide; cells toggle the risk filter) */}
      <div
        className="grid bg-white"
        style={{
          gridTemplateColumns: '1.5fr 1fr 1fr 1fr 1fr',
          borderBottom: '1px solid var(--rule-strong)',
        }}
      >
        <div className="border-r border-[var(--rule-strong)] px-5 py-4">
          <div className="font-mono text-[12px] uppercase tracking-[0.14em] text-[var(--ink-navy-muted)]">
            PROVINCE-WIDE
          </div>
          <div className="mt-1.5 flex items-baseline gap-2.5">
            <div
              className="font-mono text-[40px] font-semibold leading-none tabular-nums"
              style={{ color: 'var(--ink-navy)', letterSpacing: '-0.02em' }}
            >
              {counts ? counts.total : '—'}
            </div>
            <div className="font-mono text-[13px] text-[var(--ink-navy-dim)]">หญิงตั้งครรภ์</div>
          </div>
          <div className="mt-2.5">
            <RiskBar
              low={counts?.low ?? 0}
              medium={counts ? counts.hr1 + counts.hr2 : 0}
              high={counts?.hr3 ?? 0}
              height={6}
            />
          </div>
        </div>
        {riskCells.map((c) => {
          const active = riskFilter === c.k;
          return (
            <KpiTip
              key={c.k}
              title={`${c.k} — ${ANC_RISK_LABEL_TH[c.k]}`}
              body={RISK_TIPS[c.k]}
              trigger={
                <button
                  data-testid={`risk-${c.k}`}
                  aria-pressed={active}
                  onClick={() => {
                    setRiskFilter((r) => (r === c.k ? '' : c.k));
                    setPage(1);
                  }}
                  className="flex flex-col gap-0.5 px-4 py-3 text-left transition-colors hover:bg-[var(--accent-navy-soft)]"
                  style={{
                    borderLeft: `2px solid ${c.color}`,
                    background: active ? 'var(--accent-navy-soft)' : undefined,
                  }}
                />
              }
            >
              <div className="font-mono text-[12px] uppercase tracking-[0.12em] text-[var(--ink-navy-muted)]">
                {c.k}
              </div>
              <div className="flex items-baseline gap-2">
                <div
                  className="font-mono text-[28px] font-semibold leading-none tabular-nums"
                  style={{ color: 'var(--ink-navy)' }}
                >
                  {c.v ?? '—'}
                </div>
                <div className="font-mono text-[12px] text-[var(--ink-navy-muted)]">
                  {ANC_RISK_LABEL_TH[c.k]}
                </div>
              </div>
            </KpiTip>
          );
        })}
      </div>

      {/* 02 — Operational cohorts (DB-wide; cells toggle the cohort filter) */}
      <div
        className="grid grid-cols-2 bg-white sm:grid-cols-3 lg:grid-cols-6"
        style={{ borderBottom: '1px solid var(--rule-strong)' }}
      >
        {opsCells.map((c, i) => {
          const active = cohortFilter === c.cohort;
          const tip = COHORT_TIPS[c.testId];
          return (
            <KpiTip
              key={c.cohort}
              title={tip.title}
              body={tip.body}
              trigger={
                <button
                  data-testid={c.testId}
                  aria-pressed={active}
                  onClick={() => {
                    setCohortFilter((cur) => (cur === c.cohort ? '' : c.cohort));
                    setPage(1);
                  }}
                  className="flex flex-col gap-0.5 px-4 py-3 text-left transition-colors hover:bg-[var(--accent-navy-soft)]"
                  style={{
                    borderLeft: `2px solid ${c.color}`,
                    borderRight:
                      i < opsCells.length - 1 ? '1px solid var(--rule-strong)' : undefined,
                    background: active ? 'var(--accent-navy-soft)' : undefined,
                  }}
                />
              }
            >
              <div className="font-mono text-[12px] uppercase tracking-[0.12em] text-[var(--ink-navy-muted)]">
                {c.k}
              </div>
              <div
                className="font-mono text-[28px] font-semibold leading-none tabular-nums"
                style={{
                  color:
                    (c.v ?? 0) > 0 && c.color === 'var(--risk-high)' ? c.color : 'var(--ink-navy)',
                }}
              >
                {c.v ?? '—'}
              </div>
              <div className="text-[12px] text-[var(--ink-navy-muted)]">{c.labelTh}</div>
            </KpiTip>
          );
        })}
      </div>

      {/* 03 — Filters + registry */}
      <div className="bg-white px-5 pt-4 pb-5">
        <SectionLabel
          idx={3}
          right={
            <span>
              PAGE {pagination.page}/{pagination.totalPages} · {pagination.total} TOTAL
            </span>
          }
        >
          ANC Registry
        </SectionLabel>

        <div
          className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2 border bg-white px-3 py-2"
          style={{ borderColor: 'var(--rule-strong)', borderBottom: 'none' }}
        >
          {/* Search */}
          <div className="relative min-w-[220px] flex-1">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--ink-navy-muted)]" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="ค้นหา ชื่อ / HN / โรงพยาบาล…"
              className="h-8 w-full rounded-sm border bg-white pl-8 pr-3 text-[14px] focus:border-[var(--accent-navy)] focus:outline-none focus:ring-1 focus:ring-[var(--accent-navy-soft)]"
              style={{ borderColor: 'var(--rule-strong)' }}
            />
          </div>

          {/* Hospital */}
          <div className="flex items-center gap-1">
            <span className="font-mono text-[12px] uppercase tracking-[0.1em] text-[var(--ink-navy-muted)]">
              HOSPITAL:
            </span>
            <select
              data-testid="filter-hospital"
              value={hospitalFilter}
              onChange={(e) => {
                setHospitalFilter(e.target.value);
                setPage(1);
              }}
              className="h-7 max-w-[220px] rounded-sm border bg-white px-1.5 font-mono text-[13px] focus:border-[var(--accent-navy)] focus:outline-none"
              style={{
                borderColor: hospitalFilter ? 'var(--accent-navy)' : 'var(--rule-strong)',
                color: hospitalFilter ? 'var(--accent-navy)' : 'var(--ink-navy-dim)',
              }}
            >
              <option value="">ทุกโรงพยาบาล</option>
              {hospitalCounts.map((h) => (
                <option key={h.id} value={h.id}>
                  {h.name} ({h.count})
                </option>
              ))}
            </select>
          </div>

          {/* Sort */}
          <div className="flex items-center gap-1">
            <span className="font-mono text-[12px] uppercase tracking-[0.1em] text-[var(--ink-navy-muted)]">
              SORT:
            </span>
            <select
              data-testid="sort-select"
              value={sortBy}
              onChange={(e) => {
                setSortBy(e.target.value);
                setPage(1);
              }}
              className="h-7 rounded-sm border bg-white px-1.5 font-mono text-[13px] focus:border-[var(--accent-navy)] focus:outline-none"
              style={{ borderColor: 'var(--rule-strong)', color: 'var(--ink-navy-dim)' }}
            >
              {SORT_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>

          {hasActiveFilters && (
            <button
              onClick={clearFilters}
              className="inline-flex items-center gap-1 rounded-sm border px-2 py-1 font-mono text-[12px] tracking-[0.08em] transition-colors hover:bg-[var(--accent-navy-soft)]"
              style={{ borderColor: 'var(--rule-strong)', color: 'var(--ink-navy-dim)' }}
            >
              <X className="h-3 w-3" />
              ล้างตัวกรอง
            </button>
          )}
        </div>

        {/* Desktop table (md+) */}
        <div
          className="hidden border border-t-0 bg-white md:block"
          style={{ borderColor: 'var(--rule-strong)' }}
        >
          <div className="overflow-x-auto">
            <div className="min-w-[1250px]">
              <div
                className="grid gap-2 border-b border-[var(--rule-strong)] px-3 py-2 font-mono text-[12px] tracking-[0.1em] text-[var(--ink-navy-muted)]"
                style={{ gridTemplateColumns: GRID_COLUMNS }}
              >
                <div>HN</div>
                <div>PATIENT</div>
                <div>AGE</div>
                <div>GA</div>
                <div>RISK</div>
                <div>ANC#</div>
                <div>LAST ANC</div>
                <div>DUE (EDC)</div>
                <div>HOSPITAL</div>
              </div>

              {journeys.length === 0 ? (
                <EmptyState hasActiveFilters={hasActiveFilters} onClear={clearFilters} />
              ) : (
                journeys.map((j) => <JourneyRow key={j.id} journey={j} />)
              )}
            </div>
          </div>
        </div>

        {/* Mobile cards (below md) */}
        <div
          className="border border-t-0 bg-white md:hidden"
          style={{ borderColor: 'var(--rule-strong)' }}
        >
          {journeys.length === 0 ? (
            <EmptyState hasActiveFilters={hasActiveFilters} onClear={clearFilters} />
          ) : (
            journeys.map((j) => <JourneyCard key={j.id} journey={j} />)
          )}
        </div>

        {/* Pagination */}
        {pagination.totalPages > 1 && (
          <div
            className="mt-3 flex items-center justify-between font-mono text-[12px] tracking-[0.08em]"
            style={{ color: 'var(--ink-navy-muted)' }}
          >
            <span>
              SHOWING{' '}
              <span className="font-semibold text-[var(--ink-navy)] tabular-nums">
                {(pagination.page - 1) * pagination.perPage + 1}–
                {Math.min(pagination.page * pagination.perPage, pagination.total)}
              </span>{' '}
              OF{' '}
              <span className="font-semibold text-[var(--ink-navy)] tabular-nums">
                {pagination.total}
              </span>
            </span>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="inline-flex items-center gap-1 rounded-sm border bg-white px-2.5 py-1 text-[12px] transition-colors hover:bg-[var(--accent-navy-soft)] disabled:opacity-40"
                style={{ borderColor: 'var(--rule-strong)', color: 'var(--ink-navy-dim)' }}
              >
                <ChevronLeft className="h-3 w-3" />
                PREV
              </button>
              <span
                className="rounded-sm px-2.5 py-1 font-semibold tabular-nums"
                style={{ background: 'var(--accent-navy-soft)', color: 'var(--accent-navy)' }}
              >
                {pagination.page}/{pagination.totalPages}
              </span>
              <button
                onClick={() => setPage((p) => Math.min(pagination.totalPages, p + 1))}
                disabled={page >= pagination.totalPages}
                className="inline-flex items-center gap-1 rounded-sm border bg-white px-2.5 py-1 text-[12px] transition-colors hover:bg-[var(--accent-navy-soft)] disabled:opacity-40"
                style={{ borderColor: 'var(--rule-strong)', color: 'var(--ink-navy-dim)' }}
              >
                NEXT
                <ChevronRight className="h-3 w-3" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function EmptyState({
  hasActiveFilters,
  onClear,
}: {
  hasActiveFilters: boolean;
  onClear: () => void;
}) {
  return (
    <div className="px-3 py-10 text-center">
      <Baby className="mx-auto mb-2 h-8 w-8 text-[var(--ink-navy-muted)] opacity-50" />
      <p className="font-mono text-[13px] text-[var(--ink-navy-muted)]">ไม่พบข้อมูลฝากครรภ์</p>
      {hasActiveFilters ? (
        <button
          onClick={onClear}
          className="mt-3 inline-flex items-center gap-1 rounded-sm border bg-white px-2.5 py-1 font-mono text-[12px] tracking-[0.08em] transition-colors hover:bg-[var(--accent-navy-soft)]"
          style={{ borderColor: 'var(--rule-strong)', color: 'var(--accent-navy)' }}
        >
          <X className="h-3 w-3" />
          ล้างตัวกรอง
        </button>
      ) : (
        <p className="mt-1 text-[13px] text-[var(--ink-navy-muted)]">
          ยังไม่มีข้อมูลฝากครรภ์ในทะเบียน
        </p>
      )}
    </div>
  );
}

function AgeCell({ age }: { age: number }) {
  const flag = ageFlag(age);
  return (
    <div className="flex items-center gap-1">
      <span className="font-mono text-[14px] tabular-nums text-[var(--ink-navy-dim)]">{age}</span>
      {flag === 'teen' && <FlagChip color="var(--risk-medium)">&lt;20</FlagChip>}
      {flag === 'ama' && <FlagChip color="var(--ink-navy-dim)">35+</FlagChip>}
    </div>
  );
}

function JourneyRow({ journey: j }: { journey: JourneyListItem }) {
  const due = classifyEdcDue(j.edc);
  const followup = classifyAncFollowup(j.lastAncDate);
  return (
    <Link
      href={`/pregnancies/${j.id}`}
      data-testid={`journey-row-${j.id}`}
      data-due={due}
      data-followup={followup}
      data-age-flag={ageFlag(j.age)}
      className="grid cursor-pointer items-center gap-2 border-b px-3 py-2 transition-colors hover:bg-[var(--accent-navy-soft)]"
      style={{
        gridTemplateColumns: GRID_COLUMNS,
        borderColor: 'var(--rule-hair)',
        borderLeft: `3px solid ${
          due === 'overdue' || followup === 'critical' ? 'var(--risk-high)' : 'transparent'
        }`,
        minHeight: 52,
      }}
    >
      <div className="font-mono text-[14px] font-semibold text-[var(--ink-navy)]">{j.hn}</div>
      <div className="min-w-0">
        <div className="truncate text-[15px] text-[var(--ink-navy)]">{maskName(j.name)}</div>
        <div className="font-mono text-[12px] text-[var(--ink-navy-muted)]">
          G{j.gravida}
          {j.para > 0 && <>P{j.para}</>}
        </div>
      </div>
      <AgeCell age={j.age} />
      <div className="font-mono text-[14px] tabular-nums text-[var(--ink-navy-dim)]">
        {j.gaWeeks != null ? (
          <>
            {j.gaWeeks}
            <span className="text-[12px] text-[var(--ink-navy-muted)]">w</span>
          </>
        ) : (
          '—'
        )}
      </div>
      <div>
        <AncRiskChip level={j.ancRiskLevel} />
      </div>
      <div className="font-mono text-[14px] tabular-nums text-[var(--ink-navy-dim)]">
        {j.ancVisitCount}
      </div>
      <LastAncCell lastAncDate={j.lastAncDate} followup={followup} />
      <DueCell edc={j.edc} due={due} />
      <div className="truncate text-[14px] text-[var(--ink-navy-dim)]">{j.hospitalName}</div>
    </Link>
  );
}

function JourneyCard({ journey: j }: { journey: JourneyListItem }) {
  const due = classifyEdcDue(j.edc);
  const followup = classifyAncFollowup(j.lastAncDate);
  return (
    <Link
      href={`/pregnancies/${j.id}`}
      className="block border-b px-3 py-2.5 transition-colors hover:bg-[var(--accent-navy-soft)]"
      style={{
        borderColor: 'var(--rule-hair)',
        borderLeft: `3px solid ${
          due === 'overdue' || followup === 'critical' ? 'var(--risk-high)' : 'transparent'
        }`,
      }}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-[13px] font-semibold text-[var(--ink-navy)]">{j.hn}</span>
        <AncRiskChip level={j.ancRiskLevel} />
      </div>
      <div className="mt-1 flex items-center gap-1.5">
        <span className="truncate text-[15px] font-medium text-[var(--ink-navy)]">
          {maskName(j.name)}
        </span>
      </div>
      <div className="mt-0.5 font-mono text-[12px] text-[var(--ink-navy-muted)]">
        อายุ {j.age} · G{j.gravida}
        {j.para > 0 && <>P{j.para}</>}
        {j.gaWeeks != null && <> · GA {j.gaWeeks}w</>} · ANC {j.ancVisitCount} ครั้ง
      </div>
      <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2">
        <LastAncCell lastAncDate={j.lastAncDate} followup={followup} />
        <DueCell edc={j.edc} due={due} />
      </div>
      <div className="mt-1 text-[13px] text-[var(--ink-navy-dim)]">{j.hospitalName}</div>
    </Link>
  );
}

// useSearchParams (alert-ribbon deep links) requires a Suspense boundary in
// prerendered app-router pages — Next.js bails out of static rendering
// without one.
export default function PregnanciesPage() {
  return (
    <Suspense fallback={<LoadingState message="กำลังโหลด..." />}>
      <PregnanciesBoard />
    </Suspense>
  );
}
