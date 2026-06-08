// PrintForm component tests
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PrintForm } from '@/components/patient/PrintForm';
import type { VitalSignEntry } from '@/types/api';

const basePatient = {
  hn: '12345',
  an: 'AN-001',
  name: 'นางสาวทดสอบ ใจดี',
  age: 28,
  gravida: 2,
  gaWeeks: 38,
  admitDate: '2026-01-15T08:30:00Z',
};

const sampleVitals: VitalSignEntry[] = [
  {
    measuredAt: '2026-01-15T10:00:00Z',
    maternalHr: 80,
    fetalHr: '140',
    sbp: 120,
    dbp: 80,
    pphAmountMl: null,
  },
  {
    measuredAt: '2026-01-15T12:00:00Z',
    maternalHr: 85,
    fetalHr: '145',
    sbp: 125,
    dbp: 85,
    pphAmountMl: 200,
  },
];

describe('PrintForm', () => {
  it('renders header with hospital name', () => {
    render(<PrintForm patient={basePatient} hospitalName="รพ.ขอนแก่น" vitals={[]} />);
    expect(screen.getByText('รพ.ขอนแก่น')).toBeTruthy();
  });

  it('renders header with labor record title', () => {
    render(<PrintForm patient={basePatient} hospitalName="รพ.ขอนแก่น" vitals={[]} />);
    expect(screen.getByText('บันทึกการคลอด (Labor Record)')).toBeTruthy();
  });

  it('renders patient info: HN, AN, age', () => {
    render(<PrintForm patient={basePatient} hospitalName="รพ.ขอนแก่น" vitals={[]} />);
    expect(screen.getByText('12345')).toBeTruthy();
    expect(screen.getByText('AN-001')).toBeTruthy();
    expect(screen.getByText('28 ปี')).toBeTruthy();
  });

  it('renders patient gravida and GA', () => {
    render(<PrintForm patient={basePatient} hospitalName="รพ.ขอนแก่น" vitals={[]} />);
    expect(screen.getByText('2')).toBeTruthy();
    expect(screen.getByText('38 สัปดาห์')).toBeTruthy();
  });

  it('renders table column headers', () => {
    render(<PrintForm patient={basePatient} hospitalName="รพ.ขอนแก่น" vitals={sampleVitals} />);
    expect(screen.getByText('วันเวลา')).toBeTruthy();
    expect(screen.getByText('V/S')).toBeTruthy();
    expect(screen.getByText('UC')).toBeTruthy();
    expect(screen.getByText('FHS')).toBeTruthy();
    expect(screen.getByText('Cervix')).toBeTruthy();
    expect(screen.getByText('ผู้ตรวจ')).toBeTruthy();
    expect(screen.getByText('SOS')).toBeTruthy();
    expect(screen.getByText('Med')).toBeTruthy();
    expect(screen.getByText('หมายเหตุ')).toBeTruthy();
  });

  it('shows "พิมพ์จาก SR-LRMS" footer text', () => {
    render(<PrintForm patient={basePatient} hospitalName="รพ.ขอนแก่น" vitals={[]} />);
    const footer = screen.getByText(/พิมพ์จาก SR-LRMS/);
    expect(footer).toBeTruthy();
  });

  it('pre-fills rows with vital sign data when provided', () => {
    render(<PrintForm patient={basePatient} hospitalName="รพ.ขอนแก่น" vitals={sampleVitals} />);
    // V/S column: "120/80 HR 80"
    expect(screen.getByText(/120\/80/)).toBeTruthy();
    expect(screen.getByText(/HR 80/)).toBeTruthy();
    // FHS column
    expect(screen.getByText('140')).toBeTruthy();
    expect(screen.getByText('145')).toBeTruthy();
  });

  it('shows PPH amount in notes column when present', () => {
    render(<PrintForm patient={basePatient} hospitalName="รพ.ขอนแก่น" vitals={sampleVitals} />);
    expect(screen.getByText('PPH 200ml')).toBeTruthy();
  });

  it('renders empty rows for manual filling when no vitals', () => {
    const { container } = render(
      <PrintForm patient={basePatient} hospitalName="รพ.ขอนแก่น" vitals={[]} />,
    );
    // Should render 12 empty rows in tbody
    const tbody = container.querySelector('tbody');
    expect(tbody).toBeTruthy();
    const rows = tbody!.querySelectorAll('tr');
    expect(rows.length).toBe(12);
  });

  it('shows dash for null gravida', () => {
    const patientNoGravida = { ...basePatient, gravida: null };
    render(<PrintForm patient={patientNoGravida} hospitalName="รพ.ขอนแก่น" vitals={[]} />);
    // The gravida field should show "-"
    const gravidaStrong = screen.getAllByText('-');
    expect(gravidaStrong.length).toBeGreaterThan(0);
  });
});
