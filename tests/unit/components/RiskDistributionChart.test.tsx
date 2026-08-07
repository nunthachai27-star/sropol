// RiskDistributionChart component tests
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RiskDistributionChart } from '@/components/dashboard/RiskDistributionChart';
import type { DashboardSummary } from '@/types/api';

// Mock Recharts components to avoid SVG rendering issues in jsdom
vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="responsive-container">{children}</div>
  ),
  PieChart: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="pie-chart">{children}</div>
  ),
  Pie: ({ data }: { data: Array<{ name: string; value: number }> }) => (
    <div data-testid="pie">
      {data?.map((d) => (
        <span key={d.name} data-testid={`pie-segment-${d.name}`}>
          {d.name}:{d.value}
        </span>
      ))}
    </div>
  ),
  Cell: () => <div data-testid="cell" />,
  Tooltip: () => <div data-testid="tooltip" />,
}));

const summary: DashboardSummary = {
  totalActive: 25,
  totalHigh: 5,
  totalMedium: 8,
  totalLow: 12,
};

const emptySummary: DashboardSummary = {
  totalActive: 0,
  totalHigh: 0,
  totalMedium: 0,
  totalLow: 0,
};

describe('RiskDistributionChart', () => {
  it('renders the card with correct title', () => {
    render(<RiskDistributionChart summary={summary} />);
    expect(screen.getByText('การกระจายระดับความเสี่ยง')).toBeTruthy();
  });

  it('renders donut chart with PieChart', () => {
    render(<RiskDistributionChart summary={summary} />);
    expect(screen.getByTestId('pie-chart')).toBeTruthy();
  });

  it('displays total active count in center', () => {
    render(<RiskDistributionChart summary={summary} />);
    expect(screen.getByText('25')).toBeTruthy();
    expect(screen.getByText('ผู้คลอด')).toBeTruthy();
  });

  it('displays legend with all risk levels', () => {
    render(<RiskDistributionChart summary={summary} />);
    expect(screen.getByText('เสี่ยงสูง')).toBeTruthy();
    expect(screen.getByText('เสี่ยงปานกลาง')).toBeTruthy();
    expect(screen.getByText('เสี่ยงต่ำ')).toBeTruthy();
  });

  it('displays counts in legend items', () => {
    render(<RiskDistributionChart summary={summary} />);
    // Counts for each risk level
    expect(screen.getByText('5')).toBeTruthy();
    expect(screen.getByText('8')).toBeTruthy();
    expect(screen.getByText('12')).toBeTruthy();
  });

  it('displays percentages in legend items', () => {
    render(<RiskDistributionChart summary={summary} />);
    // 5/25 = 20%, 8/25 = 32%, 12/25 = 48%
    expect(screen.getByText('20%')).toBeTruthy();
    expect(screen.getByText('32%')).toBeTruthy();
    expect(screen.getByText('48%')).toBeTruthy();
  });

  it('shows empty state when totalActive is 0', () => {
    render(<RiskDistributionChart summary={emptySummary} />);
    expect(screen.getByText('ไม่มีผู้คลอด')).toBeTruthy();
    // Should not render the chart
    expect(screen.queryByTestId('pie-chart')).toBeNull();
  });

  it('uses Clinical Command Center card styling', () => {
    const { container } = render(<RiskDistributionChart summary={summary} />);
    const card = container.firstElementChild as HTMLElement;
    expect(card.className).toContain('rounded-2xl');
    expect(card.className).toContain('bg-white');
  });

  it('title has correct styling classes', () => {
    render(<RiskDistributionChart summary={summary} />);
    const title = screen.getByText('การกระจายระดับความเสี่ยง');
    expect(title.className).toContain('text-sm');
    expect(title.className).toContain('uppercase');
    expect(title.className).toContain('tracking-wider');
    expect(title.className).toContain('font-semibold');
    expect(title.className).toContain('text-slate-400');
  });

  it('handles summary where not all risk levels have patients', () => {
    const partialSummary: DashboardSummary = {
      totalActive: 3,
      totalHigh: 3,
      totalMedium: 0,
      totalLow: 0,
    };
    render(<RiskDistributionChart summary={partialSummary} />);
    // "3" appears in both center and HIGH legend; use getAllByText
    const threes = screen.getAllByText('3');
    expect(threes.length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('100%')).toBeTruthy();
    // Zero-count segments should show 0%
    const zeroPercents = screen.getAllByText('0%');
    expect(zeroPercents.length).toBe(2); // MEDIUM and LOW
  });
});
