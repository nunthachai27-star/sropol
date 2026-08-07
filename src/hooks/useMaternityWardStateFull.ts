'use client';
// Clinical-density variant of useMaternityWardState — surfaces BedOccupancyFull
// rows (latest partograph + latest nurse-note joined server-side) for the v2
// bed-tile UI. Same SWR cadence as the lite hook so the kiosk pulse stays
// uniform: ward list 60s, beds 60s, occupancy 20s.
import { useState } from 'react';
import useSWR from 'swr';
import { useBmsSession } from '@/hooks/useBmsSession';
import {
  listMaternityWards,
  listWardBedsInventory,
  listWardBedsOccupancyFull,
} from '@/services/maternity-ward';
import type { MaternityWard, BedSlot, BedOccupancyFull } from '@/types/maternity-ward';

/**
 * Aggregate live-data health for the masthead badge.
 *  - `ok`           — the beds/occupancy feeds are current (no outstanding error).
 *  - `reconnecting` — a feed errored and SWR is currently re-fetching (retry in flight).
 *  - `error`        — a feed errored and no retry is currently in flight.
 */
export type WardFeedHealth = 'ok' | 'reconnecting' | 'error';

export interface MaternityWardStateFull {
  wards: MaternityWard[];
  /** Effective ward being queried (the user's selection, or the first ward). */
  ward: string | null;
  /** Same value as `ward`; exposed for the ward <select> value binding. */
  selectedWard: string | null;
  /** Switch the queried ward. Ignored values that aren't in `wards` fall back to the first ward. */
  setSelectedWard: (ward: string) => void;
  beds: BedSlot[];
  occupancy: BedOccupancyFull[];
  isLoading: boolean;
  error: Error | null;
  /** Live-data health for the masthead LIVE badge. */
  health: WardFeedHealth;
  mutateBeds: () => Promise<unknown>;
  mutateOccupancy: () => Promise<unknown>;
}

const WARD_REFRESH_INTERVAL = 60_000;
const BEDS_REFRESH_INTERVAL = 60_000;
const OCCUPANCY_REFRESH_INTERVAL = 20_000;

export function useMaternityWardStateFull(): MaternityWardStateFull {
  const { config } = useBmsSession();

  const { data: wards, error: wardsErr } = useSWR(
    config ? ['maternity-wards', config.apiUrl] : null,
    () => listMaternityWards(config!),
    { refreshInterval: WARD_REFRESH_INTERVAL },
  );

  // The user's explicit ward pick. Null until they choose one, in which case
  // we default to the first ward. If the picked ward disappears from the list
  // (ward roster changed server-side) we fall back to the first ward so the
  // board never queries a ward that no longer exists.
  const [pickedWard, setPickedWard] = useState<string | null>(null);
  const firstWard = wards?.[0]?.ward ?? null;
  const pickedIsValid = pickedWard !== null && (wards?.some((w) => w.ward === pickedWard) ?? false);
  const ward = pickedIsValid ? pickedWard : firstWard;

  const {
    data: beds,
    mutate: mutateBeds,
    error: bedsErr,
    isValidating: bedsValidating,
  } = useSWR(
    config && ward ? ['ward-beds-inventory', config.apiUrl, ward] : null,
    () => listWardBedsInventory(config!, ward!),
    { refreshInterval: BEDS_REFRESH_INTERVAL },
  );

  const {
    data: occupancy,
    mutate: mutateOccupancy,
    error: occupancyErr,
    isValidating: occupancyValidating,
  } = useSWR(
    config && ward ? ['ward-beds-occupancy-full', config.apiUrl, ward] : null,
    () => listWardBedsOccupancyFull(config!, ward!),
    { refreshInterval: OCCUPANCY_REFRESH_INTERVAL },
  );

  const error = wardsErr ?? bedsErr ?? occupancyErr ?? null;
  const isLoading = config !== null && wards === undefined && error === null;

  // Health drives the masthead LIVE badge. A settled error is 'error'; while
  // SWR is re-fetching after an error (retry in flight) surface 'reconnecting'
  // so the badge distinguishes "down" from "recovering"; otherwise 'ok'.
  const isRevalidating = Boolean(bedsValidating) || Boolean(occupancyValidating);
  const health: WardFeedHealth = error ? (isRevalidating ? 'reconnecting' : 'error') : 'ok';

  return {
    wards: wards ?? [],
    ward,
    selectedWard: ward,
    setSelectedWard: setPickedWard,
    beds: beds ?? [],
    occupancy: occupancy ?? [],
    isLoading,
    error,
    health,
    mutateBeds: () => mutateBeds(),
    mutateOccupancy: () => mutateOccupancy(),
  };
}
