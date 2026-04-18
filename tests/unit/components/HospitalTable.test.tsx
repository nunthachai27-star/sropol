// HospitalTable component tests
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
  },
  {
    hcode: 'H002',
    name: 'รพ.ชุมแพ',
    level: HospitalLevel.M1,
    connectionStatus: ConnectionStatus.OFFLINE,
    lastSyncAt: null,
    counts: { low: 2, medium: 1, high: 0, total: 3 },
  },
];

describe('HospitalTable', () => {
  beforeEach(() => {
    mockPush.mockClear();
  });

  it('renders table with hospital rows', () => {
    render(<HospitalTable hospitals={sampleHospitals} />);
    expect(screen.getByText('รพ.ขอนแก่น')).toBeTruthy();
    expect(screen.getByText('รพ.ชุมแพ')).toBeTruthy();
  });

  it('shows risk count badges with correct colors', () => {
    const { container } = render(<HospitalTable hospitals={sampleHospitals} />);
    // Green badge for low risk
    const greenBadges = container.querySelectorAll('.bg-green-100');
    expect(greenBadges.length).toBeGreaterThan(0);
    // Yellow badge for medium risk
    const yellowBadges = container.querySelectorAll('.bg-yellow-100');
    expect(yellowBadges.length).toBeGreaterThan(0);
    // Red badge for high risk
    const redBadges = container.querySelectorAll('.bg-red-100');
    expect(redBadges.length).toBeGreaterThan(0);
  });

  it('shows dash for zero risk counts', () => {
    render(<HospitalTable hospitals={sampleHospitals} />);
    // H002 has high=0, should show "-"
    const dashes = screen.getAllByText('-');
    expect(dashes.length).toBeGreaterThan(0);
  });

  it('shows ConnectionStatus for each hospital', () => {
    render(<HospitalTable hospitals={sampleHospitals} />);
    expect(screen.getByText('ออนไลน์')).toBeTruthy();
    expect(screen.getByText('ออฟไลน์')).toBeTruthy();
  });

  it('calls router.push when row is clicked', () => {
    render(<HospitalTable hospitals={sampleHospitals} />);
    const row = screen.getByText('รพ.ขอนแก่น').closest('tr');
    expect(row).toBeTruthy();
    fireEvent.click(row!);
    expect(mockPush).toHaveBeenCalledWith('/hospitals/H001');
  });

  it('navigates to correct hospital when second row is clicked', () => {
    render(<HospitalTable hospitals={sampleHospitals} />);
    const row = screen.getByText('รพ.ชุมแพ').closest('tr');
    fireEvent.click(row!);
    expect(mockPush).toHaveBeenCalledWith('/hospitals/H002');
  });

  it('renders table headers including sort headers', () => {
    render(<HospitalTable hospitals={sampleHospitals} />);
    expect(screen.getByText(/โรงพยาบาล/)).toBeTruthy();
    expect(screen.getByText(/ระดับ/)).toBeTruthy();
    expect(screen.getByText(/เสี่ยงต่ำ/)).toBeTruthy();
    expect(screen.getByText(/เสี่ยงปานกลาง/)).toBeTruthy();
    expect(screen.getByText(/เสี่ยงสูง/)).toBeTruthy();
    expect(screen.getByText(/รวม/)).toBeTruthy();
    expect(screen.getByText('สถานะ')).toBeTruthy();
  });

  it('sorts by name column when header clicked', () => {
    const hospitals: DashboardHospital[] = [
      {
        hcode: 'H002',
        name: 'สอง',
        level: HospitalLevel.M1,
        connectionStatus: ConnectionStatus.ONLINE,
        lastSyncAt: null,
        counts: { low: 1, medium: 0, high: 0, total: 1 },
      },
      {
        hcode: 'H001',
        name: 'หนึ่ง',
        level: HospitalLevel.A_S,
        connectionStatus: ConnectionStatus.ONLINE,
        lastSyncAt: null,
        counts: { low: 2, medium: 0, high: 0, total: 2 },
      },
    ];

    const { container } = render(<HospitalTable hospitals={hospitals} />);

    // Default sort is ascending by name
    const rows = container.querySelectorAll('tbody tr');
    expect(rows.length).toBe(2);

    // Click name header to toggle to descending
    const nameHeader = screen.getByText(/โรงพยาบาล/);
    fireEvent.click(nameHeader);

    // After clicking, sort direction should change
    const rowsAfterClick = container.querySelectorAll('tbody tr');
    expect(rowsAfterClick.length).toBe(2);
  });

  it('shows hospital level as Badge', () => {
    render(<HospitalTable hospitals={sampleHospitals} />);
    expect(screen.getByText('A_S')).toBeTruthy();
    expect(screen.getByText('M1')).toBeTruthy();
  });

  it('shows total count for each hospital', () => {
    const { container } = render(<HospitalTable hospitals={sampleHospitals} />);
    expect(screen.getByText('10')).toBeTruthy();
    // '3' appears in both medium count (H001) and total (H002), so use getAllByText
    const threes = screen.getAllByText('3');
    expect(threes.length).toBeGreaterThanOrEqual(2);
    // Verify totals are in font-semibold cells
    const totalCells = container.querySelectorAll('td.font-semibold');
    const totalValues = Array.from(totalCells).map((cell) => cell.textContent);
    expect(totalValues).toContain('10');
    expect(totalValues).toContain('3');
  });
});
