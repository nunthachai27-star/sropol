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
import { runBrowserPoll, pollBackoffDelay, type BrowserPollResult } from '@/lib/browser-poll';

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
  /**
   * Set to true after the server returns a 403 (readonly session, hospital
   * inactive, hospital not registered). The hook stops its interval and
   * refuses further `runNow()` calls for this mount — the rejection is
   * permanent for the session, so retrying just produces a red 403 in the
   * browser console every 60 seconds.
   */
  permanentlyBlocked: boolean;
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
  // Consecutive failed cycles, for the backoff schedule. Reset to 0 on any
  // clean success so a recovered hospital snaps back to the base cadence.
  const consecutiveFailuresRef = useRef(0);
  // Module-mount-level latch — once flipped, we don't run again. Kept in a
  // ref (not state) so the interval callback sees the latest value
  // synchronously without depending on a re-render.
  const blockedRef = useRef(false);

  const [state, setState] = useState<UseBrowserPollState>({
    isReady: false,
    isRunning: false,
    lastRunAt: null,
    lastResult: null,
    lastError: null,
    cycleCount: 0,
    permanentlyBlocked: false,
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
    if (blockedRef.current) return null;
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
      if (result.permanentBlock) {
        blockedRef.current = true;
      }
      // Feed the backoff schedule: a clean cycle resets it, a soft error
      // (e.g. a CORS-blocked / unreachable gateway surfaced as result.error)
      // counts as a failure.
      if (result.error) consecutiveFailuresRef.current += 1;
      else consecutiveFailuresRef.current = 0;
      setState((prev) => ({
        ...prev,
        isRunning: false,
        lastRunAt: new Date().toISOString(),
        lastResult: result,
        lastError: result.error ?? null,
        cycleCount: prev.cycleCount + 1,
        permanentlyBlocked: prev.permanentlyBlocked || Boolean(result.permanentBlock),
      }));
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      consecutiveFailuresRef.current += 1;
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

  // Fire-and-reschedule — first cycle right after gating clears, then the next
  // is scheduled once the current finishes, at a delay that backs off
  // exponentially while cycles keep failing (see pollBackoffDelay). A self-
  // rescheduling setTimeout (not a fixed setInterval) means an unreachable
  // gateway slows down instead of re-firing the whole query set every 60s
  // forever. It also tears down on blockedRef (permanent 403) so we don't spam
  // Chrome's network panel.
  useEffect(() => {
    if (skip || !autoStart) return;
    let cancelled = false;
    let id: ReturnType<typeof setTimeout> | null = null;

    const tick = async () => {
      if (cancelled) return;
      await runNow();
      if (cancelled || blockedRef.current) return;
      const delay = pollBackoffDelay(consecutiveFailuresRef.current, intervalMs);
      id = setTimeout(() => void tick(), delay);
    };

    void tick();

    return () => {
      cancelled = true;
      if (id !== null) clearTimeout(id);
      abortRef.current?.abort();
      abortRef.current = null;
    };
  }, [skip, autoStart, intervalMs, runNow]);

  return { state, runNow };
}
