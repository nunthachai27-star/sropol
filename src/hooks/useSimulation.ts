// useSimulation — polls /api/dev/simulate/status while a simulation is
// running so the UI reflects live per-hospital progress. Dev-only; should
// never be rendered in production.
'use client';

import useSWR, { mutate as globalMutate } from 'swr';
import { useCallback } from 'react';
import type {
  SimulationConfig,
  SimulationStatus,
} from '@/services/dev-simulation/types';
import { withBasePath } from '@/lib/base-path';

const EMPTY_STATUS: SimulationStatus = {
  running: false,
  startedAt: null,
  stoppingAt: null,
  config: null,
  hospitals: [],
  recentEvents: [],
};

export function useSimulation() {
  const { data, error, isLoading, mutate } = useSWR<SimulationStatus>(
    '/api/dev/simulate/status',
    {
      refreshInterval: 2_000,
      revalidateOnFocus: false,
    },
  );

  const start = useCallback(
    async (config: SimulationConfig): Promise<SimulationStatus> => {
      const res = await fetch(withBasePath('/api/dev/simulate/start'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      });
      const body = (await res.json()) as SimulationStatus | { error: string };
      if (!res.ok || 'error' in body) {
        throw new Error('error' in body ? body.error : `HTTP ${res.status}`);
      }
      await mutate(body, { revalidate: false });
      return body;
    },
    [mutate],
  );

  const stop = useCallback(async (): Promise<SimulationStatus> => {
    const res = await fetch(withBasePath('/api/dev/simulate/stop'), { method: 'POST' });
    const body = (await res.json()) as SimulationStatus;
    await mutate(body, { revalidate: false });
    return body;
  }, [mutate]);

  /** Wipes all patient/journey/labor data (dev-only) and resets pool + keys. */
  const clear = useCallback(async (): Promise<{ cleared: Record<string, number> }> => {
    const res = await fetch(withBasePath('/api/dev/simulate/clear'), { method: 'POST' });
    const body = (await res.json()) as { ok: boolean; cleared: Record<string, number>; error?: string };
    if (!res.ok || !body.ok) {
      throw new Error(body.error ?? `HTTP ${res.status}`);
    }
    // Force-refresh status so the live panel resets to idle.
    await mutate(EMPTY_STATUS, { revalidate: true });
    // Invalidate every SWR-backed hook in the tab (dashboard KPIs, hospital
    // table, high-risk list, trends, journeys, etc.) so the UI immediately
    // reflects the empty DB instead of waiting for the next 30s poll.
    await globalMutate(() => true, undefined, { revalidate: true });
    return { cleared: body.cleared };
  }, [mutate]);

  return {
    status: data ?? EMPTY_STATUS,
    isLoading,
    error,
    start,
    stop,
    clear,
    refresh: () => mutate(),
  };
}
