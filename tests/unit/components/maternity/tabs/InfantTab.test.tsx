/* @vitest-environment jsdom */
/* @vitest-environment-options { "url": "http://localhost/" } */
// Task 37: InfantTab read-only — TDD: write tests FIRST.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { SWRConfig } from 'swr';
import type { ReactNode } from 'react';

vi.mock('@/hooks/useBmsSession', () => ({ useBmsSession: vi.fn() }));
vi.mock('@/services/maternity-ward', () => ({
  getPatientInfants: vi.fn(),
}));
import { useBmsSession } from '@/hooks/useBmsSession';
import { getPatientInfants } from '@/services/maternity-ward';
import { InfantTab } from '@/components/maternity/tabs/InfantTab';

const mockBmsSession = useBmsSession as unknown as ReturnType<typeof vi.fn>;
const mockGet = getPatientInfants as unknown as ReturnType<typeof vi.fn>;
const cfg = { apiUrl: 'https://t.example/api', bearerToken: 'B', appIdentifier: 'X' };
const wrapper = ({ children }: { children: ReactNode }) => (
  <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>{children}</SWRConfig>
);

beforeEach(() => {
  mockBmsSession.mockReset();
  mockGet.mockReset();
});

describe('InfantTab', () => {
  it('shows no-config message when BMS session absent', () => {
    mockBmsSession.mockReturnValue({ config: null });
    render(<InfantTab an="AN1" />, { wrapper });
    expect(screen.getByText(/ไม่พร้อมใช้งาน/)).toBeInTheDocument();
  });

  it('shows loading', () => {
    mockBmsSession.mockReturnValue({ config: cfg });
    mockGet.mockReturnValue(new Promise(() => {}));
    render(<InfantTab an="AN1" />, { wrapper });
    expect(screen.getByText(/กำลังโหลด/)).toBeInTheDocument();
  });

  it('renders table rows from data', async () => {
    mockBmsSession.mockReturnValue({ config: cfg });
    mockGet.mockResolvedValue([
      {
        ipt_newborn_id: 11,
        ipt_labour_infant_id: 22,
        an: 'AN1',
        sex: 'M',
        birth_weight: 3200,
        infant_hn: 'HN-INF1',
      },
    ]);
    render(<InfantTab an="AN1" />, { wrapper });
    await waitFor(() => expect(screen.getByText('M')).toBeInTheDocument(), { timeout: 2000 });
    expect(screen.getByText('3200')).toBeInTheDocument();
  });

  it('renders empty state when data is []', async () => {
    mockBmsSession.mockReturnValue({ config: cfg });
    mockGet.mockResolvedValue([]);
    render(<InfantTab an="AN1" />, { wrapper });
    await waitFor(() => expect(screen.getByText(/ไม่พบข้อมูล/)).toBeInTheDocument(), { timeout: 2000 });
  });

  it('renders error state when fetch fails', async () => {
    mockBmsSession.mockReturnValue({ config: cfg });
    mockGet.mockRejectedValue(new Error('BMS down'));
    render(<InfantTab an="AN1" />, { wrapper });
    await waitFor(() => expect(screen.getByText(/โหลดไม่สำเร็จ.*BMS down/)).toBeInTheDocument(), { timeout: 2000 });
  });
});
