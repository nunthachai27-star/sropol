/* @vitest-environment jsdom */
/* @vitest-environment-options { "url": "http://localhost/" } */
// Task 39: DischargeTab read-only — TDD: write tests FIRST. Like BedTab, this
// tab consumes BedOccupancy directly.
// Task 50: extended with discharge form CRUD tests.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('@/hooks/useBmsSession', () => ({ useBmsSession: vi.fn() }));
vi.mock('@/services/maternity-ward', () => ({
  dischargePatient: vi.fn(),
  listDchTypes: vi.fn(async () => [
    { dchtype: '01', name: 'With Approval' },
    { dchtype: '04', name: 'By Transfer' },
  ]),
  listDchStatuses: vi.fn(async () => [
    { dchstts: '01', name: 'Complete Recovery' },
    { dchstts: '04', name: 'Normal Delivery' },
  ]),
  listSpecialties: vi.fn(async () => [
    { spclty: '03', name: 'สูติกรรม' },
    { spclty: '01', name: 'อายุรกรรม' },
  ]),
  listIptSevereTypes: vi.fn(async () => [
    { ipt_severe_type_id: 1, ipt_severe_type_name: 'ระดับ 1' },
    { ipt_severe_type_id: 2, ipt_severe_type_name: 'ระดับ 2' },
    { ipt_severe_type_id: 3, ipt_severe_type_name: 'ระดับ 3' },
    { ipt_severe_type_id: 4, ipt_severe_type_name: 'ระดับ 4' },
  ]),
  // Hydration — DischargeTab now reads the existing ipt row to restore
  // a saved draft when reopening the drawer. Returning null mirrors the
  // "no prior save" path which existing tests already exercise.
  getPatientIptDischarge: vi.fn(async () => null),
  // Refer-out support — DischargeTab fetches existing referout to drive the
  // warning banner / "edit" affordance. Tests don't exercise the dialog path
  // so a no-data stub is fine.
  getPatientReferOut: vi.fn(async () => null),
  listReferCauses: vi.fn(async () => []),
  listReferTypes: vi.fn(async () => []),
  listReferoutEmergencyTypes: vi.fn(async () => []),
  searchHospcodes: vi.fn(async () => []),
  searchDoctors: vi.fn(async () => []),
  searchSpecialties: vi.fn(async () => []),
  searchIcd10: vi.fn(async () => []),
  upsertReferOut: vi.fn(async () => ({})),
}));
import { SWRConfig } from 'swr';
import type { ReactNode } from 'react';
import { useBmsSession } from '@/hooks/useBmsSession';
import { dischargePatient } from '@/services/maternity-ward';
import { DischargeTab } from '@/components/maternity/tabs/DischargeTab';
import type { BedOccupancy } from '@/types/maternity-ward';

const wrapper = ({ children }: { children: ReactNode }) => (
  <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>{children}</SWRConfig>
);

const mockBmsSession = useBmsSession as unknown as ReturnType<typeof vi.fn>;
const mockDischarge = dischargePatient as unknown as ReturnType<typeof vi.fn>;
const cfg = { apiUrl: 'https://t.example/api', bearerToken: 'B', appIdentifier: 'X' };
const userInfo = { loginname: 'n1', fullname: 'N', hospcode: '10670' };

const baseOccupant: BedOccupancy = {
  an: 'AN1',
  hn: 'HN1',
  regdate: '2026-04-19',
  regtime: '10:00:00',
  ward: '03',
  bedno: '07',
  roomno: 'LR1',
  bedtype: 'Labor',
  roomname: 'ห้องคลอด 1',
  pname: null,
  fname: null,
  lname: null,
  birthday: null,
  gravida: null,
  ga: null,
  incharge_doctor_name: null,
  last_observation_at: null,
  last_cervix_cm: null,
};

beforeEach(() => {
  mockBmsSession.mockReset();
  mockBmsSession.mockReturnValue({ config: cfg, userInfo });
  mockDischarge.mockReset();
});

describe('DischargeTab', () => {
  it('shows admitted message + admit timestamp when occupant present', async () => {
    render(<DischargeTab occupant={baseOccupant} />, { wrapper });
    // Settle the mount-time SWR fetches (dchtype/dchstts/specialty/severity
    // masters + referout/ipt-discharge hydration) before asserting.
    await waitFor(() => {});
    expect(screen.getByText(/ยังไม่มีการจำหน่าย/)).toBeInTheDocument();
    expect(screen.getByText(/2026-04-19/)).toBeInTheDocument();
  });

  it('shows ไม่พบข้อมูล when occupant is null', () => {
    render(<DischargeTab occupant={null} />);
    expect(screen.getByText(/ไม่พบข้อมูล/)).toBeInTheDocument();
  });
});

