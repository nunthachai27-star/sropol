/* @vitest-environment jsdom */
/* @vitest-environment-options { "url": "http://localhost/" } */
// Vitals tab tests — Batch 2.1 onward uses ipd_nurse_note (port of
// HOSxPIPDPatientAdmitNurseNoteEntryForm). Schema fields: pulse / bp_systolic
// / bp_diastolic / respiratory_rate / spo2_ra / temperature / weight / height /
// note_date / note_time, plus the nurse_note_id PK minted via
// get_serialnumber.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import { SWRConfig } from 'swr';
import type { ReactNode } from 'react';

vi.mock('@/hooks/useBmsSession', () => ({ useBmsSession: vi.fn() }));
vi.mock('@/services/maternity-ward', () => ({
  getPatientNurseNotes: vi.fn(),
  upsertNurseNote: vi.fn(),
  deleteNurseNote: vi.fn(),
}));
// The Vitals "กราฟ" sub-tab (default) now renders a server-rendered PNG fetched
// via getIpdVitalSignChart. Override just that export so no real network call
// fires; keep the rest of the client module intact for any transitive imports.
vi.mock('@/lib/bms-browser-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/bms-browser-client')>();
  return { ...actual, getIpdVitalSignChart: vi.fn() };
});
import { useBmsSession } from '@/hooks/useBmsSession';
import { getPatientNurseNotes, upsertNurseNote, deleteNurseNote } from '@/services/maternity-ward';
import { getIpdVitalSignChart } from '@/lib/bms-browser-client';
import { VitalsTab } from '@/components/maternity/tabs/VitalsTab';

const mockBmsSession = useBmsSession as unknown as ReturnType<typeof vi.fn>;
const mockGet = getPatientNurseNotes as unknown as ReturnType<typeof vi.fn>;
const mockUpsert = upsertNurseNote as unknown as ReturnType<typeof vi.fn>;
const mockDelete = deleteNurseNote as unknown as ReturnType<typeof vi.fn>;
const mockChart = getIpdVitalSignChart as unknown as ReturnType<typeof vi.fn>;

// jsdom does not implement object-URL APIs; the chart turns its PNG blob into
// one for <img src>. Stub them so the success path renders deterministically.
URL.createObjectURL = vi.fn(() => 'blob:mock-url');
URL.revokeObjectURL = vi.fn();

function pngBlob() {
  return new Blob([new Uint8Array([137, 80, 78, 71])], { type: 'image/png' });
}
const cfg = { apiUrl: 'https://t.example/api', bearerToken: 'B', appIdentifier: 'X' };
const userInfo = { loginname: 'n1', fullname: 'N', hospcode: '10670' };
const wrapper = ({ children }: { children: ReactNode }) => (
  <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>{children}</SWRConfig>
);

// The VitalSignEntryDialog is a large clinical form (40+ ipd_nurse_note fields
// across Batches 2.1–2.3). Rendering it and firing a handful of controlled-input
// changes re-renders the whole form each time, which in jsdom pushes the
// heaviest tests (the multi-field "save posts …" cases) past Vitest's default
// 5s test budget under load — the failure surfaced as a flaky timeout that
// hopped between those tests run-to-run. The assertions are correct and the
// save fires synchronously; the tests just need room to finish their DOM work.
vi.setConfig({ testTimeout: 20000 });

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    nurse_note_id: 7,
    an: 'AN1',
    note_date: '2026-04-19',
    note_time: '08:00:00',
    temperature: 36.8,
    pulse: 88,
    heart_rate: 88,
    bp_systolic: 118,
    bp_diastolic: 76,
    respiratory_rate: 18,
    spo2_ra: 98,
    spo2_o2: null,
    pain_score: null,
    weight: 62,
    height: 158,
    bmi: null,
    bsa: null,
    waist: null,
    lung_text: null,
    heart_text: null,
    abdomen_text: null,
    fetal_heart_text: 'regular',
    cervical_open_size: 5,
    eff: 70,
    station: '0',
    note: null,
    ...overrides,
  };
}

async function openTable(rows: unknown[]) {
  mockBmsSession.mockReturnValue({ config: cfg, userInfo });
  mockGet.mockResolvedValue(rows);
  render(<VitalsTab an="AN1" />, { wrapper });
  const tableTab = await screen.findByRole('tab', { name: /^ตาราง$/ });
  fireEvent.click(tableTab);
}

