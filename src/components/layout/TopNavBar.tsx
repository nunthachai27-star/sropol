// TopNavBar — shared provincial/hospital chrome. Single compact navy bar
// (2026-04-21 redesign): logo + brand on the left, nav menu inline in the
// middle, identity + logout on the right. Previous two-row layout (navy
// identity row + white nav row) has been collapsed into one to free ~35px
// of vertical space for page content.
'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useSession, signOut } from 'next-auth/react';
import { LogOut, Menu, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { withBasePath } from '@/lib/base-path';
import { NAV_ITEMS, ROLE_LABELS, filterNavByRole } from '@/config/nav';

export type TopNavBarVariant = 'hospital' | 'provincial';

interface TopNavBarProps {
  variant?: TopNavBarVariant;
}

function formatBangkokTime(): string {
  return new Date().toLocaleTimeString('th-TH', {
    timeZone: 'Asia/Bangkok',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function useBangkokClock(): string {
  const [time, setTime] = useState('--:--');
  useEffect(() => {
    queueMicrotask(() => setTime(formatBangkokTime()));
    const id = setInterval(() => setTime(formatBangkokTime()), 30_000);
    return () => clearInterval(id);
  }, []);
  return time;
}

export function TopNavBar({ variant = 'provincial' }: TopNavBarProps = {}) {
  const pathname = usePathname();
  const { data: session } = useSession();
  const clock = useBangkokClock();
  const [mobileOpen, setMobileOpen] = useState(false);

  const isHospital = variant === 'hospital';
  const userRole = session?.user?.role;
  const items = isHospital ? [] : filterNavByRole(NAV_ITEMS, userRole);
  const logoHref = isHospital ? '/hospital-maternity-ward' : '/';
  const userName = session?.user?.name ?? '';
  const hospitalName = session?.user?.hospitalName ?? '';
  const hospitalCode = session?.user?.hospitalCode ?? '';
  const roleLabel = userRole ? (ROLE_LABELS[userRole] ?? userRole) : '';
  const userId = session?.user?.id;

  useEffect(() => {
    if (!userId) return;

    const sendHeartbeat = () => {
      if (document.visibilityState === 'hidden') return;
      fetch(withBasePath('/api/presence/heartbeat'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: pathname || '/' }),
        keepalive: true,
      }).catch(() => {
        // Presence is best-effort and should not interrupt clinical workflows.
      });
    };

    sendHeartbeat();
    const interval = window.setInterval(sendHeartbeat, 30_000);
    window.addEventListener('focus', sendHeartbeat);
    document.addEventListener('visibilitychange', sendHeartbeat);

    return () => {
      window.clearInterval(interval);
      window.removeEventListener('focus', sendHeartbeat);
      document.removeEventListener('visibilitychange', sendHeartbeat);
    };
  }, [pathname, userId]);

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
    <header className="sticky top-0 z-30">
      {/* 3-px navy accent rail */}
      <div
        className="h-[3px]"
        style={{
          background:
            'linear-gradient(90deg, var(--accent-navy-strong) 0%, var(--accent-navy) 60%, var(--accent-navy) 100%)',
        }}
      />

      {/* Single compact navy bar: brand + inline nav + identity */}
      <div
        className="flex items-center gap-3 px-4 py-2 text-white"
        style={{
          background: 'var(--accent-navy)',
          borderBottom: '1px solid var(--accent-navy-strong)',
        }}
      >
        {/* Brand cluster */}
        <Link
          href={logoHref}
          className="flex shrink-0 items-center gap-2.5"
          aria-label="SR-LRMS home"
        >
          <span
            className="grid h-8 w-8 place-items-center rounded-sm bg-white font-mono text-[12px] font-extrabold shadow-md"
            style={{ color: 'var(--accent-navy-strong)', letterSpacing: '0.02em' }}
          >
            LR
          </span>
          <span className="leading-tight">
            <span
              className="block text-[15px] font-extrabold"
              style={{
                color: '#ffe89a',
                letterSpacing: '-0.01em',
                textShadow: '0 1px 2px rgba(0,0,0,0.25)',
              }}
            >
              SR-LRMS
            </span>
            <span className="block text-[10px] font-medium tracking-wide text-white/70">
              {isHospital ? 'ห้องคลอด' : 'OneLR · สุรินทร์'}
            </span>
          </span>
        </Link>

        {/* Divider */}
        {!isHospital && items.length > 0 && (
          <div className="mx-1 hidden h-7 w-px shrink-0 bg-white/15 lg:block" />
        )}

        {/* Inline nav (provincial, desktop) */}
        {!isHospital && (
          <nav
            className="hidden flex-1 items-center gap-0.5 overflow-x-auto lg:flex"
            aria-label="เมนูหลัก"
          >
            {items.map(({ href, label, icon: Icon }) => {
              const active = isActive(href);
              return (
                <Link
                  key={href}
                  href={href}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'inline-flex shrink-0 items-center gap-1.5 rounded-sm px-2.5 py-1.5 text-[13px] transition-colors',
                    active
                      ? 'bg-white/15 font-semibold text-white'
                      : 'font-medium text-white/75 hover:bg-white/10 hover:text-white',
                  )}
                >
                  <Icon className="h-[15px] w-[15px]" />
                  {label}
                </Link>
              );
            })}
          </nav>
        )}

        {/* Spacer when nav is hidden (hospital variant or mobile) */}
        {(isHospital || items.length === 0) && <div className="flex-1" />}
        {!isHospital && items.length > 0 && <div className="flex-1 lg:hidden" />}

        {/* Identity + actions */}
        <div className="flex shrink-0 items-center gap-2 text-[11px] text-white/80">
          <span className="hidden font-mono tabular-nums text-white sm:inline">{clock}</span>
          {hospitalName && (
            <span className="hidden items-center gap-1 rounded-sm border border-white/25 bg-white/10 px-2 py-0.5 text-[11px] font-medium text-white md:inline-flex">
              {hospitalName}
              {hospitalCode && <span className="text-white/60">·{hospitalCode}</span>}
            </span>
          )}
          {userName && (
            <div className="hidden flex-col items-end font-sans leading-tight md:flex">
              <span className="text-[12px] font-medium text-white">{userName}</span>
              {roleLabel && <span className="text-[10px] text-white/60">{roleLabel}</span>}
            </div>
          )}
          <button
            onClick={handleLogout}
            className="rounded-sm p-1.5 text-white/70 transition-colors hover:bg-white/10 hover:text-white"
            aria-label="ออกจากระบบ"
            title="ออกจากระบบ"
          >
            <LogOut className="h-4 w-4" />
          </button>
          {/* Mobile hamburger (provincial only) */}
          {!isHospital && (
            <button
              onClick={() => setMobileOpen((v) => !v)}
              className="rounded-sm p-1.5 text-white/80 hover:bg-white/10 lg:hidden"
              aria-label="เมนู"
            >
              {mobileOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
            </button>
          )}
        </div>
      </div>

      {/* Mobile drawer */}
      {!isHospital && mobileOpen && (
        <nav
          className="flex flex-col bg-white px-4 py-2 shadow-lg lg:hidden"
          style={{ borderBottom: '1px solid var(--rule-strong)' }}
        >
          {items.map(({ href, label, icon: Icon }) => {
            const active = isActive(href);
            return (
              <Link
                key={href}
                href={href}
                onClick={() => setMobileOpen(false)}
                className="flex items-center gap-2 rounded-sm px-3 py-2 text-[14px]"
                style={{
                  color: active ? 'var(--accent-navy)' : 'var(--ink-navy-dim)',
                  background: active ? 'var(--accent-navy-soft)' : 'transparent',
                }}
              >
                <Icon className="h-4 w-4" /> {label}
              </Link>
            );
          })}
          <button
            onClick={handleLogout}
            className="mt-2 flex w-full items-center gap-2 rounded-sm px-3 py-2 text-[14px] text-red-600 hover:bg-red-50"
            aria-label="ออกจากระบบ"
          >
            <LogOut className="h-4 w-4" /> ออกจากระบบ
          </button>
        </nav>
      )}
    </header>
  );
}
