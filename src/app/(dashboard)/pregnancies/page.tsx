// Pregnancies page — ANC registry with risk badges and filters
'use client';

import { useState, useMemo } from 'react';
import useSWR from 'swr';
import { useSetBreadcrumbs } from '@/components/layout/BreadcrumbContext';
import { LoadingState } from '@/components/shared/LoadingState';
import { cn, formatThaiDate } from '@/lib/utils';
import { Baby, Search, Filter, ChevronLeft, ChevronRight } from 'lucide-react';
import type { JourneyListResponse } from '@/types/api';

const RISK_BADGE_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  LOW: { bg: 'bg-green-100', text: 'text-green-700', label: 'LOW' },
  HR1: { bg: 'bg-yellow-100', text: 'text-yellow-700', label: 'HR1' },
  HR2: { bg: 'bg-orange-100', text: 'text-orange-700', label: 'HR2' },
  HR3: { bg: 'bg-red-100', text: 'text-red-700', label: 'HR3' },
};

function RiskBadge({ level }: { level: string }) {
  const style = RISK_BADGE_STYLES[level] ?? { bg: 'bg-slate-100', text: 'text-slate-600', label: level };
  return (
    <span className={cn('inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold', style.bg, style.text)}>
      {style.label}
    </span>
  );
}

const RISK_OPTIONS = [
  { value: '', label: 'ทุกระดับ' },
  { value: 'LOW', label: 'LOW — ความเสี่ยงต่ำ' },
  { value: 'HR1', label: 'HR1 — ความเสี่ยง 1' },
  { value: 'HR2', label: 'HR2 — ความเสี่ยง 2' },
  { value: 'HR3', label: 'HR3 — ความเสี่ยงสูง' },
];

export default function PregnanciesPage() {
  useSetBreadcrumbs([
    { label: 'แดชบอร์ด', href: '/' },
    { label: 'ฝากครรภ์' },
  ]);

  const [page, setPage] = useState(1);
  const [riskFilter, setRiskFilter] = useState('');
  const [search, setSearch] = useState('');

  const queryParams = useMemo(() => {
    const params = new URLSearchParams({ stage: 'PREGNANCY', page: String(page), per_page: '20' });
    if (riskFilter) params.set('risk_level', riskFilter);
    return params.toString();
  }, [page, riskFilter]);

  const { data, isLoading, error } = useSWR<JourneyListResponse>(
    `/api/journeys?${queryParams}`,
    { refreshInterval: 30000 },
  );

  const journeys = useMemo(() => data?.journeys ?? [], [data?.journeys]);
  const filteredJourneys = useMemo(() => {
    if (!search.trim()) return journeys;
    const q = search.trim().toLowerCase();
    return journeys.filter(
      (j) =>
        j.name.toLowerCase().includes(q) ||
        j.hn.toLowerCase().includes(q) ||
        j.hospitalName.toLowerCase().includes(q),
    );
  }, [journeys, search]);

  if (isLoading) {
    return <LoadingState message="กำลังโหลดข้อมูลฝากครรภ์..." />;
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <Baby className="mb-3 h-10 w-10 text-slate-200" />
        <p className="text-sm text-red-500">เกิดข้อผิดพลาดในการโหลดข้อมูล กรุณาลองใหม่</p>
      </div>
    );
  }

  const pagination = data?.pagination ?? { total: 0, page: 1, perPage: 20, totalPages: 1 };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">ฝากครรภ์ (ANC)</h1>
          <p className="mt-0.5 text-sm text-slate-400">
            ทะเบียนหญิงตั้งครรภ์ทั้งหมด {pagination.total} ราย
          </p>
        </div>

        <div className="flex items-center gap-3">
          {/* Search */}
          <div className="relative w-full sm:w-64">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-300" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="ค้นหาชื่อ, HN..."
              className="h-10 w-full rounded-xl border border-slate-200 bg-white pl-10 pr-4 text-sm text-slate-700 placeholder:text-slate-300 focus:border-emerald-300 focus:outline-none focus:ring-2 focus:ring-emerald-100"
            />
          </div>

          {/* Risk filter */}
          <div className="relative">
            <Filter className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-300" />
            <select
              value={riskFilter}
              onChange={(e) => { setRiskFilter(e.target.value); setPage(1); }}
              className="h-10 appearance-none rounded-xl border border-slate-200 bg-white pl-10 pr-8 text-sm text-slate-700 focus:border-emerald-300 focus:outline-none focus:ring-2 focus:ring-emerald-100"
            >
              {RISK_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-2xl bg-white shadow-[0_1px_3px_rgba(0,0,0,0.04),0_4px_12px_rgba(0,0,0,0.03)]">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100 text-left text-xs font-semibold uppercase tracking-wider text-slate-400">
              <th className="px-4 py-3">ชื่อ</th>
              <th className="px-4 py-3">HN</th>
              <th className="px-4 py-3 text-center">อายุ</th>
              <th className="px-4 py-3 text-center">GA (สัปดาห์)</th>
              <th className="px-4 py-3 text-center">ครรภ์ที่</th>
              <th className="px-4 py-3 text-center">ระดับเสี่ยง</th>
              <th className="px-4 py-3 text-center">ANC ครั้ง</th>
              <th className="px-4 py-3">ฝากครรภ์ล่าสุด</th>
              <th className="px-4 py-3">โรงพยาบาล</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50">
            {filteredJourneys.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-4 py-12 text-center text-slate-400">
                  <Baby className="mx-auto mb-2 h-8 w-8 text-slate-200" />
                  ไม่พบข้อมูลฝากครรภ์
                </td>
              </tr>
            ) : (
              filteredJourneys.map((j) => (
                <tr key={j.id} className="transition-colors hover:bg-slate-50/50">
                  <td className="px-4 py-3 font-medium text-slate-800">{j.name}</td>
                  <td className="px-4 py-3 font-mono text-xs text-slate-500">{j.hn}</td>
                  <td className="px-4 py-3 text-center text-slate-600">{j.age}</td>
                  <td className="px-4 py-3 text-center font-mono text-slate-600">{j.gaWeeks ?? '-'}</td>
                  <td className="px-4 py-3 text-center text-slate-600">G{j.gravida}</td>
                  <td className="px-4 py-3 text-center">
                    <RiskBadge level={j.ancRiskLevel} />
                  </td>
                  <td className="px-4 py-3 text-center font-mono text-slate-600">{j.ancVisitCount}</td>
                  <td className="px-4 py-3 text-slate-500">
                    {j.lastAncDate ? formatThaiDate(j.lastAncDate) : '-'}
                  </td>
                  <td className="px-4 py-3 text-slate-500">{j.hospitalName}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {pagination.totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-xs text-slate-400">
            แสดง {(pagination.page - 1) * pagination.perPage + 1}–{Math.min(pagination.page * pagination.perPage, pagination.total)} จาก {pagination.total} ราย
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-500 transition-colors hover:bg-slate-50 disabled:opacity-40"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
              ก่อนหน้า
            </button>
            <span className="rounded-lg bg-slate-100 px-3 py-1.5 font-mono text-xs text-slate-600">
              {pagination.page}/{pagination.totalPages}
            </span>
            <button
              onClick={() => setPage((p) => Math.min(pagination.totalPages, p + 1))}
              disabled={page >= pagination.totalPages}
              className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-500 transition-colors hover:bg-slate-50 disabled:opacity-40"
            >
              ถัดไป
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
