// Province-wide sync status table — one row per active hospital. Reads
// /api/admin/sync-overview which aggregates the latest poll-cycle run
// for every hospital from Redis (progress-store.ts).
//
// Each row shows: outcome badge, trigger source, started/duration,
// authenticity status, and the latest error message (if any). Click a
// row to jump into the per-hospital edit dialog's Sync Log tab for the
// full step trail.
'use client';

import useSWR from 'swr';
import { useMemo, useState } from 'react';
import { Activity, AlertTriangle, RefreshCw } from 'lucide-react';
import {
  HospitalEditDialog,
  type AdminHospital,
} from '@/components/admin/HospitalEditDialog';

type RunOutcome = 'running' | 'success' | 'partial' | 'failed';

interface SyncStep {
  name: string;
  status: 'running' | 'success' | 'warning' | 'error' | 'info';
  message: string;
  detail?: string;
  counts?: Record<string, number>;
  at: string;
}

interface SyncRun {
  runId: string;
  hospitalId: string;
  hcode: string;
  trigger: 'scheduled' | 'immediate' | 'onboarding';
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  outcome: RunOutcome;
  finalMessage: string | null;
  errorMessage: string | null;
  steps: SyncStep[];
}

interface OverviewEntry {
  hcode: string;
  name: string;
  level: string;
  isActive: boolean;
  connectionStatus: string;
  lastSyncAt: string | null;
  authenticity: {
    status: string | null;
    reason: string | null;
    checkedAt: string | null;
    isFailure: boolean;
  };
  dataPurgedAt: string | null;
  hasBmsConfig: boolean;
  latestRun: SyncRun | null;
}

interface OverviewResponse {
  hospitals: OverviewEntry[];
  total: number;
  updatedAt: string;
}

type FilterKey = 'all' | 'failing' | 'never' | 'ok';

function effectiveOutcome(entry: OverviewEntry): RunOutcome | 'never' {
  if (!entry.hasBmsConfig) return 'never';
  if (entry.authenticity.isFailure) return 'failed';
  if (!entry.latestRun) return 'never';
  return entry.latestRun.outcome;
}

function outcomeStyle(outcome: RunOutcome | 'never'): {
  bg: string;
  ink: string;
  label: string;
} {
  switch (outcome) {
    case 'success':
      return { bg: '#d1fae5', ink: '#065f46', label: 'SUCCESS' };
    case 'partial':
      return { bg: '#fef3c7', ink: '#92400e', label: 'PARTIAL' };
    case 'failed':
      return { bg: '#fee2e2', ink: '#991b1b', label: 'FAILED' };
    case 'running':
      return { bg: '#dbeafe', ink: '#1e3a8a', label: 'RUNNING' };
    case 'never':
      return { bg: '#f1f5f9', ink: '#475569', label: 'NEVER' };
  }
}

