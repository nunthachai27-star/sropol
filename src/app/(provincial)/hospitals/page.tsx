// Hospitals — provincial directory. Redesigned 2026-04-30 to a Mission-Control
// "Map + Roster" split: a Leaflet map of Surin on the left (pins sized by
// activity, colored by max-risk severity), a level-grouped roster on the right
// that selects in sync with the map. Top KPI strip surfaces network-level ops
// signals (online ratio, active total, high-risk total, sync health).
'use client';

import { useState, useMemo, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useDashboard } from '@/hooks/useDashboard';
import { useSetBreadcrumbs } from '@/components/layout/BreadcrumbContext';
import { LoadingState } from '@/components/shared/LoadingState';
import { ErrorState } from '@/components/shared/ErrorState';
import { SectionLabel } from '@/components/dashboard/shared';
import { ProvinceMap } from '@/components/dashboard/ProvinceMap';
import { HOSPITAL_LEVELS, KK_HOSPITALS } from '@/config/hospitals';
import {
  classifySyncHealth,
  combinedWorkload,
  classifyPartographCoverage,
  PARTOGRAPH_QUALITY,
  type SyncHealthClass,
  type PartographCoverageClass,
} from '@/config/hospital-network';
import { cn, formatThaiTime } from '@/lib/utils';
import { KpiTip } from '@/components/shared/KpiTip';
import { SYNC_HEALTH } from '@/config/hospital-network';
import { formatRelativeAge } from '@/lib/relative-time';
import { Search, Building2, Globe, ChevronRight } from 'lucide-react';
import type { DashboardHospital } from '@/types/api';
import type { HospitalLevel } from '@/types/domain';

const KK_HCODES = new Set(KK_HOSPITALS.map((h) => h.hcode));

type TabKey = 'khonkaen' | 'other';

function groupByLevel(hospitals: DashboardHospital[]) {
  const groups = new Map<HospitalLevel, DashboardHospital[]>();
  const sortedLevels = Object.values(HOSPITAL_LEVELS).sort((a, b) => a.sortOrder - b.sortOrder);
  for (const config of sortedLevels) groups.set(config.level, []);
  for (const h of hospitals) {
    const list = groups.get(h.level);
    if (list) list.push(h);
    else {
      const other = groups.get('M2' as HospitalLevel) ?? [];
      other.push(h);
    }
  }
  for (const [level, list] of groups) if (list.length === 0) groups.delete(level);
  return groups;
}

function levelStats(list: DashboardHospital[]) {
  let anc = 0;
  let labor = 0;
  let high = 0;
  for (const h of list) {
    anc += h.ancCounts.total;
    labor += h.counts.total;
    high += h.counts.high;
  }
  return { anc, labor, high };
}

// Sync-freshness display tokens — classification itself lives in
// src/config/hospital-network.ts.
const SYNC_META: Record<SyncHealthClass, { color: string }> = {
  ok: { color: 'var(--risk-low)' },
  stale: { color: 'var(--risk-medium)' },
  critical: { color: 'var(--risk-high)' },
  never: { color: 'var(--ink-navy-muted)' },
  blocked: { color: 'var(--risk-high)' },
};

/** Relative last-sync stamp with a status dot; blocked/never get labels. */
function SyncCell({ hospital }: { hospital: DashboardHospital }) {
  const health = classifySyncHealth(hospital.syncStatus, hospital.lastSyncAt);
  const meta = SYNC_META[health];
  const text =
    health === 'blocked'
      ? 'ถูกบล็อก'
      : health === 'never'
        ? 'ยังไม่ซิงก์'
        : formatRelativeAge(hospital.lastSyncAt, 'th');
  return (
    <span
      className="inline-flex items-center gap-1.5 font-mono text-[13px] tabular-nums"
      style={{ color: health === 'ok' ? 'var(--ink-navy-muted)' : meta.color }}
      title={hospital.syncBlockedReason ?? undefined}
    >
      <span
        className="inline-block h-1.5 w-1.5 shrink-0 rounded-full"
        style={{ background: meta.color }}
      />
      {text}
    </span>
  );
}