describe('DischargeTab CRUD', () => {
  it('shows the discharge form with date/time/type/status inputs', async () => {
    render(<DischargeTab occupant={baseOccupant} />, { wrapper });
    await waitFor(() => {});
    expect(screen.getByLabelText('dchdate')).toBeInTheDocument();
    expect(screen.getByLabelText('dchtime')).toBeInTheDocument();
    expect(screen.getByLabelText('dchtype')).toBeInTheDocument();
    expect(screen.getByLabelText('dchstts')).toBeInTheDocument();
  });

  // Helper: flip confirm_discharge toggle from default 'N' → 'Y' so the save
  // button reads "ยืนยันการจำหน่าย" (in 'N' state it reads "บันทึกร่าง").
  function flipConfirmToggleOn() {
    fireEvent.click(screen.getByRole('switch', { name: 'confirm_discharge' }));
  }

  // dchdate/dchtime are BE text inputs (BeDateInput/BeTimeInput) that commit
  // their parsed ISO/HH:mm value on blur, not on every keystroke. Drive them
  // the way a nurse does: type the display-format text, then blur to commit.
  function setDate(display: string) {
    const el = screen.getByLabelText('dchdate');
    fireEvent.change(el, { target: { value: display } });
    fireEvent.blur(el);
  }
  function setTime(display: string) {
    const el = screen.getByLabelText('dchtime');
    fireEvent.change(el, { target: { value: display } });
    fireEvent.blur(el);
  }

  it('blocks save when date is empty (Thai validation message)', async () => {
    render(<DischargeTab occupant={baseOccupant} />, { wrapper });
    await waitFor(() => {});
    flipConfirmToggleOn();
    // The form now auto-fills today/now on mount as a UX accelerator — clear
    // both (blank text + blur commits '' back to the draft) to exercise the
    // empty-input validation path.
    setDate('');
    setTime('');
    fireEvent.click(screen.getByRole('button', { name: /ยืนยันการจำหน่าย/ }));
    expect(screen.getByText(/กรุณาระบุวันที่และเวลาจำหน่าย/)).toBeInTheDocument();
    expect(mockDischarge).not.toHaveBeenCalled();
  });

  it('confirms then calls dischargePatient with all four fields', async () => {
    const origConfirm = window.confirm;
    window.confirm = vi.fn().mockReturnValue(true);
    mockDischarge.mockResolvedValue(undefined);
    render(<DischargeTab occupant={baseOccupant} />, { wrapper });
    flipConfirmToggleOn();
    // BE date 19/4/2569 → ISO 2026-04-19; BeTimeInput normalizes to HH:mm.
    setDate('19/4/2569');
    setTime('14:30');
    fireEvent.click(screen.getByRole('button', { name: /ยืนยันการจำหน่าย/ }));
    expect(window.confirm).toHaveBeenCalled();
    await waitFor(() => expect(mockDischarge).toHaveBeenCalled());
    const args = mockDischarge.mock.calls[0][3];
    // Defaults match real HOSxP master codes (varchar 2). Maternity LR
    // canonical defaults: dchtype '01' (With Approval) + dchstts '04'
    // (Normal Delivery). confirm_discharge='Y' here because the test flipped
    // the toggle on — matches HOSxP cxDBCheckBox1 semantics. dchtime is HH:mm
    // (minute precision) — the redesign's shared time input drops seconds.
    expect(args).toMatchObject({
      an: 'AN1',
      dchdate: '2026-04-19',
      dchtime: '14:30',
      dchtype: '01',
      dchstts: '04',
      confirm_discharge: 'Y',
    });
    await waitFor(() => expect(screen.getByText(/ดำเนินการจำหน่ายเรียบร้อย/)).toBeInTheDocument());
    window.confirm = origConfirm;
  });

  it('does not fire dischargePatient when confirm returns false', async () => {
    const origConfirm = window.confirm;
    window.confirm = vi.fn().mockReturnValue(false);
    render(<DischargeTab occupant={baseOccupant} />, { wrapper });
    await waitFor(() => {});
    flipConfirmToggleOn();
    fireEvent.change(screen.getByLabelText('dchdate'), { target: { value: '2026-04-19' } });
    fireEvent.change(screen.getByLabelText('dchtime'), { target: { value: '14:30:00' } });
    fireEvent.click(screen.getByRole('button', { name: /ยืนยันการจำหน่าย/ }));
    expect(window.confirm).toHaveBeenCalled();
    expect(mockDischarge).not.toHaveBeenCalled();
    window.confirm = origConfirm;
  });

  it('surfaces Thai error when dischargePatient throws', async () => {
    const origConfirm = window.confirm;
    window.confirm = vi.fn().mockReturnValue(true);
    mockDischarge.mockRejectedValue(new Error('rest 500'));
    render(<DischargeTab occupant={baseOccupant} />, { wrapper });
    flipConfirmToggleOn();
    fireEvent.change(screen.getByLabelText('dchdate'), { target: { value: '2026-04-19' } });
    fireEvent.change(screen.getByLabelText('dchtime'), { target: { value: '14:30:00' } });
    fireEvent.click(screen.getByRole('button', { name: /ยืนยันการจำหน่าย/ }));
    await waitFor(() => expect(screen.getByText(/จำหน่ายไม่สำเร็จ.*rest 500/)).toBeInTheDocument());
    window.confirm = origConfirm;
  });
});
