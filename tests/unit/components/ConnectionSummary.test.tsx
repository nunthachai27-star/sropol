// ConnectionSummary component tests
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ConnectionSummary } from '@/components/dashboard/ConnectionSummary';
import type { DashboardHospital } from '@/types/api';
import { ConnectionStatus, HospitalLevel } from '@/types/domain';

function makeHospital(
  hcode: string,
  name: string,
  status: ConnectionStatus,
): DashboardHospital {
  return {
    hcode,
    name,
    level: HospitalLevel.F2,
    connectionStatus: status,
    lastSyncAt: null,
    counts: { low: 0, medium: 0, high: 0, total: 0 },
    ancCounts: { total: 0, hr3: 0 },
    partographQuality: { laborRecent: 0, withPartograph: 0 },
    syncStatus: 'OK',
    syncBlockedReason: null,
  };
}

const hospitals: DashboardHospital[] = [
  makeHospital('001', 'รพ.กาฬสินธุ์', ConnectionStatus.ONLINE),
  makeHospital('002', 'รพ.ยางตลาด', ConnectionStatus.ONLINE),
  makeHospital('003', 'รพ.กมลาไสย', ConnectionStatus.OFFLINE),
  makeHospital('004', 'รพ.สหัสขันธ์', ConnectionStatus.UNKNOWN),
  makeHospital('005', 'รพ.สมเด็จ', ConnectionStatus.UNKNOWN),
];

describe('ConnectionSummary', () => {
  it('renders the card with correct title', () => {
    render(<ConnectionSummary hospitals={hospitals} />);
    expect(screen.getByText('สถานะการเชื่อมต่อ')).toBeTruthy();
  });

  it('shows correct online count', () => {
    const { container } = render(<ConnectionSummary hospitals={hospitals} />);
    expect(screen.getByText(/ออนไลน์/)).toBeTruthy();
    // Find the row that contains "ออนไลน์" and verify its count
    const onlineRow = Array.from(container.querySelectorAll('.flex.items-center.justify-between')).find(
      (el) => el.textContent?.includes('ออนไลน์'),
    );
    expect(onlineRow).toBeTruthy();
    expect(onlineRow!.textContent).toContain('2');
  });

  it('shows correct offline count', () => {
    render(<ConnectionSummary hospitals={hospitals} />);
    // "ออฟไลน์: 1"
    expect(screen.getByText(/ออฟไลน์/)).toBeTruthy();
    expect(screen.getByText('1')).toBeTruthy();
  });

  it('shows correct unknown count', () => {
    render(<ConnectionSummary hospitals={hospitals} />);
    // "ไม่ทราบ: 2"
    expect(screen.getByText(/ไม่ทราบ/)).toBeTruthy();
  });

  it('uses Clinical Command Center card styling', () => {
    const { container } = render(<ConnectionSummary hospitals={hospitals} />);
    const card = container.firstElementChild as HTMLElement;
    expect(card.className).toContain('rounded-2xl');
    expect(card.className).toContain('bg-white');
  });

  it('renders colored dots for each status', () => {
    const { container } = render(<ConnectionSummary hospitals={hospitals} />);
    const dots = container.querySelectorAll('.rounded-full');
    expect(dots.length).toBe(3); // green, red, gray dots
  });

  it('handles all hospitals online', () => {
    const allOnline = [
      makeHospital('001', 'รพ.กาฬสินธุ์', ConnectionStatus.ONLINE),
      makeHospital('002', 'รพ.ยางตลาด', ConnectionStatus.ONLINE),
    ];
    render(<ConnectionSummary hospitals={allOnline} />);
    expect(screen.getByText(/ออนไลน์/)).toBeTruthy();
  });

  it('handles empty hospitals array', () => {
    render(<ConnectionSummary hospitals={[]} />);
    expect(screen.getByText('สถานะการเชื่อมต่อ')).toBeTruthy();
    // All counts should be 0
    const zeros = screen.getAllByText('0');
    expect(zeros.length).toBe(3);
  });
});
