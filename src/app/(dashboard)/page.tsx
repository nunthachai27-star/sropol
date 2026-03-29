// Dashboard — Province-wide KPI and metrics overview (normal + kiosk mode)
'use client';

import { useDashboard } from '@/hooks/useDashboard';
import { useHighRiskPatients } from '@/hooks/useHighRiskPatients';
import { useSSE } from '@/hooks/useSSE';
import { useKioskMode } from '@/hooks/useKioskMode';
import { useSyncTrigger } from '@/hooks/useSyncTrigger';
import { useSetBreadcrumbs } from '@/components/layout/BreadcrumbContext';
import { SummaryCards } from '@/components/dashboard/SummaryCards';
import { StageKPICards } from '@/components/dashboard/StageKPICards';
import { AlertBar } from '@/components/dashboard/AlertBar';
import { RiskDistributionChart } from '@/components/dashboard/RiskDistributionChart';
import { ConnectionSummary } from '@/components/dashboard/ConnectionSummary';
import { HighRiskPatientList } from '@/components/dashboard/HighRiskPatientList';
import { HospitalTable } from '@/components/dashboard/HospitalTable';
import { KioskHeader } from '@/components/dashboard/KioskHeader';
import { LoadingState } from '@/components/shared/LoadingState';
import { Monitor, RefreshCw, CheckCircle2, AlertCircle } from 'lucide-react';

