/* @vitest-environment jsdom */
/* @vitest-environment-options { "url": "http://localhost/" } */
// Task 31: VitalsTab read-only — TDD: write tests FIRST.
// Task 42: extended with CRUD (Add / Edit / Save / Delete / Cancel) tests.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { SWRConfig } from 'swr';
import type { ReactNode } from 'react';

vi.mock('@/hooks/useBmsSession', () => ({ useBmsSession: vi.fn() }));
vi.mock('@/services/maternity-ward', () => ({
  getPatientVitalSigns: vi.fn(),
  upsertVitalSign: vi.fn(),
  deleteVitalSign: vi.fn(),
}));
import { useBmsSession } from '@/hooks/useBmsSession';
import {
  getPatientVitalSigns,
  upsertVitalSign,
  deleteVitalSign,
} from '@/services/maternity-ward';
import { VitalsTab } from '@/components/maternity/tabs/VitalsTab';

const mockBmsSession = useBmsSession as unknown as ReturnType<typeof vi.fn>;
const mockGet = getPatientVitalSigns as unknown as ReturnType<typeof vi.fn>;
const mockUpsert = upsertVitalSign as unknown as ReturnType<typeof vi.fn>;
const mockDelete = deleteVitalSign as unknown as ReturnType<typeof vi.fn>;
const cfg = { apiUrl: 'https://t.example/api', bearerToken: 'B', appIdentifier: 'X' };
const userInfo = { loginname: 'n1', fullname: 'N', hospcode: '10670' };
const wrapper = ({ children }: { children: ReactNode }) => (
  <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>{children}</SWRConfig>
);

beforeEach(() => {
  mockBmsSession.mockReset();
  mockGet.mockReset();
  mockUpsert.mockReset();
  mockDelete.mockReset();
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

describe('VitalsTab CRUD', () => {
  const sampleRow = {
    ipt_pregnancy_vital_sign_id: 7,
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
  };

  it('clicking + เพิ่มข้อมูลใหม่ shows an inline edit row', async () => {
    mockBmsSession.mockReturnValue({ config: cfg, userInfo });
    mockGet.mockResolvedValue([]);
    render(<VitalsTab an="AN1" />, { wrapper });
    await waitFor(() => expect(screen.getByText(/ไม่พบข้อมูล/)).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /เพิ่มข้อมูลใหม่/ }));
    expect(screen.getAllByRole('textbox').length).toBeGreaterThan(0);
  });

  it('save calls upsertVitalSign with edited fields', async () => {
    mockBmsSession.mockReturnValue({ config: cfg, userInfo });
    mockGet.mockResolvedValue([sampleRow]);
    mockUpsert.mockResolvedValue({});
    render(<VitalsTab an="AN1" />, { wrapper });
    await waitFor(() => expect(screen.getByText('88')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /แก้ไข/ }));
    const hrInput = screen.getByDisplayValue('88');
    fireEvent.change(hrInput, { target: { value: '92' } });
    fireEvent.click(screen.getByRole('button', { name: /บันทึก/ }));
    await waitFor(() => expect(mockUpsert).toHaveBeenCalled());
    const callArg = mockUpsert.mock.calls[0][3];
    expect(callArg).toMatchObject({ ipt_pregnancy_vital_sign_id: 7, hr: 92 });
  });

  it('delete calls deleteVitalSign after confirm', async () => {
    const origConfirm = window.confirm;
    window.confirm = vi.fn().mockReturnValue(true);
    mockBmsSession.mockReturnValue({ config: cfg, userInfo });
    mockGet.mockResolvedValue([sampleRow]);
    mockDelete.mockResolvedValue(undefined);
    render(<VitalsTab an="AN1" />, { wrapper });
    await waitFor(() => expect(screen.getByText('88')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /ลบ/ }));
    expect(window.confirm).toHaveBeenCalled();
    await waitFor(() => expect(mockDelete).toHaveBeenCalled());
    window.confirm = origConfirm;
  });

  it('cancel exits edit mode without calling upsert', async () => {
    mockBmsSession.mockReturnValue({ config: cfg, userInfo });
    mockGet.mockResolvedValue([sampleRow]);
    render(<VitalsTab an="AN1" />, { wrapper });
    await waitFor(() => expect(screen.getByText('88')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /แก้ไข/ }));
    expect(screen.getByDisplayValue('88')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /ยกเลิก/ }));
    expect(mockUpsert).not.toHaveBeenCalled();
    expect(screen.queryByDisplayValue('88')).not.toBeInTheDocument();
  });
});
