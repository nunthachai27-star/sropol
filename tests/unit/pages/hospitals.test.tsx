// Hospitals network board — behavior tests for the redesigned directory.
// Sync freshness must be visible per hospital (constitution V), ANC must be a
// first-class axis alongside labor, and rows must order by real workload.
import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { SWRConfig } from 'swr';
import type { DashboardHospital } from '@/types/api';
import HospitalsPage from '@/app/(provincial)/hospitals/page';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({}),
}));

// Leaflet cannot render in jsdom — stub the map, keep the props contract.
vi.mock('@/components/dashboard/ProvinceMap', () => ({
  ProvinceMap: ({ hospitals }: { hospitals: DashboardHospital[] }) => (
    <div data-testid="map-stub" data-pin-count={hospitals.length} />
  ),
}));

const MIN = 60_000;

function iso(msAgo: number): string {
  return new Date(Date.now() - msAgo).toISOString();
}

// Real KK hcodes so the จ.ขอนแก่น tab filter keeps them visible.
function makeHospitals(): DashboardHospital[] {
  return [
    {
      hcode: '10670',
      name: 'รพ.ขอนแก่น',
      level: 'A_S' as DashboardHospital['level'],
      connectionStatus: 'ONLINE' as DashboardHospital['connectionStatus'],
      lastSyncAt: iso(13 * 24 * 60 * MIN), // 13 days stale → critical
      counts: { low: 0, medium: 0, high: 0, total: 0 },
      ancCounts: { total: 62, hr3: 5 },
      partographQuality: { laborRecent: 10, withPartograph: 2 }, // 20% → critical
      syncStatus: 'OK' as DashboardHospital['syncStatus'],
      syncBlockedReason: null,
    },
    {
      hcode: '10995',
      name: 'รพ.บ้านฝาง',
      level: 'M2' as DashboardHospital['level'],
      connectionStatus: 'ONLINE' as DashboardHospital['connectionStatus'],
      lastSyncAt: iso(2 * MIN), // fresh
      counts: { low: 1, medium: 0, high: 0, total: 1 },
      ancCounts: { total: 215, hr3: 20 },
      partographQuality: { laborRecent: 4, withPartograph: 3 }, // 75% → ok
      syncStatus: 'OK' as DashboardHospital['syncStatus'],
      syncBlockedReason: null,
    },
    {
      hcode: '10996',
      name: 'รพ.พระยืน',
      level: 'M2' as DashboardHospital['level'],
      connectionStatus: 'OFFLINE' as DashboardHospital['connectionStatus'],
      lastSyncAt: null,
      counts: { low: 0, medium: 0, high: 0, total: 0 },
      ancCounts: { total: 10, hr3: 0 },
      partographQuality: { laborRecent: 0, withPartograph: 0 }, // no admissions → none
      syncStatus: 'BLOCKED' as DashboardHospital['syncStatus'],
      syncBlockedReason: 'missing_marketplace_token',
    },
  ];
}

function renderPage(hospitals: DashboardHospital[] = makeHospitals()) {
  const payload = { hospitals, updatedAt: new Date().toISOString() };
  const fetcher = vi.fn(async (_url: string) => payload);
  const utils = render(
    <SWRConfig value={{ fetcher, provider: () => new Map(), dedupingInterval: 0 }}>
      <HospitalsPage />
    </SWRConfig>,
  );
  return { fetcher, ...utils };
}

describe('HospitalsPage — KPI strip', () => {
  it('shows the ANC registry as a first-class KPI (total + HR3)', async () => {
    renderPage();

    const anc = await screen.findByTestId('kpi-anc');
    expect(within(anc).getByText('287')).toBeInTheDocument(); // 62 + 215 + 10
    expect(within(anc).getByText(/HR3 25/)).toBeInTheDocument(); // 5 + 20
  });

  it('breaks sync health down instead of a binary online count', async () => {
    renderPage();

    const sync = await screen.findByTestId('kpi-sync');
    // Only one hospital has fresh data.
    expect(within(sync).getByText('1')).toBeInTheDocument();
    expect(within(sync).getByText(/ถูกบล็อก 1/)).toBeInTheDocument();
    expect(within(sync).getByText(/ช้า 1/)).toBeInTheDocument();
  });

  it('shows a last-updated stamp in the header', async () => {
    renderPage();
    expect(await screen.findByText(/อัปเดตล่าสุด/)).toBeInTheDocument();
  });
});

describe('HospitalsPage — roster rows', () => {
  it('classifies each row by sync freshness and shows relative sync age', async () => {
    renderPage();

    const hub = await screen.findByTestId('hospital-row-10670');
    expect(hub.getAttribute('data-sync')).toBe('critical');
    expect(within(hub).getByText(/13 วัน/)).toBeInTheDocument();

    expect(screen.getByTestId('hospital-row-10995').getAttribute('data-sync')).toBe('ok');

    const blocked = screen.getByTestId('hospital-row-10996');
    expect(blocked.getAttribute('data-sync')).toBe('blocked');
    expect(within(blocked).getByText(/ถูกบล็อก/)).toBeInTheDocument();
  });

  it('shows ANC and labor counts per row', async () => {
    renderPage();

    const row = await screen.findByTestId('hospital-row-10995');
    expect(within(row).getByText('215')).toBeInTheDocument(); // ANC
    expect(within(row).getByText('1')).toBeInTheDocument(); // labor
  });

  it('orders rows within a level group by combined workload, busiest first', async () => {
    renderPage();

    await screen.findByTestId('hospital-row-10995');
    const rows = screen.getAllByTestId(/hospital-row-/);
    const codes = rows.map((r) => r.getAttribute('data-testid'));
    // Both M2 hospitals: บ้านฝาง (workload ~22.5) before พระยืน (~1).
    expect(codes.indexOf('hospital-row-10995')).toBeLessThan(codes.indexOf('hospital-row-10996'));
  });

  it('shows the partograph data-quality KPI and per-row coverage', async () => {
    renderPage();

    // Province KPI: 5 of 14 recent admissions charted → 36%, one hospital
    // below the quality threshold.
    const kpi = await screen.findByTestId('kpi-partograph');
    expect(kpi.textContent).toContain('36%');
    expect(kpi.textContent).toMatch(/ต่ำกว่าเกณฑ์\s*1/);

    // Per-row coverage cell, colored by the config thresholds.
    const critical = within(screen.getByTestId('hospital-row-10670')).getByTestId('parto-cell');
    expect(critical.getAttribute('data-parto')).toBe('critical');
    expect(critical.textContent).toContain('2/10');

    const none = within(screen.getByTestId('hospital-row-10996')).getByTestId('parto-cell');
    expect(none.getAttribute('data-parto')).toBe('none');
  });
});
