/* @vitest-environment jsdom */
/* @vitest-environment-options { "url": "http://localhost/" } */
// Task 28: integration test that exercises the maternity-ward page one layer
// deeper than the Task 25 test. Instead of mocking @/services/maternity-ward,
// it boots an in-process mock BMS HTTP server (Task 26 helper) and lets the
// real `executeSql` browser client (src/lib/bms-browser-client.ts) hit it via
// native fetch. Only the PasteJSON session-retrieval URL is intercepted —
// every other fetch falls through to the real network call against the mock
// server's 127.0.0.1:port URL.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { SWRConfig } from 'swr';
import type { ReactNode } from 'react';
import HospitalLayout from '@/app/(hospital)/layout';
import HospitalMaternityWardPage from '@/app/(hospital)/hospital-maternity-ward/page';
import { createMockBmsServer, type MockBmsServer } from '../helpers/createMockBmsServer';

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

const PASTE_JSON_URL = 'https://hosxp.net/phapi/PasteJSON';

let server: MockBmsServer;
let originalFetch: typeof fetch;

beforeEach(async () => {
  server = await createMockBmsServer();
  document.cookie = 'bms-session-id=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/';
  document.cookie = 'marketplace_token=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/';
  localStorage.clear();
  window.history.replaceState({}, '', 'http://localhost/');

  // Intercept ONLY the PasteJSON URL; everything else (including the
  // 127.0.0.1:<port> mock server URL) falls through to the real native fetch.
  originalFetch = global.fetch;
  global.fetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url =
      typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    if (url.startsWith(PASTE_JSON_URL)) {
      // Real PasteJSON shape (verified live): connection details nest under
      // result.user_info; bms_session_code is the bearer token (key_value as
      // a fallback). Top-level jwt/bms_url do NOT exist in the real response.
      return new Response(
        JSON.stringify({
          result: {
            user_info: {
              bms_url: server.url,
              bms_session_code: 'mock-bearer',
              loginname: 'nurse1',
              fullname: 'Nurse One',
              hospcode: '10670',
            },
            key_value: 'mock-bearer',
            expired_second: 3600,
          },
          MessageCode: 200,
          Message: 'OK',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }
    return originalFetch(input, init);
  }) as typeof fetch;
});

afterEach(async () => {
  global.fetch = originalFetch;
  await server.close();
});

const PAGE = (
  <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
    <HospitalLayout>
      <HospitalMaternityWardPage />
    </HospitalLayout>
  </SWRConfig>
);

describe('Maternity ward page (against in-process mock BMS server)', () => {
  it('renders ward header + 4 bed tiles after a real BMS roundtrip', async () => {
    server.setSqlResponse('FROM ward', [{ ward: '03', name: 'ห้องคลอด', real_bedcount: 4 }]);
    server.setSqlResponse('FROM bedno', [
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
    server.setSqlResponse('FROM ipt i', [
      {
        an: 'AN1',
        hn: 'HN1',
        regdate: '2026-04-19',
        regtime: '10:00:00',
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

    window.history.replaceState({}, '', 'http://localhost/?bms-session-id=fake-sid');
    render(PAGE);

    // The clinical-density redesign renders a KPI masthead + WardLayoutViewFull
    // dense tiles. Wait for the occupancy roundtrip to place the patient into
    // bed 01 (name is masked for PDPA → "นาง A.").
    await waitFor(
      () => {
        expect(screen.getByText(/นาง A/)).toBeInTheDocument();
      },
      { timeout: 3000 },
    );

    // Two rooms render (room_name from the bedno inventory)
    expect(screen.getByText('LR1')).toBeInTheDocument();
    expect(screen.getByText('LR2')).toBeInTheDocument();
    // KPI masthead summarises the ward. "Total Beds" / "Occupied" are unique to
    // the masthead; the "Available" KPI label is intentionally not asserted here
    // because the empty BedTileFull tiles also carry an "Available" status pill.
    expect(screen.getByText('Total Beds')).toBeInTheDocument();
    expect(screen.getByText('Occupied')).toBeInTheDocument();
    // 3 empty beds (occupant lookup uses bedno; the only occupant is at bed 01)
    const empty = screen.getAllByText('ว่าง');
    expect(empty.length).toBe(3);
  });

  it('mock server received SQL queries for wards, beds, and occupancy', async () => {
    server.setSqlResponse('FROM ward', [{ ward: '03', name: 'ห้องคลอด', real_bedcount: 0 }]);
    server.setSqlResponse('FROM bedno', []);
    server.setSqlResponse('FROM ipt i', []);

    window.history.replaceState({}, '', 'http://localhost/?bms-session-id=fake-sid');
    render(PAGE);

    await waitFor(
      () => {
        const sqlRequests = server.recordedRequests.filter((r) => r.path === '/api/sql');
        expect(sqlRequests.length).toBeGreaterThanOrEqual(3);
      },
      { timeout: 3000 },
    );

    const sqls = server.recordedRequests
      .filter((r) => r.path === '/api/sql')
      .map((r) => (r.body as { sql: string }).sql);
    expect(sqls.some((s) => s.includes('FROM ward'))).toBe(true);
    expect(sqls.some((s) => s.includes('FROM bedno'))).toBe(true);
    expect(sqls.some((s) => s.includes('FROM ipt i'))).toBe(true);
  });
});
