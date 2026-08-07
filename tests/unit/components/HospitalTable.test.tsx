// HospitalTable component tests — updated 2026-04-21 for the redesigned
// dense-list layout (no <table> rows; div grid with sort chips).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { HospitalTable } from '@/components/dashboard/HospitalTable';
import { ConnectionStatus, HospitalLevel } from '@/types/domain';
import type { DashboardHospital } from '@/types/api';

const mockPush = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}));

const sampleHospitals: DashboardHospital[] = [
  {
    hcode: 'H001',
    name: 'รพ.ขอนแก่น',
    level: HospitalLevel.A_S,
    connectionStatus: ConnectionStatus.ONLINE,
    lastSyncAt: '2026-01-15T10:00:00Z',
    counts: { low: 5, medium: 3, high: 2, total: 10 },
    ancCounts: { total: 12, hr3: 1 },
    partographQuality: { laborRecent: 0, withPartograph: 0 },
    syncStatus: 'OK',
    syncBlockedReason: null,
  },
  {
    hcode: 'H002',
    name: 'รพ.ชุมแพ',
    level: HospitalLevel.M1,
    connectionStatus: ConnectionStatus.OFFLINE,
    lastSyncAt: null,
    counts: { low: 2, medium: 1, high: 0, total: 3 },
    ancCounts: { total: 4, hr3: 0 },
    partographQuality: { laborRecent: 0, withPartograph: 0 },
    syncStatus: 'OK',
    syncBlockedReason: null,
  },
];

describe('HospitalTable', () => {
  beforeEach(() => {
    mockPush.mockClear();
  });

  it('renders hospital rows', () => {
    render(<HospitalTable hospitals={sampleHospitals} />);
    expect(screen.getByText('รพ.ขอนแก่น')).toBeTruthy();
    expect(screen.getByText('รพ.ชุมแพ')).toBeTruthy();
  });

  it('renders sort chip controls', () => {
    render(<HospitalTable hospitals={sampleHospitals} />);
    expect(screen.getByText(/SEVERITY/)).toBeTruthy();
    expect(screen.getByText(/NAME/)).toBeTruthy();
    expect(screen.getByText(/TOTAL/)).toBeTruthy();
    expect(screen.getByText(/LEVEL/)).toBeTruthy();
  });

  it('sorts by severity descending by default (HIGH hospital first)', () => {
    const { container } = render(<HospitalTable hospitals={sampleHospitals} />);
    const rows = container.querySelectorAll('[data-testid="hospital-row"]');
    expect(rows.length).toBe(2);
    // Default sort: severity desc; H001 has HIGH=2 → must come before H002 (HIGH=0)
    expect(rows[0].textContent).toContain('รพ.ขอนแก่น');
    expect(rows[1].textContent).toContain('รพ.ชุมแพ');
  });

  it('clicking NAME sort chip toggles order', () => {
    const { container } = render(<HospitalTable hospitals={sampleHospitals} />);
    fireEvent.click(screen.getByText(/NAME/));
    const rows = container.querySelectorAll('[data-testid="hospital-row"]');
    expect(rows.length).toBe(2);
    // NAME desc (first click defaults to desc in the new design)
    expect(rows[0].textContent).toContain('รพ.ชุมแพ');
  });

  it('calls router.push when row is clicked (no selection handler)', () => {
    const { container } = render(<HospitalTable hospitals={sampleHospitals} />);
    const rows = container.querySelectorAll('[data-testid="hospital-row"]');
    fireEvent.click(rows[0]);
    // Row 0 = H001 by default severity sort
    expect(mockPush).toHaveBeenCalledWith('/hospitals/H001');
  });

  it('invokes onSelect instead of routing when provided', () => {
    const onSelect = vi.fn();
    const { container } = render(
      <HospitalTable hospitals={sampleHospitals} onSelect={onSelect} />,
    );
    const rows = container.querySelectorAll('[data-testid="hospital-row"]');
    fireEvent.click(rows[0]);
    expect(onSelect).toHaveBeenCalledWith('H001');
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('renders hospital level chip', () => {
    render(<HospitalTable hospitals={sampleHospitals} />);
    expect(screen.getByText('A_S')).toBeTruthy();
    expect(screen.getByText('M1')).toBeTruthy();
  });

  it('renders OFFLINE flag for offline hospital', () => {
    render(<HospitalTable hospitals={sampleHospitals} />);
    expect(screen.getByText('OFFLINE')).toBeTruthy();
  });

  it('shows total count for each hospital', () => {
    render(<HospitalTable hospitals={sampleHospitals} />);
    expect(screen.getByText(/^10/)).toBeTruthy(); // "10 act"
    expect(screen.getByText(/^3/)).toBeTruthy();
  });

  it('renders node-count summary in the sort bar', () => {
    render(<HospitalTable hospitals={sampleHospitals} />);
    expect(screen.getByText(/2 NODES/)).toBeTruthy();
  });

  it('shows empty-state message when no hospitals', () => {
    render(<HospitalTable hospitals={[]} />);
    expect(screen.getByText(/ไม่มีโรงพยาบาลในรายการ/)).toBeTruthy();
  });
});
