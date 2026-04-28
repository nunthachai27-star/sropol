'use client';
// Clinical-density variant of useMaternityWardState — surfaces BedOccupancyFull
// rows (latest partograph + latest nurse-note joined server-side) for the v2
// bed-tile UI. Same SWR cadence as the lite hook so the kiosk pulse stays
// uniform: ward list 60s, beds 60s, occupancy 20s.
import useSWR from 'swr';
import { useBmsSession } from '@/hooks/useBmsSession';
import {
  listMaternityWards,
  listWardBedsInventory,
  listWardBedsOccupancyFull,
} from '@/services/maternity-ward';
import type {
  MaternityWard,
  BedSlot,
  BedOccupancyFull,
} from '@/types/maternity-ward';

export interface MaternityWardStateFull {
  wards: MaternityWard[];
  ward: string | null;
  beds: BedSlot[];
  occupancy: BedOccupancyFull[];
  isLoading: boolean;
  error: Error | null;
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

  const ward = wards?.[0]?.ward ?? null;

  const { data: beds, mutate: mutateBeds, error: bedsErr } = useSWR(
    config && ward ? ['ward-beds-inventory', config.apiUrl, ward] : null,
    () => listWardBedsInventory(config!, ward!),
    { refreshInterval: BEDS_REFRESH_INTERVAL },
  );

  const { data: occupancy, mutate: mutateOccupancy, error: occupancyErr } = useSWR(
    config && ward ? ['ward-beds-occupancy-full', config.apiUrl, ward] : null,
    () => listWardBedsOccupancyFull(config!, ward!),
    { refreshInterval: OCCUPANCY_REFRESH_INTERVAL },
  );

  const error = wardsErr ?? bedsErr ?? occupancyErr ?? null;
  const isLoading = config !== null && wards === undefined && error === null;

  return {
    wards: wards ?? [],
    ward,
    beds: beds ?? [],
    occupancy: occupancy ?? [],
    isLoading,
    error,
    mutateBeds: () => mutateBeds(),
    mutateOccupancy: () => mutateOccupancy(),
  };
}
