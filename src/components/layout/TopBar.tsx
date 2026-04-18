// TopBar — breadcrumbs, real-time Bangkok clock, user info, logout — Clinical Command Center style
'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useSession, signOut } from 'next-auth/react';
import { Clock, LogOut } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useBreadcrumbs } from './BreadcrumbContext';

interface TopBarProps {
  className?: string;
}

const ROLE_LABELS: Record<string, string> = {
  ADMIN: 'ผู้ดูแลระบบ',
  OBSTETRICIAN: 'สูติแพทย์',
  NURSE: 'พยาบาล',
};

function useBangkokClock(): string {
  const [time, setTime] = useState('--:--:--');

  useEffect(() => {
    // Defer the initial update to avoid a synchronous setState inside
    // the effect body (react-hooks/set-state-in-effect). Subsequent
    // updates run inside the interval callback and are unaffected.
    queueMicrotask(() => setTime(formatBangkokTime()));
    const interval = setInterval(() => {
      setTime(formatBangkokTime());
    }, 1_000);
    return () => clearInterval(interval);
  }, []);

  return time;
}

function formatBangkokTime(): string {
  return new Date().toLocaleTimeString('th-TH', {
    timeZone: 'Asia/Bangkok',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

export function TopBar({ className }: TopBarProps) {
  const { breadcrumbs } = useBreadcrumbs();
  const { data: session } = useSession();
  const clock = useBangkokClock();

  const userName = session?.user?.name ?? 'ผู้ใช้';
  const userRole = session?.user?.role;
  const roleLabel = userRole ? ROLE_LABELS[userRole] ?? userRole : '';
  const userInitial = userName.charAt(0).toUpperCase();

  return (
    <header
      className={cn(
        'sticky top-0 z-30 flex h-14 items-center justify-between border-b border-slate-200/60 bg-white/80 px-4 backdrop-blur-sm md:px-6',
        className
      )}
    >
      {/* Left: Breadcrumbs */}
      <nav aria-label="Breadcrumb" className="flex items-center text-sm">
        {breadcrumbs.map((crumb, index) => (
          <span key={index} className="flex items-center">
            {index > 0 && (
              <span className="mx-2 text-slate-300">/</span>
            )}
            {crumb.href ? (
              <Link
                href={crumb.href}
                className="text-slate-500 transition-colors hover:text-slate-700"
              >
                {crumb.label}
              </Link>
            ) : (
              <span className="font-medium text-slate-800">
                {crumb.label}
              </span>
            )}
          </span>
        ))}
      </nav>

      {/* Right: Clock + User info + Logout */}
      <div className="flex items-center gap-1">
        {/* Real-time clock */}
        <div className="hidden items-center gap-1.5 rounded-lg bg-slate-50 px-3 py-1.5 sm:flex">
          <Clock className="h-3.5 w-3.5 text-slate-400" />
          <span className="font-mono text-sm font-medium tabular-nums text-slate-600">
            {clock}
          </span>
        </div>

        {/* Divider */}
        <div className="mx-2 hidden h-6 border-l border-slate-200 sm:block" />

        {/* User info */}
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-emerald-400 to-teal-500">
            <span className="text-xs font-bold text-white">{userInitial}</span>
          </div>
          <div className="hidden flex-col sm:flex">
            <span className="text-sm font-medium text-slate-700">
              {userName}
            </span>
            {roleLabel && (
              <span className="text-xs text-slate-400">{roleLabel}</span>
            )}
          </div>
        </div>

        {/* Divider */}
        <div className="mx-2 h-6 border-l border-slate-200" />

        {/* Logout button */}
        <button
          onClick={() => signOut({ callbackUrl: '/login' })}
          className="rounded-lg p-2 text-slate-300 transition-colors hover:bg-red-50 hover:text-red-500"
          aria-label="ออกจากระบบ"
          title="ออกจากระบบ"
        >
          <LogOut className="h-4 w-4" />
        </button>
      </div>
    </header>
  );
}
