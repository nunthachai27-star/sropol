// T052: useDashboard SWR hook
'use client';

import useSWR from 'swr';
import type { DashboardResponse, DashboardStageKPIs, DashboardAlerts } from '@/types/api';

interface DashboardWithExtras extends DashboardResponse {
  stageKPIs?: DashboardStageKPIs;
  alerts?: DashboardAlerts;
}

const DEFAULT_STAGE_KPIS: DashboardStageKPIs = {
  pregnancy: { total: 0, low: 0, hr1: 0, hr2: 0, hr3: 0 },
  labor: { total: 0, low: 0, medium: 0, high: 0 },
  delivered: { total: 0, normal: 0, lowApgar: 0, lbw: 0 },
};

const DEFAULT_ALERTS: DashboardAlerts = {
  referralAlerts: 0,
  overdueAnc: 0,
  inTransitReferrals: 0,
};

export function useDashboard() {
  const { data, error, isLoading, isValidating, mutate } = useSWR<DashboardWithExtras>(
    '/api/dashboard',
    {
      refreshInterval: 30000,
      revalidateOnFocus: true,
    },
  );

  return {
    hospitals: data?.hospitals ?? [],
    summary: data?.summary ?? { totalLow: 0, totalMedium: 0, totalHigh: 0, totalActive: 0 },
    stageKPIs: data?.stageKPIs ?? DEFAULT_STAGE_KPIS,
    alerts: data?.alerts ?? DEFAULT_ALERTS,
    updatedAt: data?.updatedAt ?? null,
    isLoading,
    isValidating,
    error,
    mutate,
  };
}
