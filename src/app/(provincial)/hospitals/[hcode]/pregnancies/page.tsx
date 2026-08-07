// Hospital Pregnancies Page — ANC patient list for one hospital
'use client';

import { use, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import useSWR from 'swr';
import { useSetBreadcrumbs } from '@/components/layout/BreadcrumbContext';
import { LoadingState } from '@/components/shared/LoadingState';
import { ErrorState } from '@/components/shared/ErrorState';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { ArrowLeft, Building2 } from 'lucide-react';
import { maskName } from '@/lib/pii-mask';
import { ANC_RISK_CONFIGS } from '@/config/anc-risk-rules';
import { AncRiskLevel } from '@/types/domain';
import type { JourneyListItem, JourneyListResponse } from '@/types/api';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const RISK_FILTER_OPTIONS = [
  { value: '', label: 'ทุกระดับ' },
  { value: 'LOW', label: 'เสี่ยงต่ำ' },
  { value: 'HR1', label: 'HR1' },
  { value: 'HR2', label: 'HR2' },
  { value: 'HR3', label: 'HR3' },
];

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '-';
  return new Date(dateStr).toLocaleDateString('th-TH', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function HospitalPregnanciesPage({
  params,
}: {
  params: Promise<{ hcode: string }>;
}) {
  const { hcode } = use(params);
  const router = useRouter();
  const [riskFilter, setRiskFilter] = useState('');

  // Stage + per_page must be on the key so the API applies the PREGNANCY
  // care-stage filter and its freshness gates (matches the hospital console's
  // ANC tab). No local fetcher — the global SWRProvider fetcher throws on
  // non-2xx so failures surface as `error` instead of a broken JSON body.
  const { data, isLoading, error, mutate } = useSWR<JourneyListResponse>(
    `/api/hospitals/${hcode}/journeys?stage=PREGNANCY&per_page=1000`,
    { refreshInterval: 60000 },
  );

  const hospitalName = `รหัส ${hcode}`;
  useSetBreadcrumbs([
    { label: 'แดชบอร์ด', href: '/' },
    { label: hospitalName, href: `/hospitals/${hcode}` },
    { label: 'ฝากครรภ์' },
  ]);

  if (isLoading) {
    return <LoadingState message="กำลังโหลดรายชื่อผู้ฝากครรภ์..." />;
  }

  if (error) {
    return (
      <ErrorState
        message="ไม่สามารถโหลดรายชื่อผู้ฝากครรภ์ได้"
        detail={error instanceof Error ? error.message : String(error)}
        onRetry={() => mutate()}
      />
    );
  }

  const allJourneys: JourneyListItem[] = data?.journeys ?? [];
  // Server-side count for the whole care stage — the rows array is a single
  // page (per_page=200), so its length would under-report once a hospital
  // exceeds the page size.
  const totalCount = data?.pagination?.total ?? allJourneys.length;
  const filtered = riskFilter
    ? allJourneys.filter((j) => j.ancRiskLevel === riskFilter)
    : allJourneys;

  return (
    <div className="space-y-5">
      {/* Back button */}
      <button
        onClick={() => router.push(`/hospitals/${hcode}`)}
        className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-teal-600"
      >
        <ArrowLeft size={16} /> กลับโรงพยาบาล
      </button>

      {/* ── Header card ──────────────────────────────────────────────────── */}
      <div className="rounded-xl bg-white p-5 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-purple-50 text-purple-600">
            <Building2 size={20} />
          </div>
          <div>
            <h1 className="text-lg font-semibold text-slate-800">ฝากครรภ์ — {hospitalName}</h1>
            <p className="text-sm text-slate-500">
              ทั้งหมด <span className="font-semibold text-slate-700">{totalCount}</span> ราย
            </p>
          </div>
        </div>
      </div>

      {/* ── Filters ──────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-3">
        <label className="text-sm font-medium text-slate-600">ระดับความเสี่ยง:</label>
        <select
          value={riskFilter}
          onChange={(e) => setRiskFilter(e.target.value)}
          className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-700 shadow-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
        >
          {RISK_FILTER_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        {riskFilter && (
          <span className="text-xs text-slate-400">
            แสดง {filtered.length} / {totalCount} ราย
          </span>
        )}
      </div>

      {/* ── Journey Table ─────────────────────────────────────────────────── */}
      {filtered.length === 0 ? (
        <div className="rounded-xl bg-white p-8 text-center text-slate-400 shadow-sm">
          ไม่มีข้อมูลผู้ฝากครรภ์
        </div>
      ) : (
        <div className="rounded-xl bg-white shadow-sm overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>HN</TableHead>
                <TableHead>ชื่อ-นามสกุล</TableHead>
                <TableHead>อายุ</TableHead>
                <TableHead>G/P</TableHead>
                <TableHead>GA (สัปดาห์)</TableHead>
                <TableHead>ความเสี่ยง</TableHead>
                <TableHead>ครั้ง ANC</TableHead>
                <TableHead>ฝากครรภ์ล่าสุด</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((j) => (
                <TableRow key={j.id} className="cursor-pointer hover:bg-muted/50">
                  <TableCell className="font-mono text-xs">
                    <Link href={`/pregnancies/${j.id}`} className="text-teal-700 hover:underline">
                      {j.hn}
                    </Link>
                  </TableCell>
                  <TableCell className="font-medium">
                    <Link href={`/pregnancies/${j.id}`} className="hover:text-teal-600">
                      {maskName(j.name)}
                    </Link>
                  </TableCell>
                  <TableCell>{j.age} ปี</TableCell>
                  <TableCell>{j.gravida != null ? `G${j.gravida}` : '-'}</TableCell>
                  <TableCell>{j.gaWeeks != null ? `${j.gaWeeks} สัปดาห์` : '-'}</TableCell>
                  <TableCell>
                    {j.ancRiskLevel ? (
                      (() => {
                        const cfg = ANC_RISK_CONFIGS[j.ancRiskLevel as AncRiskLevel];
                        return (
                          <span
                            className="rounded-full border px-2 py-0.5 text-xs font-medium"
                            style={
                              cfg
                                ? {
                                    background: cfg.bgColor,
                                    color: cfg.color,
                                    borderColor: cfg.color,
                                  }
                                : undefined
                            }
                          >
                            {cfg?.labelTh ?? j.ancRiskLevel}
                          </span>
                        );
                      })()
                    ) : (
                      <span className="text-slate-400">-</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">{j.ancVisitCount}</Badge>
                  </TableCell>
                  <TableCell className="text-xs text-slate-500">
                    {formatDate(j.lastAncDate)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
