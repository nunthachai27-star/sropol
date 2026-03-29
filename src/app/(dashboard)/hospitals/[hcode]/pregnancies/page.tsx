// Hospital Pregnancies Page — ANC patient list for one hospital
'use client';

import { use, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import useSWR from 'swr';
import { useSetBreadcrumbs } from '@/components/layout/BreadcrumbContext';
import { LoadingState } from '@/components/shared/LoadingState';
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

// ─── Types ───────────────────────────────────────────────────────────────────

interface JourneyRow {
  id: string;
  hn: string;
  name: string;
  age: number;
  gravida: number | null;
  gaWeeks: number | null;
  ancRiskLevel: string | null;
  ancVisitCount: number;
  lastAncDate: string | null;
  careStage: string;
}

interface HospitalJourneysResponse {
  hospital: { name: string; level: string; hcode: string } | null;
  journeys: JourneyRow[];
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const fetcher = (url: string) => fetch(url).then((r) => r.json());

const ANC_RISK_COLORS: Record<string, string> = {
  LOW:  'bg-green-100 text-green-700 border-green-200',
  HR1:  'bg-yellow-100 text-yellow-700 border-yellow-200',
  HR2:  'bg-orange-100 text-orange-700 border-orange-200',
  HR3:  'bg-red-100 text-red-700 border-red-200',
};

const ANC_RISK_LABELS: Record<string, string> = {
  LOW:  'เสี่ยงต่ำ',
  HR1:  'HR1',
  HR2:  'HR2',
  HR3:  'HR3',
};

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

  const { data, isLoading } = useSWR<HospitalJourneysResponse>(
    `/api/hospitals/${hcode}/journeys`,
    fetcher,
    { refreshInterval: 60000 },
  );

  const hospitalName = data?.hospital?.name ?? `รหัส ${hcode}`;
  useSetBreadcrumbs([
    { label: 'แดชบอร์ด', href: '/' },
    { label: hospitalName, href: `/hospitals/${hcode}` },
    { label: 'ฝากครรภ์' },
  ]);

  if (isLoading) {
    return <LoadingState message="กำลังโหลดรายชื่อผู้ฝากครรภ์..." />;
  }

  const allJourneys: JourneyRow[] = data?.journeys ?? [];
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
            <h1 className="text-lg font-semibold text-slate-800">
              ฝากครรภ์ — {hospitalName}
            </h1>
            <p className="text-sm text-slate-500">
              ทั้งหมด{' '}
              <span className="font-semibold text-slate-700">{allJourneys.length}</span> ราย
              {data?.hospital?.level && (
                <>
                  &ensp;·&ensp;
                  <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs font-medium">
                    {data.hospital.level}
                  </span>
                </>
              )}
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
            แสดง {filtered.length} / {allJourneys.length} ราย
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
                <TableRow
                  key={j.id}
                  className="cursor-pointer hover:bg-muted/50"
                >
                  <TableCell className="font-mono text-xs">
                    <Link
                      href={`/pregnancies/${j.id}`}
                      className="text-teal-700 hover:underline"
                    >
                      {j.hn}
                    </Link>
                  </TableCell>
                  <TableCell className="font-medium">
                    <Link
                      href={`/pregnancies/${j.id}`}
                      className="hover:text-teal-600"
                    >
                      {j.name}
                    </Link>
                  </TableCell>
                  <TableCell>{j.age} ปี</TableCell>
                  <TableCell>
                    {j.gravida != null ? `G${j.gravida}` : '-'}
                  </TableCell>
                  <TableCell>
                    {j.gaWeeks != null ? `${j.gaWeeks} สัปดาห์` : '-'}
                  </TableCell>
                  <TableCell>
                    {j.ancRiskLevel ? (
                      <span
                        className={`rounded-full border px-2 py-0.5 text-xs font-medium ${ANC_RISK_COLORS[j.ancRiskLevel] ?? 'bg-slate-100 text-slate-700 border-slate-200'}`}
                      >
                        {ANC_RISK_LABELS[j.ancRiskLevel] ?? j.ancRiskLevel}
                      </span>
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
