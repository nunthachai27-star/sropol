/* @vitest-environment jsdom */
/* @vitest-environment-options { "url": "http://localhost/" } */
// Partograph tab tests. Batch-1 port of HOSxPIPDLabourPartographEntryFormUnit:
// replaces the 5-field inline editor with a modal dialog that exposes every
// field in the Delphi form, grouped by clinical section.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import { SWRConfig } from 'swr';
import type { ReactNode } from 'react';

vi.mock('@/hooks/useBmsSession', () => ({ useBmsSession: vi.fn() }));
vi.mock('@/services/maternity-ward', () => ({
  getPatientPartograph: vi.fn(),
  upsertPartograph: vi.fn(),
  deletePartograph: vi.fn(),
}));
import { useBmsSession } from '@/hooks/useBmsSession';
import {
  getPatientPartograph,
  upsertPartograph,
  deletePartograph,
} from '@/services/maternity-ward';
import { PartographTab } from '@/components/maternity/tabs/PartographTab';

const mockBmsSession = useBmsSession as unknown as ReturnType<typeof vi.fn>;
const mockGet = getPatientPartograph as unknown as ReturnType<typeof vi.fn>;
const mockUpsert = upsertPartograph as unknown as ReturnType<typeof vi.fn>;
const mockDelete = deletePartograph as unknown as ReturnType<typeof vi.fn>;
const cfg = { apiUrl: 'https://t.example/api', bearerToken: 'B', appIdentifier: 'X' };
const userInfo = { loginname: 'n1', fullname: 'N', hospcode: '10670' };
const wrapper = ({ children }: { children: ReactNode }) => (
  <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>{children}</SWRConfig>
);

// Shape matches the PartographRow type; used by several tests.
function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    ipt_labour_partograph_id: 1,
    ipt_labour_id: 10,
    an: 'AN1',
    observe_datetime: '2026-04-19T08:00:00',
    hour_no: 1,
    fetal_heart_rate: 140,
    amniotic_fluid: null,
    moulding: null,
    cervical_dilation_cm: 4,
    descent_of_head: null,
    contraction_per_10min: 3,
    contraction_duration_sec: null,
    contraction_strength: null,
    oxytocin_uml: null,
    oxytocin_drops_min: null,
    drugs_iv_fluids: null,
    pulse: null,
    bp_systolic: 120,
    bp_diastolic: 70,
    temperature: null,
    urine_volume_ml: null,
    urine_protein: null,
    urine_glucose: null,
    urine_acetone: null,
    note: null,
    ...overrides,
  };
}

beforeEach(() => {
  mockBmsSession.mockReset();
  mockGet.mockReset();
  mockUpsert.mockReset();
  mockDelete.mockReset();
});

describe('PartographTab (list + basics)', () => {
  it('shows no-config message when BMS session absent', () => {
    mockBmsSession.mockReturnValue({ config: null });
    render(<PartographTab an="AN1" />, { wrapper });
    expect(screen.getByText(/ไม่พร้อมใช้งาน/)).toBeInTheDocument();
  });

  it('shows loading', () => {
    mockBmsSession.mockReturnValue({ config: cfg, userInfo });
    mockGet.mockReturnValue(new Promise(() => {}));
    render(<PartographTab an="AN1" />, { wrapper });
    expect(screen.getByText(/กำลังโหลด/)).toBeInTheDocument();
  });

  it('renders table rows from data (after switching to ตาราง)', async () => {
    await openTable([makeRow()]);
    await waitFor(() => expect(screen.getByText('140')).toBeInTheDocument(), { timeout: 2000 });
    expect(screen.getByText('4')).toBeInTheDocument();
  });

  it('renders empty state when data is [] (after switching to ตาราง)', async () => {
    await openTable([]);
    await waitFor(() => expect(screen.getByText(/ไม่พบข้อมูล/)).toBeInTheDocument(), {
      timeout: 2000,
    });
  });

  it('renders error state when fetch fails', async () => {
    mockBmsSession.mockReturnValue({ config: cfg, userInfo });
    mockGet.mockRejectedValue(new Error('BMS down'));
    render(<PartographTab an="AN1" />, { wrapper });
    await waitFor(() => expect(screen.getByText(/โหลดไม่สำเร็จ.*BMS down/)).toBeInTheDocument(), {
      timeout: 2000,
    });
  });
});

