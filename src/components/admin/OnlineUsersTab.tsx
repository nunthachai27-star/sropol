'use client';

import useSWR from 'swr';
import type { ComponentType } from 'react';
import { Activity, Clock, Database, Monitor, UserRound } from 'lucide-react';

interface OnlineUser {
  userId: string;
  name: string;
  role: string;
  hospitalCode: string;
  hospitalName: string;
  authProvider: string;
  accessMode: string;
  path: string;
  ipAddress: string | null;
  userAgent: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
  expiresAt: string;
}

interface OnlineUsersResponse {
  users: OnlineUser[];
  total: number;
  cache: {
    backend: 'redis' | 'memory';
    available: boolean;
  };
  updatedAt: string;
}

function formatTime(value: string): string {
  return new Date(value).toLocaleTimeString('th-TH', {
    timeZone: 'Asia/Bangkok',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

function ageLabel(value: string): string {
  const seconds = Math.max(0, Math.round((Date.now() - Date.parse(value)) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  return `${Math.round(seconds / 60)}m ago`;
}

function browserLabel(userAgent: string | null): string {
  if (!userAgent) return '—';
  if (userAgent.includes('Edg/')) return 'Edge';
  if (userAgent.includes('Chrome/')) return 'Chrome';
  if (userAgent.includes('Firefox/')) return 'Firefox';
  if (userAgent.includes('Safari/')) return 'Safari';
  return userAgent.slice(0, 42);
}

export function OnlineUsersTab() {
  const { data, isLoading, error } = useSWR<OnlineUsersResponse>('/api/admin/online-users', {
    refreshInterval: 10_000,
  });

  const users = data?.users ?? [];
  const redisBackend = data?.cache.backend ?? 'memory';

  return (
    <section className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        <Metric
          label="ONLINE USERS"
          value={data?.total ?? 0}
          detail={data?.updatedAt ? `Updated ${formatTime(data.updatedAt)}` : 'Waiting for heartbeat'}
          Icon={UserRound}
        />
        <Metric
          label="PRESENCE STORE"
          value={redisBackend.toUpperCase()}
          detail={redisBackend === 'redis' ? 'Shared Redis backend' : 'Built-in dev memory'}
          Icon={Database}
        />
        <Metric
          label="HEARTBEAT TTL"
          value="120s"
          detail="Users disappear after missed heartbeats"
          Icon={Activity}
        />
      </div>

      <div
        className="overflow-hidden border bg-white"
        style={{ borderColor: 'var(--rule-strong)' }}
      >
        <div
          className="flex items-center justify-between px-3 py-2"
          style={{ borderBottom: '1px solid var(--rule-strong)' }}
        >
          <div className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--ink-navy)]">
            ACTIVE SESSIONS
          </div>
          <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--ink-navy-muted)]">
            POLL 10S · TTL 120S
          </div>
        </div>

        {error ? (
          <div className="px-3 py-8 text-sm text-red-600">โหลดรายชื่อผู้ใช้งานออนไลน์ไม่สำเร็จ</div>
        ) : isLoading ? (
          <div className="px-3 py-8 text-sm text-[var(--ink-navy-muted)]">กำลังโหลด...</div>
        ) : users.length === 0 ? (
          <div className="px-3 py-8 text-sm text-[var(--ink-navy-muted)]">
            ยังไม่มี heartbeat จากผู้ใช้ที่เปิดหน้าเว็บอยู่
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left text-sm">
              <thead className="bg-[var(--surface-cool)]">
                <tr className="font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--ink-navy-muted)]">
                  <th className="px-3 py-2 font-semibold">User</th>
                  <th className="px-3 py-2 font-semibold">Hospital</th>
                  <th className="px-3 py-2 font-semibold">Page</th>
                  <th className="px-3 py-2 font-semibold">Last Seen</th>
                  <th className="px-3 py-2 font-semibold">Client</th>
                </tr>
              </thead>
              <tbody>
                {users.map((user) => (
                  <tr
                    key={user.userId}
                    style={{ borderTop: '1px solid var(--rule-subtle)' }}
                    className="align-top"
                  >
                    <td className="px-3 py-2">
                      <div className="font-medium text-[var(--ink-navy)]">{user.name}</div>
                      <div className="mt-0.5 font-mono text-[10px] text-[var(--ink-navy-muted)]">
                        {user.role} · {user.authProvider} · {user.accessMode}
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <div className="text-[var(--ink-navy)]">{user.hospitalName || '—'}</div>
                      <div className="mt-0.5 font-mono text-[10px] tabular-nums text-[var(--ink-navy-muted)]">
                        {user.hospitalCode || '—'}
                      </div>
                    </td>
                    <td className="px-3 py-2 font-mono text-[11px] text-[var(--ink-navy-dim)]">
                      {user.path}
                    </td>
                    <td className="px-3 py-2">
                      <div className="inline-flex items-center gap-1.5 font-mono text-[11px] tabular-nums text-[var(--ink-navy)]">
                        <Clock className="h-3 w-3" />
                        {formatTime(user.lastSeenAt)}
                      </div>
                      <div className="mt-0.5 font-mono text-[10px] text-[var(--ink-navy-muted)]">
                        {ageLabel(user.lastSeenAt)}
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <div className="inline-flex items-center gap-1.5 text-[var(--ink-navy-dim)]">
                        <Monitor className="h-3.5 w-3.5" />
                        {browserLabel(user.userAgent)}
                      </div>
                      <div className="mt-0.5 font-mono text-[10px] tabular-nums text-[var(--ink-navy-muted)]">
                        {user.ipAddress ?? '—'}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}

function Metric({
  label,
  value,
  detail,
  Icon,
}: {
  label: string;
  value: string | number;
  detail: string;
  Icon: ComponentType<{ className?: string }>;
}) {
  return (
    <div className="border bg-white px-3 py-2" style={{ borderColor: 'var(--rule-strong)' }}>
      <div className="flex items-center justify-between gap-2">
        <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--ink-navy-muted)]">
          {label}
        </div>
        <Icon className="h-3.5 w-3.5 text-[var(--ink-navy-muted)]" />
      </div>
      <div className="mt-1 font-mono text-[24px] font-semibold leading-none tabular-nums text-[var(--ink-navy)]">
        {value}
      </div>
      <div className="mt-1 text-[11px] text-[var(--ink-navy-muted)]">{detail}</div>
    </div>
  );
}
