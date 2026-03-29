'use client';

import { Baby, Stethoscope, Heart } from 'lucide-react';
import type { DashboardStageKPIs } from '@/types/api';

interface StageKPICardsProps {
  stageKPIs: DashboardStageKPIs;
}

export function StageKPICards({ stageKPIs }: StageKPICardsProps) {
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
      {/* Pregnancy */}
      <div className="rounded-xl border border-purple-200 bg-gradient-to-br from-purple-50 to-white p-5 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-purple-100">
            <Baby className="h-5 w-5 text-purple-600" />
          </div>
          <div>
            <div className="text-xs font-medium uppercase tracking-wider text-purple-500">ฝากครรภ์ (ANC)</div>
            <div className="text-2xl font-bold text-purple-900">{stageKPIs.pregnancy.total}</div>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <span className="rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-medium text-green-700">LOW {stageKPIs.pregnancy.low}</span>
          <span className="rounded-full bg-yellow-100 px-2.5 py-0.5 text-xs font-medium text-yellow-700">HR1 {stageKPIs.pregnancy.hr1}</span>
          <span className="rounded-full bg-orange-100 px-2.5 py-0.5 text-xs font-medium text-orange-700">HR2 {stageKPIs.pregnancy.hr2}</span>
          <span className="rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-medium text-red-700">HR3 {stageKPIs.pregnancy.hr3}</span>
        </div>
      </div>

      {/* Active Labor */}
      <div className="rounded-xl border border-blue-200 bg-gradient-to-br from-blue-50 to-white p-5 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-100">
            <Stethoscope className="h-5 w-5 text-blue-600" />
          </div>
          <div>
            <div className="text-xs font-medium uppercase tracking-wider text-blue-500">ห้องคลอด</div>
            <div className="text-2xl font-bold text-blue-900">{stageKPIs.labor.total}</div>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <span className="rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-medium text-green-700">LOW {stageKPIs.labor.low}</span>
          <span className="rounded-full bg-yellow-100 px-2.5 py-0.5 text-xs font-medium text-yellow-700">MED {stageKPIs.labor.medium}</span>
          <span className="rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-medium text-red-700">HIGH {stageKPIs.labor.high}</span>
        </div>
      </div>

      {/* Delivered */}
      <div className="rounded-xl border border-emerald-200 bg-gradient-to-br from-emerald-50 to-white p-5 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-100">
            <Heart className="h-5 w-5 text-emerald-600" />
          </div>
          <div>
            <div className="text-xs font-medium uppercase tracking-wider text-emerald-500">คลอดแล้ว (เดือนนี้)</div>
            <div className="text-2xl font-bold text-emerald-900">{stageKPIs.delivered.total}</div>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <span className="rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-medium text-green-700">ปกติ {stageKPIs.delivered.normal}</span>
          <span className="rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-medium text-red-700">Apgar ต่ำ {stageKPIs.delivered.lowApgar}</span>
          <span className="rounded-full bg-yellow-100 px-2.5 py-0.5 text-xs font-medium text-yellow-700">LBW {stageKPIs.delivered.lbw}</span>
        </div>
      </div>
    </div>
  );
}
