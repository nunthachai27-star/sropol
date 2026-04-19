/* @vitest-environment jsdom */
/* @vitest-environment-options { "url": "http://localhost/" } */
// Task 36: ComplicationsTab read-only — TDD: write tests FIRST.
// Task 47: extended with table+inline-edit CRUD tests. CRUD calls flow through
// upsertComplication / deleteComplication, both keyed by ipt_labour_id which
// is resolved from getPatientLabour.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { SWRConfig } from 'swr';
import type { ReactNode } from 'react';

vi.mock('@/hooks/useBmsSession', () => ({ useBmsSession: vi.fn() }));
vi.mock('@/services/maternity-ward', () => ({
  getPatientLabour: vi.fn(),
  getPatientComplications: vi.fn(),
  upsertComplication: vi.fn(),
  deleteComplication: vi.fn(),
}));
import { useBmsSession } from '@/hooks/useBmsSession';
import {
  getPatientLabour,
  getPatientComplications,
  upsertComplication,
  deleteComplication,
} from '@/services/maternity-ward';
import { ComplicationsTab } from '@/components/maternity/tabs/ComplicationsTab';

const mockBmsSession = useBmsSession as unknown as ReturnType<typeof vi.fn>;
const mockGetLabour = getPatientLabour as unknown as ReturnType<typeof vi.fn>;
const mockGetComps = getPatientComplications as unknown as ReturnType<typeof vi.fn>;
const mockUpsert = upsertComplication as unknown as ReturnType<typeof vi.fn>;
const mockDelete = deleteComplication as unknown as ReturnType<typeof vi.fn>;
const cfg = { apiUrl: 'https://t.example/api', bearerToken: 'B', appIdentifier: 'X' };
const userInfo = { loginname: 'n1', fullname: 'N', hospcode: '10670' };
const wrapper = ({ children }: { children: ReactNode }) => (
  <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>{children}</SWRConfig>
);

beforeEach(() => {
  mockBmsSession.mockReset();
  mockGetLabour.mockReset();
  mockGetComps.mockReset();
  mockUpsert.mockReset();
  mockDelete.mockReset();
});

describe('ComplicationsTab', () => {
  it('shows no-config message when BMS session absent', () => {
    mockBmsSession.mockReturnValue({ config: null });
    render(<ComplicationsTab an="AN1" />, { wrapper });
    expect(screen.getByText(/ไม่พร้อมใช้งาน/)).toBeInTheDocument();
  });

  it('shows loading while labour lookup is pending', () => {
    mockBmsSession.mockReturnValue({ config: cfg });
    mockGetLabour.mockReturnValue(new Promise(() => {}));
    render(<ComplicationsTab an="AN1" />, { wrapper });
    expect(screen.getByText(/กำลังโหลด/)).toBeInTheDocument();
  });

  it('renders table rows from data', async () => {
    mockBmsSession.mockReturnValue({ config: cfg });
    mockGetLabour.mockResolvedValue({
      ipt_labour_id: 99,
      an: 'AN1',
      g: 2,
      ga: 38,
      anc_count: 4,
    });
    mockGetComps.mockResolvedValue([
      {
        ipt_labour_complication_id: 1,
        ipt_labour_id: 99,
        labour_complication_id: 5,
        labour_stage_id: 2,
        complication_note: 'PPH treated',
        complication_name: 'Postpartum hemorrhage',
      },
    ]);
    render(<ComplicationsTab an="AN1" />, { wrapper });
    await waitFor(
      () => expect(screen.getByText('Postpartum hemorrhage')).toBeInTheDocument(),
      { timeout: 2000 },
    );
    expect(screen.getByText('PPH treated')).toBeInTheDocument();
  });

  it('renders empty state when complications are []', async () => {
    mockBmsSession.mockReturnValue({ config: cfg });
    mockGetLabour.mockResolvedValue({
      ipt_labour_id: 99,
      an: 'AN1',
      g: 2,
      ga: 38,
      anc_count: 4,
    });
    mockGetComps.mockResolvedValue([]);
    render(<ComplicationsTab an="AN1" />, { wrapper });
    await waitFor(() => expect(screen.getByText(/ไม่พบข้อมูล/)).toBeInTheDocument(), { timeout: 2000 });
  });

  it('renders error state when fetch fails', async () => {
    mockBmsSession.mockReturnValue({ config: cfg });
    mockGetLabour.mockResolvedValue({
      ipt_labour_id: 99,
      an: 'AN1',
      g: 2,
      ga: 38,
      anc_count: 4,
    });
    mockGetComps.mockRejectedValue(new Error('BMS down'));
    render(<ComplicationsTab an="AN1" />, { wrapper });
    await waitFor(() => expect(screen.getByText(/โหลดไม่สำเร็จ.*BMS down/)).toBeInTheDocument(), { timeout: 2000 });
  });

  it('shows empty when labour record missing (no ipt_labour_id, no complications fetched)', async () => {
    mockBmsSession.mockReturnValue({ config: cfg });
    mockGetLabour.mockResolvedValue(null);
    render(<ComplicationsTab an="AN1" />, { wrapper });
    await waitFor(() => expect(screen.getByText(/ไม่พบข้อมูล/)).toBeInTheDocument(), { timeout: 2000 });
    expect(mockGetComps).not.toHaveBeenCalled();
  });
});

