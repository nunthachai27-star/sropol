// Referrals page — inter-hospital referral tracking
'use client';

import { useState, useMemo } from 'react';
import useSWR from 'swr';
import { useSetBreadcrumbs } from '@/components/layout/BreadcrumbContext';
import { LoadingState } from '@/components/shared/LoadingState';
import { cn, formatThaiDate } from '@/lib/utils';
import { ArrowRightLeft, ChevronLeft, ChevronRight, Filter } from 'lucide-react';
import type { ReferralListResponse } from '@/types/api';

const STATUS_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  INITIATED: { bg: 'bg-blue-100', text: 'text-blue-700', label: 'รอดำเนินการ' },
  ACCEPTED: { bg: 'bg-green-100', text: 'text-green-700', label: 'ตอบรับ' },
  IN_TRANSIT: { bg: 'bg-amber-100', text: 'text-amber-700', label: 'กำลังเดินทาง' },
  ARRIVED: { bg: 'bg-emerald-100', text: 'text-emerald-700', label: 'ถึงแล้ว' },
  REJECTED: { bg: 'bg-red-100', text: 'text-red-700', label: 'ปฏิเสธ' },
};

const URGENCY_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  ROUTINE: { bg: 'bg-slate-100', text: 'text-slate-600', label: 'ปกติ' },
  URGENT: { bg: 'bg-orange-100', text: 'text-orange-700', label: 'เร่งด่วน' },
  EMERGENCY: { bg: 'bg-red-100', text: 'text-red-700', label: 'ฉุกเฉิน' },
};

function StatusBadge({ status }: { status: string }) {
  const style = STATUS_STYLES[status] ?? { bg: 'bg-slate-100', text: 'text-slate-600', label: status };
  return (
    <span className={cn('inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold', style.bg, style.text)}>
      {style.label}
    </span>
  );
}

function UrgencyBadge({ urgency }: { urgency: string }) {
  const style = URGENCY_STYLES[urgency] ?? { bg: 'bg-slate-100', text: 'text-slate-600', label: urgency };
  return (
    <span className={cn('inline-flex rounded-full px-2 py-0.5 text-xs font-medium', style.bg, style.text)}>
      {style.label}
    </span>
  );
}

const STATUS_OPTIONS = [
  { value: '', label: 'ทุกสถานะ' },
  { value: 'INITIATED', label: 'รอดำเนินการ' },
  { value: 'ACCEPTED', label: 'ตอบรับ' },
  { value: 'IN_TRANSIT', label: 'กำลังเดินทาง' },
  { value: 'ARRIVED', label: 'ถึงแล้ว' },
  { value: 'REJECTED', label: 'ปฏิเสธ' },
];

export default function ReferralsPage() {
  useSetBreadcrumbs([
    { label: 'แดชบอร์ด', href: '/' },
    { label: 'ส่งต่อ' },
  ]);

  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState('');

  const queryParams = useMemo(() => {
    const params = new URLSearchParams({ page: String(page), per_page: '20' });
    if (statusFilter) params.set('status', statusFilter);
    return params.toString();
  }, [page, statusFilter]);

  const { data, isLoading, error } = useSWR<ReferralListResponse>(
    `/api/dashboard/referrals/list?${queryParams}`,
    { refreshInterval: 30000 },
  );

  if (isLoading) {
    return <LoadingState message="กำลังโหลดข้อมูลการส่งต่อ..." />;
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <ArrowRightLeft className="mb-3 h-10 w-10 text-slate-200" />
        <p className="text-sm text-red-500">เกิดข้อผิดพลาดในการโหลดข้อมูล กรุณาลองใหม่</p>
      </div>
    );
  }

  const referrals = data?.referrals ?? [];
  const pagination = data?.pagination ?? { total: 0, page: 1, perPage: 20, totalPages: 1 };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">การส่งต่อ</h1>
          <p className="mt-0.5 text-sm text-slate-400">
            รายการส่งต่อทั้งหมด {pagination.total} รายการ
          </p>
        </div>

        {/* Status filter */}
        <div className="relative">
          <Filter className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-300" />
          <select
            value={statusFilter}
            onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
            className="h-10 appearance-none rounded-xl border border-slate-200 bg-white pl-10 pr-8 text-sm text-slate-700 focus:border-emerald-300 focus:outline-none focus:ring-2 focus:ring-emerald-100"
          >
            {STATUS_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-2xl bg-white shadow-[0_1px_3px_rgba(0,0,0,0.04),0_4px_12px_rgba(0,0,0,0.03)]">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100 text-left text-xs font-semibold uppercase tracking-wider text-slate-400">
              <th className="px-4 py-3">จาก</th>
              <th className="px-4 py-3">ไปยัง</th>
              <th className="px-4 py-3 text-center">สถานะ</th>
              <th className="px-4 py-3 text-center">ความเร่งด่วน</th>
              <th className="px-4 py-3">เหตุผล</th>
              <th className="px-4 py-3">วันที่เริ่ม</th>
              <th className="px-4 py-3">ถึงวันที่</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50">
            {referrals.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-12 text-center text-slate-400">
                  <ArrowRightLeft className="mx-auto mb-2 h-8 w-8 text-slate-200" />
                  ไม่พบรายการส่งต่อ
                </td>
              </tr>
            ) : (
              referrals.map((r) => (
                <tr key={r.id} className="transition-colors hover:bg-slate-50/50">
                  <td className="px-4 py-3 font-medium text-slate-700">{r.fromHospital}</td>
                  <td className="px-4 py-3 font-medium text-slate-700">{r.toHospital}</td>
                  <td className="px-4 py-3 text-center">
                    <StatusBadge status={r.status} />
                  </td>
                  <td className="px-4 py-3 text-center">
                    <UrgencyBadge urgency={r.urgencyLevel} />
                  </td>
                  <td className="max-w-xs truncate px-4 py-3 text-slate-500">{r.reason}</td>
                  <td className="px-4 py-3 text-slate-500">{formatThaiDate(r.initiatedAt)}</td>
                  <td className="px-4 py-3 text-slate-500">
                    {r.arrivedAt ? formatThaiDate(r.arrivedAt) : '-'}
                  </td>
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
            แสดง {(pagination.page - 1) * pagination.perPage + 1}–{Math.min(pagination.page * pagination.perPage, pagination.total)} จาก {pagination.total} รายการ
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
