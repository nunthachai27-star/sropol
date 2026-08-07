// HighRiskPatientList component tests — updated 2026-04-21 to match the
// redesigned single-view (non-mobile-duplicating) layout from the Claude Design
// handoff. Old mobile-card layout was removed in the redesign.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { HighRiskPatientList } from '@/components/dashboard/HighRiskPatientList';
import type { HighRiskPatient } from '@/components/dashboard/HighRiskPatientList';

const mockPush = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}));

const now = new Date();

function minutesAgo(mins: number): string {
  return new Date(now.getTime() - mins * 60000).toISOString();
}

function hoursAgo(hours: number): string {
  return new Date(now.getTime() - hours * 60 * 60000).toISOString();
}

const samplePatients: HighRiskPatient[] = [
  {
    an: 'AN001',
    hn: 'HN001',
    name: 'สมศรี ใจดี',
    age: 28,
    gaWeeks: 38,
    cpdScore: 12,
    riskLevel: 'HIGH',
    hospital: 'รพ.ขอนแก่น',
    hcode: 'H001',
    admitDate: minutesAgo(30),
    lastVitalAt: minutesAgo(5),
  },
  {
    an: 'AN002',
    hn: 'HN002',
    name: 'สมหญิง รักดี',
    age: 32,
    gaWeeks: 40,
    cpdScore: 8,
    riskLevel: 'MEDIUM',
    hospital: 'รพ.ชุมแพ',
    hcode: 'H002',
    admitDate: hoursAgo(2),
    lastVitalAt: minutesAgo(45),
  },
  {
    an: 'AN003',
    hn: 'HN003',
    name: 'วิภา สุขใจ',
    age: 25,
    gaWeeks: 36,
    cpdScore: 15,
    riskLevel: 'HIGH',
    hospital: 'รพ.ขอนแก่น',
    hcode: 'H001',
    admitDate: null,
    lastVitalAt: null,
  },
];