function formatRelative(iso: string | null): string {
  if (!iso) return '—';
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return `${Math.max(1, Math.floor(ms / 1000))}s ago`;
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h ago`;
  return `${Math.floor(ms / 86_400_000)}d ago`;
}

function formatDuration(ms: number | null): string {
  if (ms == null) return '—';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

// Reuse the per-hospital edit dialog so clicking a row jumps to the same
// "Sync Log" tab admins already know — keeps the data model consistent
// and avoids two places that render step trails. The dialog re-fetches
// fuller data internally; we just pass enough for it to mount.
function entryToHospital(entry: OverviewEntry): AdminHospital {
  return {
    hcode: entry.hcode,
    name: entry.name,
    level: entry.level,
    serviceType: null,
    provinceCode: null,
    districtCode: null,
    lat: null,
    lon: null,
    isActive: entry.isActive,
    connectionStatus: entry.connectionStatus,
    lastSyncAt: entry.lastSyncAt,
    bmsConfig: null,
  };
}

export function SyncOverviewTab() {
  const { data, isLoading, error, mutate } = useSWR<OverviewResponse>(
    '/api/admin/sync-overview',
    { refreshInterval: 15_000 },
  );
  const [filter, setFilter] = useState<FilterKey>('all');
  const [openHcode, setOpenHcode] = useState<string | null>(null);

  const counts = useMemo(() => {
    const c = { all: 0, failing: 0, never: 0, ok: 0 };
    for (const h of data?.hospitals ?? []) {
      c.all += 1;
      const o = effectiveOutcome(h);
      if (o === 'failed') c.failing += 1;
      else if (o === 'never') c.never += 1;
      else c.ok += 1;
    }
    return c;
  }, [data]);

  const visible = useMemo(() => {
    const all = data?.hospitals ?? [];
    if (filter === 'all') return all;
    return all.filter((h) => {
      const o = effectiveOutcome(h);
      if (filter === 'failing') return o === 'failed';
      if (filter === 'never') return o === 'never';
      if (filter === 'ok') return o === 'success' || o === 'partial' || o === 'running';
      return true;
    });
  }, [data, filter]);

  const openEntry = data?.hospitals.find((h) => h.hcode === openHcode);

  return (
    <section className="space-y-4">
      {/* Filter chips + refresh */}
      <div
        className="flex flex-wrap items-center gap-2 border bg-white px-3 py-2"
        style={{ borderColor: 'var(--rule-strong)' }}
      >
        <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--ink-navy-muted)]">
          FILTER
        </span>
        {(
          [
            { k: 'all' as const, label: 'ทั้งหมด', n: counts.all },
            { k: 'failing' as const, label: 'มีปัญหา', n: counts.failing },
            { k: 'never' as const, label: 'ยังไม่ sync', n: counts.never },
            { k: 'ok' as const, label: 'ปกติ', n: counts.ok },
          ]
        ).map((f) => {
          const active = filter === f.k;
          return (
            <button
              key={f.k}
              type="button"
              onClick={() => setFilter(f.k)}
              className="inline-flex items-center gap-1 border px-2 py-0.5 font-mono text-[11px]"
              style={{
                borderColor: active ? 'var(--accent-navy)' : 'var(--rule-strong)',
                background: active ? 'var(--accent-navy-soft)' : 'white',
                color: active ? 'var(--accent-navy)' : 'var(--ink-navy-dim)',
                fontWeight: active ? 600 : 400,
              }}
            >
              {f.label} <span className="tabular-nums">{f.n}</span>
            </button>
          );
        })}
        <span className="ml-auto inline-flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.1em] text-[var(--ink-navy-muted)]">
          AUTO-REFRESH 15s
          <button
            type="button"
            onClick={() => mutate()}
            className="inline-flex items-center gap-1 border px-1.5 py-0.5 text-[var(--accent-navy)]"
            style={{ borderColor: 'var(--accent-navy)' }}
          >
            <RefreshCw className="h-3 w-3" /> REFRESH
          </button>
        </span>
      </div>

      {error && (
        <div
          className="border bg-white px-3 py-2 text-[13px] text-[#991b1b]"
          style={{ borderColor: '#fee2e2', background: '#fef2f2' }}
        >
          โหลดสถานะ sync ไม่สำเร็จ
        </div>
      )}

      {isLoading && !data && (
        <div
          className="border bg-white px-4 py-6 text-center font-mono text-[11px] text-[var(--ink-navy-muted)]"
          style={{ borderColor: 'var(--rule-strong)' }}
        >
          กำลังโหลด…
        </div>
      )}

      {data && visible.length === 0 && (
        <div
          className="border bg-white px-4 py-6 text-center font-mono text-[11px] text-[var(--ink-navy-muted)]"
          style={{ borderColor: 'var(--rule-strong)' }}
        >
          ไม่มีโรงพยาบาลในตัวกรองนี้
        </div>
      )}

      {data && visible.length > 0 && (
        <div
          className="overflow-hidden border bg-white"
          style={{ borderColor: 'var(--rule-strong)' }}
        >
          <div
            className="grid items-center gap-3 border-b px-3 py-2 font-mono text-[10px] uppercase tracking-[0.1em] text-[var(--ink-navy-muted)]"
            style={{
              gridTemplateColumns: '70px 1fr 90px 100px 90px 1.4fr',
              borderColor: 'var(--rule-strong)',
            }}
            aria-hidden="true"
          >
            <div>OUTCOME</div>
            <div>HOSPITAL</div>
            <div>TRIGGER</div>
            <div>STARTED</div>
            <div>DURATION</div>
            <div>SUMMARY · ERROR</div>
          </div>
          <div className="divide-y" style={{ borderColor: 'var(--rule-hair)' }}>
            {visible.map((h) => {
              const outcome = effectiveOutcome(h);
              const tone = outcomeStyle(outcome);
              const run = h.latestRun;
              const errorOrSummary =
                h.authenticity.isFailure
                  ? `${h.authenticity.status}${
                      h.authenticity.reason ? ` — ${h.authenticity.reason}` : ''
                    }`
                  : run?.errorMessage ??
                    run?.finalMessage ??
                    (run?.steps[run.steps.length - 1]?.message ?? '—');
              return (
                <button
                  key={h.hcode}
                  type="button"
                  onClick={() => setOpenHcode(h.hcode)}
                  className="grid w-full items-center gap-3 px-3 py-2 text-left transition-colors hover:bg-[var(--surface-cool)]"
                  style={{
                    gridTemplateColumns: '70px 1fr 90px 100px 90px 1.4fr',
                  }}
                >
                  <span
                    className="text-center font-mono text-[10px] font-bold uppercase tracking-[0.1em]"
                    style={{
                      background: tone.bg,
                      color: tone.ink,
                      padding: '2px 4px',
                    }}
                  >
                    {tone.label}
                  </span>
                  <span className="min-w-0">
                    <span
                      className="text-[13px] font-medium"
                      style={{ color: 'var(--ink-navy)' }}
                    >
                      {h.name}
                    </span>
                    <span
                      className="ml-1.5 font-mono text-[10px] tabular-nums text-[var(--ink-navy-muted)]"
                    >
                      {h.hcode}
                    </span>
                    <span
                      className="ml-1 border px-1 font-mono text-[9px]"
                      style={{
                        color: 'var(--ink-navy-muted)',
                        borderColor: 'var(--rule-hair)',
                      }}
                    >
                      {h.level}
                    </span>
                  </span>
                  <span
                    className="font-mono text-[10px] uppercase tracking-[0.06em] text-[var(--ink-navy-muted)]"
                  >
                    {run?.trigger ?? '—'}
                  </span>
                  <span
                    className="font-mono text-[10px] tabular-nums text-[var(--ink-navy-dim)]"
                    title={
                      run?.startedAt
                        ? new Date(run.startedAt).toLocaleString('th-TH')
                        : ''
                    }
                  >
                    {formatRelative(run?.startedAt ?? null)}
                  </span>
                  <span
                    className="font-mono text-[10px] tabular-nums text-[var(--ink-navy-dim)]"
                  >
                    {formatDuration(run?.durationMs ?? null)}
                  </span>
                  <span
                    className="min-w-0 truncate text-[12px]"
                    style={{
                      color:
                        outcome === 'failed'
                          ? '#991b1b'
                          : outcome === 'partial'
                            ? '#92400e'
                            : 'var(--ink-navy-dim)',
                    }}
                    title={errorOrSummary}
                  >
                    {outcome === 'failed' && (
                      <AlertTriangle
                        className="mr-1 inline h-3 w-3"
                        style={{ color: '#991b1b' }}
                      />
                    )}
                    {errorOrSummary}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Reuse the standard hospital edit dialog so the click → drill-down
          path lands operators on the same Sync Log tab they already know.
          The dialog re-fetches /api/admin/hospitals internally for full
          data; the lite shape here is just enough for it to mount. */}
      <HospitalEditDialog
        hospital={openEntry ? entryToHospital(openEntry) : null}
        onClose={() => setOpenHcode(null)}
        onSaved={async () => {
          await mutate();
        }}
        initialSection="sync-log"
      />
    </section>
  );
}

export const _SyncOverviewTabIcon = Activity;
