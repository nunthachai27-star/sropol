// Global DB-health banner — polls /api/health every 20s. When the endpoint
// responds 503 or the response's `status` field is "unhealthy", we render a
// sticky red banner across the top of the provincial layout so users aren't
// silently looking at stale zeros while the DB is down.
//
// Only renders when there IS a problem. Green/healthy case is invisible.
'use client';

import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { withBasePath } from '@/lib/base-path';

interface HealthBody {
  status: 'healthy' | 'degraded' | 'unhealthy' | string;
  database?: string;
  timestamp?: string;
}

interface HealthState {
  ok: boolean;
  body: HealthBody | null;
  error: string | null;
  /** Unix timestamp of last successful response (`status === 'healthy'`). */
  lastHealthyAt: number | null;
  /** Consecutive failures. Banner waits for ≥2 before showing to absorb hiccups. */
  failureStreak: number;
}

const EMPTY: HealthState = {
  ok: true,
  body: null,
  error: null,
  lastHealthyAt: null,
  failureStreak: 0,
};

const POLL_MS = 20_000;

export function DbHealthBanner() {
  const [state, setState] = useState<HealthState>(EMPTY);
  const stateRef = useRef(state);
  stateRef.current = state;

  async function probe() {
    try {
      const res = await fetch(withBasePath('/api/health'), { cache: 'no-store' });
      const body = (await res.json().catch(() => null)) as HealthBody | null;
      if (res.ok && body?.database === 'connected' && body.status !== 'unhealthy') {
        setState({
          ok: true,
          body,
          error: null,
          lastHealthyAt: Date.now(),
          failureStreak: 0,
        });
        return;
      }
      // 503 / degraded / parse failure — all treated as a failure tick.
      setState((prev) => ({
        ok: false,
        body,
        error: body ? `status=${body.status}` : `HTTP ${res.status}`,
        lastHealthyAt: prev.lastHealthyAt,
        failureStreak: prev.failureStreak + 1,
      }));
    } catch (e) {
      setState((prev) => ({
        ok: false,
        body: null,
        error: e instanceof Error ? e.message : String(e),
        lastHealthyAt: prev.lastHealthyAt,
        failureStreak: prev.failureStreak + 1,
      }));
    }
  }

  useEffect(() => {
    probe();
    const t = setInterval(probe, POLL_MS);
    return () => clearInterval(t);
  }, []);

  // Soak window — wait for 2 consecutive failures before showing, to avoid
  // flashing during a single HMR reload or transient deploy.
  if (state.ok || state.failureStreak < 2) return null;

  const lastOk = state.lastHealthyAt
    ? new Date(state.lastHealthyAt).toLocaleTimeString('th-TH', { hour12: false })
    : '—';
  const dbLabel = state.body?.database ?? 'disconnected';

  return (
    <div
      role="alert"
      className="flex items-center gap-3 border-b px-4 py-2 font-mono text-[12px]"
      style={{
        background: 'linear-gradient(90deg, #fee2e2 0%, #fecaca 100%)',
        borderColor: '#ef4444',
        color: '#7f1d1d',
      }}
    >
      <AlertTriangle className="h-4 w-4 shrink-0" />
      <div className="flex-1">
        <span className="font-semibold">ดึงข้อมูลจากฐานข้อมูลไม่สำเร็จ</span>
        <span className="mx-2 opacity-60">·</span>
        <span>
          DB: <span className="font-semibold">{dbLabel}</span>
        </span>
        <span className="mx-2 opacity-60">·</span>
        <span>
          ครั้งล่าสุดที่ใช้งานได้: <span className="font-semibold">{lastOk}</span>
        </span>
        <span className="mx-2 opacity-60">·</span>
        <span className="text-[11px] opacity-80">
          retry {state.failureStreak}
        </span>
      </div>
      <button
        type="button"
        onClick={probe}
        className="inline-flex items-center gap-1 rounded-sm border border-red-400 bg-white/60 px-2 py-0.5 text-[11px] font-semibold hover:bg-white"
      >
        <RefreshCw className="h-3 w-3" />
        ลองอีกครั้ง
      </button>
    </div>
  );
}