describe('PartographTab entry dialog — Batch 1', () => {
  it('clicking + เพิ่มเวลาใหม่ opens a modal dialog', async () => {
    mockBmsSession.mockReturnValue({ config: cfg, userInfo });
    mockGet.mockResolvedValue([]);
    render(<PartographTab an="AN1" />, { wrapper });
    const addBtn = await screen.findByRole('button', { name: /เพิ่มเวลาใหม่/ });
    fireEvent.click(addBtn);
    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument());
  });

  it('dialog shows all 7 Thai section headings', async () => {
    mockBmsSession.mockReturnValue({ config: cfg, userInfo });
    mockGet.mockResolvedValue([]);
    render(<PartographTab an="AN1" />, { wrapper });
    const addBtn = await screen.findByRole('button', { name: /เพิ่มเวลาใหม่/ });
    fireEvent.click(addBtn);
    const dlg = await screen.findByRole('dialog');
    const q = within(dlg);
    for (const heading of [
      'ทารกในครรภ์',
      'ความก้าวหน้าของการคลอด',
      'การหดรัดตัวของมดลูก',
      'ยาและสารน้ำ',
      'สัญญาณชีพมารดา',
      'ปัสสาวะ',
      'บันทึกเพิ่มเติม',
    ]) {
      expect(q.getByText(heading)).toBeInTheDocument();
    }
  });

  it('dialog exposes every editable clinical field (21 inputs)', async () => {
    mockBmsSession.mockReturnValue({ config: cfg, userInfo });
    mockGet.mockResolvedValue([]);
    render(<PartographTab an="AN1" />, { wrapper });
    const addBtn = await screen.findByRole('button', { name: /เพิ่มเวลาใหม่/ });
    fireEvent.click(addBtn);
    const dlg = await screen.findByRole('dialog');
    const q = within(dlg);
    // Each editable column from HOSxPIPDLabourPartographEntryFormUnit.
    // observe_datetime is rendered as a BeDateTimeInput → two labelled inputs
    // ("observe_datetime date" + "observe_datetime time").
    for (const field of [
      'observe_datetime date',
      'observe_datetime time',
      'fetal_heart_rate',
      'amniotic_fluid',
      'moulding',
      'cervical_dilation_cm',
      'descent_of_head',
      'contraction_per_10min',
      'contraction_duration_sec',
      'contraction_strength',
      'oxytocin_uml',
      'oxytocin_drops_min',
      'drugs_iv_fluids',
      'pulse',
      'bp_systolic',
      'bp_diastolic',
      'temperature',
      'urine_volume_ml',
      'urine_protein',
      'urine_acetone',
      'urine_glucose',
      'note',
    ]) {
      expect(q.getByLabelText(field)).toBeInTheDocument();
    }
  });

  it('save posts entered fields via upsertPartograph (new row)', async () => {
    mockBmsSession.mockReturnValue({ config: cfg, userInfo });
    mockGet.mockResolvedValue([]);
    mockUpsert.mockResolvedValue({});
    render(<PartographTab an="AN1" />, { wrapper });
    const addBtn = await screen.findByRole('button', { name: /เพิ่มเวลาใหม่/ });
    fireEvent.click(addBtn);
    const dlg = await screen.findByRole('dialog');
    fireEvent.change(within(dlg).getByLabelText('fetal_heart_rate'), { target: { value: '145' } });
    fireEvent.change(within(dlg).getByLabelText('cervical_dilation_cm'), {
      target: { value: '5' },
    });
    fireEvent.change(within(dlg).getByLabelText('note'), { target: { value: 'ok' } });
    fireEvent.click(within(dlg).getByRole('button', { name: /^บันทึก$/ }));
    await waitFor(() => expect(mockUpsert).toHaveBeenCalled());
    const body = mockUpsert.mock.calls[0][3] as Record<string, unknown>;
    expect(body).toMatchObject({
      fetal_heart_rate: 145,
      cervical_dilation_cm: 5,
      note: 'ok',
    });
  });

  it('save is blocked when no observation value is entered (only datetime)', async () => {
    mockBmsSession.mockReturnValue({ config: cfg, userInfo });
    mockGet.mockResolvedValue([]);
    render(<PartographTab an="AN1" />, { wrapper });
    const addBtn = await screen.findByRole('button', { name: /เพิ่มเวลาใหม่/ });
    fireEvent.click(addBtn);
    const dlg = await screen.findByRole('dialog');
    fireEvent.click(within(dlg).getByRole('button', { name: /^บันทึก$/ }));
    // Save should NOT be called — form still open, error message visible.
    expect(mockUpsert).not.toHaveBeenCalled();
    expect(within(dlg).getByText(/กรุณากรอกข้อมูลอย่างน้อย/)).toBeInTheDocument();
  });

  it('edit opens the dialog pre-filled with the row values', async () => {
    await openTable([makeRow()]);
    await waitFor(() => expect(screen.getByText('140')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /^แก้ไข$/ }));
    const dlg = await screen.findByRole('dialog');
    expect(within(dlg).getByLabelText('fetal_heart_rate')).toHaveValue('140');
    expect(within(dlg).getByLabelText('cervical_dilation_cm')).toHaveValue('4');
    expect(within(dlg).getByLabelText('bp_systolic')).toHaveValue('120');
  });

  it('cancel closes the dialog without calling upsert', async () => {
    await openTable([makeRow()]);
    await waitFor(() => expect(screen.getByText('140')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /^แก้ไข$/ }));
    const dlg = await screen.findByRole('dialog');
    fireEvent.click(within(dlg).getByRole('button', { name: /^ยกเลิก$/ }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it('Copy-Prev fills maternal vitals + urine from the newest prior row', async () => {
    mockBmsSession.mockReturnValue({ config: cfg, userInfo });
    mockGet.mockResolvedValue([
      makeRow({
        ipt_labour_partograph_id: 2,
        observe_datetime: '2026-04-19T10:00:00',
        pulse: 88,
        bp_systolic: 118,
        bp_diastolic: 72,
        temperature: 37.1,
        urine_volume_ml: 250,
        urine_protein: 'negative',
      }),
    ]);
    render(<PartographTab an="AN1" />, { wrapper });
    const addBtn = await screen.findByRole('button', { name: /เพิ่มเวลาใหม่/ });
    fireEvent.click(addBtn);
    const dlg = await screen.findByRole('dialog');
    fireEvent.click(within(dlg).getByRole('button', { name: /คัดลอกครั้งก่อน/ }));
    expect(within(dlg).getByLabelText('pulse')).toHaveValue('88');
    expect(within(dlg).getByLabelText('bp_systolic')).toHaveValue('118');
    expect(within(dlg).getByLabelText('bp_diastolic')).toHaveValue('72');
    expect(within(dlg).getByLabelText('temperature')).toHaveValue('37.1');
    expect(within(dlg).getByLabelText('urine_volume_ml')).toHaveValue('250');
    expect(within(dlg).getByLabelText('urine_protein')).toHaveValue('negative');
  });

  it('delete button is hidden when adding, visible when editing', async () => {
    await openTable([makeRow()]);
    await waitFor(() => expect(screen.getByText('140')).toBeInTheDocument());
    // Add → no delete inside dialog
    fireEvent.click(screen.getByRole('button', { name: /เพิ่มเวลาใหม่/ }));
    let dlg = await screen.findByRole('dialog');
    expect(within(dlg).queryByRole('button', { name: /^ลบ$/ })).not.toBeInTheDocument();
    fireEvent.click(within(dlg).getByRole('button', { name: /^ยกเลิก$/ }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    // Edit → delete visible
    fireEvent.click(screen.getByRole('button', { name: /^แก้ไข$/ }));
    dlg = await screen.findByRole('dialog');
    expect(within(dlg).getByRole('button', { name: /^ลบ$/ })).toBeInTheDocument();
  });

  it('delete inside dialog calls deletePartograph after confirm', async () => {
    const origConfirm = window.confirm;
    window.confirm = vi.fn().mockReturnValue(true);
    mockDelete.mockResolvedValue(undefined);
    await openTable([makeRow()]);
    await waitFor(() => expect(screen.getByText('140')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /^แก้ไข$/ }));
    const dlg = await screen.findByRole('dialog');
    fireEvent.click(within(dlg).getByRole('button', { name: /^ลบ$/ }));
    expect(window.confirm).toHaveBeenCalled();
    await waitFor(() => expect(mockDelete).toHaveBeenCalledWith(cfg, userInfo, 1, '10670'));
    window.confirm = origConfirm;
  });
});

// Helper: render, open the Add dialog via the always-visible header button.
// Works regardless of which sub-tab is active (the Add button sits in the
// sub-tab header row since Batch-4 / user feedback).
async function openAddDialog(rows: unknown[] = []) {
  mockBmsSession.mockReturnValue({ config: cfg, userInfo });
  mockGet.mockResolvedValue(rows);
  render(<PartographTab an="AN1" />, { wrapper });
  const addBtn = await screen.findByRole('button', { name: /เพิ่มเวลาใหม่/ });
  fireEvent.click(addBtn);
  return await screen.findByRole('dialog');
}

// Helper: render, switch to the ตาราง sub-tab so table-content assertions
// (แก้ไข buttons, row cells, ไม่พบข้อมูล) become visible.
async function openTable(rows: unknown[]) {
  mockBmsSession.mockReturnValue({ config: cfg, userInfo });
  mockGet.mockResolvedValue(rows);
  render(<PartographTab an="AN1" />, { wrapper });
  // Wait for Tabs to mount, then switch to ตาราง.
  const tableTab = await screen.findByRole('tab', { name: /^ตาราง$/ });
  fireEvent.click(tableTab);
}

// observe_datetime is now a BeDateTimeInput (BE date + 24h time), which renders
// TWO text inputs — aria-labels "observe_datetime date" and
// "observe_datetime time" — that commit their parsed ISO value on blur, not on
// keystroke. Drive them the way a nurse does: type the BE date + 24h time then
// blur to commit. isoLocal is a datetime-local string 'YYYY-MM-DDTHH:mm'.
function setObserveDatetime(dlg: HTMLElement, isoLocal: string) {
  const [datePart, timePart] = isoLocal.split('T');
  const [y, mo, d] = datePart.split('-').map(Number);
  const beDate = `${d}/${mo}/${y + 543}`; // ISO Gregorian → BE display (D/M/YYYY+543)
  const dateEl = within(dlg).getByLabelText('observe_datetime date');
  fireEvent.change(dateEl, { target: { value: beDate } });
  fireEvent.blur(dateEl);
  const timeEl = within(dlg).getByLabelText('observe_datetime time');
  fireEvent.change(timeEl, { target: { value: timePart } });
  fireEvent.blur(timeEl);
}

describe('PartographTab — abnormal-range highlighting (Batch 2)', () => {
  it('marks FHR abnormal when <110 or >160', async () => {
    const dlg = await openAddDialog();
    const fhr = within(dlg).getByLabelText('fetal_heart_rate');
    fireEvent.change(fhr, { target: { value: '175' } });
    expect(within(dlg).getByTestId('abnormal-fetal_heart_rate')).toBeInTheDocument();
    fireEvent.change(fhr, { target: { value: '140' } });
    expect(within(dlg).queryByTestId('abnormal-fetal_heart_rate')).not.toBeInTheDocument();
  });

  it('marks Pulse abnormal when <60 or >100', async () => {
    const dlg = await openAddDialog();
    const p = within(dlg).getByLabelText('pulse');
    fireEvent.change(p, { target: { value: '110' } });
    expect(within(dlg).getByTestId('abnormal-pulse')).toBeInTheDocument();
  });

  it('marks BP systolic ≥140 and diastolic ≥90 as abnormal', async () => {
    const dlg = await openAddDialog();
    fireEvent.change(within(dlg).getByLabelText('bp_systolic'), { target: { value: '145' } });
    fireEvent.change(within(dlg).getByLabelText('bp_diastolic'), { target: { value: '95' } });
    expect(within(dlg).getByTestId('abnormal-bp_systolic')).toBeInTheDocument();
    expect(within(dlg).getByTestId('abnormal-bp_diastolic')).toBeInTheDocument();
  });

  it('marks Temperature ≥38 as abnormal', async () => {
    const dlg = await openAddDialog();
    fireEvent.change(within(dlg).getByLabelText('temperature'), { target: { value: '38.5' } });
    expect(within(dlg).getByTestId('abnormal-temperature')).toBeInTheDocument();
  });
});

describe('PartographTab — status panel (Batch 2)', () => {
  it('shows the observation count + latent phase when no cervical reading', async () => {
    const dlg = await openAddDialog([
      makeRow({
        ipt_labour_partograph_id: 2,
        cervical_dilation_cm: 2,
        observe_datetime: '2026-04-19T08:00:00',
      }),
      makeRow({
        ipt_labour_partograph_id: 3,
        cervical_dilation_cm: null,
        observe_datetime: '2026-04-19T09:00:00',
      }),
    ]);
    const panel = within(dlg).getByTestId('partograph-status');
    expect(panel).toHaveTextContent(/2 รายการ/);
    expect(panel).toHaveTextContent(/LATENT/);
  });

  it('flips to ACTIVE phase when the current dilation is ≥4', async () => {
    const dlg = await openAddDialog();
    fireEvent.change(within(dlg).getByLabelText('cervical_dilation_cm'), {
      target: { value: '5' },
    });
    const panel = within(dlg).getByTestId('partograph-status');
    expect(panel).toHaveTextContent(/ACTIVE/);
  });
});

describe('PartographTab — auto hour_no (Batch 2)', () => {
  it('computes hour_no automatically from observe_datetime vs earliest prior', async () => {
    // Earliest prior observation at 08:00 → an observation at 11:00 is hour 4.
    const dlg = await openAddDialog([
      makeRow({ ipt_labour_partograph_id: 9, observe_datetime: '2026-04-19T08:00:00' }),
    ]);
    setObserveDatetime(dlg, '2026-04-19T11:00');
    expect(within(dlg).getByLabelText('hour_no')).toHaveValue('4');
  });

  it('respects a user override of hour_no', async () => {
    const dlg = await openAddDialog([
      makeRow({ ipt_labour_partograph_id: 9, observe_datetime: '2026-04-19T08:00:00' }),
    ]);
    setObserveDatetime(dlg, '2026-04-19T11:00');
    fireEvent.change(within(dlg).getByLabelText('hour_no'), { target: { value: '7' } });
    expect(within(dlg).getByLabelText('hour_no')).toHaveValue('7');
  });
});

describe('PartographTab — BeforePost validation (Batch 2)', () => {
  it('blocks save when observe_datetime is in the future', async () => {
    const dlg = await openAddDialog();
    fireEvent.change(within(dlg).getByLabelText('fetal_heart_rate'), { target: { value: '140' } });
    // Pick a datetime clearly in the future.
    const future = new Date(Date.now() + 7 * 24 * 3600_000);
    const p = (n: number) => n.toString().padStart(2, '0');
    const val = `${future.getFullYear()}-${p(future.getMonth() + 1)}-${p(future.getDate())}T${p(future.getHours())}:${p(future.getMinutes())}`;
    setObserveDatetime(dlg, val);
    fireEvent.click(within(dlg).getByRole('button', { name: /^บันทึก$/ }));
    expect(mockUpsert).not.toHaveBeenCalled();
    expect(within(dlg).getByRole('alert')).toHaveTextContent(/อนาคต/);
  });

  it('blocks save when only one of oxytocin U/mL or drops/min is set', async () => {
    const dlg = await openAddDialog();
    fireEvent.change(within(dlg).getByLabelText('oxytocin_uml'), { target: { value: '2.5' } });
    // leave drops/min empty
    fireEvent.click(within(dlg).getByRole('button', { name: /^บันทึก$/ }));
    expect(mockUpsert).not.toHaveBeenCalled();
    expect(within(dlg).getByRole('alert')).toHaveTextContent(/Oxytocin/i);
  });

  it('blocks save when contractions > 0 but duration/strength missing', async () => {
    const dlg = await openAddDialog();
    fireEvent.change(within(dlg).getByLabelText('contraction_per_10min'), {
      target: { value: '3' },
    });
    // leave duration + strength empty
    fireEvent.click(within(dlg).getByRole('button', { name: /^บันทึก$/ }));
    expect(mockUpsert).not.toHaveBeenCalled();
    expect(within(dlg).getByRole('alert')).toHaveTextContent(/การหด/);
  });
});

describe('PartographTab — soft confirmations (Batch 2)', () => {
  it('prompts and aborts when cervical dilation decreases vs the prior observation', async () => {
    const origConfirm = window.confirm;
    window.confirm = vi.fn().mockReturnValue(false);
    // Prior has cervix=6 at t-2h. User enters a new observation with cervix=4.
    const dlg = await openAddDialog([
      makeRow({
        ipt_labour_partograph_id: 5,
        cervical_dilation_cm: 6,
        observe_datetime: '2026-04-19T08:00:00',
      }),
    ]);
    fireEvent.change(within(dlg).getByLabelText('cervical_dilation_cm'), {
      target: { value: '4' },
    });
    setObserveDatetime(dlg, '2026-04-19T09:30');
    fireEvent.click(within(dlg).getByRole('button', { name: /^บันทึก$/ }));
    expect(window.confirm).toHaveBeenCalled();
    expect((window.confirm as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0]).toMatch(
      /ลดลง/,
    );
    expect(mockUpsert).not.toHaveBeenCalled();
    window.confirm = origConfirm;
  });

  it('prompts when the previous observation is older than 2 hours', async () => {
    const origConfirm = window.confirm;
    window.confirm = vi.fn().mockReturnValue(false);
    const dlg = await openAddDialog([
      makeRow({ ipt_labour_partograph_id: 5, observe_datetime: '2026-04-19T02:00:00' }),
    ]);
    fireEvent.change(within(dlg).getByLabelText('cervical_dilation_cm'), {
      target: { value: '5' },
    });
    setObserveDatetime(dlg, '2026-04-19T10:00');
    fireEvent.click(within(dlg).getByRole('button', { name: /^บันทึก$/ }));
    expect(window.confirm).toHaveBeenCalled();
    expect((window.confirm as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0]).toMatch(
      /2 ชั่วโมง/,
    );
    expect(mockUpsert).not.toHaveBeenCalled();
    window.confirm = origConfirm;
  });

  it('prompts when another observation exists within 5 minutes', async () => {
    const origConfirm = window.confirm;
    window.confirm = vi.fn().mockReturnValue(false);
    const dlg = await openAddDialog([
      makeRow({ ipt_labour_partograph_id: 5, observe_datetime: '2026-04-19T10:00:00' }),
    ]);
    fireEvent.change(within(dlg).getByLabelText('cervical_dilation_cm'), {
      target: { value: '5' },
    });
    setObserveDatetime(dlg, '2026-04-19T10:03');
    fireEvent.click(within(dlg).getByRole('button', { name: /^บันทึก$/ }));
    expect(window.confirm).toHaveBeenCalled();
    expect((window.confirm as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0]).toMatch(
      /5 นาที/,
    );
    expect(mockUpsert).not.toHaveBeenCalled();
    window.confirm = origConfirm;
  });
});

describe('PartographTab — chart sub-tab (Batch 3)', () => {
  it('shows sub-tabs "กราฟ" then "ตาราง" in that order', async () => {
    mockBmsSession.mockReturnValue({ config: cfg, userInfo });
    mockGet.mockResolvedValue([makeRow()]);
    render(<PartographTab an="AN1" />, { wrapper });
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /เพิ่มเวลาใหม่/ })).toBeInTheDocument(),
    );
    const tabs = screen.getAllByRole('tab');
    expect(tabs[0]).toHaveTextContent(/กราฟ/);
    expect(tabs[1]).toHaveTextContent(/^ตาราง$/);
  });

  it('default sub-tab is กราฟ (chart)', async () => {
    mockBmsSession.mockReturnValue({ config: cfg, userInfo });
    mockGet.mockResolvedValue([makeRow()]);
    render(<PartographTab an="AN1" />, { wrapper });
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /เพิ่มเวลาใหม่/ })).toBeInTheDocument(),
    );
    expect(screen.getByRole('tab', { name: /กราฟ/ })).toHaveAttribute('aria-selected', 'true');
  });

  it('Add (+ เพิ่มเวลาใหม่) button is present next to the sub-tab header on the default chart view', async () => {
    mockBmsSession.mockReturnValue({ config: cfg, userInfo });
    mockGet.mockResolvedValue([makeRow()]);
    render(<PartographTab an="AN1" />, { wrapper });
    // The chart tab is the default, so the Add button must be reachable
    // WITHOUT first switching to ตาราง. Structurally, the button's parent
    // must contain the tab list.
    const addBtn = await screen.findByRole('button', { name: /เพิ่มเวลาใหม่/ });
    const parent = addBtn.parentElement;
    expect(parent).not.toBeNull();
    expect(parent!.querySelector('[role="tablist"]')).not.toBeNull();
  });

  it('default chart sub-tab renders the WHO partograph form (FHR strip)', async () => {
    mockBmsSession.mockReturnValue({ config: cfg, userInfo });
    mockGet.mockResolvedValue([makeRow()]);
    render(<PartographTab an="AN1" />, { wrapper });
    await waitFor(() => expect(screen.getByTestId('partograph-form')).toBeInTheDocument());
    expect(screen.getByTestId('strip-fhr')).toBeInTheDocument();
  });

  it('chart sub-tab shows occupant HN / name / GPAL / age / admit in the form header', async () => {
    mockBmsSession.mockReturnValue({ config: cfg, userInfo });
    mockGet.mockResolvedValue([]);
    const occupant = {
      an: 'AN1',
      hn: 'HN9',
      pname: 'นาง',
      fname: 'ทดสอบ',
      lname: 'ระบบ',
      birthday: '1996-04-19',
      regdate: '2026-04-19',
      regtime: '08:00:00',
      gravida: 2,
      ga: 38,
      bedno: '01',
      roomno: 'LR1',
      ward: '03',
      bedtype: null,
      roomname: 'LR1',
      incharge_doctor_name: null,
      last_observation_at: null,
      last_cervix_cm: null,
    };
    render(<PartographTab an="AN1" occupant={occupant} />, { wrapper });
    const header = await screen.findByTestId('strip-header');
    expect(header).toHaveTextContent('HN9');
    expect(header).toHaveTextContent('ทดสอบ');
    expect(header).toHaveTextContent(/G2/);
    expect(header).toHaveTextContent(/Age:\s*30/);
    expect(header).toHaveTextContent(/Admitted:/);
  });

  it('clicking an observation column on the chart opens the edit dialog prefilled', async () => {
    mockBmsSession.mockReturnValue({ config: cfg, userInfo });
    mockGet.mockResolvedValue([makeRow({ ipt_labour_partograph_id: 7, fetal_heart_rate: 155 })]);
    render(<PartographTab an="AN1" />, { wrapper });
    await waitFor(() => expect(screen.getByTestId('partograph-form')).toBeInTheDocument());
    // One click-target rect is emitted per observation on the chart overlay.
    const target = screen.getByTestId('obs-click-target-7');
    fireEvent.click(target);
    const dlg = await screen.findByRole('dialog');
    // Prefilled with the clicked observation's FHR.
    expect(within(dlg).getByLabelText('fetal_heart_rate')).toHaveValue('155');
  });

  it('chart sub-tab renders the full partograph form even with no observations', async () => {
    mockBmsSession.mockReturnValue({ config: cfg, userInfo });
    mockGet.mockResolvedValue([]);
    render(<PartographTab an="AN1" />, { wrapper });
    await waitFor(() => expect(screen.getByTestId('partograph-form')).toBeInTheDocument());
    // Every strip rendered — the form is the paper template nurses expect.
    expect(screen.getByTestId('strip-cervix')).toBeInTheDocument();
    expect(screen.getByTestId('strip-contractions')).toBeInTheDocument();
    expect(screen.getByTestId('strip-pulse-bp')).toBeInTheDocument();
    expect(screen.getByTestId('strip-staff')).toBeInTheDocument();
  });

  it('CDSS badge counts appear on the กราฟ sub-tab trigger when alerts fire', async () => {
    mockBmsSession.mockReturnValue({ config: cfg, userInfo });
    // FHR of 200 guarantees a CRITICAL FHR alert from analyzeFhr.
    mockGet.mockResolvedValue([makeRow({ fetal_heart_rate: 200 })]);
    render(<PartographTab an="AN1" />, { wrapper });
    await waitFor(() => expect(screen.getByText('200')).toBeInTheDocument());
    const chartTab = screen.getByRole('tab', { name: /กราฟ/ });
    expect(chartTab).toHaveTextContent(/วิกฤต|เตือน|ระวัง/);
  });
});