export default function DashboardPage() {
  useSetBreadcrumbs([{ label: 'แดชบอร์ด' }]);
  const { hospitals, summary, stageKPIs, alerts, updatedAt, isLoading, mutate } = useDashboard();
  const { patients: highRiskPatients, isLoading: hrLoading, mutate: hrMutate } = useHighRiskPatients();
  const { isKiosk, toggleKiosk, exitKiosk } = useKioskMode();

  // Trigger immediate data sync on first dashboard load
  const refreshAll = () => { mutate(); hrMutate(); };
  const { syncing, lastResult, triggerSync } = useSyncTrigger(refreshAll);

  useSSE({
    onPatientUpdate: refreshAll,
    onConnectionStatus: () => mutate(),
    onSyncComplete: refreshAll,
  });

  if (isLoading) {
    return <LoadingState message="กำลังโหลด Dashboard..." />;
  }

  // ─── Kiosk Mode Layout ───
  if (isKiosk) {
    return (
      <div className="min-h-screen bg-slate-900">
        <KioskHeader updatedAt={updatedAt} onExit={exitKiosk} />

        <div className="px-8 pb-8 space-y-6">
          {/* Row 1: Large KPI cards */}
          <div className="grid grid-cols-2 gap-5 lg:grid-cols-4">
            {[
              { label: 'ผู้คลอดทั้งหมด', value: summary.totalActive, sub: 'กำลังคลอด', color: 'text-white', glow: 'kiosk-stat-glow', border: 'border-slate-700', bg: 'from-slate-800 to-slate-800/80' },
              { label: 'เสี่ยงสูง', value: summary.totalHigh, sub: 'ต้องเฝ้าระวัง', color: 'text-red-400', glow: 'kiosk-stat-glow-red', border: 'border-red-500/30', bg: 'from-red-950/60 to-slate-800/80' },
              { label: 'เสี่ยงปานกลาง', value: summary.totalMedium, sub: 'ติดตามต่อเนื่อง', color: 'text-amber-400', glow: 'kiosk-stat-glow-amber', border: 'border-amber-500/30', bg: 'from-amber-950/40 to-slate-800/80' },
              { label: 'เสี่ยงต่ำ', value: summary.totalLow, sub: 'ปกติ', color: 'text-emerald-400', glow: 'kiosk-stat-glow-green', border: 'border-emerald-500/30', bg: 'from-emerald-950/40 to-slate-800/80' },
            ].map((card) => (
              <div
                key={card.label}
                className={`rounded-2xl border ${card.border} bg-gradient-to-br ${card.bg} p-6 lg:p-8`}
              >
                <p className="text-sm font-semibold uppercase tracking-wider text-slate-400">
                  {card.label}
                </p>
                <p className={`mt-3 font-mono text-6xl font-bold ${card.color} ${card.glow}`}>
                  {card.value}
                </p>
                <p className="mt-2 text-sm text-slate-500">{card.sub}</p>
              </div>
            ))}
          </div>

          {/* Row 2: Risk distribution + Connection + High-risk list */}
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
            {/* Left: Risk chart + Connection */}
            <div className="space-y-5 lg:col-span-4">
              <div className="kiosk-wrap rounded-2xl border border-slate-700 bg-slate-800/80 p-6">
                <RiskDistributionChart summary={summary} />
              </div>
              <div className="kiosk-wrap rounded-2xl border border-slate-700 bg-slate-800/80 p-6">
                <ConnectionSummary hospitals={hospitals} />
              </div>
            </div>

            {/* Right: High-risk patients */}
            <div className="lg:col-span-8">
              <div className="kiosk-wrap rounded-2xl border border-slate-700 bg-slate-800/80 p-6">
                <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-slate-400 kiosk-text-glow">
                  ผู้ป่วยที่ต้องเฝ้าระวัง
                </h2>
                <HighRiskPatientList patients={highRiskPatients} isLoading={hrLoading} />
              </div>
            </div>
          </div>

          {/* Row 3: Hospital table */}
          <div className="kiosk-wrap rounded-2xl border border-slate-700 bg-slate-800/80 p-6">
            <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-slate-400 kiosk-text-glow">
              สรุปตามโรงพยาบาล
            </h2>
            <HospitalTable hospitals={hospitals} />
          </div>
        </div>
      </div>
    );
  }

  // ─── Normal Mode Layout ───
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">
            แดชบอร์ดจังหวัดขอนแก่น
          </h1>
          <p className="mt-0.5 text-sm text-slate-400">
            ระบบติดตามห้องคลอด — ภาพรวมทั้งจังหวัด
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* Sync status indicator */}
          {syncing && (
            <span className="inline-flex items-center gap-1.5 rounded-lg bg-blue-50 px-3 py-1.5 text-xs text-blue-600">
              <RefreshCw className="h-3 w-3 animate-spin" />
              กำลังดึงข้อมูล...
            </span>
          )}
          {!syncing && lastResult && lastResult.synced && (
            <span className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-50 px-3 py-1.5 text-xs text-emerald-600">
              <CheckCircle2 className="h-3 w-3" />
              ดึงข้อมูลสำเร็จ
              {lastResult.patientsCount !== undefined && ` (${lastResult.patientsCount} ราย)`}
            </span>
          )}
          {!syncing && lastResult && !lastResult.synced && lastResult.reason !== 'cooldown' && lastResult.reason !== 'no_config' && lastResult.reason !== 'no_hospital_code' && (
            <span className="inline-flex items-center gap-1.5 rounded-lg bg-amber-50 px-3 py-1.5 text-xs text-amber-600">
              <AlertCircle className="h-3 w-3" />
              {lastResult.reason === 'in_progress' ? 'กำลังดึงข้อมูลอยู่' : 'ไม่สามารถดึงข้อมูลได้'}
            </span>
          )}
          {updatedAt && (
            <span className="inline-flex items-center gap-1.5 rounded-lg bg-slate-50 px-3 py-1.5 font-mono text-xs text-slate-400">
              <span
                className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse-live"
                aria-hidden="true"
              />
              อัปเดตล่าสุด: {new Date(updatedAt).toLocaleTimeString('th-TH')}
            </span>
          )}
          <button
            onClick={() => triggerSync()}
            disabled={syncing}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-500 transition-colors hover:bg-slate-50 hover:text-slate-700 disabled:opacity-50"
            title="ดึงข้อมูลทันที"
          >
            <RefreshCw className={`h-3 w-3 ${syncing ? 'animate-spin' : ''}`} />
            <span className="hidden sm:inline">ดึงข้อมูล</span>
          </button>
          <button
            onClick={toggleKiosk}
            className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-slate-800"
            title="เปิดโหมดจอภาพ (Kiosk Mode)"
          >
            <Monitor className="h-4 w-4" />
            <span className="hidden sm:inline">โหมดจอภาพ</span>
          </button>
        </div>
      </div>

      {/* Row 1: Alert Bar */}
      <AlertBar alerts={alerts} />

      {/* Row 2: Stage KPI Cards (Pregnancy / Labor / Delivered) */}
      <StageKPICards stageKPIs={stageKPIs} />

      {/* Row 3: Summary Cards (labor risk breakdown) */}
      <SummaryCards summary={summary} />

      {/* Row 4: Risk Distribution + Connection Summary */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <RiskDistributionChart summary={summary} />
        </div>
        <ConnectionSummary hospitals={hospitals} />
      </div>

      {/* Row 3: High-Risk Patient List */}
      <div>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-slate-400">
          ผู้ป่วยที่ต้องเฝ้าระวัง
        </h2>
        <HighRiskPatientList patients={highRiskPatients} isLoading={hrLoading} />
      </div>

      {/* Row 4: Hospital Comparison Table */}
      <div>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-slate-400">
          สรุปตามโรงพยาบาล
        </h2>
        <div className="rounded-2xl bg-white p-4 shadow-[0_1px_3px_rgba(0,0,0,0.04),0_4px_12px_rgba(0,0,0,0.03)]">
          <HospitalTable hospitals={hospitals} />
        </div>
      </div>
    </div>
  );
}
