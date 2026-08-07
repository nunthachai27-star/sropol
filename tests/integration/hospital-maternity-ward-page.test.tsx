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
vi.mock('next/navigation', () => ({ usePathname: () => '/hospital-maternity-ward', useRouter: () => ({ push: () => {}, back: () => {}, replace: () => {}, prefetch: () => {} }) }));

vi.mock('@/services/maternity-ward', () => ({
  listMaternityWards: vi.fn(),
  listWardBedsInventory: vi.fn(),
  // The redesigned page reads occupancy through useMaternityWardStateFull, which
  // calls listWardBedsOccupancyFull (the clinical-density query). The lite
  // listWardBedsOccupancy is kept mocked too so any stray import stays safe.
  listWardBedsOccupancy: vi.fn(),
  listWardBedsOccupancyFull: vi.fn(),
  // Task 51-52: page now lazy-loads bed-move reasons and triggers movePatientBed
  // on drag-drop confirm. Stub both with safe defaults so the page render path
  // is independent of these flows in this test.
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
const mockListOccupancyFull = listWardBedsOccupancyFull as unknown as ReturnType<typeof vi.fn>;

const mockFetch = vi.fn();
global.fetch = mockFetch as unknown as typeof fetch;

// PasteJSON (session-retrieval) response for the current test. Every other
// fetch — the TopNavBar presence heartbeat (fires because the mocked session
// carries a userId) and any skipped onboarding/poll calls — routes to a benign
// 200 so sendHeartbeat's `fetch(...).catch()` always has a real promise.
let sessionResolver: () => Promise<unknown>;

function benignResponse(): Promise<unknown> {
  return Promise.resolve({
    ok: true,
    status: 200,
    statusText: 'OK',
    json: async () => ({}),
    text: async () => '',
    clone() {
      return this;
    },
  });
}

const PAGE = (
  <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
    <HospitalLayout>
      <HospitalMaternityWardPage />
    </HospitalLayout>
  </SWRConfig>
);

beforeEach(() => {
  mockFetch.mockReset();
  sessionResolver = benignResponse;
  mockFetch.mockImplementation((input: RequestInfo | URL) => {
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : (input as Request).url;
    if (url.startsWith('https://hosxp.net/phapi/PasteJSON')) {
      return sessionResolver();
    }
    return benignResponse();
  });
  mockListWards.mockReset();
  mockListInventory.mockReset();
  mockListOccupancyFull.mockReset();
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
    sessionResolver = () =>
      Promise.resolve({
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
    mockListOccupancyFull.mockResolvedValue([
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

    // Wait for the full data roundtrip: the (masked) occupant only renders once
    // wards + inventory + occupancy-full have all resolved and the dense tile
    // mounts into bed 01.
    await waitFor(() => expect(screen.getByText(/นาง A/)).toBeInTheDocument(), {
      timeout: 2000,
    });
    // Masthead heading (the h1 carries a trailing accent "." span).
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('ห้องคลอด');
    // KPI masthead summary — Total Beds / Occupied are unique to the masthead
    // (the "Available" label collides with the empty-tile status pill).
    expect(screen.getByText('Total Beds')).toBeInTheDocument();
    expect(screen.getByText('Occupied')).toBeInTheDocument();
    // Both rooms render (room_name from the bedno inventory).
    expect(screen.getByText('LR1')).toBeInTheDocument();
    expect(screen.getByText('LR2')).toBeInTheDocument();
    // One occupied + three empty beds.
    expect(screen.getAllByText('ว่าง').length).toBe(3);
    // Refresh control (redesign labels it "Refresh ↻").
    expect(screen.getByRole('button', { name: /Refresh/i })).toBeInTheDocument();
  });

  it('clicks bed → opens drawer with patient header + tabs', async () => {
    sessionResolver = () =>
      Promise.resolve({
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
    mockListOccupancyFull.mockResolvedValue([
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
    // The dense BedTileFull renders identity/vitals but carries no "เตียง NN"
    // aria-label — the whole <article> is the click target (onClick → onBedClick).
    // Click via the masked patient name, which sits inside the occupied tile so
    // the click bubbles to the article's handler.
    await waitFor(() => expect(screen.getByText(/นาง A/)).toBeInTheDocument(), {
      timeout: 2000,
    });
    fireEvent.click(screen.getByText(/นาง A/));

    // Drawer opens (role="dialog") with the patient's AN in the header + 10 tabs.
    // AN also appears on the tile, so assert the drawer itself, not a bare /AN1/.
    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument(), {
      timeout: 2000,
    });
    expect(screen.getByText('AN AN1')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Partograph' })).toBeInTheDocument();
  });

  it('shows error UI when ward query fails', async () => {
    sessionResolver = () =>
      Promise.resolve({
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