beforeEach(() => {
  mockBmsSession.mockReset();
  mockGet.mockReset();
  mockUpsert.mockReset();
  mockDelete.mockReset();
  // Default: chart reports "no data" (a returned failure, not a throw) so the
  // default กราฟ tab in unrelated tests renders a stable panel without a real
  // fetch and without SWR retrying. Chart-specific tests override this.
  mockChart.mockReset();
  mockChart.mockResolvedValue({
    ok: false,
    messageCode: 500,
    message: 'ยังไม่มีข้อมูลสัญญาณชีพสำหรับผู้ป่วยรายนี้',
  });
});

describe('VitalsTab — basics', () => {
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

  it('renders error state when fetch fails', async () => {
    mockBmsSession.mockReturnValue({ config: cfg });
    mockGet.mockRejectedValue(new Error('BMS down'));
    render(<VitalsTab an="AN1" />, { wrapper });
    await waitFor(() => expect(screen.getByText(/โหลดไม่สำเร็จ.*BMS down/)).toBeInTheDocument());
  });
});

describe('VitalsTab — sub-tabs + Add button', () => {
  it('shows sub-tabs "กราฟ" then "ตาราง" in that order', async () => {
    mockBmsSession.mockReturnValue({ config: cfg, userInfo });
    mockGet.mockResolvedValue([makeRow()]);
    render(<VitalsTab an="AN1" />, { wrapper });
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /เพิ่มข้อมูลใหม่/ })).toBeInTheDocument(),
    );
    const tabs = screen.getAllByRole('tab');
    expect(tabs[0]).toHaveTextContent(/กราฟ/);
    expect(tabs[1]).toHaveTextContent(/^ตาราง$/);
  });

  it('default sub-tab is กราฟ', async () => {
    mockBmsSession.mockReturnValue({ config: cfg, userInfo });
    mockGet.mockResolvedValue([makeRow()]);
    render(<VitalsTab an="AN1" />, { wrapper });
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /เพิ่มข้อมูลใหม่/ })).toBeInTheDocument(),
    );
    expect(screen.getByRole('tab', { name: /กราฟ/ })).toHaveAttribute('aria-selected', 'true');
  });

  it('Add button sits in the same row as the tab list', async () => {
    mockBmsSession.mockReturnValue({ config: cfg, userInfo });
    mockGet.mockResolvedValue([makeRow()]);
    render(<VitalsTab an="AN1" />, { wrapper });
    const addBtn = await screen.findByRole('button', { name: /เพิ่มข้อมูลใหม่/ });
    const parent = addBtn.parentElement;
    expect(parent).not.toBeNull();
    expect(parent!.querySelector('[role="tablist"]')).not.toBeNull();
  });
});

describe('VitalsTab — chart view (server-rendered PNG)', () => {
  it('renders the chart <img> once the PNG loads', async () => {
    mockBmsSession.mockReturnValue({ config: cfg, userInfo, marketplaceToken: 'MKT' });
    mockGet.mockResolvedValue([makeRow()]);
    mockChart.mockResolvedValue({ ok: true, blob: pngBlob() });
    render(<VitalsTab an="AN1" />, { wrapper });
    const img = await screen.findByTestId('vital-sign-chart');
    expect(img.tagName).toBe('IMG');
    expect(img).toHaveAttribute('src', 'blob:mock-url');
  });

  it('fetches the chart for this AN with the session marketplace token', async () => {
    mockBmsSession.mockReturnValue({ config: cfg, userInfo, marketplaceToken: 'MKT' });
    mockGet.mockResolvedValue([makeRow()]);
    mockChart.mockResolvedValue({ ok: true, blob: pngBlob() });
    render(<VitalsTab an="AN1" />, { wrapper });
    await screen.findByTestId('vital-sign-chart');
    // (config, an, chart_type_id default = 2 = chart page 1, marketplaceToken)
    expect(mockChart).toHaveBeenCalledWith(cfg, 'AN1', 2, 'MKT');
  });

  it('shows an actionable Thai message (not a crash) when there is no vital data', async () => {
    mockBmsSession.mockReturnValue({ config: cfg, userInfo, marketplaceToken: null });
    mockGet.mockResolvedValue([]);
    mockChart.mockResolvedValue({
      ok: false,
      messageCode: 500,
      message: 'ยังไม่มีข้อมูลสัญญาณชีพสำหรับผู้ป่วยรายนี้',
    });
    render(<VitalsTab an="AN1" />, { wrapper });
    const panel = await screen.findByTestId('vital-sign-chart-error');
    expect(panel).toHaveTextContent(/ยังไม่มีข้อมูลสัญญาณชีพ/);
  });

  it('offers a retry when the chart fetch throws a transport error', async () => {
    mockBmsSession.mockReturnValue({ config: cfg, userInfo, marketplaceToken: null });
    mockGet.mockResolvedValue([makeRow()]);
    mockChart.mockRejectedValue(new Error('ไม่สามารถเชื่อมต่อบริการสร้างกราฟสัญญาณชีพได้'));
    render(<VitalsTab an="AN1" />, { wrapper });
    const panel = await screen.findByTestId('vital-sign-chart-error');
    expect(panel).toHaveTextContent(/ไม่สามารถเชื่อมต่อ/);
    expect(within(panel).getByRole('button', { name: /ลองใหม่/ })).toBeInTheDocument();
  });
});

