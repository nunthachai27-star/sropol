// TopNavBar — horizontal top navigation with logo, nav links, Bangkok clock,
// hospital badge, user identity, and logout. Replaces the previous
// Sidebar + breadcrumb-only TopBar pair.
'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useSession, signOut } from 'next-auth/react';
import {
  LayoutDashboard,
  Baby,
  Building2,
  ArrowRightLeft,
  BarChart3,
  Stethoscope,
  Settings,
  LogOut,
  Clock,
  Menu,
  X,
} from 'lucide-react';
import { cn } from '@/lib/utils';

const ROLE_LABELS: Record<string, string> = {
  ADMIN: 'ผู้ดูแลระบบ',
  OBSTETRICIAN: 'สูติแพทย์',
  NURSE: 'พยาบาล',
};

interface NavItem {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  adminOnly?: boolean;
}

const NAV_ITEMS: NavItem[] = [
  { href: '/', label: 'แดชบอร์ด', icon: LayoutDashboard },
  { href: '/pregnancies', label: 'ฝากครรภ์', icon: Baby },
  { href: '/hospitals', label: 'โรงพยาบาล', icon: Building2 },
  { href: '/referrals', label: 'ส่งต่อ', icon: ArrowRightLeft },
  { href: '/outcomes', label: 'ผลลัพธ์ทารก', icon: BarChart3 },
  { href: '/hospital-maternity-ward', label: 'ห้องคลอด', icon: Stethoscope },
  { href: '/admin', label: 'ตั้งค่า', icon: Settings, adminOnly: true },
];

function formatBangkokTime(): string {
  return new Date().toLocaleTimeString('th-TH', {
    timeZone: 'Asia/Bangkok',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function useBangkokClock(): string {
  const [time, setTime] = useState('--:--:--');
  useEffect(() => {
    // Defer the initial update to avoid a synchronous setState inside
    // the effect body (react-hooks/set-state-in-effect). Subsequent
    // updates run inside the interval callback and are unaffected.
    queueMicrotask(() => setTime(formatBangkokTime()));
    const id = setInterval(() => setTime(formatBangkokTime()), 1_000);
    return () => clearInterval(id);
  }, []);
  return time;
}

export function TopNavBar() {
  const pathname = usePathname();
  const { data: session } = useSession();
  const clock = useBangkokClock();
  const [mobileOpen, setMobileOpen] = useState(false);

  const userRole = session?.user?.role;
  const items = NAV_ITEMS.filter((i) => !i.adminOnly || userRole === 'ADMIN');
  const userName = session?.user?.name ?? '';
  const hospitalName = session?.user?.hospitalName ?? '';
  const hospitalCode = session?.user?.hospitalCode ?? '';
  const roleLabel = userRole ? ROLE_LABELS[userRole] ?? userRole : '';

  const isActive = useCallback(
    (href: string) => {
      if (href === '/') return pathname === '/';
      return pathname.startsWith(href);
    },
    [pathname],
  );

  const handleLogout = useCallback(() => {
    signOut({ callbackUrl: '/login' });
  }, []);

  return (
    <header className="sticky top-0 z-30 border-b border-slate-200/60 bg-white/85 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-[1600px] items-center gap-4 px-4 lg:px-6">
        {/* Logo */}
        <Link href="/" className="flex shrink-0 items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-900">
            <Building2 className="h-5 w-5 text-white" />
          </div>
          <span className="hidden text-lg font-bold tracking-tight text-slate-900 sm:inline">
            KK-LRMS
          </span>
        </Link>

        {/* Desktop nav */}
        <nav className="hidden flex-1 items-center gap-1 lg:flex">
          {items.map(({ href, label, icon: Icon }) => {
            const active = isActive(href);
            return (
              <Link
                key={href}
                href={href}
                className={cn(
                  'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                  active
                    ? 'bg-emerald-50 text-emerald-700'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900',
                )}
              >
                <Icon className="h-4 w-4" />
                {label}
              </Link>
            );
          })}
        </nav>

        {/* Right cluster (desktop) */}
        <div className="ml-auto hidden items-center gap-3 lg:flex">
          {/* Clock */}
          <div className="hidden items-center gap-1.5 rounded-lg bg-slate-50 px-3 py-1.5 sm:flex">
            <Clock className="h-3.5 w-3.5 text-slate-400" />
            <span className="font-mono text-sm tabular-nums text-slate-600">
              {clock}
            </span>
          </div>

          {/* Hospital badge */}
          {hospitalName && (
            <div className="hidden items-center gap-1 rounded-lg border border-slate-200 px-3 py-1.5 md:flex">
              <span className="text-sm font-medium text-slate-700">
                {hospitalName}
              </span>
              <span className="text-xs text-slate-400">({hospitalCode})</span>
            </div>
          )}

          {/* User */}
          {userName && (
            <div className="hidden flex-col items-end md:flex">
              <span className="text-sm font-medium text-slate-700">
                {userName}
              </span>
              {roleLabel && (
                <span className="text-xs text-slate-400">{roleLabel}</span>
              )}
            </div>
          )}

          {/* Logout */}
          <button
            onClick={handleLogout}
            className="rounded-lg p-2 text-slate-400 transition-colors hover:bg-red-50 hover:text-red-500"
            aria-label="ออกจากระบบ"
            title="ออกจากระบบ"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>

        {/* Mobile hamburger */}
        <button
          onClick={() => setMobileOpen((v) => !v)}
          className="ml-auto rounded-lg p-2 text-slate-500 hover:bg-slate-100 lg:hidden"
          aria-label="เมนู"
        >
          {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </div>

      {/* Mobile menu drawer */}
      {mobileOpen && (
        <nav className="border-t border-slate-200 bg-white px-4 py-2 lg:hidden">
          {items.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              onClick={() => setMobileOpen(false)}
              className={cn(
                'flex items-center gap-2 rounded-md px-3 py-2 text-sm',
                isActive(href)
                  ? 'bg-emerald-50 text-emerald-700'
                  : 'text-slate-600 hover:bg-slate-100',
              )}
            >
              <Icon className="h-4 w-4" /> {label}
            </Link>
          ))}
          <button
            onClick={handleLogout}
            className="mt-2 flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm text-slate-600 hover:bg-red-50 hover:text-red-500"
            aria-label="ออกจากระบบ"
          >
            <LogOut className="h-4 w-4" /> ออกจากระบบ
          </button>
        </nav>
      )}
    </header>
  );
}
