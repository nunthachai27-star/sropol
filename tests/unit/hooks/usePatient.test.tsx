/* @vitest-environment jsdom */
import { describe, it, expect } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { SWRConfig } from 'swr';
import { usePatient } from '@/hooks/usePatient';

// usePatient fires three independent SWR calls (detail / vitals / contractions).
// These tests pin the contract that the secondary feeds' errors are surfaced
// individually — so the page can keep the main detail on screen and show a
// non-blocking banner for the feeds that failed instead of silently rendering
// them as empty. Each test drives a per-key fetcher through an isolated SWR
// cache (provider: new Map()) so the feeds can succeed or fail independently.
function makeWrapper(fetcher: (key: string) => Promise<unknown>) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, fetcher }}>
        {children}
      </SWRConfig>
    );
  };
}

const detail = { patient: { an: 'AN1', name: 'ก ข' }, cpdScore: null, journeyContext: null };

describe('usePatient secondary-feed errors', () => {
  it('surfaces vitals + contractions errors independently while the detail loads fine', async () => {
    const fetcher = (key: string) => {
      if (key.endsWith('/vitals')) return Promise.reject(new Error('vitals boom'));
      if (key.endsWith('/contractions')) return Promise.reject(new Error('contractions boom'));
      return Promise.resolve(detail);
    };
    const { result } = renderHook(() => usePatient('AN1'), { wrapper: makeWrapper(fetcher) });

    await waitFor(() => expect(result.current.patient).toBeTruthy(), { timeout: 2000 });
    await waitFor(() => expect(result.current.vitalsError).toBeTruthy(), { timeout: 2000 });
    await waitFor(() => expect(result.current.contractionsError).toBeTruthy(), { timeout: 2000 });
    // Main detail loaded fine — its error stays falsy even though feeds failed.
    expect(result.current.error).toBeFalsy();
    expect((result.current.vitalsError as Error).message).toBe('vitals boom');
    expect((result.current.contractionsError as Error).message).toBe('contractions boom');
  });

  it('leaves feed errors unset and exposes per-feed revalidators when feeds succeed', async () => {
    const fetcher = (key: string) => {
      if (key.endsWith('/vitals')) return Promise.resolve({ vitals: [] });
      if (key.endsWith('/contractions')) return Promise.resolve({ contractions: [] });
      return Promise.resolve(detail);
    };
    const { result } = renderHook(() => usePatient('AN1'), { wrapper: makeWrapper(fetcher) });

    await waitFor(() => expect(result.current.patient).toBeTruthy(), { timeout: 2000 });
    expect(result.current.vitalsError).toBeFalsy();
    expect(result.current.contractionsError).toBeFalsy();
    expect(typeof result.current.mutateVitals).toBe('function');
    expect(typeof result.current.mutateContractions).toBe('function');
  });
});
