// ErrorState — actionable fetch-failure UI (Constitution V: error messages in
// Thai, say what went wrong AND what to do). Two variants:
//   'page'   — full-panel replacement when there is no data to show
//   'banner' — slim strip above stale cached data that is still on screen
'use client';

import { cn } from '@/lib/utils';
import { AlertTriangle, RefreshCw } from 'lucide-react';

interface ErrorStateProps {
  message?: string;
  /** Technical detail (e.g. FetchError message from the API error body). */
  detail?: string;
  /** Renders a "ลองใหม่" button when provided. */
  onRetry?: () => void;
  variant?: 'page' | 'banner';
  /** banner variant: timestamp of the cached data still being displayed. */
  lastUpdatedAt?: string | null;
  className?: string;
}

function formatBangkokTime(value: string): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleTimeString('th-TH', {
    timeZone: 'Asia/Bangkok',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

export function ErrorState({
  message = 'ไม่สามารถโหลดข้อมูลได้ กรุณาลองใหม่',
  detail,
  onRetry,
  variant = 'page',
  lastUpdatedAt,
  className,
}: ErrorStateProps) {
  if (variant === 'banner') {
    return (
      <div
        role="alert"
        className={cn(
          'flex flex-wrap items-center gap-x-2 gap-y-1 border-b px-5 py-2 font-mono text-[11px]',
          className,
        )}
        style={{
          background: 'color-mix(in srgb, var(--risk-medium) 12%, white)',
          borderColor: 'var(--risk-medium)',
          color: 'var(--ink-navy)',
        }}
      >
        <AlertTriangle className="h-3.5 w-3.5 shrink-0" style={{ color: 'var(--risk-medium)' }} />
        <span className="font-semibold">{message}</span>
        {lastUpdatedAt && (
          <span style={{ color: 'var(--ink-navy-dim)' }}>
            แสดงข้อมูลล่าสุดเมื่อ{' '}
            <span className="font-semibold tabular-nums">{formatBangkokTime(lastUpdatedAt)}</span>
          </span>
        )}
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="ml-auto inline-flex shrink-0 items-center gap-1 rounded-sm border bg-white px-2 py-0.5 transition-colors hover:bg-[var(--accent-navy-soft)]"
            style={{ borderColor: 'var(--rule-strong)', color: 'var(--ink-navy-dim)' }}
          >
            <RefreshCw className="h-3 w-3" />
            ลองใหม่
          </button>
        )}
      </div>
    );
  }

  return (
    <div
      role="alert"
      className={cn('flex flex-col items-center justify-center gap-3 py-16 text-center', className)}
      style={{ color: 'var(--ink-navy-muted)' }}
    >
      <AlertTriangle className="h-10 w-10 opacity-40" />
      <p className="font-mono text-[12px] font-semibold" style={{ color: 'var(--risk-high)' }}>
        {message}
      </p>
      {detail && <p className="max-w-md font-mono text-[11px]">{detail}</p>}
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="inline-flex items-center gap-1.5 rounded-sm border bg-white px-3 py-1.5 font-mono text-[11px] transition-colors hover:bg-[var(--accent-navy-soft)]"
          style={{ borderColor: 'var(--rule-strong)', color: 'var(--ink-navy-dim)' }}
        >
          <RefreshCw className="h-3 w-3" />
          ลองใหม่
        </button>
      )}
    </div>
  );
}
