// Sidebar navigation — dark slate command center, collapsible, mobile overlay, role-based nav
'use client';

import { useState, useCallback } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useSession, signOut } from 'next-auth/react';
import {
  LayoutDashboard,
  Building2,
  Settings,
  LogOut,
  ChevronLeft,
  ChevronRight,
  Menu,
  X,
  Baby,
  ArrowRightLeft,
  BarChart3,
} from 'lucide-react';
import { cn } from '@/lib/utils';

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
  { href: '/admin', label: 'ตั้งค่า', icon: Settings, adminOnly: true },
];

export function Sidebar() {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const pathname = usePathname();
  const { data: session } = useSession();

  const userRole = (session?.user as unknown as { role?: string })?.role;
  const userName = session?.user?.name ?? 'ผู้ใช้';

  const handleLogout = useCallback(() => {
    signOut({ callbackUrl: '/login' });
  }, []);

  const toggleCollapse = useCallback(() => {
    setCollapsed((prev) => !prev);
  }, []);

  const toggleMobile = useCallback(() => {
    setMobileOpen((prev) => !prev);
  }, []);

  const closeMobile = useCallback(() => {
    setMobileOpen(false);
  }, []);

  const isActive = (href: string) => {
    if (href === '/') return pathname === '/';
    return pathname.startsWith(href);
  };

  const visibleItems = NAV_ITEMS.filter(
    (item) => !item.adminOnly || userRole === 'ADMIN'
  );

  // Get user initial for avatar
  const userInitial = userName.charAt(0).toUpperCase();

  const sidebarContent = (
    <div className="flex h-full flex-col">
      {/* Logo area */}
      <div className="flex items-center gap-3 border-b border-white/5 px-4 py-4">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white/10">
          <Building2 className="h-5 w-5 text-white" />
        </div>
        {!collapsed && (
          <div className="min-w-0">
            <div className="text-lg font-bold tracking-tight text-white">KK-LRMS</div>
            <div className="truncate text-sm text-slate-400">
              ระบบติดตามครรภ์-คลอด
            </div>
          </div>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 space-y-1 px-2 py-3">
        {visibleItems.map((item) => {
          const Icon = item.icon;
          const active = isActive(item.href);

          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={closeMobile}
              className={cn(
                'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors',
                active
                  ? 'border-l-2 border-emerald-400 bg-white/10 text-white'
                  : 'text-slate-400 hover:bg-white/5 hover:text-white'
              )}
              title={collapsed ? item.label : undefined}
            >
              <Icon className="h-5 w-5 shrink-0" />
              {!collapsed && <span>{item.label}</span>}
            </Link>
          );
        })}
      </nav>

      {/* Collapse toggle (desktop only) */}
      <button
        onClick={toggleCollapse}
        className="mx-2 mb-2 hidden items-center justify-center rounded-lg p-2 text-slate-500 transition-colors hover:bg-white/5 hover:text-slate-300 md:flex"
        aria-label={collapsed ? 'ขยายเมนู' : 'ย่อเมนู'}
      >
        {collapsed ? (
          <ChevronRight className="h-5 w-5" />
        ) : (
          <ChevronLeft className="h-5 w-5" />
        )}
      </button>

      {/* User info + Logout */}
      <div className="border-t border-white/5 px-3 py-3">
        {!collapsed && (
          <div className="mb-2 flex items-center gap-2.5">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-emerald-400 to-teal-500">
              <span className="text-xs font-bold text-white">{userInitial}</span>
            </div>
            <span className="truncate text-sm text-slate-300">{userName}</span>
          </div>
        )}
        {collapsed && (
          <div className="mb-2 flex justify-center">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-emerald-400 to-teal-500">
              <span className="text-xs font-bold text-white">{userInitial}</span>
            </div>
          </div>
        )}
        <button
          onClick={handleLogout}
          className={cn(
            'flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-slate-400 transition-colors hover:bg-white/5 hover:text-white',
            collapsed && 'justify-center'
          )}
          title={collapsed ? 'ออกจากระบบ' : undefined}
        >
          <LogOut className="h-5 w-5 shrink-0" />
          {!collapsed && <span>ออกจากระบบ</span>}
        </button>
      </div>
    </div>
  );

  return (
    <>
      {/* Mobile hamburger button */}
      <button
        onClick={toggleMobile}
        className="fixed left-3 top-3 z-50 rounded-lg bg-slate-800 p-2 text-white shadow-lg md:hidden"
        aria-label="เปิดเมนู"
      >
        <Menu className="h-5 w-5" />
      </button>

      {/* Mobile overlay */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={closeMobile}
            aria-hidden="true"
          />
          {/* Sidebar drawer */}
          <aside className="relative z-50 h-full w-60 bg-gradient-to-b from-slate-900 to-slate-800">
            <button
              onClick={closeMobile}
              className="absolute right-3 top-3 rounded-lg p-1 text-slate-500 hover:bg-white/5 hover:text-slate-300"
              aria-label="ปิดเมนู"
            >
              <X className="h-5 w-5" />
            </button>
            {sidebarContent}
          </aside>
        </div>
      )}

      {/* Desktop sidebar */}
      <aside
        className={cn(
          'sticky top-0 hidden h-screen shrink-0 bg-gradient-to-b from-slate-900 to-slate-800 transition-[width] duration-200 md:block',
          collapsed ? 'w-16' : 'w-60'
        )}
      >
        {sidebarContent}
      </aside>
    </>
  );
}
