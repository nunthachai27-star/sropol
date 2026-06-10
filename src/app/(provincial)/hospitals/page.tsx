// Hospitals — provincial directory. Redesigned 2026-04-30 to a Mission-Control
// "Map + Roster" split: a Leaflet map of Khon Kaen on the left (pins sized by
// activity, colored by max-risk severity), a level-grouped roster on the right
// that selects in sync with the map. Top KPI strip surfaces network-level ops
// signals (online ratio, active total, high-risk total, sync health).
'use client';

import { useState, useMemo, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useDashboard } from '@/hooks/useDashboard';
import { useSetBreadcrumbs } from '@/components/layout/BreadcrumbContext';
import { LoadingState } from '@/components/shared/LoadingState';
import { SectionLabel } from '@/components/dashboard/shared';
import { ProvinceMap } from '@/components/dashboard/ProvinceMap';
import { HOSPITAL_LEVELS } from '@/config/hospitals';
import { DEFAULT_PROVINCE_CODE, DEFAULT_PROVINCE_NAME } from '@/config/province';
import { cn } from '@/lib/utils';
import { Search, Building2, Globe, ChevronRight } from 'lucide-react';
import type { DashboardHospital } from '@/types/api';
import type { HospitalLevel } from '@/types/domain';

type TabKey = 'inProvince' | 'other';

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
  let online = 0;
  let active = 0;
  let high = 0;
  for (const h of list) {
    if (h.connectionStatus === 'ONLINE') online++;
    active += h.counts.total;
    high += h.counts.high;
  }
  return { online, active, high };
}

