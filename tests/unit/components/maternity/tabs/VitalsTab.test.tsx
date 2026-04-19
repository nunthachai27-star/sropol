/* @vitest-environment jsdom */
/* @vitest-environment-options { "url": "http://localhost/" } */
// Task 31: VitalsTab read-only — TDD: write tests FIRST.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { SWRConfig } from 'swr';
import type { ReactNode } from 'react';

vi.mock('@/hooks/useBmsSession', () => ({ useBmsSession: vi.fn() }));
vi.mock('@/services/maternity-ward', () => ({ getPatientVitalSigns: vi.fn() }));
import { useBmsSession } from '@/hooks/useBmsSession';
import { getPatientVitalSigns } from '@/services/maternity-ward';
import { VitalsTab } from '@/components/maternity/tabs/VitalsTab';

const mockBmsSession = useBmsSession as unknown as ReturnType<typeof vi.fn>;
const mockGet = getPatientVitalSigns as unknown as ReturnType<typeof vi.fn>;
const cfg = { apiUrl: 'https://t.example/api', bearerToken: 'B', appIdentifier: 'X' };
const wrapper = ({ children }: { children: ReactNode }) => (
  <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>{children}</SWRConfig>
);

beforeEach(() => {
  mockBmsSession.mockReset();
  mockGet.mockReset();
});

describe('VitalsTab', () => {
  it('shows no-config message when BMS session absent', () => {
    mockBmsSession.mockReturnValue({ config: null });
    render(<VitalsTab an="AN1" />, { wrapper });
    expect(screen.getByText(/ไม่พร้อมใช้งาน/)).toBeInTheDocument();
  });

  it('shows loading', () => {
    mockBmsSession.mockReturnValue({ config: cfg });
    mockGet.mockReturnValue(new Promise(() => {}));
    render(<VitalsTab an="AN1" />, { wrapper });
    expect(screen.getByText(/กำลังโหลด/)).toBeInTheDocument();
  });

  it('renders table rows from data', async () => {
    mockBmsSession.mockReturnValue({ config: cfg });
    mockGet.mockResolvedValue([
      {
        an: 'AN1',
        hr: 88,
        bps: 118,
        bpd: 76,
        fetal_heart_sound: 'regular',
        cervical_open_size: 5,
        eff: 70,
        station: '0',
        hct: 36,
        height: 158,
        bw: 62,
        temperature: 36.8,
        rr: 18,
        ultrasound_result: null,
      },
    ]);
    render(<VitalsTab an="AN1" />, { wrapper });
    await waitFor(() => expect(screen.getByText('88')).toBeInTheDocument(), { timeout: 2000 });
    expect(screen.getByText('regular')).toBeInTheDocument();
  });

  it('renders empty state when data is []', async () => {
    mockBmsSession.mockReturnValue({ config: cfg });
    mockGet.mockResolvedValue([]);
    render(<VitalsTab an="AN1" />, { wrapper });
    await waitFor(() => expect(screen.getByText(/ไม่พบข้อมูล/)).toBeInTheDocument(), { timeout: 2000 });
  });

  it('renders error state when fetch fails', async () => {
    mockBmsSession.mockReturnValue({ config: cfg });
    mockGet.mockRejectedValue(new Error('BMS down'));
    render(<VitalsTab an="AN1" />, { wrapper });
    await waitFor(() => expect(screen.getByText(/โหลดไม่สำเร็จ.*BMS down/)).toBeInTheDocument(), { timeout: 2000 });
  });
});
