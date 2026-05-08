'use client';

// Browser-side HOSxP poll hook.
//
// Drives src/lib/browser-poll.ts on a fixed interval inside an authenticated
// tab. Server-side scheduled polling is disabled — every refresh you see in
// the dashboard now came through this hook, the user's local 127.0.0.1:45011
// gateway (or BMS tunnel fallback), and POST /api/sync/browser-push.
//
// The hook is intentionally self-throttling (60s interval) and ref-guarded
// against overlapping cycles, so multiple tabs from the same user push at
// roughly tab-count × 60s ≈ well below the BMS rate limit.

import { useCallback, useEffect, useRef, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useBmsSession } from '@/contexts/BmsSessionContext';
import { runBrowserPoll, type BrowserPollResult } from '@/lib/browser-poll';

const DEFAULT_INTERVAL_MS = 60_000;
const MIN_INTERVAL_MS = 15_000;

export interface UseBrowserPollOptions {
  /** Polling cadence in milliseconds. Floored to 15s to protect the gateway. */
  intervalMs?: number;
  /**
   * When false, the hook stays idle but is still mounted. Useful for pages
   * that want the hook for manual `runNow()` invocations only.
   */
  autoStart?: boolean;
}

export interface UseBrowserPollState {
  isReady: boolean;
  isRunning: boolean;
  lastRunAt: string | null;
  lastResult: BrowserPollResult | null;
  lastError: string | null;
  cycleCount: number;
}

export function useBrowserPoll(options: UseBrowserPollOptions = {}): {
  state: UseBrowserPollState;
  runNow: () => Promise<BrowserPollResult | null>;
} {
  const { data: session } = useSession();
  const { config, marketplaceToken, isReady } = useBmsSession();

  const intervalMs = Math.max(MIN_INTERVAL_MS, options.intervalMs ?? DEFAULT_INTERVAL_MS);
  const autoStart = options.autoStart ?? true;

  const runningRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);

  const [state, setState] = useState<UseBrowserPollState>({
    isReady: false,
    isRunning: false,
    lastRunAt: null,
    lastResult: null,
    lastError: null,
    cycleCount: 0,
  });

  // Skip-conditions: read-only viewers, provider-id sessions (no HOSxP
  // marketplace token), and tabs without a paired marketplace token (any
  // direct bms-session-id paste). Server-side polling skipped these for the
  // same reasons; mirroring keeps the Sync Log honest.
  const skip =
    session?.user?.accessMode === 'readonly' ||
    session?.user?.authProvider === 'provider-id' ||
    !isReady ||
    !config ||
    !marketplaceToken;

  const runNow = useCallback(async (): Promise<BrowserPollResult | null> => {
    if (skip || !config) return null;
    if (runningRef.current) return null;
    runningRef.current = true;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setState((prev) => ({ ...prev, isRunning: true, lastError: null }));
    try {
      const result = await runBrowserPoll({
        config,
        marketplaceToken,
        signal: controller.signal,
      });
      setState((prev) => ({
        ...prev,
        isRunning: false,
        lastRunAt: new Date().toISOString(),
        lastResult: result,
        lastError: result.error ?? null,
        cycleCount: prev.cycleCount + 1,
      }));
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setState((prev) => ({
        ...prev,
        isRunning: false,
        lastError: message,
        cycleCount: prev.cycleCount + 1,
      }));
      return null;
    } finally {
      runningRef.current = false;
      if (abortRef.current === controller) abortRef.current = null;
    }
  }, [config, marketplaceToken, skip]);

  // Surface readiness state so consumers can show "waiting for HOSxP gateway"
  // before the first cycle has even tried to fire.
  useEffect(() => {
    setState((prev) => (prev.isReady === !skip ? prev : { ...prev, isReady: !skip }));
  }, [skip]);

  // Fire-and-interval — first cycle on the next tick after gating clears,
  // then every `intervalMs` afterwards. AbortController torn down on unmount
  // so a navigation away from / mid-cycle doesn't leak fetches.
  useEffect(() => {
    if (skip || !autoStart) return;
    let cancelled = false;

    const tick = async () => {
      if (cancelled) return;
      await runNow();
    };

    void tick();
    const id = setInterval(() => void tick(), intervalMs);

    return () => {
      cancelled = true;
      clearInterval(id);
      abortRef.current?.abort();
      abortRef.current = null;
    };
  }, [skip, autoStart, intervalMs, runNow]);

  return { state, runNow };
}