const ROSTER_GRID = '58px 1fr 60px 60px 64px 96px 16px';

// Coverage-class → color, shared by the roster cell and the KPI number.
const PARTO_COLOR: Record<PartographCoverageClass, string> = {
  ok: 'var(--risk-low)',
  warn: 'var(--risk-medium)',
  critical: 'var(--risk-high)',
  none: 'var(--ink-navy-muted)',
};

/** Partograph charting coverage for one hospital — "charted/recent" over the
 *  quality window; hospitals with no recent admissions show a dash. */
function PartoCell({ hospital }: { hospital: DashboardHospital }) {
  const pq = hospital.partographQuality;
  const cls = classifyPartographCoverage(pq.laborRecent, pq.withPartograph);
  return (
    <div
      className="text-right"
      data-testid="parto-cell"
      data-parto={cls}
      title={
        cls === 'none'
          ? `ไม่มีผู้คลอดรับใหม่ใน ${PARTOGRAPH_QUALITY.windowDays} วัน`
          : `บันทึก partograph ${pq.withPartograph} จาก ${pq.laborRecent} ราย (${PARTOGRAPH_QUALITY.windowDays} วัน)`
      }
    >
      {cls === 'none' ? (
        <span className="font-mono text-[13px] text-[var(--ink-navy-muted)]">—</span>
      ) : (
        <span
          className="font-mono text-[14px] font-semibold tabular-nums"
          style={{ color: PARTO_COLOR[cls] }}
        >
          {pq.withPartograph}/{pq.laborRecent}
        </span>
      )}
    </div>
  );
}

interface RosterRowProps {
  hospital: DashboardHospital;
  isSelected: boolean;
  onSelect: () => void;
  onOpen: () => void;
}

