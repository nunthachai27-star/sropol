/* @vitest-environment jsdom */
/* @vitest-environment-options { "url": "http://localhost/" } */
// W5: unit tests for the clinical-density hook that backs the maternity-ward
// board. Covers the two behaviours the page depends on and that TDD requires us
// to pin down FIRST:
//   1. `health` derivation for the masthead LIVE badge (ok / reconnecting / error).
//   2. `selectedWard` / `setSelectedWard` changing which ward is queried.
// Mock conventions mirror useMaternityWardState.test.tsx: mock the domain
// service + useBmsSession, isolate SWR cache per test via SWRConfig provider.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import type { ReactNode } from 'react';

vi.mock('@/hooks/useBmsSession', () => ({
  useBmsSession: vi.fn(),
}));
vi.mock('@/services/maternity-ward', () => ({
  listMaternityWards: vi.fn(),
  listWardBedsInventory: vi.fn(),
  listWardBedsOccupancyFull: vi.fn(),
}));

import { useBmsSession } from '@/hooks/useBmsSession';
import {
  listMaternityWards,
  listWardBedsInventory,
  listWardBedsOccupancyFull,
} from '@/services/maternity-ward';
import { useMaternityWardStateFull } from '@/hooks/useMaternityWardStateFull';

const mockBmsSession = useBmsSession as unknown as ReturnType<typeof vi.fn>;
const mockListWards = listMaternityWards as unknown as ReturnType<typeof vi.fn>;
const mockListInventory = listWardBedsInventory as unknown as ReturnType<typeof vi.fn>;
const mockListOccupancy = listWardBedsOccupancyFull as unknown as ReturnType<typeof vi.fn>;

const cfg = { apiUrl: 'https://t.example/api', bearerToken: 'B', appIdentifier: 'X' };

// Fresh SWR cache per test; disable retry-on-error so a rejected fetch settles
// deterministically into the 'error' health state instead of flapping through
// SWR's exponential-backoff retries.
import { SWRConfig } from 'swr';
const wrapper = ({ children }: { children: ReactNode }) => (
  <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, shouldRetryOnError: false }}>
    {children}
  </SWRConfig>
);

beforeEach(() => {
  mockBmsSession.mockReset();
  mockListWards.mockReset();
  mockListInventory.mockReset();
  mockListOccupancy.mockReset();
});

describe('useMaternityWardStateFull — health derivation', () => {
  it("reports health='ok' when every feed resolves", async () => {
    mockBmsSession.mockReturnValue({ config: cfg });
    mockListWards.mockResolvedValue([{ ward: '03', name: 'ห้องคลอด', real_bedcount: 12 }]);
    mockListInventory.mockResolvedValue([]);
    mockListOccupancy.mockResolvedValue([]);

    const { result } = renderHook(() => useMaternityWardStateFull(), { wrapper });
    await waitFor(() => expect(result.current.beds).toEqual([]), { timeout: 2000 });
    await waitFor(() => expect(result.current.health).toBe('ok'), { timeout: 2000 });
    expect(result.current.error).toBeNull();
  });

  it("reports health='error' when the occupancy feed fails and is not retrying", async () => {
    mockBmsSession.mockReturnValue({ config: cfg });
    mockListWards.mockResolvedValue([{ ward: '03', name: 'ห้องคลอด', real_bedcount: 12 }]);
    mockListInventory.mockResolvedValue([]);
    mockListOccupancy.mockRejectedValue(new Error('occupancy feed down'));

    const { result } = renderHook(() => useMaternityWardStateFull(), { wrapper });
    await waitFor(() => expect(result.current.health).toBe('error'), { timeout: 2000 });
    expect(result.current.error?.message).toBe('occupancy feed down');
  });

  it("reports health='reconnecting' while a failed feed is being re-fetched", async () => {
    mockBmsSession.mockReturnValue({ config: cfg });
    mockListWards.mockResolvedValue([{ ward: '03', name: 'ห้องคลอด', real_bedcount: 12 }]);
    mockListInventory.mockResolvedValue([]);
    // First occupancy fetch fails → 'error'. The manual revalidation below
    // never resolves, so the hook sits in the retry-in-flight state with the
    // prior error still set → 'reconnecting'.
    mockListOccupancy
      .mockRejectedValueOnce(new Error('occupancy feed down'))
      .mockImplementation(() => new Promise(() => {}));

    const { result } = renderHook(() => useMaternityWardStateFull(), { wrapper });
    await waitFor(() => expect(result.current.health).toBe('error'), { timeout: 2000 });

    await act(async () => {
      void result.current.mutateOccupancy();
    });
    await waitFor(() => expect(result.current.health).toBe('reconnecting'), { timeout: 2000 });
  });
});

describe('useMaternityWardStateFull — ward selection', () => {
  it('defaults to the first ward and queries beds/occupancy for it', async () => {
    mockBmsSession.mockReturnValue({ config: cfg });
    mockListWards.mockResolvedValue([
      { ward: '03', name: 'ห้องคลอด A', real_bedcount: 12 },
      { ward: '05', name: 'ห้องคลอด B', real_bedcount: 8 },
    ]);
    mockListInventory.mockResolvedValue([]);
    mockListOccupancy.mockResolvedValue([]);

    const { result } = renderHook(() => useMaternityWardStateFull(), { wrapper });
    await waitFor(() => expect(result.current.selectedWard).toBe('03'), { timeout: 2000 });
    expect(result.current.ward).toBe('03');
    await waitFor(() => expect(mockListInventory).toHaveBeenCalledWith(cfg, '03'), {
      timeout: 2000,
    });
    expect(mockListOccupancy).toHaveBeenCalledWith(cfg, '03');
  });

  it('setSelectedWard switches the queried ward', async () => {
    mockBmsSession.mockReturnValue({ config: cfg });
    mockListWards.mockResolvedValue([
      { ward: '03', name: 'ห้องคลอด A', real_bedcount: 12 },
      { ward: '05', name: 'ห้องคลอด B', real_bedcount: 8 },
    ]);
    mockListInventory.mockResolvedValue([]);
    mockListOccupancy.mockResolvedValue([]);

    const { result } = renderHook(() => useMaternityWardStateFull(), { wrapper });
    await waitFor(() => expect(result.current.selectedWard).toBe('03'), { timeout: 2000 });

    act(() => {
      result.current.setSelectedWard('05');
    });

    await waitFor(() => expect(result.current.selectedWard).toBe('05'), { timeout: 2000 });
    expect(result.current.ward).toBe('05');
    await waitFor(() => expect(mockListInventory).toHaveBeenCalledWith(cfg, '05'), {
      timeout: 2000,
    });
    expect(mockListOccupancy).toHaveBeenCalledWith(cfg, '05');
  });

  it('exposes setSelectedWard as a function even before wards load', () => {
    mockBmsSession.mockReturnValue({ config: null });
    const { result } = renderHook(() => useMaternityWardStateFull(), { wrapper });
    expect(typeof result.current.setSelectedWard).toBe('function');
    expect(result.current.selectedWard).toBeNull();
    expect(result.current.health).toBe('ok');
  });
});
