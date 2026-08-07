/* @vitest-environment jsdom */
/* @vitest-environment-options { "url": "http://localhost/" } */
// Task 32: PreLabourTab read-only — TDD: write tests FIRST.
// Task 43: extended with form-based CRUD tests (composite write to ipt_pregnancy
// + ipt_labour).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { SWRConfig } from 'swr';
import type { ReactNode } from 'react';

vi.mock('@/hooks/useBmsSession', () => ({ useBmsSession: vi.fn() }));
vi.mock('@/services/maternity-ward', () => ({
  getPatientLabour: vi.fn(),
  getPatientPregnancy: vi.fn(),
  upsertLabour: vi.fn(),
  upsertPregnancy: vi.fn(),
}));
import { useBmsSession } from '@/hooks/useBmsSession';
import {
  getPatientLabour,
  getPatientPregnancy,
  upsertLabour,
  upsertPregnancy,
} from '@/services/maternity-ward';
import { PreLabourTab } from '@/components/maternity/tabs/PreLabourTab';

const mockBmsSession = useBmsSession as unknown as ReturnType<typeof vi.fn>;
const mockGetLabour = getPatientLabour as unknown as ReturnType<typeof vi.fn>;
const mockGetPreg = getPatientPregnancy as unknown as ReturnType<typeof vi.fn>;
const mockUpLabour = upsertLabour as unknown as ReturnType<typeof vi.fn>;
const mockUpPreg = upsertPregnancy as unknown as ReturnType<typeof vi.fn>;
const cfg = { apiUrl: 'https://t.example/api', bearerToken: 'B', appIdentifier: 'X' };
const userInfo = { loginname: 'n1', fullname: 'N', hospcode: '10670' };
const wrapper = ({ children }: { children: ReactNode }) => (
  <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>{children}</SWRConfig>
);

beforeEach(() => {
  mockBmsSession.mockReset();
  mockGetLabour.mockReset();
  mockGetPreg.mockReset();
  mockUpLabour.mockReset();
  mockUpPreg.mockReset();
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
    // labor_date is rendered in Buddhist-Era display format in the read-only
    // view (2026-04-19 → 19/4/2569), matching the HOSxP paper chart. Assert
    // the BE display the component actually shows.
    expect(screen.getByText('19/4/2569')).toBeInTheDocument();
  });

  it('renders empty state when both records are null', async () => {
    mockBmsSession.mockReturnValue({ config: cfg });
    mockGetLabour.mockResolvedValue(null);
    mockGetPreg.mockResolvedValue(null);
    render(<PreLabourTab an="AN1" />, { wrapper });
    await waitFor(() => expect(screen.getByText(/ไม่พบข้อมูล/)).toBeInTheDocument(), {
      timeout: 2000,
    });
  });

  it('renders error state when a fetch fails', async () => {
    mockBmsSession.mockReturnValue({ config: cfg });
    mockGetLabour.mockRejectedValue(new Error('BMS down'));
    mockGetPreg.mockResolvedValue(null);
    render(<PreLabourTab an="AN1" />, { wrapper });
    await waitFor(() => expect(screen.getByText(/โหลดไม่สำเร็จ.*BMS down/)).toBeInTheDocument(), {
      timeout: 2000,
    });
  });
});

describe('PreLabourTab CRUD', () => {
  const labourRow = { ipt_labour_id: 99, an: 'AN1', g: 3, ga: 39, anc_count: 8 };
  const pregRow = {
    an: 'AN1',
    preg_number: 3,
    ga: 39,
    anc_complete: 'Y',
    labor_date: '2026-04-19',
  };

  it('clicking แก้ไข reveals form inputs for both records', async () => {
    mockBmsSession.mockReturnValue({ config: cfg, userInfo });
    mockGetLabour.mockResolvedValue(labourRow);
    mockGetPreg.mockResolvedValue(pregRow);
    render(<PreLabourTab an="AN1" />, { wrapper });
    await waitFor(() => expect(screen.getByText('99')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /แก้ไข/ }));
    expect(screen.getByLabelText('preg_number')).toBeInTheDocument();
    expect(screen.getByLabelText('labour_g')).toBeInTheDocument();
  });

  it('save calls upsertPregnancy AND upsertLabour with edited fields', async () => {
    mockBmsSession.mockReturnValue({ config: cfg, userInfo });
    mockGetLabour.mockResolvedValue(labourRow);
    mockGetPreg.mockResolvedValue(pregRow);
    mockUpPreg.mockResolvedValue(undefined);
    mockUpLabour.mockResolvedValue(undefined);
    render(<PreLabourTab an="AN1" />, { wrapper });
    await waitFor(() => expect(screen.getByText('99')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /แก้ไข/ }));
    fireEvent.change(screen.getByLabelText('preg_number'), { target: { value: '4' } });
    fireEvent.change(screen.getByLabelText('labour_g'), { target: { value: '4' } });
    fireEvent.click(screen.getByRole('button', { name: /บันทึก/ }));
    await waitFor(() => expect(mockUpLabour).toHaveBeenCalled());
    expect(mockUpPreg).toHaveBeenCalled();
    expect(mockUpPreg.mock.calls[0][3]).toMatchObject({ preg_number: 4 });
    expect(mockUpLabour.mock.calls[0][3]).toMatchObject({ g: 4 });
  });

  it('surfaces Thai error when ipt_labour write fails after pregnancy succeeded', async () => {
    mockBmsSession.mockReturnValue({ config: cfg, userInfo });
    mockGetLabour.mockResolvedValue(labourRow);
    mockGetPreg.mockResolvedValue(pregRow);
    mockUpPreg.mockResolvedValue(undefined);
    mockUpLabour.mockRejectedValue(new Error('rest failed'));
    render(<PreLabourTab an="AN1" />, { wrapper });
    await waitFor(() => expect(screen.getByText('99')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /แก้ไข/ }));
    fireEvent.click(screen.getByRole('button', { name: /บันทึก/ }));
    await waitFor(() =>
      expect(screen.getByText(/ipt_pregnancy สำเร็จ แต่ ipt_labour ไม่สำเร็จ/)).toBeInTheDocument(),
    );
  });

  it('cancel exits edit mode without calling upsert', async () => {
    mockBmsSession.mockReturnValue({ config: cfg, userInfo });
    mockGetLabour.mockResolvedValue(labourRow);
    mockGetPreg.mockResolvedValue(pregRow);
    render(<PreLabourTab an="AN1" />, { wrapper });
    await waitFor(() => expect(screen.getByText('99')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /แก้ไข/ }));
    expect(screen.getByLabelText('preg_number')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /ยกเลิก/ }));
    expect(mockUpPreg).not.toHaveBeenCalled();
    expect(mockUpLabour).not.toHaveBeenCalled();
    expect(screen.queryByLabelText('preg_number')).not.toBeInTheDocument();
  });
});