function RosterRow({ hospital, isSelected, onSelect, onOpen }: RosterRowProps) {
  const ref = useRef<HTMLButtonElement | null>(null);

  // When this row becomes the selection (because the user clicked a map pin),
  // bring it into view inside the scrollable roster pane.
  useEffect(() => {
    if (isSelected && ref.current) {
      ref.current.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }, [isSelected]);

  const health = classifySyncHealth(hospital.syncStatus, hospital.lastSyncAt);
  return (
    <button
      ref={ref}
      type="button"
      data-testid={`hospital-row-${hospital.hcode}`}
      data-sync={health}
      onMouseEnter={onSelect}
      onClick={onOpen}
      className={cn(
        'group grid w-full items-center gap-3 border-b px-3 py-2 text-left transition-colors',
        isSelected ? '' : 'hover:bg-[var(--accent-navy-soft)]',
      )}
      style={{
        gridTemplateColumns: ROSTER_GRID,
        borderColor: 'var(--rule-hair)',
        background: isSelected ? 'var(--accent-navy-soft)' : undefined,
        minHeight: 42,
      }}
    >
      <div
        className="font-mono text-[14px] tabular-nums"
        style={{ color: 'var(--ink-navy-muted)' }}
      >
        {hospital.hcode}
      </div>
      <div className="min-w-0 truncate text-[16px] font-medium text-[var(--ink-navy)]">
        {hospital.name}
        {hospital.counts.high > 0 && (
          <span
            className="ml-2 border px-1.5 py-0.5 align-middle font-mono text-[12px] font-semibold tracking-[0.06em]"
            style={{ color: 'var(--risk-high)', borderColor: 'var(--risk-high)' }}
          >
            HR
          </span>
        )}
        {hospital.ancCounts.hr3 > 0 && (
          <span
            className="ml-2 border px-1.5 py-0.5 align-middle font-mono text-[12px] font-semibold tracking-[0.06em]"
            style={{ color: 'var(--risk-medium)', borderColor: 'var(--risk-medium)' }}
            title={`ครรภ์เสี่ยงสูง (HR3) ${hospital.ancCounts.hr3} ราย`}
          >
            HR3 {hospital.ancCounts.hr3}
          </span>
        )}
      </div>
      <div
        className="text-right font-mono text-[15px] font-semibold tabular-nums"
        style={{
          color: hospital.ancCounts.total > 0 ? 'var(--accent-navy)' : 'var(--ink-navy-muted)',
        }}
      >
        {hospital.ancCounts.total > 0 ? hospital.ancCounts.total : '—'}
      </div>
      <div
        className="text-right font-mono text-[15px] font-semibold tabular-nums"
        style={{
          color: hospital.counts.total > 0 ? 'var(--ink-navy)' : 'var(--ink-navy-muted)',
        }}
      >
        {hospital.counts.total > 0 ? hospital.counts.total : '—'}
      </div>
      <PartoCell hospital={hospital} />
      <div className="text-right">
        <SyncCell hospital={hospital} />
      </div>
      <ChevronRight className="h-3.5 w-3.5" style={{ color: 'var(--ink-navy-muted)' }} />
    </button>
  );
}

interface RosterListProps {
  hospitals: DashboardHospital[];
  selected: string | null;
  onSelect: (hcode: string | null) => void;
}

function RosterList({ hospitals, selected, onSelect }: RosterListProps) {
  const router = useRouter();
  const grouped = useMemo(() => groupByLevel(hospitals), [hospitals]);

  if (grouped.size === 0) {
    return (
      <div
        className="border bg-white py-10 text-center"
        style={{ borderColor: 'var(--rule-strong)' }}
      >
        <Building2 className="mx-auto mb-2 h-8 w-8 text-[var(--ink-navy-muted)] opacity-50" />
        <p className="font-mono text-[14px] text-[var(--ink-navy-muted)]">
          ไม่พบโรงพยาบาลที่ตรงกับการค้นหา
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Column legend — mirrors the row grid so numbers read as columns. */}
      <div
        className="grid gap-3 px-3 font-mono text-[12px] uppercase tracking-[0.1em] text-[var(--ink-navy-muted)]"
        style={{ gridTemplateColumns: ROSTER_GRID }}
      >
        <div>CODE</div>
        <div>HOSPITAL</div>
        <div className="text-right">ANC</div>
        <div className="text-right">LABOR</div>
        <div className="text-right">PARTO</div>
        <div className="text-right">SYNC</div>
        <div />
      </div>
      {Array.from(grouped.entries()).map(([level, levelHospitals]) => {
        const config = HOSPITAL_LEVELS[level];
        const stats = levelStats(levelHospitals);
        // Busiest first — combined labor + weighted-ANC workload.
        const ordered = [...levelHospitals].sort(
          (a, b) =>
            combinedWorkload(b.counts, b.ancCounts) - combinedWorkload(a.counts, a.ancCounts),
        );
        return (
          <div
            key={level}
            className="border bg-white"
            style={{ borderColor: 'var(--rule-strong)' }}
          >
            <div
              className="flex items-center justify-between px-3 py-2"
              style={{ borderBottom: '1px solid var(--rule-strong)' }}
            >
              <div className="flex items-center gap-2">
                <span className="font-mono text-[13px] uppercase tracking-[0.14em] text-[var(--ink-navy-dim)]">
                  {config?.nameTh ?? level}
                </span>
                <span
                  className="rounded-sm border px-1.5 py-0.5 font-mono text-[13px] tabular-nums text-[var(--ink-navy-dim)]"
                  style={{ borderColor: 'var(--rule-strong)' }}
                >
                  {levelHospitals.length}
                </span>
              </div>
              <div className="flex items-center gap-3 font-mono text-[13px] tracking-[0.06em] text-[var(--ink-navy-muted)]">
                <span>
                  ANC{' '}
                  <span className="font-semibold tabular-nums text-[var(--accent-navy)]">
                    {stats.anc}
                  </span>
                </span>
                <span>
                  LABOR{' '}
                  <span className="text-[var(--ink-navy)] font-semibold tabular-nums">
                    {stats.labor}
                  </span>
                </span>
                {stats.high > 0 && (
                  <span>
                    HR{' '}
                    <span
                      className="font-semibold tabular-nums"
                      style={{ color: 'var(--risk-high)' }}
                    >
                      {stats.high}
                    </span>
                  </span>
                )}
              </div>
            </div>
            {ordered.map((h) => (
              <RosterRow
                key={h.hcode}
                hospital={h}
                isSelected={selected === h.hcode}
                onSelect={() => onSelect(h.hcode)}
                onOpen={() => router.push(`/hospitals/${h.hcode}`)}
              />
            ))}
          </div>
        );
      })}
    </div>
  );
}

export default function HospitalsPage() {
  useSetBreadcrumbs([{ label: 'แดชบอร์ด', href: '/' }, { label: 'โรงพยาบาล' }]);

  const { hospitals, isLoading, error, updatedAt, mutate } = useDashboard();
  const [search, setSearch] = useState('');
  const [activeTab, setActiveTab] = useState<TabKey>('khonkaen');
  const [selected, setSelected] = useState<string | null>(null);

  const kkHospitals = useMemo(() => hospitals.filter((h) => KK_HCODES.has(h.hcode)), [hospitals]);
  const otherHospitals = useMemo(
    () => hospitals.filter((h) => !KK_HCODES.has(h.hcode)),
    [hospitals],
  );

  const tabHospitals = activeTab === 'khonkaen' ? kkHospitals : otherHospitals;

  // Search applies to the roster only — the map keeps showing the full set
  // for spatial context, since hiding pins on a typed search would erase the
  // network awareness the map exists to provide.
  const filteredRoster = useMemo(() => {
    if (!search.trim()) return tabHospitals;
    const q = search.trim().toLowerCase();
    return tabHospitals.filter(
      (h) => h.name.toLowerCase().includes(q) || h.hcode.toLowerCase().includes(q),
    );
  }, [tabHospitals, search]);

  // KPI roll-ups — bound to the active tab so switching from KK to "other"
  // re-summarises (28 hospitals total = 26 KK + a couple of webhook guests).
  const totalActive = tabHospitals.reduce((sum, h) => sum + h.counts.total, 0);
  const totalLow = tabHospitals.reduce((sum, h) => sum + h.counts.low, 0);
  const totalMedium = tabHospitals.reduce((sum, h) => sum + h.counts.medium, 0);
  const totalHigh = tabHospitals.reduce((sum, h) => sum + h.counts.high, 0);
  const totalAnc = tabHospitals.reduce((sum, h) => sum + h.ancCounts.total, 0);
  // Partograph data quality — province coverage over the config window plus
  // how many hospitals sit below the warn threshold.
  const partoRecent = tabHospitals.reduce((sum, h) => sum + h.partographQuality.laborRecent, 0);
  const partoCharted = tabHospitals.reduce((sum, h) => sum + h.partographQuality.withPartograph, 0);
  const partoClass = classifyPartographCoverage(partoRecent, partoCharted);
  const partoPct = partoRecent > 0 ? Math.round((partoCharted / partoRecent) * 100) : null;
  const partoBelow = tabHospitals.filter((h) => {
    const c = classifyPartographCoverage(
      h.partographQuality.laborRecent,
      h.partographQuality.withPartograph,
    );
    return c === 'warn' || c === 'critical';
  }).length;
  const totalAncHr3 = tabHospitals.reduce((sum, h) => sum + h.ancCounts.hr3, 0);
  const withWorkload = tabHospitals.filter(
    (h) => combinedWorkload(h.counts, h.ancCounts) > 0,
  ).length;

  // Data-freshness breakdown — connection_status only says the tunnel is up;
  // these say whether the *data* is current (see config/hospital-network.ts).
  const syncBreakdown = { ok: 0, stale: 0, critical: 0, never: 0, blocked: 0 };
  for (const h of tabHospitals) {
    syncBreakdown[classifySyncHealth(h.syncStatus, h.lastSyncAt)] += 1;
  }
  const syncAttention =
    syncBreakdown.stale + syncBreakdown.critical + syncBreakdown.never + syncBreakdown.blocked;

  if (isLoading) {
    return <LoadingState message="กำลังโหลดรายชื่อโรงพยาบาล..." />;
  }

  // Fetch failed with nothing cached — an all-zero roster is indistinguishable
  // from an empty province, so show the failure instead of a blank map.
  if (error && !updatedAt) {
    return (
      <ErrorState
        message="ไม่สามารถโหลดข้อมูลโรงพยาบาลได้"
        detail={error instanceof Error ? error.message : String(error)}
        onRetry={() => mutate()}
      />
    );
  }
  // Fetch failed but SWR still holds the last good payload — keep rendering it
  // and flag the staleness (Constitution VI: offline shows cached data + time).
  const dataStale = Boolean(error && updatedAt);

  return (
    <div style={{ color: 'var(--ink-navy)', background: 'var(--surface-cool)' }}>
      {dataStale && (
        <ErrorState
          variant="banner"
          message="การเชื่อมต่อล้มเหลว — แสดงข้อมูลโรงพยาบาลเดิมจากแคช"
          lastUpdatedAt={updatedAt}
          onRetry={() => mutate()}
        />
      )}
      {/* Header strip */}
      <div
        className="flex flex-wrap items-baseline gap-x-4 gap-y-1 bg-white px-5 py-2.5"
        style={{ borderBottom: '1px solid var(--rule-strong)' }}
      >
        <div>
          <div className="font-mono text-[12px] uppercase tracking-[0.18em] text-[var(--ink-navy-muted)]">
            PROVINCIAL REGISTRY · HOSPITALS · GEOGRAPHIC VIEW
          </div>
          <h1
            className="mt-0.5 text-[26px] font-bold leading-tight tracking-tight"
            style={{ color: 'var(--ink-navy)' }}
          >
            โรงพยาบาล จังหวัดสุรินทร์
          </h1>
        </div>
        <p className="ml-auto font-mono text-[12px] tracking-[0.08em] text-[var(--ink-navy-muted)]">
          อัปเดตล่าสุด{' '}
          <span className="tabular-nums text-[var(--ink-navy-dim)]">
            {updatedAt ? formatThaiTime(updatedAt) : '—'}
          </span>{' '}
          · รีเฟรชอัตโนมัติทุก 30 วิ
        </p>
      </div>

      {/* KPI strip — 4 cells, vertical-rule division */}
      <div
        className="grid bg-white"
        style={{
          gridTemplateColumns: '1.4fr 1fr 1fr 1fr 1fr',
          borderBottom: '1px solid var(--rule-strong)',
        }}
      >
        <KpiTip
          title="โรงพยาบาลในเครือข่าย"
          body="จำนวน รพ.ในแท็บที่เลือก (จ.สุรินทร์ / ภายนอก) และจำนวนแห่งที่มีผู้ป่วยในระบบ — นับจากภาระงานรวมห้องคลอด + ทะเบียนฝากครรภ์"
          trigger={<div className="cursor-help border-r border-[var(--rule-strong)] px-5 py-3" />}
        >
          <div className="font-mono text-[12px] uppercase tracking-[0.14em] text-[var(--ink-navy-muted)]">
            ROSTER
          </div>
          <div
            className="mt-1 font-mono text-[32px] font-semibold leading-none tabular-nums"
            style={{ color: 'var(--ink-navy)', letterSpacing: '-0.02em' }}
          >
            {tabHospitals.length}
            <span className="ml-2 font-mono text-[14px] font-normal text-[var(--ink-navy-muted)]">
              โรงพยาบาล
            </span>
          </div>
          <div className="mt-1 font-mono text-[13px] text-[var(--ink-navy-dim)]">
            มีผู้ป่วยในระบบ {withWorkload} / {tabHospitals.length} แห่ง
          </div>
        </KpiTip>

        <KpiTip
          title="ความสดของข้อมูล (ไม่ใช่แค่การเชื่อมต่อ)"
          body={`นับ รพ.ที่ซิงก์ข้อมูลจาก HOSxP ภายใน ${SYNC_HEALTH.staleAfterMinutes} นาทีล่าสุด — ช้า = เกิน ${SYNC_HEALTH.staleAfterMinutes} นาที (แดงเมื่อเกิน ${SYNC_HEALTH.criticalAfterHours} ชม.), ยังไม่ซิงก์ = ไม่เคยมีข้อมูล, ถูกบล็อก = ระบบระงับการซิงก์ (ดูเหตุผลที่แถวรายชื่อ) — การเชื่อมต่อ ONLINE อย่างเดียวไม่รับประกันว่าข้อมูลเป็นปัจจุบัน`}
          trigger={
            <div
              className="cursor-help border-r border-[var(--rule-strong)] px-5 py-3"
              data-testid="kpi-sync"
            />
          }
        >
          <div className="font-mono text-[12px] uppercase tracking-[0.14em] text-[var(--ink-navy-muted)]">
            DATA SYNC
          </div>
          <div
            className="mt-1 font-mono text-[32px] font-semibold leading-none tabular-nums"
            style={{
              color: syncAttention === 0 ? 'var(--ink-navy)' : 'var(--risk-medium)',
              letterSpacing: '-0.02em',
            }}
          >
            <span>{syncBreakdown.ok}</span>
            <span className="ml-1 font-mono text-[14px] font-normal text-[var(--ink-navy-muted)]">
              /{tabHospitals.length} ข้อมูลสด
            </span>
          </div>
          <div className="mt-1 font-mono text-[13px] text-[var(--ink-navy-dim)]">
            ช้า {syncBreakdown.stale + syncBreakdown.critical} · ยังไม่ซิงก์ {syncBreakdown.never} ·{' '}
            <span style={{ color: syncBreakdown.blocked > 0 ? 'var(--risk-high)' : undefined }}>
              ถูกบล็อก {syncBreakdown.blocked}
            </span>
          </div>
        </KpiTip>

        <KpiTip
          title="ทะเบียนฝากครรภ์ทั้งเครือข่าย"
          body="ผลรวมหญิงตั้งครรภ์ในทะเบียน active ของทุก รพ.ในแท็บ พร้อมจำนวนครรภ์เสี่ยงสูงสุด (HR3) — ตัวเลขเดียวกับหน้า ฝากครรภ์"
          trigger={
            <div
              className="cursor-help border-r border-[var(--rule-strong)] px-5 py-3"
              data-testid="kpi-anc"
            />
          }
        >
          <div className="font-mono text-[12px] uppercase tracking-[0.14em] text-[var(--ink-navy-muted)]">
            ANC REGISTRY
          </div>
          <div
            className="mt-1 font-mono text-[32px] font-semibold leading-none tabular-nums"
            style={{ color: 'var(--accent-navy)', letterSpacing: '-0.02em' }}
          >
            <span>{totalAnc}</span>
            <span className="ml-2 font-mono text-[14px] font-normal text-[var(--ink-navy-muted)]">
              หญิงตั้งครรภ์
            </span>
          </div>
          <div className="mt-1 font-mono text-[13px]" style={{ color: 'var(--risk-high)' }}>
            HR3 {totalAncHr3} ราย
          </div>
        </KpiTip>

        <KpiTip
          title="ห้องคลอดทั้งเครือข่าย"
          body="ผู้ป่วยที่กำลังรอคลอด (labor_status = ACTIVE) รวมทุก รพ. แถบสีคือสัดส่วนระดับความเสี่ยง CPD ล่าสุด — LOW/MED/HIGH"
          trigger={
            <div
              className="cursor-help border-r border-[var(--rule-strong)] px-5 py-3"
              data-testid="kpi-labor"
            />
          }
        >
          <div className="font-mono text-[12px] uppercase tracking-[0.14em] text-[var(--ink-navy-muted)]">
            LABOR WARD
          </div>
          <div
            className="mt-1 font-mono text-[32px] font-semibold leading-none tabular-nums"
            style={{ color: 'var(--ink-navy)', letterSpacing: '-0.02em' }}
          >
            <span>{totalActive}</span>
            <span className="ml-2 font-mono text-[14px] font-normal text-[var(--ink-navy-muted)]">
              ผู้คลอด{totalHigh > 0 ? ` · เสี่ยงสูง ${totalHigh}` : ''}
            </span>
          </div>
          {totalActive > 0 ? (
            <div
              className="mt-2 flex h-1.5 overflow-hidden rounded-sm"
              style={{ background: 'var(--rule-hair)' }}
            >
              <span
                style={{
                  background: 'var(--risk-low)',
                  width: `${(totalLow / totalActive) * 100}%`,
                }}
              />
              <span
                style={{
                  background: 'var(--risk-medium)',
                  width: `${(totalMedium / totalActive) * 100}%`,
                }}
              />
              <span
                style={{
                  background: 'var(--risk-high)',
                  width: `${(totalHigh / totalActive) * 100}%`,
                }}
              />
            </div>
          ) : (
            <div className="mt-1 font-mono text-[13px] text-[var(--ink-navy-muted)]">
              ไม่มีผู้คลอดที่กำลังรอคลอด
            </div>
          )}
        </KpiTip>

        <KpiTip
          title="คุณภาพการบันทึก Partograph"
          body={`สัดส่วนผู้คลอดที่รับใหม่ใน ${PARTOGRAPH_QUALITY.windowDays} วันที่ผ่านมา ที่มีการบันทึก partograph อย่างน้อย 1 จุด — ต่ำกว่า ${PARTOGRAPH_QUALITY.warnBelowPct}% สีเหลือง, ต่ำกว่า ${PARTOGRAPH_QUALITY.criticalBelowPct}% สีแดง; รพ.ที่ไม่บันทึกเลย ส่วนกลางจะมองไม่เห็นภาวะวิกฤตระหว่างคลอด`}
          trigger={<div className="cursor-help px-5 py-3" data-testid="kpi-partograph" />}
        >
          <div className="font-mono text-[12px] uppercase tracking-[0.14em] text-[var(--ink-navy-muted)]">
            PARTOGRAPH QUALITY
          </div>
          <div
            className="mt-1 font-mono text-[32px] font-semibold leading-none tabular-nums"
            style={{ color: PARTO_COLOR[partoClass], letterSpacing: '-0.02em' }}
          >
            <span>{partoPct == null ? '—' : `${partoPct}%`}</span>
            <span className="ml-2 font-mono text-[14px] font-normal text-[var(--ink-navy-muted)]">
              {partoCharted}/{partoRecent} ราย · {PARTOGRAPH_QUALITY.windowDays} วัน
            </span>
          </div>
          <div
            className="mt-1 font-mono text-[13px]"
            style={{ color: partoBelow > 0 ? 'var(--risk-medium)' : 'var(--ink-navy-muted)' }}
          >
            {partoBelow > 0 ? `ต่ำกว่าเกณฑ์ ${partoBelow} รพ.` : 'ทุก รพ.ผ่านเกณฑ์'}
          </div>
        </KpiTip>
      </div>

      {/* Controls — tabs + search */}
      <div
        className="flex flex-wrap items-center gap-3 bg-white px-5 py-2.5"
        style={{ borderBottom: '1px solid var(--rule-strong)' }}
      >
        <div
          className="inline-flex items-center border bg-white"
          style={{ borderColor: 'var(--rule-strong)' }}
        >
          {[
            {
              k: 'khonkaen' as const,
              label: 'จ.สุรินทร์',
              count: kkHospitals.length,
              icon: Building2,
            },
            {
              k: 'other' as const,
              label: 'จังหวัดอื่น / ภายนอก',
              count: otherHospitals.length,
              icon: Globe,
            },
          ].map((t, i) => {
            const active = activeTab === t.k;
            const Icon = t.icon;
            return (
              <button
                key={t.k}
                onClick={() => {
                  setActiveTab(t.k);
                  setSelected(null);
                }}
                className={cn(
                  'inline-flex items-center gap-1.5 px-3 py-1.5 font-mono text-[14px] tracking-[0.06em] transition-colors',
                  active ? 'font-semibold' : 'font-normal hover:bg-[var(--accent-navy-soft)]',
                )}
                style={{
                  background: active ? 'var(--accent-navy-soft)' : 'white',
                  color: active ? 'var(--accent-navy)' : 'var(--ink-navy-dim)',
                  borderLeft: i > 0 ? '1px solid var(--rule-strong)' : undefined,
                }}
              >
                <Icon className="h-3.5 w-3.5" />
                {t.label}
                <span
                  className="rounded-sm border px-1.5 py-0.5 font-mono text-[13px] tabular-nums"
                  style={{
                    borderColor: active ? 'var(--accent-navy)' : 'var(--rule-strong)',
                    color: active ? 'var(--accent-navy)' : 'var(--ink-navy-dim)',
                  }}
                >
                  {t.count}
                </span>
              </button>
            );
          })}
        </div>

        <div className="relative ml-auto w-full sm:w-72">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--ink-navy-muted)]" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="ค้นหาชื่อหรือรหัส…"
            className="h-8 w-full rounded-sm border bg-white pl-8 pr-3 text-[15px] focus:border-[var(--accent-navy)] focus:outline-none focus:ring-1 focus:ring-[var(--accent-navy-soft)]"
            style={{ borderColor: 'var(--rule-strong)' }}
          />
        </div>
      </div>

      {/* Map + Roster split — stacks on small screens, splits from lg up. */}
      <div
        className="grid grid-cols-1 lg:[grid-template-columns:1.4fr_1fr]"
        style={{ minHeight: 'calc(100vh - 240px)' }}
      >
        {/* Map panel */}
        <div className="bg-white" style={{ borderRight: '1px solid var(--rule-strong)' }}>
          <div className="px-5 pt-3 pb-2">
            <SectionLabel
              idx={1}
              right={
                <span>
                  {tabHospitals.length} NODES · ขนาดวงกลม = ผู้คลอด · สี = ความเสี่ยงสูงสุด
                </span>
              }
            >
              Network map · เขตจังหวัดสุรินทร์
            </SectionLabel>
          </div>
          <div
            className="mx-5 mb-5 border"
            style={{
              borderColor: 'var(--rule-strong)',
              height: 'calc(100vh - 320px)',
              minHeight: 480,
            }}
          >
            <ProvinceMap
              hospitals={tabHospitals}
              selected={selected}
              onSelect={(hcode) => setSelected(hcode)}
              size="full"
            />
          </div>
        </div>

        {/* Roster panel */}
        <div
          className="overflow-y-auto bg-[var(--surface-cool)] px-5 pt-3 pb-6"
          style={{ maxHeight: 'calc(100vh - 240px)' }}
        >
          <SectionLabel
            idx={2}
            right={
              <span>
                {filteredRoster.length}/{tabHospitals.length} HOSPITALS
              </span>
            }
          >
            Hospital roster
          </SectionLabel>
          <div className="mt-2">
            <RosterList
              hospitals={filteredRoster}
              selected={selected}
              onSelect={(hcode) => setSelected(hcode)}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
