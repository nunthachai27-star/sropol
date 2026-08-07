/* @vitest-environment jsdom */
/* @vitest-environment-options { "url": "http://localhost/" } */
// Task 16: hospital route group + maternity-ward page layout shell.
// Verifies the (hospital) layout wires SessionProvider + BmsSessionProvider +
// TopNavBar around the page, that the page shows the BMS-session prompt
// when no session is present, and surfaces session-retrieval errors.
// next-auth and next/navigation are mocked so the layout renders synchronously.
// Post-session render (header summary, room/bed grid) is covered by
// tests/integration/hospital-maternity-ward-page.test.tsx (Task 25).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import HospitalLayout from '@/app/(hospital)/layout';
import HospitalMaternityWardPage from '@/app/(hospital)/hospital-maternity-ward/page';

const mockFetch = vi.fn();
global.fetch = mockFetch as unknown as typeof fetch;

// PasteJSON (session-retrieval) response for the current test. Every other
// fetch — notably TopNavBar's presence heartbeat, which fires because the
// mocked session carries a userId — routes to a benign 200 so
// `fetch(...).catch()` in sendHeartbeat has a real promise to chain onto.
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
vi.mock('next/navigation', () => ({
  usePathname: () => '/hospital-maternity-ward',
  useRouter: () => ({ push: () => {}, back: () => {}, replace: () => {}, prefetch: () => {} }),
}));

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

  it('renders the hospital-variant top navbar: ห้องคลอด label, no provincial nav links (design §4.2)', async () => {
    render(
      <HospitalLayout>
        <HospitalMaternityWardPage />
      </HospitalLayout>,
    );
    expect(await screen.findByText('ห้องคลอด')).toBeInTheDocument();
    for (const label of ['แดชบอร์ด', 'ฝากครรภ์', 'โรงพยาบาล', 'ส่งต่อ', 'ผลลัพธ์ทารก']) {
      expect(screen.queryByText(label)).not.toBeInTheDocument();
    }
  });

  it('shows error UI on retrieve failure', async () => {
    sessionResolver = () =>
      Promise.resolve({
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
