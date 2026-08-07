/* @vitest-environment jsdom */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TopNavBar } from '@/components/layout/TopNavBar';

const mockSignOut = vi.fn();
vi.mock('next-auth/react', () => ({
  useSession: vi.fn(),
  signOut: (...args: unknown[]) => mockSignOut(...args),
}));
vi.mock('next/navigation', () => ({
  usePathname: () => '/',
}));

import { useSession } from 'next-auth/react';
const mockUseSession = useSession as unknown as ReturnType<typeof vi.fn>;

const baseSession = {
  data: {
    user: {
      id: 'u1',
      name: 'นางทดสอบ',
      role: 'NURSE' as const,
      hospitalCode: '10670',
      hospitalName: 'รพ.ขอนแก่น',
      tunnelUrl: '',
      databaseType: 'mysql',
    },
  },
};

describe('TopNavBar — provincial variant (default)', () => {
  it('renders all 6 non-admin nav items for a NURSE', async () => {
    mockUseSession.mockReturnValue(baseSession);
    render(<TopNavBar />);
    for (const label of [
      'แดชบอร์ด',
      'ฝากครรภ์',
      'โรงพยาบาล',
      'ส่งต่อ',
      'ผลลัพธ์ทารก',
      'ห้องคลอด',
    ]) {
      expect(await screen.findByText(label)).toBeInTheDocument();
    }
    expect(screen.queryByText('ตั้งค่า')).not.toBeInTheDocument();
  });

  it('shows ตั้งค่า nav item for ADMIN', async () => {
    mockUseSession.mockReturnValue({
      data: { ...baseSession.data, user: { ...baseSession.data.user, role: 'ADMIN' } },
    });
    render(<TopNavBar />);
    expect(await screen.findByText('ตั้งค่า')).toBeInTheDocument();
  });

  it('renders hospital badge with name + hcode', async () => {
    mockUseSession.mockReturnValue(baseSession);
    render(<TopNavBar />);
    expect(await screen.findByText(/รพ\.ขอนแก่น/)).toBeInTheDocument();
    expect(screen.getByText(/10670/)).toBeInTheDocument();
  });

  it('renders user name', async () => {
    mockUseSession.mockReturnValue(baseSession);
    render(<TopNavBar />);
    expect(await screen.findByText('นางทดสอบ')).toBeInTheDocument();
  });

  it('logout button calls signOut with /login callbackUrl', async () => {
    mockUseSession.mockReturnValue(baseSession);
    render(<TopNavBar />);
    const logoutBtn = await screen.findByLabelText(/ออกจากระบบ/);
    fireEvent.click(logoutBtn);
    expect(mockSignOut).toHaveBeenCalledWith({ callbackUrl: '/login' });
  });
});

describe('TopNavBar — hospital variant', () => {
  it('renders only the ห้องคลอด label, no provincial nav links (design §4.2)', async () => {
    mockUseSession.mockReturnValue(baseSession);
    render(<TopNavBar variant="hospital" />);
    expect(await screen.findByText('ห้องคลอด')).toBeInTheDocument();
    for (const label of ['แดชบอร์ด', 'ฝากครรภ์', 'โรงพยาบาล', 'ส่งต่อ', 'ผลลัพธ์ทารก', 'ตั้งค่า']) {
      expect(screen.queryByText(label)).not.toBeInTheDocument();
    }
  });

  it('hides the provincial nav even for an ADMIN', async () => {
    mockUseSession.mockReturnValue({
      data: { ...baseSession.data, user: { ...baseSession.data.user, role: 'ADMIN' } },
    });
    render(<TopNavBar variant="hospital" />);
    await screen.findByLabelText(/ออกจากระบบ/);
    expect(screen.queryByText('ตั้งค่า')).not.toBeInTheDocument();
  });

  it('still renders hospital badge, user name, and logout button', async () => {
    mockUseSession.mockReturnValue(baseSession);
    render(<TopNavBar variant="hospital" />);
    expect(await screen.findByText(/รพ\.ขอนแก่น/)).toBeInTheDocument();
    expect(screen.getByText(/10670/)).toBeInTheDocument();
    expect(screen.getByText('นางทดสอบ')).toBeInTheDocument();
    expect(screen.getByLabelText(/ออกจากระบบ/)).toBeInTheDocument();
  });

  it('renders the notification-settings link un-hidden and linked to /profile', async () => {
    mockUseSession.mockReturnValue(baseSession);
    render(<TopNavBar variant="hospital" />);
    const link = await screen.findByRole('link', { name: 'การตั้งค่าการแจ้งเตือน' });
    expect(link).toBeInTheDocument();
    // Regression: the link must NOT be visibility-hidden at any breakpoint
    // (was `hidden ... md:inline-flex` — invisible on mobile). toBeVisible
    // fails if Tailwind `hidden` is present.
    expect(link).toBeVisible();
    expect(link).toHaveAttribute('href', '/profile');
  });
});