// Mini risk-mix bar for each roster row — proportional segments scaled to row width.
function MiniMix({ counts }: { counts: DashboardHospital['counts'] }) {
  const total = counts.total || 1;
  const lowPct = (counts.low / total) * 100;
  const medPct = (counts.medium / total) * 100;
  const highPct = (counts.high / total) * 100;
  if (counts.total === 0) {
    return (
      <div
        className="h-1.5 w-16 rounded-sm"
        style={{ background: 'var(--rule-hair)' }}
      />
    );
  }
  return (
    <div
      className="flex h-1.5 w-16 overflow-hidden rounded-sm"
      style={{ background: 'var(--rule-hair)' }}
    >
      {lowPct > 0 && <span style={{ background: 'var(--risk-low)', width: `${lowPct}%` }} />}
      {medPct > 0 && <span style={{ background: 'var(--risk-medium)', width: `${medPct}%` }} />}
      {highPct > 0 && <span style={{ background: 'var(--risk-high)', width: `${highPct}%` }} />}
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

  const hasPatients = hospital.counts.total > 0;
  return (
    <button
      ref={ref}
      type="button"
      onMouseEnter={onSelect}
      onClick={onOpen}
      className={cn(
        'group grid w-full items-center gap-3 border-b px-3 py-2 text-left transition-colors',
        isSelected ? '' : 'hover:bg-[var(--accent-navy-soft)]',
      )}
      style={{
        gridTemplateColumns: '54px 1fr 70px 32px 14px',
        borderColor: 'var(--rule-hair)',
        background: isSelected ? 'var(--accent-navy-soft)' : undefined,
        minHeight: 42,
      }}
    >
      <div
        className="font-mono text-[12px] tabular-nums"
        style={{ color: 'var(--ink-navy-muted)' }}
      >
        {hospital.hcode}
      </div>
      <div className="min-w-0 truncate text-[14px] font-medium text-[var(--ink-navy)]">
        {hospital.name}
        {hospital.counts.high > 0 && (
          <span
            className="ml-2 rounded-sm px-1.5 py-0.5 align-middle font-mono text-[10px] tracking-[0.06em]"
            style={{ background: '#fde2dc', color: '#9b2c1c' }}
          >
            HR
          </span>
        )}
      </div>
      <div className="flex items-center justify-end">
        <MiniMix counts={hospital.counts} />
      </div>
      <div
        className="text-right font-mono text-[14px] font-semibold tabular-nums"
        style={{
          color: hasPatients ? 'var(--accent-navy)' : 'var(--ink-navy-muted)',
        }}
      >
        {hasPatients ? hospital.counts.total : '—'}
      </div>
      <ChevronRight
        className="h-3.5 w-3.5"
        style={{ color: 'var(--ink-navy-muted)' }}
      />
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
        <p className="font-mono text-[12px] text-[var(--ink-navy-muted)]">
          ไม่พบโรงพยาบาลที่ตรงกับการค้นหา
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {Array.from(grouped.entries()).map(([level, levelHospitals]) => {
        const config = HOSPITAL_LEVELS[level];
        const stats = levelStats(levelHospitals);
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
                <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-[var(--ink-navy-dim)]">
                  {config?.nameTh ?? level}
                </span>
                <span
                  className="rounded-sm border px-1.5 py-0.5 font-mono text-[11px] tabular-nums text-[var(--ink-navy-dim)]"
                  style={{ borderColor: 'var(--rule-strong)' }}
                >
                  {levelHospitals.length}
                </span>
              </div>
              <div className="flex items-center gap-3 font-mono text-[11px] tracking-[0.06em] text-[var(--ink-navy-muted)]">
                <span>
                  ACT <span className="text-[var(--ink-navy)] font-semibold tabular-nums">{stats.active}</span>
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
            {levelHospitals.map((h) => (
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
  useSetBreadcrumbs([
    { label: 'แดชบอร์ด', href: '/' },
    { label: 'โรงพยาบาล' },
  ]);

  const { hospitals, isLoading } = useDashboard();
  const [search, setSearch] = useState('');
  const [activeTab, setActiveTab] = useState<TabKey>('inProvince');
  const [selected, setSelected] = useState<string | null>(null);

  // Split by the active province (default = deployment province) rather than a
  // hardcoded hospital list, so any province's hospitals group correctly.
  const inProvinceHospitals = useMemo(
    () => hospitals.filter((h) => h.provinceCode === DEFAULT_PROVINCE_CODE),
    [hospitals],
  );
  const otherHospitals = useMemo(
    () => hospitals.filter((h) => h.provinceCode !== DEFAULT_PROVINCE_CODE),
    [hospitals],
  );

  const tabHospitals = activeTab === 'inProvince' ? inProvinceHospitals : otherHospitals;

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
  const onlineCount = tabHospitals.filter((h) => h.connectionStatus === 'ONLINE').length;
  const totalActive = tabHospitals.reduce((sum, h) => sum + h.counts.total, 0);
  const totalLow = tabHospitals.reduce((sum, h) => sum + h.counts.low, 0);
  const totalMedium = tabHospitals.reduce((sum, h) => sum + h.counts.medium, 0);
  const totalHigh = tabHospitals.reduce((sum, h) => sum + h.counts.high, 0);
  const withPatients = tabHospitals.filter((h) => h.counts.total > 0).length;

  if (isLoading) {
    return <LoadingState message="กำลังโหลดรายชื่อโรงพยาบาล..." />;
  }

  return (
    <div
      style={{
        color: 'var(--ink-navy)',
        background: 'var(--surface-cool)',
        // Bumped from 1.15 → 1.3 so the air-traffic-control aesthetic reads
        // at a clinic-room distance — same proportions as sister pages, just
        // larger overall.
        zoom: 1.3,
      }}
    >
      {/* Header strip */}
      <div
        className="flex flex-wrap items-baseline gap-x-4 gap-y-1 bg-white px-5 py-2.5"
        style={{ borderBottom: '1px solid var(--rule-strong)' }}
      >
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--ink-navy-muted)]">
            PROVINCIAL REGISTRY · HOSPITALS · GEOGRAPHIC VIEW
          </div>
          <h1
            className="mt-0.5 text-[24px] font-bold leading-tight tracking-tight"
            style={{ color: 'var(--ink-navy)' }}
          >
            โรงพยาบาล จังหวัด{DEFAULT_PROVINCE_NAME}
          </h1>
        </div>
      </div>

      {/* KPI strip — 4 cells, vertical-rule division */}
      <div
        className="grid bg-white"
        style={{
          gridTemplateColumns: '1.4fr 1fr 1fr 1fr',
          borderBottom: '1px solid var(--rule-strong)',
        }}
      >
        <div className="border-r border-[var(--rule-strong)] px-5 py-3">
          <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--ink-navy-muted)]">
            ROSTER
          </div>
          <div
            className="mt-1 font-mono text-[28px] font-semibold leading-none tabular-nums"
            style={{ color: 'var(--ink-navy)', letterSpacing: '-0.02em' }}
          >
            {tabHospitals.length}
            <span className="ml-2 font-mono text-[12px] font-normal text-[var(--ink-navy-muted)]">
              โรงพยาบาล
            </span>
          </div>
          <div className="mt-1 font-mono text-[11px] text-[var(--ink-navy-dim)]">
            มีผู้คลอด {withPatients} / {tabHospitals.length} แห่ง
          </div>
        </div>

        <div className="border-r border-[var(--rule-strong)] px-5 py-3">
          <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--ink-navy-muted)]">
            ONLINE
          </div>
          <div
            className="mt-1 font-mono text-[28px] font-semibold leading-none tabular-nums"
            style={{
              color:
                onlineCount === tabHospitals.length
                  ? 'var(--ink-navy)'
                  : 'var(--risk-medium)',
              letterSpacing: '-0.02em',
            }}
          >
            {onlineCount}
            <span className="ml-1 font-mono text-[12px] font-normal text-[var(--ink-navy-muted)]">
              /{tabHospitals.length}
            </span>
          </div>
          <div className="mt-1 flex items-center gap-1.5 font-mono text-[11px] text-[var(--ink-navy-dim)]">
            <span
              className="inline-block h-1.5 w-1.5 rounded-full"
              style={{
                background:
                  onlineCount === tabHospitals.length
                    ? 'var(--risk-low)'
                    : 'var(--risk-medium)',
              }}
            />
            {onlineCount === tabHospitals.length
              ? 'เชื่อมต่อครบ'
              : `${tabHospitals.length - onlineCount} แห่งหลุดการเชื่อมต่อ`}
          </div>
        </div>

        <div className="border-r border-[var(--rule-strong)] px-5 py-3">
          <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--ink-navy-muted)]">
            ACTIVE
          </div>
          <div
            className="mt-1 font-mono text-[28px] font-semibold leading-none tabular-nums"
            style={{ color: 'var(--ink-navy)', letterSpacing: '-0.02em' }}
          >
            {totalActive}
            <span className="ml-2 font-mono text-[12px] font-normal text-[var(--ink-navy-muted)]">
              ราย
            </span>
          </div>
          {totalActive > 0 && (
            <div
              className="mt-2 flex h-1.5 overflow-hidden rounded-sm"
              style={{ background: 'var(--rule-hair)' }}
            >
              <span style={{ background: 'var(--risk-low)', width: `${(totalLow / totalActive) * 100}%` }} />
              <span style={{ background: 'var(--risk-medium)', width: `${(totalMedium / totalActive) * 100}%` }} />
              <span style={{ background: 'var(--risk-high)', width: `${(totalHigh / totalActive) * 100}%` }} />
            </div>
          )}
        </div>

        <div className="px-5 py-3">
          <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--ink-navy-muted)]">
            HIGH-RISK
          </div>
          <div
            className="mt-1 font-mono text-[28px] font-semibold leading-none tabular-nums"
            style={{ color: 'var(--risk-high)', letterSpacing: '-0.02em' }}
          >
            {totalHigh}
            <span className="ml-2 font-mono text-[12px] font-normal text-[var(--ink-navy-muted)]">
              ราย
            </span>
          </div>
          <div className="mt-1 font-mono text-[11px] text-[var(--ink-navy-dim)]">
            {totalActive > 0
              ? `${((totalHigh / totalActive) * 100).toFixed(1)}% ของผู้คลอด`
              : '—'}
          </div>
        </div>
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
          {(
            [
              { k: 'inProvince' as const, label: `จ.${DEFAULT_PROVINCE_NAME}`, count: inProvinceHospitals.length, icon: Building2 },
              { k: 'other' as const, label: 'จังหวัดอื่น / ภายนอก', count: otherHospitals.length, icon: Globe },
            ]
          ).map((t, i) => {
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
                  'inline-flex items-center gap-1.5 px-3 py-1.5 font-mono text-[12px] tracking-[0.06em] transition-colors',
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
                  className="rounded-sm border px-1.5 py-0.5 font-mono text-[11px] tabular-nums"
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
            className="h-8 w-full rounded-sm border bg-white pl-8 pr-3 text-[13px] focus:border-[var(--accent-navy)] focus:outline-none focus:ring-1 focus:ring-[var(--accent-navy-soft)]"
            style={{ borderColor: 'var(--rule-strong)' }}
          />
        </div>
      </div>

      {/* Map + Roster split */}
      <div
        className="grid"
        style={{
          gridTemplateColumns: '1.4fr 1fr',
          minHeight: 'calc(100vh - 240px)',
        }}
      >
        {/* Map panel */}
        <div
          className="bg-white"
          style={{ borderRight: '1px solid var(--rule-strong)' }}
        >
          <div className="px-5 pt-3 pb-2">
            <SectionLabel
              idx={1}
              right={
                <span>
                  {tabHospitals.length} NODES · ขนาดวงกลม = ผู้คลอด · สี = ความเสี่ยงสูงสุด
                </span>
              }
            >
              Network map · เขตจังหวัด{DEFAULT_PROVINCE_NAME}
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
        <div className="overflow-y-auto bg-[var(--surface-cool)] px-5 pt-3 pb-6"
             style={{ maxHeight: 'calc(100vh - 240px)' }}>
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
