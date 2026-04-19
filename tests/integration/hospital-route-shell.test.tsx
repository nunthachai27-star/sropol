/* @vitest-environment jsdom */
/* @vitest-environment-options { "url": "http://localhost/" } */
// Task 16: hospital route group + maternity-ward stub page.
// Verifies the (hospital) layout wires SessionProvider + BmsSessionProvider +
// TopNavBar around the page, that the stub page shows the BMS-session prompt
// when no session is present, hydrates from a URL bms-session-id, and surfaces
// retrieval errors. next-auth and next/navigation are mocked so the layout
// renders synchronously without a real session/router.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import HospitalLayout from '@/app/(hospital)/layout';
import HospitalMaternityWardPage from '@/app/(hospital)/hospital-maternity-ward/page';

const mockFetch = vi.fn();
global.fetch = mockFetch as unknown as typeof fetch;

vi.mock('next-auth/react', () => ({
  SessionProvider: ({ children }: { children: React.ReactNode }) => children,
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

beforeEach(() => {
  mockFetch.mockReset();
  document.cookie = 'bms-session-id=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/';
  document.cookie = 'marketplace_token=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/';
  localStorage.clear();
  window.history.replaceState({}, '', 'http://localhost/');
});

describe('Hospital route shell', () => {
  it('renders the BMS-session prompt when no session is present', async () => {
    render(
      <HospitalLayout>
        <HospitalMaternityWardPage />
      </HospitalLayout>,
    );
    expect(await screen.findByText(/เปิดหน้านี้จาก HOSxP/)).toBeInTheDocument();
  });

  it('renders the welcome page after URL bms-session-id resolves', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        jwt: 'JWT',
        bms_url: 'https://t.example/api',
        user_info: { loginname: 'nurse1', fullname: 'Nurse One', hospcode: '10670' },
      }),
    });
    window.history.replaceState({}, '', 'http://localhost/?bms-session-id=SID');
    render(
      <HospitalLayout>
        <HospitalMaternityWardPage />
      </HospitalLayout>,
    );
    await waitFor(() => expect(screen.getByText(/ห้องคลอด — Nurse One/)).toBeInTheDocument(), {
      timeout: 2000,
    });
    expect(screen.getByText(/โรงพยาบาล: 10670/)).toBeInTheDocument();
  });

  it('renders the top navbar inside the hospital layout', async () => {
    render(
      <HospitalLayout>
        <HospitalMaternityWardPage />
      </HospitalLayout>,
    );
    expect(screen.getByText('แดชบอร์ด')).toBeInTheDocument();
    expect(screen.getByText('ห้องคลอด')).toBeInTheDocument();
  });

  it('shows error UI on retrieve failure', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
      text: async () => 'expired',
    });
    window.history.replaceState({}, '', 'http://localhost/?bms-session-id=BAD');
    render(
      <HospitalLayout>
        <HospitalMaternityWardPage />
      </HospitalLayout>,
    );
    await waitFor(() => expect(screen.getByText(/เกิดข้อผิดพลาด/)).toBeInTheDocument(), {
      timeout: 2000,
    });
  });
});
