// KioskHeader — redesigned 2026-04-21 for 1920×1080 wall-mount display.
// Signature motion: live EKG pulse ribbon at the very top; monospace clock; glow accents.
'use client';

import { useState, useEffect } from 'react';
import { Minimize2 } from 'lucide-react';
import { EkgRibbon } from './shared';

interface KioskHeaderProps {
  updatedAt: string | null;
  onExit: () => void;
  onlineCount?: number;
  totalCount?: number;
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
        hour12: false,
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

export function KioskHeader({
  updatedAt,
  onExit,
  onlineCount = 0,
  totalCount = 26,
}: KioskHeaderProps) {
  const clock = useLiveClock();
  const dateStr = useLiveDate();

  return (
    <>
      <EkgRibbon color="var(--kiosk-accent)" height={22} opacity={0.55} />
      <header
        className="flex items-center gap-6 border-b px-7 pb-3 pt-3.5"
        style={{ borderColor: 'var(--kiosk-rule)' }}
      >
        {/* Left — LR monogram + title */}
        <div className="flex h-[42px] w-[42px] items-center justify-center border font-mono text-sm font-bold"
             style={{ borderColor: 'var(--kiosk-ink)', color: 'var(--kiosk-ink)' }}>
          LR
        </div>
        <div>
          <div className="text-[22px] font-semibold leading-tight" style={{ color: 'var(--kiosk-ink)', letterSpacing: '-0.01em' }}>
            SR-LRMS ·{' '}
            <span style={{ color: 'var(--kiosk-dim)', fontWeight: 500 }}>
              OneLR ห้องคลอดหนึ่งเดียว
            </span>
          </div>
          <div className="mt-0.5 font-mono text-[11px] tracking-[0.18em]" style={{ color: 'var(--kiosk-dim)' }}>
            PROVINCIAL LABOR-ROOM NETWORK · SURIN · WAR-ROOM DISPLAY
          </div>
        </div>

        <div className="flex-1" />

        {/* Center — date + clock */}
        <div className="text-center">
          <div className="font-mono text-xs tracking-[0.2em]" style={{ color: 'var(--kiosk-dim)' }}>
            {dateStr}
          </div>
          <div
            className="font-mono text-[44px] font-semibold leading-none tabular-nums"
            style={{ color: 'var(--kiosk-ink)', letterSpacing: '-0.02em' }}
          >
            {clock}
          </div>
        </div>

        <div className="flex-1" />

        {/* Right — status */}
        <div className="text-right font-mono text-xs tracking-[0.1em]" style={{ color: 'var(--kiosk-dim)' }}>
          <div className="flex items-center justify-end gap-2">
            <span
              className="h-2.5 w-2.5 rounded-full"
              style={{
                background: 'var(--kiosk-low)',
                boxShadow: '0 0 12px var(--kiosk-low)',
              }}
              aria-hidden="true"
            />
            <span style={{ color: 'var(--kiosk-ink)', fontWeight: 600 }}>SSE LIVE</span>
          </div>
          {updatedAt && (
            <div className="mt-0.5">
              LAST SYNC{' '}
              <span style={{ color: 'var(--kiosk-ink)' }}>
                {new Date(updatedAt).toLocaleTimeString('th-TH', {
                  timeZone: 'Asia/Bangkok',
                  hour: '2-digit',
                  minute: '2-digit',
                  hour12: false,
                })}
              </span>
            </div>
          )}
          <div className="mt-0.5">
            {onlineCount}/{totalCount} NODES ONLINE
          </div>
        </div>

        {/* Exit */}
        <button
          onClick={onExit}
          className="ml-2 rounded-sm p-2 transition-colors hover:bg-white/10"
          style={{ color: 'var(--kiosk-dim)' }}
          title="ออกจากโหมดจอภาพ (ESC)"
          aria-label="Exit kiosk mode"
        >
          <Minimize2 className="h-5 w-5" />
        </button>
      </header>
    </>
  );
}
