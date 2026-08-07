'use client';

import { useRouter } from 'next/navigation';
import type { DashboardHospital } from '@/types/api';
import { ConnectionStatus } from '@/components/shared/ConnectionStatus';

interface ActiveHospitalCardProps {
  hospital: DashboardHospital;
}

function getAccentGradient(counts: DashboardHospital['counts']): string {
  if (counts.high > 0) return 'bg-gradient-to-r from-red-400 to-red-500';
  if (counts.medium > 0) return 'bg-gradient-to-r from-amber-400 to-amber-500';
  if (counts.low > 0) return 'bg-gradient-to-r from-emerald-400 to-emerald-500';
  return 'bg-slate-200';
}

interface RiskDot {
  key: string;
  count: number;
  label: string;
  dotClass: string;
}

function getRiskDots(counts: DashboardHospital['counts']): RiskDot[] {
  const dots: RiskDot[] = [];
  if (counts.high > 0) {
    dots.push({ key: 'high', count: counts.high, label: 'สูง', dotClass: 'bg-red-500' });
  }
  if (counts.medium > 0) {
    dots.push({ key: 'medium', count: counts.medium, label: 'ปานกลาง', dotClass: 'bg-amber-500' });
  }
  if (counts.low > 0) {
    dots.push({ key: 'low', count: counts.low, label: 'ต่ำ', dotClass: 'bg-emerald-500' });
  }
  return dots;
}

export function ActiveHospitalCard({ hospital }: ActiveHospitalCardProps) {
  const router = useRouter();
  const accentGradient = getAccentGradient(hospital.counts);
  const dots = getRiskDots(hospital.counts);

  return (
    <button
      type="button"
      onClick={() => router.push(`/hospitals/${hospital.hcode}`)}
      className="w-full cursor-pointer overflow-hidden rounded-2xl bg-white text-left shadow-[0_1px_3px_rgba(0,0,0,0.04),0_4px_12px_rgba(0,0,0,0.03)] transition-all hover:-translate-y-0.5 hover:shadow-[0_2px_8px_rgba(0,0,0,0.06),0_8px_24px_rgba(0,0,0,0.05)]"
    >
      {/* Top accent bar */}
      <div className={`h-0.5 ${accentGradient}`} />

      <div className="p-5">
        {/* Top row: name + level badge + patient count */}
        <div className="flex items-start justify-between">
          <div>
            <div className="font-semibold text-slate-800">{hospital.name}</div>
            <span className="mt-1 inline-block rounded bg-slate-100 px-2 py-0.5 font-mono text-sm text-slate-600">
              {hospital.level}
            </span>
          </div>
          <div className="font-mono text-[28px] font-bold text-slate-900">
            {hospital.counts.total}
          </div>
        </div>

        {/* Risk dots row */}
        {dots.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-3">
            {dots.map((dot) => (
              <span key={dot.key} className="inline-flex items-center gap-1.5 text-sm text-slate-500">
                <span className={`inline-block h-2 w-2 rounded-full ${dot.dotClass}`} aria-hidden="true" />
                {dot.count} {dot.label}
              </span>
            ))}
          </div>
        )}

        {/* Bottom row: connection status + last sync */}
        <div className="mt-3 border-t border-slate-100 pt-2">
          <ConnectionStatus
            status={hospital.connectionStatus}
            lastSyncAt={hospital.lastSyncAt}
            className="text-sm"
          />
        </div>
      </div>
    </button>
  );
}
