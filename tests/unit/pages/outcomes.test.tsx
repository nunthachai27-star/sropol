// Outcomes board page — behavior tests for the redesigned neonatal view.
// KPIs must render the API payload faithfully (percent LBW!), the range and
// hospital filters must hit the API, names stay masked, and an empty table
// states honestly that no sync data exists yet.
import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { SWRConfig } from 'swr';
import type { OutcomesResponse } from '@/types/api';
import OutcomesPage from '@/app/(provincial)/outcomes/page';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({}),
}));

function makeFixture(): OutcomesResponse {
  return {
    totalBirths: 48,
    lbwCount: 6,
    lbwRate: 12.5,
    lowApgarCount: 2,
    avgBirthWeightG: 3050,
    multiples: 3,
    resuscitated: 4,
    trend: [
      { month: '2026-02', births: 30, lbw: 3 },
      { month: '2026-03', births: 41, lbw: 5 },
      { month: '2026-04', births: 38, lbw: 4 },
      { month: '2026-05', births: 45, lbw: 6 },
      { month: '2026-06', births: 52, lbw: 7 },
      { month: '2026-07', births: 48, lbw: 6 },
    ],
    byHospital: [
      { id: 'h-kkh', hcode: '10670', name: 'รพ.ขอนแก่น', births: 30, lbw: 4, lowApgar: 2 },
      { id: 'h-chumphae', hcode: '10998', name: 'รพ.ชุมแพ', births: 18, lbw: 2, lowApgar: 0 },
    ],
    recent: [
      {
        id: 'nb-1',
        journeyId: 'j-1',
        motherName: 'นาง สายฝน อุ่นเรือน',
        hospitalName: 'รพ.ขอนแก่น',
        infantNumber: 2,
        sex: 'F',
        birthWeightG: 2300,
        apgar1min: 7,
        apgar5min: 6,
        resuscitated: true,
        bornAt: new Date().toISOString(),
      },
    ],
  };
}

function renderPage(data: OutcomesResponse = makeFixture()) {
  const fetcher = vi.fn(async (_url: string) => data);
  const utils = render(
    <SWRConfig value={{ fetcher, provider: () => new Map(), dedupingInterval: 0 }}>
      <OutcomesPage />
    </SWRConfig>,
  );
  return { fetcher, ...utils };
}

describe('OutcomesPage — KPI tiles', () => {
  it('renders all six KPIs from the payload with a correct LBW percentage', async () => {
    renderPage();

    const total = await screen.findByTestId('kpi-total');
    expect(within(total).getByText('48')).toBeInTheDocument();

    const lbw = screen.getByTestId('kpi-lbw');
    expect(within(lbw).getByText('6')).toBeInTheDocument();
    expect(within(lbw).getByText(/12\.5%/)).toBeInTheDocument();

    expect(within(screen.getByTestId('kpi-apgar')).getByText('2')).toBeInTheDocument();
    expect(within(screen.getByTestId('kpi-multiples')).getByText('3')).toBeInTheDocument();
    expect(within(screen.getByTestId('kpi-resus')).getByText('4')).toBeInTheDocument();
    expect(within(screen.getByTestId('kpi-avg-weight')).getByText('3,050')).toBeInTheDocument();
  });

  it('defaults to month-to-date and switches ranges via chips', async () => {
    const { fetcher } = renderPage();

    await screen.findByTestId('kpi-total');
    let urls = fetcher.mock.calls.map((c) => String(c[0]));
    expect(urls.some((u) => u.includes('range=mtd'))).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: /30 วัน/ }));
    await waitFor(() => {
      urls = fetcher.mock.calls.map((c) => String(c[0]));
      expect(urls.some((u) => u.includes('range=30d'))).toBe(true);
    });
  });

  it('filters by hospital from the byHospital facet', async () => {
    const { fetcher } = renderPage();

    const select = await screen.findByTestId('filter-hospital');
    expect(within(select).getByText(/รพ.ขอนแก่น \(30\)/)).toBeInTheDocument();

    fireEvent.change(select, { target: { value: 'h-kkh' } });
    await waitFor(() => {
      const urls = fetcher.mock.calls.map((c) => String(c[0]));
      expect(urls.some((u) => u.includes('hospital_id=h-kkh'))).toBe(true);
    });
  });

  it('shows a last-updated stamp', async () => {
    renderPage();
    expect(await screen.findByText(/อัปเดตล่าสุด/)).toBeInTheDocument();
  });
});

describe('OutcomesPage — trend and breakdown', () => {
  it('renders the six-month trend and the hospital breakdown table', async () => {
    renderPage();

    const trend = await screen.findByTestId('outcome-trend');
    expect(within(trend).getByText('52')).toBeInTheDocument(); // June births

    const table = screen.getByTestId('hospital-outcomes');
    const kkh = within(table).getByTestId('hospital-outcome-10670');
    expect(within(kkh).getByText('30')).toBeInTheDocument();
    expect(within(kkh).getByText(/13\.3%/)).toBeInTheDocument(); // 4/30 LBW
  });
});

describe('OutcomesPage — recent births', () => {
  it('masks the mother name, flags LBW and low Apgar, links to the journey', async () => {
    renderPage();

    const row = await screen.findByTestId('birth-row-nb-1');
    expect(within(row).getByText(/นาง สายฝน อ\./)).toBeInTheDocument();
    expect(screen.queryByText(/อุ่นเรือน/)).toBeNull();
    expect(within(row).getByText('LBW')).toBeInTheDocument();
    expect(within(row).getByText(/กู้ชีพ/)).toBeInTheDocument();
    expect(row.getAttribute('href')).toBe('/pregnancies/j-1');
    expect(row.getAttribute('data-low-apgar')).toBe('true');
  });

  it('states honestly that no sync data exists yet when the table is empty', async () => {
    renderPage({
      ...makeFixture(),
      totalBirths: 0,
      lbwCount: 0,
      lbwRate: 0,
      lowApgarCount: 0,
      avgBirthWeightG: 0,
      multiples: 0,
      resuscitated: 0,
      trend: makeFixture().trend.map((t) => ({ ...t, births: 0, lbw: 0 })),
      byHospital: [],
      recent: [],
    });

    expect(await screen.findByText(/ยังไม่มีข้อมูลทารกจากการซิงก์/)).toBeInTheDocument();
  });
});
