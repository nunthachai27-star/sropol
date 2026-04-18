// KioskHeader — branded header bar shown only in kiosk/fullscreen mode
'use client';

import { useState, useEffect } from 'react';
import { Building2, Minimize2 } from 'lucide-react';

interface KioskHeaderProps {
  updatedAt: string | null;
  onExit: () => void;
}

function useLiveClock(): string {
  const [time, setTime] = useState('--:--:--');

  useEffect(() => {
    const fmt = () =>
      new Date().toLocaleTimeString('th-TH', {
        timeZone: 'Asia/Bangkok',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      });
    queueMicrotask(() => setTime(fmt()));
    const id = setInterval(() => setTime(fmt()), 1_000);
    return () => clearInterval(id);
  }, []);

  return time;
}

function useLiveDate(): string {
  const [date, setDate] = useState('');

  useEffect(() => {
    const fmt = () =>
      new Date().toLocaleDateString('th-TH', {
        timeZone: 'Asia/Bangkok',
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      });
    queueMicrotask(() => setDate(fmt()));
    const id = setInterval(() => setDate(fmt()), 60_000);
    return () => clearInterval(id);
  }, []);

  return date;
}

export function KioskHeader({ updatedAt, onExit }: KioskHeaderProps) {
  const clock = useLiveClock();
  const dateStr = useLiveDate();

  return (
    <header className="flex items-center justify-between px-8 py-4">
      {/* Left: Logo + System name */}
      <div className="flex items-center gap-4">
        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-500/20 ring-1 ring-emerald-500/30">
          <Building2 className="h-7 w-7 text-emerald-400" />
        </div>
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white kiosk-text-glow">
            KK-LRMS
          </h1>
          <p className="text-sm text-slate-400">
            ระบบติดตามห้องคลอด — จังหวัดขอนแก่น
          </p>
        </div>
      </div>

      {/* Center: Date */}
      <div className="hidden text-center lg:block">
        <p className="text-lg font-medium text-slate-300">{dateStr}</p>
      </div>

      {/* Right: Clock + Sync status + Exit */}
      <div className="flex items-center gap-6">
        {/* Sync status */}
        {updatedAt && (
          <div className="flex items-center gap-2 rounded-lg bg-white/5 px-4 py-2">
            <span className="inline-block h-2 w-2 rounded-full bg-emerald-500 animate-pulse-live" />
            <span className="text-sm text-slate-400">
              ข้อมูลล่าสุด{' '}
              <span className="font-mono text-slate-300">
                {new Date(updatedAt).toLocaleTimeString('th-TH')}
              </span>
            </span>
          </div>
        )}

        {/* Live clock */}
        <div className="rounded-lg bg-white/5 px-5 py-2">
          <span className="font-mono text-2xl font-bold tabular-nums text-white kiosk-text-glow">
            {clock}
          </span>
        </div>

        {/* Exit kiosk */}
        <button
          onClick={onExit}
          className="rounded-lg bg-white/10 p-2.5 text-slate-400 transition-colors hover:bg-white/20 hover:text-white"
          title="ออกจากโหมดจอภาพ (ESC)"
        >
          <Minimize2 className="h-5 w-5" />
        </button>
      </div>
    </header>
  );
}
