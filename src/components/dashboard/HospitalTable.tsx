// HospitalTable — dense per-hospital list with proportional risk bar.
// Redesigned 2026-04-21: sorted HIGH-first by default; retains sortable headers
// for coordinator desk use; row-flash on SSE count change preserved.
'use client';

import { useState, useRef, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import type { DashboardHospital } from '@/types/api';
import { ConnectionStatus as ConnectionStatusEnum } from '@/types/domain';
import { RiskBar } from './shared';
import { cn } from '@/lib/utils';
import { formatRelativeAge } from '@/lib/relative-time';

interface HospitalTableProps {
  hospitals: DashboardHospital[];
  selected?: string | null;
  onSelect?: (hcode: string | null) => void;
  variant?: 'light' | 'kiosk';
}

interface HospitalCounts {
  low: number;
  medium: number;
  high: number;
  total: number;
}

type SortKey = 'severity' | 'name' | 'total' | 'level';
type SortDir = 'asc' | 'desc';

function severityRank(h: DashboardHospital): number {
  // HIGH gets heaviest weight, then MED, then LOW, then offline penalty
  return h.counts.high * 100 + h.counts.medium * 10 + h.counts.low;
}

export function HospitalTable({ hospitals, selected, onSelect, variant = 'light' }: HospitalTableProps) {
  const router = useRouter();
  const [sortKey, setSortKey] = useState<SortKey>('severity');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const prevCountsRef = useRef<Map<string, HospitalCounts>>(new Map());
  const rowRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  // Row highlight animation when risk counts change (SSE updates)
  useEffect(() => {
    const prevCounts = prevCountsRef.current;
    for (const h of hospitals) {
      const prev = prevCounts.get(h.hcode);
      if (
        prev &&
        (prev.low !== h.counts.low ||
          prev.medium !== h.counts.medium ||
          prev.high !== h.counts.high ||
          prev.total !== h.counts.total)
      ) {
        const el = rowRefs.current.get(h.hcode);
        if (el) {
          el.classList.add('animate-flash-row');
          setTimeout(() => el.classList.remove('animate-flash-row'), 3000);
        }
      }
    }
    const nextCounts = new Map<string, HospitalCounts>();
    for (const h of hospitals) {
      nextCounts.set(h.hcode, { ...h.counts });
    }
    prevCountsRef.current = nextCounts;
  }, [hospitals]);

  const sorted = useMemo(() => {
    const dir = sortDir === 'asc' ? 1 : -1;
    return [...hospitals].sort((a, b) => {
      switch (sortKey) {
        case 'severity':
          return (severityRank(a) - severityRank(b)) * dir;
        case 'name':
          return a.name.localeCompare(b.name, 'th') * dir;
        case 'total':
          return (a.counts.total - b.counts.total) * dir;
        case 'level':
          return a.level.localeCompare(b.level) * dir;
        default:
          return 0;
      }
    });
  }, [hospitals, sortKey, sortDir]);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    else {
      setSortKey(key);
      setSortDir('desc');
    }
  };

  const handleRowClick = (h: DashboardHospital) => {
    if (onSelect) onSelect(h.hcode === selected ? null : h.hcode);
    else router.push(`/hospitals/${h.hcode}`);
  };

  const isKiosk = variant === 'kiosk';
  const ink = isKiosk ? 'var(--kiosk-ink)' : 'var(--ink-navy)';
  const inkMuted = isKiosk ? 'var(--kiosk-dim)' : 'var(--ink-navy-muted)';
  const ruleStrong = isKiosk ? 'var(--kiosk-rule)' : 'var(--rule-strong)';
  const ruleHair = isKiosk ? 'var(--kiosk-rule)' : 'var(--rule-hair)';
  const accent = isKiosk ? 'var(--kiosk-accent)' : 'var(--accent-navy)';
  const accentSoft = isKiosk ? 'rgba(107,167,229,0.08)' : 'var(--accent-navy-soft)';

  // Two-line row layout — Thai hospital names like
  // "โรงพยาบาลสมเด็จพระยุพราชกระนวน" are too long to share a single row
  // with the level pill and status badge without truncation, so the row
  // is now stacked: line 1 = identity (full name + level + status),
  // line 2 = metrics (LABOR / ANC / SYNC). The metrics row uses an
  // indented grid so operators still get a stable left-aligned numeric
  // column without a separate header strip.
  const metricsGrid = '18px 1fr 110px 44px 78px 50px';

  return (
    <div className="border" style={{ borderColor: ruleStrong }}>
      {/* Sort chips */}
      <div
        className="flex items-center gap-3 border-b px-3 py-2 font-mono text-[10px] tracking-[0.1em]"
        style={{ color: inkMuted, borderColor: ruleStrong }}
      >
        <span>SORT:</span>
        {[
          { k: 'severity' as SortKey, l: 'SEVERITY' },
          { k: 'name' as SortKey, l: 'NAME' },
          { k: 'total' as SortKey, l: 'TOTAL' },
          { k: 'level' as SortKey, l: 'LEVEL' },
        ].map((x) => (
          <button
            key={x.k}
            onClick={() => handleSort(x.k)}
            className={cn(
              'cursor-pointer border-b-2 bg-transparent pb-0.5 transition-colors',
              sortKey === x.k ? 'font-semibold' : 'font-normal',
            )}
            style={{
              color: sortKey === x.k ? accent : inkMuted,
              borderColor: sortKey === x.k ? accent : 'transparent',
            }}
          >
            {x.l} {sortKey === x.k ? (sortDir === 'asc' ? '↑' : '↓') : ''}
          </button>
        ))}
        <span className="ml-auto">{hospitals.length} NODES</span>
      </div>

      {/* Rows */}
      <div className={cn(isKiosk ? 'max-h-[360px]' : 'max-h-[420px]', 'overflow-y-auto')}>
        {sorted.map((h) => {
          const isSel = selected === h.hcode;
          const isOnline = h.connectionStatus === ConnectionStatusEnum.ONLINE;
          const isOffline = h.connectionStatus === ConnectionStatusEnum.OFFLINE;
          // Sync state OVERRIDES connection state in the badge — a hospital
          // can be ONLINE (tunnel responds) but BLOCKED (authenticity probe
          // failed or admin purged), and showing "ONLINE" for that case
          // misled operators into thinking sync was healthy.
          const isBlocked = h.syncStatus === 'BLOCKED';
          const isNeverSynced = h.syncStatus === 'NEVER_SYNCED';
          const statusLabel = isBlocked
            ? 'BLOCKED'
            : isNeverSynced && !isOffline
              ? 'NO SYNC'
              : isOnline
                ? 'ONLINE'
                : isOffline
                  ? 'OFFLINE'
                  : 'UNKNOWN';
          const statusColor = isBlocked
            ? 'var(--risk-medium)'
            : isOnline && !isNeverSynced
              ? 'var(--risk-low)'
              : isOffline
                ? 'var(--risk-high)'
                : inkMuted;
          const statusTitle = isBlocked
            ? `Sync ถูกระงับ — ${h.syncBlockedReason ?? 'unknown reason'}`
            : isNeverSynced
              ? 'ยังไม่เคยมีการเชื่อมต่อ Sync — รอผู้ใช้จากโรงพยาบาลนี้เปิด KK-LRMS ครั้งแรก'
              : '';
          const sev =
            h.counts.high > 0
              ? 'var(--risk-high)'
              : h.counts.medium > 0
                ? 'var(--risk-medium)'
                : h.counts.low > 0
                  ? 'var(--risk-low)'
                  : inkMuted;
          return (
            <div
              key={h.hcode}
              ref={(el) => {
                if (el) rowRefs.current.set(h.hcode, el);
                else rowRefs.current.delete(h.hcode);
              }}
              onClick={() => handleRowClick(h)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  handleRowClick(h);
                }
              }}
              role="button"
              tabIndex={0}
              aria-label={`${h.name} — ${h.counts.total} ราย${
                h.counts.high > 0 ? ` เสี่ยงสูง ${h.counts.high}` : ''
              }`}
              className="cursor-pointer border-b px-3 py-2 transition-colors hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-navy)]"
              style={{
                borderColor: ruleHair,
                background: isSel ? accentSoft : 'transparent',
              }}
              data-testid="hospital-row"
            >
              {/* Line 1 — identity: severity dot, full hospital name (no
                  truncate), level pill, sync/connection status badge. */}
              <div className="flex min-w-0 items-center gap-2">
                <div
                  style={{
                    width: 8,
                    height: 8,
                    background: sev,
                    borderRadius: isOffline ? '50%' : 0,
                    flexShrink: 0,
                  }}
                  aria-hidden="true"
                />
                <span
                  className="min-w-0 flex-1 break-words"
                  style={{
                    color: ink,
                    fontSize: isKiosk ? 14 : 13,
                    lineHeight: 1.25,
                  }}
                >
                  {h.name}
                </span>
                <span
                  className="shrink-0 border px-1 font-mono text-[9px]"
                  style={{ color: inkMuted, borderColor: ruleHair }}
                >
                  {h.level}
                </span>
                <span
                  className="inline-flex shrink-0 items-center gap-1 font-mono text-[9px] uppercase tracking-wide"
                  style={{ color: statusColor }}
                  aria-label={`สถานะ: ${statusLabel}`}
                  title={statusTitle || undefined}
                >
                  <span
                    aria-hidden="true"
                    style={{
                      width: 6,
                      height: 6,
                      borderRadius: '50%',
                      background: statusColor,
                      boxShadow: isOffline ? `inset 0 0 0 1px ${statusColor}` : undefined,
                      opacity: isOffline ? 0.85 : 1,
                    }}
                  />
                  {statusLabel}
                </span>
              </div>

              {/* Line 2 — metrics: LABOR risk-mix bar + active count, ANC
                  registry + HR3 chip, sync freshness. Indented past the
                  severity-dot column so it visually nests under the name. */}
              <div
                className="mt-1.5 grid items-center gap-2.5"
                style={{ gridTemplateColumns: metricsGrid }}
              >
                <div /> {/* indent placeholder — aligns with severity dot */}
                <div className="min-w-0">
                  <RiskBar
                    low={h.counts.low}
                    medium={h.counts.medium}
                    high={h.counts.high}
                    height={6}
                    variant={variant}
                  />
                </div>
                <div
                  className="text-left font-mono tabular-nums"
                  style={{ color: ink, fontSize: isKiosk ? 13 : 11 }}
                  title={`Active labor: ${h.counts.total} ราย`}
                >
                  <span
                    className="font-mono text-[9px] uppercase tracking-[0.08em]"
                    style={{ color: inkMuted }}
                  >
                    LB
                  </span>{' '}
                  {h.counts.total || '–'}
                </div>
                <div
                  className="flex items-baseline gap-1 font-mono tabular-nums"
                  style={{ color: ink, fontSize: isKiosk ? 13 : 11 }}
                  title={`ANC registry: ${h.ancCounts.total} · HR3: ${h.ancCounts.hr3}`}
                >
                  <span
                    className="font-mono text-[9px] uppercase tracking-[0.08em]"
                    style={{ color: inkMuted }}
                  >
                    ANC
                  </span>
                  <span>{h.ancCounts.total || '–'}</span>
                  {h.ancCounts.hr3 > 0 && (
                    <span
                      className="rounded-sm px-1 text-[9px] font-bold"
                      style={{
                        background: '#fde2dc',
                        color: '#9b2c1c',
                      }}
                    >
                      HR3 {h.ancCounts.hr3}
                    </span>
                  )}
                </div>
                {/* Sync freshness — amber ≥24h, red ≥72h. */}
                <div
                  className="text-right font-mono tabular-nums"
                  style={{
                    fontSize: isKiosk ? 11 : 10,
                    color: (() => {
                      if (!h.lastSyncAt) return inkMuted;
                      const ageH = (Date.now() - new Date(h.lastSyncAt).getTime()) / 3600000;
                      if (ageH >= 72) return 'var(--risk-high)';
                      if (ageH >= 24) return 'var(--risk-medium)';
                      return inkMuted;
                    })(),
                  }}
                  title={
                    h.lastSyncAt
                      ? `Last sync: ${new Date(h.lastSyncAt).toLocaleString('th-TH')}`
                      : 'ยังไม่เคย sync'
                  }
                >
                  {formatRelativeAge(h.lastSyncAt, 'short')}
                </div>
              </div>
            </div>
          );
        })}
        {sorted.length === 0 && (
          <div
            className="p-6 text-center font-mono text-[11px]"
            style={{ color: inkMuted }}
          >
            ไม่มีโรงพยาบาลในรายการ
          </div>
        )}
      </div>
    </div>
  );
}
