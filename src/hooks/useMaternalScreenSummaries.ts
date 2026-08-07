// SWR hook for the ward bed-tile cross-source join (Phase 6 Task H4,
// docs/superpowers/plans/2026-07-17-maternal-screening-hosxp.md GC-H4/GC-H5).
// Modeled directly on src/hooks/useMaternalScreenings.ts: same
// conditional-null key, same "stop polling once we've learned uiEnabled is
// false" refreshInterval trick. SEPARATE hook (not folded into
// useMaternityWardStateFull) — the ward board's live HOSxP feed must never
// block on, or degrade because of, this provisional central-DB fetch.
'use client';

import { useMemo } from 'react';
import useSWR from 'swr';
import type { MaternalScreenSummariesResponse, MaternalScreenSummaryItem } from '@/types/api';

export interface UseMaternalScreenSummariesResult {
  uiEnabled: boolean;
  /** an → summary, built here so the page/ward layout stays a thin passthrough. */
  byAn: Map<string, MaternalScreenSummaryItem>;
  isLoading: boolean;
  error: Error | undefined;
  mutate: () => Promise<MaternalScreenSummariesResponse | undefined>;
}

export function useMaternalScreenSummaries(
  hcode: string | null | undefined,
): UseMaternalScreenSummariesResult {
  const { data, error, isLoading, mutate } = useSWR<MaternalScreenSummariesResponse>(
    hcode ? `/api/hospitals/${hcode}/maternal-screen-summaries` : null,
    {
      // Flag-off wards fetch once to learn uiEnabled, then stop polling —
      // same trick as useMaternalScreenings.
      refreshInterval: (data) => (data?.uiEnabled ? 30000 : 0),
    },
  );

  // GC-H4: a missing/failed fetch (data undefined, whether from `error` or
  // simply not-yet-loaded) degrades to an empty map — every bed tile then
  // renders exactly as it does today, never an error state.
  const byAn = useMemo(() => {
    const map = new Map<string, MaternalScreenSummaryItem>();
    for (const item of data?.summaries ?? []) {
      map.set(item.an, item);
    }
    return map;
  }, [data]);

  return {
    uiEnabled: data?.uiEnabled ?? false,
    byAn,
    isLoading,
    error,
    mutate: () => mutate(),
  };
}
