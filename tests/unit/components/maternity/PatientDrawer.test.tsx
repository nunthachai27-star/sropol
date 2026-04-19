/* @vitest-environment jsdom */
// Task 29: PatientDrawer shell tests — TDD: write tests FIRST.
// Task 31: VitalsTab swap means clicking the "Vital Signs" tab now mounts a
// real component that calls useBmsSession(); mock the hook to return null
// config so the tab falls through to its no-config branch.
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('@/hooks/useBmsSession', () => ({
  useBmsSession: () => ({ config: null }),
}));

import { PatientDrawer } from '@/components/maternity/PatientDrawer';
import type { BedOccupancy } from '@/types/maternity-ward';

const occupant: BedOccupancy = {
  an: 'AN1',
  hn: 'HN1',
  regdate: '2026-04-19',
  regtime: '10:00:00',
  ward: '03',
  bedno: '01',
  roomno: 'LR1',
  bedtype: null,
  roomname: 'LR1',
  pname: 'นาง',
  fname: 'ทดสอบ',
  lname: 'ระบบ',
  birthday: '1996-04-19',
  gravida: 2,
  ga: 38,
  incharge_doctor_name: 'ดร.X',
  last_observation_at: null,
  last_cervix_cm: 4,
};

describe('PatientDrawer', () => {
  it('renders nothing when open=false', () => {
    render(<PatientDrawer open={false} occupant={occupant} onClose={() => {}} />);
    // Either nothing visible OR hidden — assert no header text appears
    expect(screen.queryByText(/AN1/)).not.toBeInTheDocument();
  });

  it('renders header with AN, name, age, GA, bedno when open + occupant', () => {
    render(<PatientDrawer open occupant={occupant} onClose={() => {}} />);
    expect(screen.getByText(/AN1/)).toBeInTheDocument();
    expect(screen.getByText(/นาง ทดสอบ ระบบ|ทดสอบ ระบบ/)).toBeInTheDocument();
    expect(screen.getByText(/30/)).toBeInTheDocument(); // age
    expect(screen.getByText(/G2/)).toBeInTheDocument();
    expect(screen.getByText(/GA38/)).toBeInTheDocument();
    expect(screen.getByText(/เตียง 01|bedno 01|01/)).toBeInTheDocument();
  });

  it('renders all 10 tab buttons', () => {
    render(<PatientDrawer open occupant={occupant} onClose={() => {}} />);
    for (const label of [
      'Partograph',
      'Vital Signs',
      'Pre-labour',
      'Stage',
      'Medications',
      'DR Med',
      'Complications',
      'Infant',
      'Bed',
      'Discharge',
    ]) {
      expect(screen.getByRole('tab', { name: label })).toBeInTheDocument();
    }
  });

  it('switches active tab on click', () => {
    render(<PatientDrawer open occupant={occupant} onClose={() => {}} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Vital Signs' }));
    // VitalsTab (Task 31) renders its no-config branch when useBmsSession()
    // returns a null config — see the vi.mock at the top of this file.
    expect(screen.getByText(/ไม่พร้อมใช้งาน/)).toBeInTheDocument();
  });

  it('calls onClose when X clicked', () => {
    const onClose = vi.fn();
    render(<PatientDrawer open occupant={occupant} onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: /ปิด|close/i }));
    expect(onClose).toHaveBeenCalled();
  });

  it('shows loading state when open + null occupant', () => {
    render(<PatientDrawer open occupant={null} onClose={() => {}} />);
    expect(screen.getByText(/Loading|กำลังโหลด/)).toBeInTheDocument();
  });
});