describe('HighRiskPatientList', () => {
  beforeEach(() => {
    mockPush.mockClear();
  });

  it('renders the section label', () => {
    render(<HighRiskPatientList patients={samplePatients} />);
    // "High-risk" appears in both section title and tab label — at least 1 match
    expect(screen.getAllByText(/High-risk/i).length).toBeGreaterThan(0);
  });

  it('renders tab counts (HIGH-RISK ONLY and ALL ACTIVE)', () => {
    render(<HighRiskPatientList patients={samplePatients} />);
    expect(screen.getByText(/HIGH-RISK ONLY/)).toBeTruthy();
    expect(screen.getByText(/ALL ACTIVE/)).toBeTruthy();
  });

  it('renders AN numbers for HIGH-risk tab (default)', () => {
    render(<HighRiskPatientList patients={samplePatients} />);
    // Default tab = HIGH only, so AN001 + AN003 render (cpd 12 + 15)
    expect(screen.getByText('AN001')).toBeTruthy();
    expect(screen.getByText('AN003')).toBeTruthy();
  });

  it('switches to ALL ACTIVE tab and shows every patient', () => {
    render(<HighRiskPatientList patients={samplePatients} />);
    fireEvent.click(screen.getByText(/ALL ACTIVE/));
    expect(screen.getByText('AN001')).toBeTruthy();
    expect(screen.getByText('AN002')).toBeTruthy();
    expect(screen.getByText('AN003')).toBeTruthy();
  });

  it('sorts patients by CPD score descending (highest first)', () => {
    const { container } = render(<HighRiskPatientList patients={samplePatients} />);
    fireEvent.click(screen.getByText(/ALL ACTIVE/));
    const rows = container.querySelectorAll('[data-testid="patient-row"]');
    expect(rows.length).toBe(3);
    expect(rows[0].textContent).toContain('AN003'); // cpd 15
    expect(rows[1].textContent).toContain('AN001'); // cpd 12
    expect(rows[2].textContent).toContain('AN002'); // cpd 8
  });

  it('navigates to patient detail on row click', () => {
    const { container } = render(<HighRiskPatientList patients={samplePatients} />);
    const rows = container.querySelectorAll('[data-testid="patient-row"]');
    fireEvent.click(rows[0]);
    // First HIGH-risk row = AN003 (cpd 15) → hcode H001
    expect(mockPush).toHaveBeenCalledWith('/patients/H001-AN003');
  });

  it('shows font-mono numerics', () => {
    const { container } = render(<HighRiskPatientList patients={samplePatients} />);
    const monoElements = container.querySelectorAll('.font-mono');
    expect(monoElements.length).toBeGreaterThan(0);
  });

  it('shows hospital name for each HIGH-risk patient', () => {
    render(<HighRiskPatientList patients={samplePatients} />);
    // Default tab shows 2 HIGH patients (AN001, AN003), both at รพ.ขอนแก่น
    expect(screen.getAllByText('รพ.ขอนแก่น').length).toBe(2);
  });

  it('shows no-data text for null lastVitalAt', () => {
    render(<HighRiskPatientList patients={[samplePatients[2]]} />);
    expect(screen.getByText(/no data/)).toBeTruthy();
  });

  it('shows empty state when no patients', () => {
    render(<HighRiskPatientList patients={[]} />);
    expect(screen.getByText(/ไม่มีผู้คลอดเสี่ยงสูงในห้องคลอดขณะนี้/)).toBeTruthy();
  });

  it('empty state surfaces upstream ANC pressure with board links', () => {
    render(<HighRiskPatientList patients={[]} ancFallback={{ hr3: 106, dueSoon: 172 }} />);
    expect(screen.getByText(/HR3 106 ราย/)).toBeTruthy();
    expect(screen.getByText(/≤14 วัน 172 ราย/)).toBeTruthy();
  });

  it('shows loading skeletons when isLoading is true', () => {
    const { container } = render(<HighRiskPatientList patients={[]} isLoading={true} />);
    const skeletons = container.querySelectorAll('.animate-pulse');
    expect(skeletons.length).toBeGreaterThan(0);
  });

  it('does not show empty state when loading', () => {
    render(<HighRiskPatientList patients={[]} isLoading={true} />);
    expect(screen.queryByText(/ไม่มีผู้คลอดเสี่ยงสูงในห้องคลอดขณะนี้/)).toBeNull();
  });

  it('renders GA weeks in HIGH tab', () => {
    render(<HighRiskPatientList patients={samplePatients} />);
    // HIGH tab shows AN001 (GA 38) + AN003 (GA 36)
    expect(screen.getByText('38')).toBeTruthy();
    expect(screen.getByText('36')).toBeTruthy();
  });

  it('tags HIGH risk with data-risk attribute', () => {
    const { container } = render(<HighRiskPatientList patients={samplePatients} />);
    // Default HIGH tab: 2 HIGH-risk chips
    const highChips = container.querySelectorAll('[data-risk="HIGH"]');
    expect(highChips.length).toBe(2);
  });

  it('switches to ALL ACTIVE tab and shows MEDIUM risk chip', () => {
    const { container } = render(<HighRiskPatientList patients={samplePatients} />);
    fireEvent.click(screen.getByText(/ALL ACTIVE/));
    const medChips = container.querySelectorAll('[data-risk="MEDIUM"]');
    expect(medChips.length).toBe(1);
  });

  // Phase 5 W2 — maternal-screen chips beside PartographCell (GC-W2: separate
  // slot, own data-*). See src/components/dashboard/MaternalScreenCell.tsx.
  describe('maternal-screen cell (W2)', () => {
    it('shows the maternal-screen cell in the row for a LOCAL_SEVERE/EMERGENCY patient', () => {
      const severePatient: HighRiskPatient = {
        ...samplePatients[0],
        an: 'AN901',
        maternalScreenLocalTier: 'LOCAL_SEVERE',
        maternalScreenEmergencyAcuity: 'EMERGENCY',
        maternalScreenIsComplete: true,
        maternalScreenAssessedAt: minutesAgo(10),
      };
      const { container } = render(<HighRiskPatientList patients={[severePatient]} />);
      const cell = container.querySelector('[data-testid="maternal-screen-cell"]');
      expect(cell).toBeTruthy();
      expect(container.querySelector('[data-tier="LOCAL_SEVERE"]')).toBeTruthy();
      expect(container.querySelector('[data-acuity="EMERGENCY"]')).toBeTruthy();
    });

    it('shows no maternal-screen cell for a patient with all-null screening fields', () => {
      const nullScreenPatient: HighRiskPatient = {
        ...samplePatients[0],
        an: 'AN902',
        maternalScreenLocalTier: null,
        maternalScreenEmergencyAcuity: null,
        maternalScreenIsComplete: null,
        maternalScreenAssessedAt: null,
      };
      const { container } = render(<HighRiskPatientList patients={[nullScreenPatient]} />);
      expect(container.querySelector('[data-testid="maternal-screen-cell"]')).toBeNull();
    });
  });
});