describe('VitalsTab — entry dialog (Batch 2.1)', () => {
  it('clicking + เพิ่มข้อมูลใหม่ opens a modal dialog', async () => {
    mockBmsSession.mockReturnValue({ config: cfg, userInfo });
    mockGet.mockResolvedValue([]);
    render(<VitalsTab an="AN1" />, { wrapper });
    const addBtn = await screen.findByRole('button', { name: /เพิ่มข้อมูลใหม่/ });
    fireEvent.click(addBtn);
    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument());
  });

  it('dialog shows the Thai section headings for Batch 2.1 scope', async () => {
    mockBmsSession.mockReturnValue({ config: cfg, userInfo });
    mockGet.mockResolvedValue([]);
    render(<VitalsTab an="AN1" />, { wrapper });
    fireEvent.click(await screen.findByRole('button', { name: /เพิ่มข้อมูลใหม่/ }));
    const dlg = await screen.findByRole('dialog');
    for (const heading of [
      'วันที่และเวลา',
      'สัญญาณชีพหลัก',
      'ร่างกาย',
      'การตรวจร่างกาย',
      'PV',
      'บันทึกเพิ่มเติม',
    ]) {
      expect(within(dlg).getByText(heading)).toBeInTheDocument();
    }
  });

  it('dialog exposes the nurse-note column names as aria-labels', async () => {
    mockBmsSession.mockReturnValue({ config: cfg, userInfo });
    mockGet.mockResolvedValue([]);
    render(<VitalsTab an="AN1" />, { wrapper });
    fireEvent.click(await screen.findByRole('button', { name: /เพิ่มข้อมูลใหม่/ }));
    const dlg = await screen.findByRole('dialog');
    const q = within(dlg);
    for (const field of [
      'note_date',
      'note_time',
      'temperature',
      'pulse',
      'heart_rate',
      'bp_systolic',
      'bp_diastolic',
      'respiratory_rate',
      'spo2_ra',
      'spo2_o2',
      'pain_score',
      'weight',
      'height',
      'bmi',
      'bsa',
      'waist',
      'lung_text',
      'heart_text',
      'abdomen_text',
      'fetal_heart_text',
      'cervical_open_size',
      'eff',
      'station',
      'note',
    ]) {
      expect(q.getByLabelText(field)).toBeInTheDocument();
    }
  });

  it('save posts nurse-note fields via upsertNurseNote', async () => {
    mockBmsSession.mockReturnValue({ config: cfg, userInfo });
    mockGet.mockResolvedValue([]);
    mockUpsert.mockResolvedValue({});
    render(<VitalsTab an="AN1" />, { wrapper });
    fireEvent.click(await screen.findByRole('button', { name: /เพิ่มข้อมูลใหม่/ }));
    const dlg = await screen.findByRole('dialog');
    fireEvent.change(within(dlg).getByLabelText('pulse'), { target: { value: '92' } });
    fireEvent.change(within(dlg).getByLabelText('temperature'), { target: { value: '37.4' } });
    fireEvent.click(within(dlg).getByRole('button', { name: /^บันทึก$/ }));
    await waitFor(() => expect(mockUpsert).toHaveBeenCalled());
    const body = mockUpsert.mock.calls[0][3] as Record<string, unknown>;
    expect(body).toMatchObject({ pulse: 92, temperature: 37.4 });
  });

  it('save is blocked when no clinical value is entered', async () => {
    mockBmsSession.mockReturnValue({ config: cfg, userInfo });
    mockGet.mockResolvedValue([]);
    render(<VitalsTab an="AN1" />, { wrapper });
    fireEvent.click(await screen.findByRole('button', { name: /เพิ่มข้อมูลใหม่/ }));
    const dlg = await screen.findByRole('dialog');
    fireEvent.click(within(dlg).getByRole('button', { name: /^บันทึก$/ }));
    expect(mockUpsert).not.toHaveBeenCalled();
    expect(within(dlg).getByRole('alert')).toHaveTextContent(/กรุณากรอกข้อมูลอย่างน้อย/);
  });

  it('edit opens the dialog pre-filled with the nurse-note row', async () => {
    await openTable([makeRow({ pulse: 88, temperature: 37.2 })]);
    await waitFor(() => expect(screen.getByText('88')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /^แก้ไข$/ }));
    const dlg = await screen.findByRole('dialog');
    expect(within(dlg).getByLabelText('pulse')).toHaveValue('88');
    expect(within(dlg).getByLabelText('temperature')).toHaveValue('37.2');
  });

  it('marks temperature ≥38 as abnormal', async () => {
    mockBmsSession.mockReturnValue({ config: cfg, userInfo });
    mockGet.mockResolvedValue([]);
    render(<VitalsTab an="AN1" />, { wrapper });
    fireEvent.click(await screen.findByRole('button', { name: /เพิ่มข้อมูลใหม่/ }));
    const dlg = await screen.findByRole('dialog');
    fireEvent.change(within(dlg).getByLabelText('temperature'), { target: { value: '38.5' } });
    expect(within(dlg).getByTestId('abnormal-temperature')).toBeInTheDocument();
  });

  it('marks pulse <60 or >100 as abnormal', async () => {
    mockBmsSession.mockReturnValue({ config: cfg, userInfo });
    mockGet.mockResolvedValue([]);
    render(<VitalsTab an="AN1" />, { wrapper });
    fireEvent.click(await screen.findByRole('button', { name: /เพิ่มข้อมูลใหม่/ }));
    const dlg = await screen.findByRole('dialog');
    fireEvent.change(within(dlg).getByLabelText('pulse'), { target: { value: '115' } });
    expect(within(dlg).getByTestId('abnormal-pulse')).toBeInTheDocument();
  });

  it('marks BP sys ≥140 / dia ≥90 as abnormal', async () => {
    mockBmsSession.mockReturnValue({ config: cfg, userInfo });
    mockGet.mockResolvedValue([]);
    render(<VitalsTab an="AN1" />, { wrapper });
    fireEvent.click(await screen.findByRole('button', { name: /เพิ่มข้อมูลใหม่/ }));
    const dlg = await screen.findByRole('dialog');
    fireEvent.change(within(dlg).getByLabelText('bp_systolic'), { target: { value: '150' } });
    fireEvent.change(within(dlg).getByLabelText('bp_diastolic'), { target: { value: '95' } });
    expect(within(dlg).getByTestId('abnormal-bp_systolic')).toBeInTheDocument();
    expect(within(dlg).getByTestId('abnormal-bp_diastolic')).toBeInTheDocument();
  });

  it('delete inside dialog calls deleteNurseNote after confirm', async () => {
    const origConfirm = window.confirm;
    window.confirm = vi.fn().mockReturnValue(true);
    mockDelete.mockResolvedValue(undefined);
    await openTable([makeRow()]);
    await waitFor(() => expect(screen.getByText('88')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /^แก้ไข$/ }));
    const dlg = await screen.findByRole('dialog');
    fireEvent.click(within(dlg).getByRole('button', { name: /^ลบ$/ }));
    expect(window.confirm).toHaveBeenCalled();
    await waitFor(() => expect(mockDelete).toHaveBeenCalledWith(cfg, userInfo, 7, '10670'));
    window.confirm = origConfirm;
  });

  it('dialog exposes the extended-vitals + fluid I/O + text-block fields (Batches 2.2 + 2.3)', async () => {
    mockBmsSession.mockReturnValue({ config: cfg, userInfo });
    mockGet.mockResolvedValue([]);
    render(<VitalsTab an="AN1" />, { wrapper });
    fireEvent.click(await screen.findByRole('button', { name: /เพิ่มข้อมูลใหม่/ }));
    const dlg = await screen.findByRole('dialog');
    const q = within(dlg);
    for (const field of [
      // Extended vitals
      'ibps',
      'ibpd',
      'imap',
      'etco2',
      'cvp',
      'icp',
      'pvc',
      // Scores + oxygen flags
      'sedation_score',
      'news2_score',
      'sos_score',
      'has_hypercapnic_rf',
      'has_oxygen_ventilator',
      // Biometric
      'weight_loss',
      // Fluid intake
      'fluid_intake_oral',
      'fluid_intake_parenteral',
      'fluid_intake_1',
      'fluid_intake_1_int',
      'fluid_intake_2',
      'fluid_intake_2_int',
      'fluid_intake_3',
      'fluid_intake_3_int',
      'fluid_intake_4',
      'fluid_intake_4_int',
      'fluid_intake_medication1',
      'fluid_intake_medication1_int',
      'fluid_intake_medication2',
      'fluid_intake_medication2_int',
      'fluid_intake_medication3',
      'fluid_intake_medication3_int',
      // Fluid output
      'fluid_output_urine',
      'fluid_output_emesis',
      'fluid_output_drainage',
      'fluid_output_drainage_2',
      'fluid_output_drainage_3',
      'fluid_output_drainage_4',
      'fluid_output_aspiration',
      'fluid_blood_loss',
      // Stool / urine
      'urine_qty',
      'urine_qty_unit',
      'stools_qty',
      'stools_qty_unit',
      // Text blocks
      'ipd_nurse_note_diet_text',
      'medication_text',
      'bottom_note_text',
    ]) {
      expect(q.getByLabelText(field)).toBeInTheDocument();
    }
  });

  it('save posts extended-scope fields (fluid I/O, scores, text) via upsertNurseNote', async () => {
    mockBmsSession.mockReturnValue({ config: cfg, userInfo });
    mockGet.mockResolvedValue([]);
    mockUpsert.mockResolvedValue({});
    render(<VitalsTab an="AN1" />, { wrapper });
    fireEvent.click(await screen.findByRole('button', { name: /เพิ่มข้อมูลใหม่/ }));
    const dlg = await screen.findByRole('dialog');
    fireEvent.change(within(dlg).getByLabelText('fluid_intake_oral'), { target: { value: '250' } });
    fireEvent.change(within(dlg).getByLabelText('fluid_output_urine'), {
      target: { value: '180' },
    });
    fireEvent.change(within(dlg).getByLabelText('news2_score'), { target: { value: '3' } });
    fireEvent.change(within(dlg).getByLabelText('has_oxygen_ventilator'), {
      target: { value: 'Y' },
    });
    fireEvent.change(within(dlg).getByLabelText('medication_text'), {
      target: { value: 'paracetamol' },
    });
    fireEvent.click(within(dlg).getByRole('button', { name: /^บันทึก$/ }));
    await waitFor(() => expect(mockUpsert).toHaveBeenCalled());
    const body = mockUpsert.mock.calls[0][3] as Record<string, unknown>;
    expect(body).toMatchObject({
      fluid_intake_oral: 250,
      fluid_output_urine: 180,
      news2_score: 3,
      has_oxygen_ventilator: 'Y',
      medication_text: 'paracetamol',
    });
  });

  it('cancel closes the dialog without calling upsert', async () => {
    await openTable([makeRow()]);
    await waitFor(() => expect(screen.getByText('88')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /^แก้ไข$/ }));
    const dlg = await screen.findByRole('dialog');
    fireEvent.click(within(dlg).getByRole('button', { name: /^ยกเลิก$/ }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(mockUpsert).not.toHaveBeenCalled();
  });
});

describe('VitalsTab — table (after switching to ตาราง)', () => {
  it('renders table rows from data', async () => {
    await openTable([makeRow()]);
    await waitFor(() => expect(screen.getByText('88')).toBeInTheDocument());
  });

  it('renders empty state when data is []', async () => {
    await openTable([]);
    await waitFor(() => expect(screen.getByText(/ไม่พบข้อมูล/)).toBeInTheDocument());
  });
});
