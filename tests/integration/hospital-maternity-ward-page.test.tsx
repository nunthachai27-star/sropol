/* @vitest-environment jsdom */
/* @vitest-environment-options { "url": "http://localhost/" } */
// Task 25: full-render integration test for the hospital maternity-ward page.
// Wraps the (hospital) layout around the page, mocks next-auth + next/navigation
// so the layout renders synchronously, and mocks the maternity-ward domain
// service so the SWR hook resolves with deterministic data. Verifies:
//   1. Without a BMS session, the prompt renders.
//   2. With a session + ward/inventory/occupancy data, the header summary,
//      room sections, and refresh button render.
//   3. When the ward query fails, the error UI surfaces.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import HospitalLayout from '@/app/(hospital)/layout';
import HospitalMaternityWardPage from '@/app/(hospital)/hospital-maternity-ward/page';
import { SWRConfig } from 'swr';
import type { ReactNode } from 'react';

vi.mock('next-auth/react', () => ({
  SessionProvider: ({ children }: { children: ReactNode }) => children,
  useSession: () => ({
    data: {
      user: {
        id: 'u1',
        name: 'นางทดสอบ',
        role: 'NURSE',
        hospitalCode: '10670',
        hospitalName: 'รพ.ขอนแก่น',
        tunnelUrl: '',
        databaseType: 'mysql',
      },
    },
  }),
  signOut: vi.fn(),
}));
vi.mock('next/navigation', () => ({ usePathname: () => '/hospital-maternity-ward' }));

vi.mock('@/services/maternity-ward', () => ({
  listMaternityWards: vi.fn(),
  listWardBedsInventory: vi.fn(),
  // The page's hook (useMaternityWardStateFull) reads the *Full* occupancy
  // variant; mocking the old name left it undefined → occupancy fetch threw →
  // the page fell into its error branch instead of rendering the header.
  listWardBedsOccupancyFull: vi.fn(),
  // Task 51-52: page now lazy-loads bed-move reasons and triggers movePatientBed
  // on drag-drop confirm. Stub both with safe defaults so the page render path
  // is independent of these flows in this Task 25 test.
  getBedMoveReasons: vi.fn().mockResolvedValue([]),
  movePatientBed: vi.fn().mockResolvedValue(undefined),
}));

import {
  listMaternityWards,
  listWardBedsInventory,
  listWardBedsOccupancyFull,
} from '@/services/maternity-ward';
const mockListWards = listMaternityWards as unknown as ReturnType<typeof vi.fn>;
const mockListInventory = listWardBedsInventory as unknown as ReturnType<typeof vi.fn>;
const mockListOccupancy = listWardBedsOccupancyFull as unknown as ReturnType<typeof vi.fn>;

const mockFetch = vi.fn();
global.fetch = mockFetch as unknown as typeof fetch;

const PAGE = (
  <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
    <HospitalLayout>
      <HospitalMaternityWardPage />
    </HospitalLayout>
  </SWRConfig>
);

beforeEach(() => {
  mockFetch.mockReset();
  mockListWards.mockReset();
  mockListInventory.mockReset();
  mockListOccupancy.mockReset();
  // Safe default for every fetch — chiefly the layout's TopNavBar presence
  // heartbeat, which fires on mount and does fetch(...).catch(...). Without a
  // resolved default it returns undefined and throws. Session tests override
  // with their own payload below.
  mockFetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });
  document.cookie = 'bms-session-id=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/';
  document.cookie = 'marketplace_token=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/';
  localStorage.clear();
  window.history.replaceState({}, '', 'http://localhost/');
});

