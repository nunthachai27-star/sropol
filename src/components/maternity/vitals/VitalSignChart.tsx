// VitalSignChart — renders the ready-to-use IPD vital-sign chart PNG served by
// HOSxP's GetIPDVitalSignChart function endpoint. The server renders the classic
// paper chart (temperature/pulse dual axis + respiration + blood pressure) and
// returns it as an image, so the browser no longer reconstructs the chart from
// raw nurse-note rows. A page selector switches between the six printed chart
// pages; the render endpoint caches one frame per admission, so flipping pages
// for the same patient is cheap.
'use client';

import { useEffect, useMemo, useState } from 'react';
import useSWR from 'swr';
import { getIpdVitalSignChart, type IpdVitalSignChartResponse } from '@/lib/bms-browser-client';
import type { ConnectionConfig } from '@/types/bms-browser';

/** GetIPDVitalSignChart chart pages. chart_type_id 2–7 map to printed chart
 *  pages 1–6 (id 1 is the header/summary page; see the API spec §4). */
const CHART_PAGES: ReadonlyArray<{ chartTypeId: number; label: string }> = [
  { chartTypeId: 2, label: 'หน้า 1' },
  { chartTypeId: 3, label: 'หน้า 2' },
  { chartTypeId: 4, label: 'หน้า 3' },
  { chartTypeId: 5, label: 'หน้า 4' },
  { chartTypeId: 6, label: 'หน้า 5' },
  { chartTypeId: 7, label: 'หน้า 6' },
];

/** Default page shown first: chart_type_id 2 = printed chart page 1 (the
 *  temperature/pulse/respiration/blood-pressure graph nurses use most). */
export const DEFAULT_VITAL_SIGN_CHART_TYPE_ID = 2;

interface VitalSignChartProps {
  /** IPD admission number (AN) whose chart to render. */
  an: string;
  /** Active BMS connection (from useBmsSession). */
  config: ConnectionConfig;
  /** Marketplace token paired with the session, if any. */
  marketplaceToken?: string | null;
  /** Initial chart page (chart_type_id, see spec §4). Default 2 = chart page 1. */
  chartTypeId?: number;
}

export function VitalSignChart({
  an,
  config,
  marketplaceToken,
  chartTypeId = DEFAULT_VITAL_SIGN_CHART_TYPE_ID,
}: VitalSignChartProps) {
  const [page, setPage] = useState(chartTypeId);

  const { data, error, isLoading, isValidating, mutate } = useSWR<IpdVitalSignChartResponse>(
    config ? ['ipd-vital-sign-chart', config.apiUrl, an, page] : null,
    () => getIpdVitalSignChart(config, an, page, marketplaceToken),
    { revalidateOnFocus: false, shouldRetryOnError: false },
  );

  // Turn the PNG blob into an <img>-able object URL during render (deriving it
  // in an effect would need a synchronous setState, which cascades renders).
  // The matching effect below revokes it when the blob changes or the component
  // unmounts, so we don't leak blob: URLs.
  const objectUrl = useMemo(() => (data?.ok ? URL.createObjectURL(data.blob) : null), [data]);
  useEffect(() => {
    if (!objectUrl) return;
    return () => URL.revokeObjectURL(objectUrl);
  }, [objectUrl]);

  const busy = isLoading || isValidating;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-slate-500">หน้ากราฟ:</span>
        {CHART_PAGES.map((p) => (
          <button
            key={p.chartTypeId}
            type="button"
            onClick={() => setPage(p.chartTypeId)}
            aria-pressed={page === p.chartTypeId}
            className={
              page === p.chartTypeId
                ? 'rounded bg-emerald-600 px-3 py-1 text-xs font-medium text-white'
                : 'rounded border border-slate-300 px-3 py-1 text-xs text-slate-700 hover:bg-slate-50'
            }
          >
            {p.label}
          </button>
        ))}
        {busy && (
          <span data-testid="vital-sign-chart-refreshing" className="ml-1 text-xs text-slate-400">
            กำลังโหลด…
          </span>
        )}
      </div>

      <div className="min-h-[240px] rounded border border-slate-200 bg-white p-2">
        {busy && !objectUrl ? (
          <div
            data-testid="vital-sign-chart-loading"
            role="status"
            className="flex h-[240px] items-center justify-center text-sm text-slate-500"
          >
            กำลังสร้างกราฟสัญญาณชีพ… (การสร้างครั้งแรกอาจใช้เวลาสักครู่)
          </div>
        ) : error ? (
          <ChartMessage
            testId="vital-sign-chart-error"
            tone="error"
            message={(error as Error).message || 'โหลดกราฟสัญญาณชีพไม่สำเร็จ กรุณาลองใหม่อีกครั้ง'}
            onRetry={() => void mutate()}
          />
        ) : data && !data.ok ? (
          <ChartMessage
            testId="vital-sign-chart-error"
            tone="empty"
            message={data.message}
            onRetry={() => void mutate()}
          />
        ) : objectUrl ? (
          // next/image can't optimize a client-side blob: object URL (no static
          // dimensions, no remote loader) — a plain <img> is the correct element.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            data-testid="vital-sign-chart"
            src={objectUrl}
            alt={`กราฟสัญญาณชีพ (IPD) AN ${an}`}
            className="mx-auto block h-auto max-w-full"
          />
        ) : null}
      </div>
    </div>
  );
}

function ChartMessage({
  testId,
  tone,
  message,
  onRetry,
}: {
  testId: string;
  tone: 'error' | 'empty';
  message: string;
  onRetry: () => void;
}) {
  return (
    <div
      data-testid={testId}
      role="alert"
      className="flex h-[240px] flex-col items-center justify-center gap-3 px-4 text-center"
    >
      <p className={tone === 'error' ? 'text-sm text-red-600' : 'text-sm text-slate-500'}>
        {message}
      </p>
      <button
        type="button"
        onClick={onRetry}
        className="rounded border border-slate-300 px-3 py-1 text-xs text-slate-700 hover:bg-slate-50"
      >
        ลองใหม่อีกครั้ง
      </button>
    </div>
  );
}
