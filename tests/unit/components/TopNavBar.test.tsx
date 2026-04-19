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

describe('TopNavBar', () => {
  it('renders all 6 non-admin nav items for a NURSE', () => {
    mockUseSession.mockReturnValue(baseSession);
    render(<TopNavBar />);
    for (const label of ['แดชบอร์ด', 'ฝากครรภ์', 'โรงพยาบาล', 'ส่งต่อ', 'ผลลัพธ์ทารก', 'ห้องคลอด']) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    expect(screen.queryByText('ตั้งค่า')).not.toBeInTheDocument();
  });

  it('shows ตั้งค่า nav item for ADMIN', () => {
    mockUseSession.mockReturnValue({
      data: { ...baseSession.data, user: { ...baseSession.data.user, role: 'ADMIN' } },
    });
    render(<TopNavBar />);
    expect(screen.getByText('ตั้งค่า')).toBeInTheDocument();
  });

  it('renders hospital badge with name + hcode', () => {
    mockUseSession.mockReturnValue(baseSession);
    render(<TopNavBar />);
    expect(screen.getByText(/รพ\.ขอนแก่น/)).toBeInTheDocument();
    expect(screen.getByText(/10670/)).toBeInTheDocument();
  });

  it('renders user name', () => {
    mockUseSession.mockReturnValue(baseSession);
    render(<TopNavBar />);
    expect(screen.getByText('นางทดสอบ')).toBeInTheDocument();
  });

  it('logout button calls signOut with /login callbackUrl', () => {
    mockUseSession.mockReturnValue(baseSession);
    render(<TopNavBar />);
    const logoutBtn = screen.getByLabelText(/ออกจากระบบ/);
    fireEvent.click(logoutBtn);
    expect(mockSignOut).toHaveBeenCalledWith({ callbackUrl: '/login' });
  });
});