describe('ComplicationsTab CRUD', () => {
  const labourRow = { ipt_labour_id: 99, an: 'AN1', g: 2, ga: 38, anc_count: 4 };
  const compRow = {
    ipt_labour_complication_id: 1,
    ipt_labour_id: 99,
    labour_complication_id: 5,
    labour_stage_id: 2,
    complication_note: 'PPH treated',
    complication_name: 'Postpartum hemorrhage',
  };

  it('clicking + เพิ่มภาวะแทรกซ้อน shows an inline edit row', async () => {
    mockBmsSession.mockReturnValue({ config: cfg, userInfo });
    mockGetLabour.mockResolvedValue(labourRow);
    mockGetComps.mockResolvedValue([]);
    render(<ComplicationsTab an="AN1" />, { wrapper });
    await waitFor(() => expect(screen.getByText(/ไม่พบข้อมูล/)).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /เพิ่มภาวะแทรกซ้อน/ }));
    expect(screen.getByLabelText('labour_complication_id')).toBeInTheDocument();
  });

  it('save calls upsertComplication with iptLabourId resolved from labour fetch', async () => {
    mockBmsSession.mockReturnValue({ config: cfg, userInfo });
    mockGetLabour.mockResolvedValue(labourRow);
    mockGetComps.mockResolvedValue([compRow]);
    mockUpsert.mockResolvedValue({});
    render(<ComplicationsTab an="AN1" />, { wrapper });
    await waitFor(() => expect(screen.getByText('Postpartum hemorrhage')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /แก้ไข/ }));
    fireEvent.change(screen.getByLabelText('complication_note'), {
      target: { value: 'updated' },
    });
    fireEvent.click(screen.getByRole('button', { name: /บันทึก/ }));
    await waitFor(() => expect(mockUpsert).toHaveBeenCalled());
    expect(mockUpsert.mock.calls[0][2]).toBe(99); // iptLabourId
    expect(mockUpsert.mock.calls[0][3]).toMatchObject({
      ipt_labour_complication_id: 1,
      complication_note: 'updated',
    });
  });

  it('delete calls deleteComplication after confirm', async () => {
    const origConfirm = window.confirm;
    window.confirm = vi.fn().mockReturnValue(true);
    mockBmsSession.mockReturnValue({ config: cfg, userInfo });
    mockGetLabour.mockResolvedValue(labourRow);
    mockGetComps.mockResolvedValue([compRow]);
    mockDelete.mockResolvedValue(undefined);
    render(<ComplicationsTab an="AN1" />, { wrapper });
    await waitFor(() => expect(screen.getByText('Postpartum hemorrhage')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /ลบ/ }));
    expect(window.confirm).toHaveBeenCalled();
    await waitFor(() => expect(mockDelete).toHaveBeenCalled());
    window.confirm = origConfirm;
  });

  it('Add button is disabled when no ipt_labour_id (cannot create complication)', async () => {
    mockBmsSession.mockReturnValue({ config: cfg, userInfo });
    mockGetLabour.mockResolvedValue(null);
    render(<ComplicationsTab an="AN1" />, { wrapper });
    await waitFor(() => expect(screen.getByText(/ไม่พบข้อมูล/)).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /เพิ่มภาวะแทรกซ้อน/ })).toBeDisabled();
  });
});