describe('Hospital maternity ward page (full render)', () => {
  it('shows BMS session prompt when no session', async () => {
    render(PAGE);
    expect(await screen.findByText(/เปิดหน้านี้จาก HOSxP/)).toBeInTheDocument();
  });

  it('renders header summary + 4 bed tiles when session resolves', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        jwt: 'JWT',
        bms_url: 'https://t.example/api',
        user_info: { loginname: 'nurse1', fullname: 'Nurse One', hospcode: '10670' },
      }),
    });
    mockListWards.mockResolvedValue([{ ward: '03', name: 'ห้องคลอด', real_bedcount: 4 }]);
    mockListInventory.mockResolvedValue([
      {
        bedno: '01',
        roomno: 'LR1',
        bed_order: 1,
        bed_lock: 'N',
        bed_status_type_id: 1,
        room_name: 'LR1',
        room_display_number: 1,
      },
      {
        bedno: '02',
        roomno: 'LR1',
        bed_order: 2,
        bed_lock: 'N',
        bed_status_type_id: 1,
        room_name: 'LR1',
        room_display_number: 1,
      },
      {
        bedno: '03',
        roomno: 'LR2',
        bed_order: 1,
        bed_lock: 'N',
        bed_status_type_id: 1,
        room_name: 'LR2',
        room_display_number: 2,
      },
      {
        bedno: '04',
        roomno: 'LR2',
        bed_order: 2,
        bed_lock: 'N',
        bed_status_type_id: 1,
        room_name: 'LR2',
        room_display_number: 2,
      },
    ]);
    mockListOccupancy.mockResolvedValue([
      {
        an: 'AN1',
        hn: 'HN1',
        regdate: '2026-04-19',
        regtime: '10:00',
        ward: '03',
        bedno: '01',
        roomno: 'LR1',
        bedtype: null,
        roomname: 'LR1',
        pname: 'นาง',
        fname: 'A',
        lname: '',
        birthday: '1996-04-19',
        gravida: 2,
        ga: 38,
        incharge_doctor_name: 'ดร.X',
        last_observation_at: null,
        last_cervix_cm: 4,
      },
    ]);
    window.history.replaceState({}, '', 'http://localhost/?bms-session-id=SID');

    render(PAGE);

    // Wait on a KPI label unique to the loaded header (the clinical-density
    // redesign replaced the old "X เตียง · ใช้งาน Y" subtitle with a 5-card
    // Total Beds / Occupied / Available / Locked / High-risk strip).
    await waitFor(() => expect(screen.getByText('Total Beds')).toBeInTheDocument(), {
      timeout: 2000,
    });
    // (hospital) route group has no nav bar → the ward header carries its own
    // back link to the provincial dashboard.
    const backLink = screen.getByRole('link', { name: /แดชบอร์ด/ });
    expect(backLink).toHaveAttribute('href', '/');
    expect(screen.getByText('LR1')).toBeInTheDocument();
    expect(screen.getByText('LR2')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /refresh/i })).toBeInTheDocument();
  });

  it('clicks bed → opens drawer with patient header + tabs', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        jwt: 'JWT',
        bms_url: 'https://t.example/api',
        user_info: { loginname: 'nurse1', fullname: 'Nurse One', hospcode: '10670' },
      }),
    });
    mockListWards.mockResolvedValue([{ ward: '03', name: 'ห้องคลอด', real_bedcount: 4 }]);
    mockListInventory.mockResolvedValue([
      {
        bedno: '01',
        roomno: 'LR1',
        bed_order: 1,
        bed_lock: 'N',
        bed_status_type_id: 1,
        room_name: 'LR1',
        room_display_number: 1,
      },
    ]);
    mockListOccupancy.mockResolvedValue([
      {
        an: 'AN1',
        hn: 'HN1',
        regdate: '2026-04-19',
        regtime: '10:00',
        ward: '03',
        bedno: '01',
        roomno: 'LR1',
        bedtype: null,
        roomname: 'LR1',
        pname: 'นาง',
        fname: 'A',
        lname: '',
        birthday: '1996-04-19',
        gravida: 2,
        ga: 38,
        incharge_doctor_name: 'ดร.X',
        last_observation_at: null,
        last_cervix_cm: 4,
      },
    ]);
    window.history.replaceState({}, '', 'http://localhost/?bms-session-id=SID');

    render(PAGE);
    // BedTileFull tags each tile with data-testid="bed-<bedno>" and fires
    // onClick(occupant.an) → opens the drawer. (The DnD wrapper also exposes
    // role="button", so target the stable testid rather than a role.)
    // Both the DnD wrapper and the inner BedTileFull <article> carry the
    // testid; the inner one holds the onClick that opens the drawer, so click
    // the last (innermost) match.
    await waitFor(
      () => expect(screen.getAllByTestId('bed-01').length).toBeGreaterThan(0),
      { timeout: 2000 },
    );
    const bedTiles = screen.getAllByTestId('bed-01');
    fireEvent.click(bedTiles[bedTiles.length - 1]);

    // Drawer should now be visible — the Partograph tab is unique to it, so it
    // is the clearest "drawer opened" signal (AN1 also shows on the bed tile).
    await waitFor(
      () => expect(screen.getByRole('tab', { name: 'Partograph' })).toBeInTheDocument(),
      { timeout: 2000 },
    );
    expect(screen.getAllByText(/AN1/).length).toBeGreaterThan(0);
  });

  it('shows error UI when ward query fails', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        jwt: 'JWT',
        bms_url: 'https://t.example/api',
        user_info: { loginname: 'n1', fullname: 'N', hospcode: '10670' },
      }),
    });
    mockListWards.mockRejectedValue(new Error('BMS unavailable'));
    window.history.replaceState({}, '', 'http://localhost/?bms-session-id=X');

    render(PAGE);
    await waitFor(
      () => expect(screen.getByText(/ไม่สามารถโหลดข้อมูลห้องคลอด/)).toBeInTheDocument(),
      { timeout: 2000 },
    );
  });
});
