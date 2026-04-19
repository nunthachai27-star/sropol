/* @vitest-environment jsdom */
/* @vitest-environment-options { "url": "http://localhost/" } */
// Task 32: PreLabourTab read-only — TDD: write tests FIRST.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { SWRConfig } from 'swr';
import type { ReactNode } from 'react';

vi.mock('@/hooks/useBmsSession', () => ({ useBmsSession: vi.fn() }));
vi.mock('@/services/maternity-ward', () => ({
  getPatientLabour: vi.fn(),
  getPatientPregnancy: vi.fn(),
}));
import { useBmsSession } from '@/hooks/useBmsSession';
import {
  getPatientLabour,
  getPatientPregnancy,
} from '@/services/maternity-ward';
import { PreLabourTab } from '@/components/maternity/tabs/PreLabourTab';

const mockBmsSession = useBmsSession as unknown as ReturnType<typeof vi.fn>;
const mockGetLabour = getPatientLabour as unknown as ReturnType<typeof vi.fn>;
const mockGetPreg = getPatientPregnancy as unknown as ReturnType<typeof vi.fn>;
const cfg = { apiUrl: 'https://t.example/api', bearerToken: 'B', appIdentifier: 'X' };
const wrapper = ({ children }: { children: ReactNode }) => (
  <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>{children}</SWRConfig>
);

beforeEach(() => {
  mockBmsSession.mockReset();
  mockGetLabour.mockReset();
  mockGetPreg.mockReset();
});

describe('PreLabourTab', () => {
  it('shows no-config message when BMS session absent', () => {
    mockBmsSession.mockReturnValue({ config: null });
    render(<PreLabourTab an="AN1" />, { wrapper });
    expect(screen.getByText(/ไม่พร้อมใช้งาน/)).toBeInTheDocument();
  });

  it('shows loading while either fetch is pending', () => {
    mockBmsSession.mockReturnValue({ config: cfg });
    mockGetLabour.mockReturnValue(new Promise(() => {}));
    mockGetPreg.mockReturnValue(new Promise(() => {}));
    render(<PreLabourTab an="AN1" />, { wrapper });
    expect(screen.getByText(/กำลังโหลด/)).toBeInTheDocument();
  });

  it('renders fields from both records', async () => {
    mockBmsSession.mockReturnValue({ config: cfg });
    mockGetLabour.mockResolvedValue({
      ipt_labour_id: 99,
      an: 'AN1',
      g: 3,
      ga: 39,
      anc_count: 8,
    });
    mockGetPreg.mockResolvedValue({
      an: 'AN1',
      preg_number: 3,
      ga: 39,
      anc_complete: 'Y',
      labor_date: '2026-04-19',
    });
    render(<PreLabourTab an="AN1" />, { wrapper });
    await waitFor(() => expect(screen.getByText('99')).toBeInTheDocument(), { timeout: 2000 });
    expect(screen.getByText('Y')).toBeInTheDocument();
    expect(screen.getByText('2026-04-19')).toBeInTheDocument();
  });

  it('renders empty state when both records are null', async () => {
    mockBmsSession.mockReturnValue({ config: cfg });
    mockGetLabour.mockResolvedValue(null);
    mockGetPreg.mockResolvedValue(null);
    render(<PreLabourTab an="AN1" />, { wrapper });
    await waitFor(() => expect(screen.getByText(/ไม่พบข้อมูล/)).toBeInTheDocument(), { timeout: 2000 });
  });

  it('renders error state when a fetch fails', async () => {
    mockBmsSession.mockReturnValue({ config: cfg });
    mockGetLabour.mockRejectedValue(new Error('BMS down'));
    mockGetPreg.mockResolvedValue(null);
    render(<PreLabourTab an="AN1" />, { wrapper });
    await waitFor(() => expect(screen.getByText(/โหลดไม่สำเร็จ.*BMS down/)).toBeInTheDocument(), { timeout: 2000 });
  });
});
