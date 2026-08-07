// AlertBar — recalibrated ribbon: every cell is actionable, links to its
// pre-filtered board, and the dead in-transit tile is gone.
import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { AlertBar } from '@/components/dashboard/AlertBar';

const alerts = { referralAlerts: 7, overdueAnc: 138, dueSoon: 172 };

describe('AlertBar', () => {
  it('renders the three recalibrated tiles with deep links to the boards', () => {
    render(<AlertBar alerts={alerts} />);

    const referral = screen.getByTestId('alert-referrals');
    expect(within(referral).getByText('7')).toBeInTheDocument();
    expect(referral.getAttribute('href')).toBe('/referrals?overdue=1');

    const anc = screen.getByTestId('alert-overdue-anc');
    expect(within(anc).getByText('138')).toBeInTheDocument();
    expect(anc.getAttribute('href')).toBe('/pregnancies?cohort=anc_stale');

    const due = screen.getByTestId('alert-due-soon');
    expect(within(due).getByText('172')).toBeInTheDocument();
    expect(due.getAttribute('href')).toBe('/pregnancies?cohort=due_soon');

    expect(screen.queryByText(/IN-TRANSIT/)).toBeNull();
  });

  it('sums only true alarms into the leading total (due-soon is workload, not alarm)', () => {
    render(<AlertBar alerts={alerts} />);
    expect(screen.getByText('145')).toBeInTheDocument(); // 7 + 138
  });

  it('shows ALL CLEAR when the alarm categories are zero', () => {
    render(<AlertBar alerts={{ referralAlerts: 0, overdueAnc: 0, dueSoon: 5 }} />);
    expect(screen.getByText('ALL CLEAR')).toBeInTheDocument();
  });
});
