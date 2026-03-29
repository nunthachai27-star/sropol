// Outcomes page — neonatal KPIs dashboard
'use client';

import useSWR from 'swr';
import { useSetBreadcrumbs } from '@/components/layout/BreadcrumbContext';
import { LoadingState } from '@/components/shared/LoadingState';
import { Baby, Weight, Activity, Scale } from 'lucide-react';
import type { NewbornKPIsResponse } from '@/types/api';

export default function OutcomesPage() {
  useSetBreadcrumbs([
    { label: 'แดชบอร์ด', href: '/' },
    { label: 'ผลลัพธ์ทารก' },
  ]);

  const { data, isLoading, error } = useSWR<NewbornKPIsResponse>(
    '/api/dashboard/outcomes',
    { refreshInterval: 60000 },
  );

  if (isLoading) {
    return <LoadingState message="กำลังโหลดข้อมูลผลลัพธ์ทารก..." />;
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <Baby className="mb-3 h-10 w-10 text-slate-200" />
        <p className="text-sm text-red-500">เกิดข้อผิดพลาดในการโหลดข้อมูล กรุณาลองใหม่</p>
      </div>
    );
  }

  const kpis = data ?? { totalBirths: 0, lbwCount: 0, lbwRate: 0, lowApgarCount: 0, avgBirthWeightG: 0 };

  const cards = [
    {
      key: 'total',
      title: 'จำนวนทารกเกิดทั้งหมด',
      value: kpis.totalBirths,
      subtitle: 'ราย (เดือนนี้)',
      icon: Baby,
      iconBg: 'bg-emerald-50',
      iconColor: 'text-emerald-500',
      numberColor: 'text-emerald-600',
      borderColor: 'border-emerald-200',
      gradientFrom: 'from-emerald-50',
    },
    {
      key: 'lbw',
      title: 'น้ำหนักน้อย (LBW)',
      value: kpis.lbwCount,
      subtitle: `${kpis.lbwRate.toFixed(1)}% ของทารกทั้งหมด`,
      icon: Weight,
      iconBg: 'bg-amber-50',
      iconColor: 'text-amber-500',
      numberColor: 'text-amber-600',
      borderColor: 'border-amber-200',
      gradientFrom: 'from-amber-50',
    },
    {
      key: 'apgar',
      title: 'Apgar ต่ำ',
      value: kpis.lowApgarCount,
      subtitle: 'ราย (Apgar 5 นาที < 7)',
      icon: Activity,
      iconBg: 'bg-red-50',
      iconColor: 'text-red-500',
      numberColor: 'text-red-600',
      borderColor: 'border-red-200',
      gradientFrom: 'from-red-50',
    },
    {
      key: 'avgWeight',
      title: 'น้ำหนักเฉลี่ย',
      value: kpis.avgBirthWeightG > 0 ? kpis.avgBirthWeightG.toLocaleString() : '-',
      subtitle: 'กรัม',
      icon: Scale,
      iconBg: 'bg-blue-50',
      iconColor: 'text-blue-500',
      numberColor: 'text-blue-600',
      borderColor: 'border-blue-200',
      gradientFrom: 'from-blue-50',
    },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-slate-900">ผลลัพธ์ทารก</h1>
        <p className="mt-0.5 text-sm text-slate-400">
          สรุปตัวชี้วัดทารกแรกเกิดประจำเดือน
        </p>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map((card) => {
          const Icon = card.icon;
          return (
            <div
              key={card.key}
              className={`rounded-2xl border ${card.borderColor} bg-gradient-to-br ${card.gradientFrom} to-white p-6 shadow-[0_1px_3px_rgba(0,0,0,0.04),0_4px_12px_rgba(0,0,0,0.03)]`}
            >
              <div className="flex items-center gap-3">
                <div className={`flex h-10 w-10 items-center justify-center rounded-full ${card.iconBg}`}>
                  <Icon className={`h-5 w-5 ${card.iconColor}`} />
                </div>
                <span className="text-sm font-medium uppercase tracking-wider text-slate-400">
                  {card.title}
                </span>
              </div>
              <div className={`mt-4 font-mono text-4xl font-bold ${card.numberColor}`}>
                {card.value}
              </div>
              <div className="mt-1 text-sm text-slate-400">{card.subtitle}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
