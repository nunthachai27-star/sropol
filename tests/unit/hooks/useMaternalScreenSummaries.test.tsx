/* @vitest-environment jsdom */
// Phase 6 Task H4 — small direct test for the ward cross-source join hook
// (docs/superpowers/plans/2026-07-17-maternal-screening-hosxp.md GC-H4).
// Same per-key-fetcher SWRConfig wrapper pattern as tests/unit/hooks/usePatient.test.tsx.
import { describe, it, expect } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { SWRConfig } from 'swr';
import { useMaternalScreenSummaries } from '@/hooks/useMaternalScreenSummaries';
import type { MaternalScreenSummariesResponse } from '@/types/api';

function makeWrapper(fetcher: (key: string) => Promise<unknown>) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, fetcher }}>
        {children}
      </SWRConfig>
    );
  };
}

const response: MaternalScreenSummariesResponse = {
  uiEnabled: true,
  summaries: [
    {
      an: 'AN1',
      localTier: 'LOCAL_SEVERE',
      emergencyAcuity: 'EMERGENCY',
      isComplete: true,
      assessedAt: null,
    },
    {
      an: 'AN2',
      localTier: 'LOCAL_MILD',
      emergencyAcuity: null,
      isComplete: null,
      assessedAt: null,
    },
  ],
};

describe('useMaternalScreenSummaries', () => {
  it('does not fetch and returns an empty map when hcode is null/undefined', () => {
    const fetcher = () => Promise.reject(new Error('should not be called'));
    const { result } = renderHook(() => useMaternalScreenSummaries(null), {
      wrapper: makeWrapper(fetcher),
    });
    expect(result.current.uiEnabled).toBe(false);
    expect(result.current.byAn.size).toBe(0);
    expect(result.current.isLoading).toBe(false);
  });

  it('builds an an-indexed map from the response summaries', async () => {
    const fetcher = (key: string) => {
      expect(key).toBe('/api/hospitals/10670/maternal-screen-summaries');
      return Promise.resolve(response);
    };
    const { result } = renderHook(() => useMaternalScreenSummaries('10670'), {
      wrapper: makeWrapper(fetcher),
    });

    await waitFor(() => expect(result.current.uiEnabled).toBe(true), { timeout: 2000 });
    expect(result.current.byAn.size).toBe(2);
    expect(result.current.byAn.get('AN1')).toEqual(response.summaries[0]);
    expect(result.current.byAn.get('AN2')).toEqual(response.summaries[1]);
    expect(result.current.byAn.get('AN-MISSING')).toBeUndefined();
  });

  it('GC-H4: a failed central fetch degrades to an empty map, never throwing into the caller', async () => {
    const fetcher = () => Promise.reject(new Error('central fetch down'));
    const { result } = renderHook(() => useMaternalScreenSummaries('10670'), {
      wrapper: makeWrapper(fetcher),
    });

    await waitFor(() => expect(result.current.error).toBeTruthy(), { timeout: 2000 });
    expect(result.current.byAn.size).toBe(0);
    expect(result.current.uiEnabled).toBe(false);
  });
});
