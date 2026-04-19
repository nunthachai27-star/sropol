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
  listWardBedsOccupancy: vi.fn(),
}));

import {
  listMaternityWards,
  listWardBedsInventory,
  listWardBedsOccupancy,
} from '@/services/maternity-ward';
const mockListWards = listMaternityWards as unknown as ReturnType<typeof vi.fn>;
const mockListInventory = listWardBedsInventory as unknown as ReturnType<typeof vi.fn>;
const mockListOccupancy = listWardBedsOccupancy as unknown as ReturnType<typeof vi.fn>;

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
    mockFetch.mockResolvedValueOnce({
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

    await waitFor(() => expect(screen.getByText('ห้องคลอด')).toBeInTheDocument(), {
      timeout: 2000,
    });
    await waitFor(
      () => expect(screen.getByText(/4 เตียง · ใช้งาน 1 · ว่าง 3/)).toBeInTheDocument(),
      { timeout: 2000 },
    );
    expect(screen.getByText('LR1')).toBeInTheDocument();
    expect(screen.getByText('LR2')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /รีเฟรช/ })).toBeInTheDocument();
  });

  it('clicks bed → opens drawer with patient header + tabs', async () => {
    mockFetch.mockResolvedValueOnce({
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
    await waitFor(
      () => expect(screen.getByRole('button', { name: /เตียง 01/i })).toBeInTheDocument(),
      { timeout: 2000 },
    );
    fireEvent.click(screen.getByRole('button', { name: /เตียง 01/i }));

    // Drawer should now be visible with the patient's AN in header + 10 tabs
    await waitFor(() => expect(screen.getByText(/AN1/)).toBeInTheDocument(), {
      timeout: 2000,
    });
    expect(screen.getByRole('tab', { name: 'Partograph' })).toBeInTheDocument();
  });

  it('shows error UI when ward query fails', async () => {
    mockFetch.mockResolvedValueOnce({
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
