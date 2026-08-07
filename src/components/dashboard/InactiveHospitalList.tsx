'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronDown, ChevronUp } from 'lucide-react';
import type { DashboardHospital } from '@/types/api';
import { ConnectionStatus as ConnectionStatusEnum } from '@/types/domain';

interface InactiveHospitalListProps {
  hospitals: DashboardHospital[];
}

function getStatusDotClass(status: ConnectionStatusEnum): string {
  switch (status) {
    case ConnectionStatusEnum.ONLINE:
      return 'bg-green-500 animate-pulse-live';
    case ConnectionStatusEnum.OFFLINE:
      return 'bg-red-500';
    case ConnectionStatusEnum.UNKNOWN:
    default:
      return 'bg-gray-400';
  }
}

function getStatusLabel(status: ConnectionStatusEnum): string {
  switch (status) {
    case ConnectionStatusEnum.ONLINE:
      return 'ออนไลน์';
    case ConnectionStatusEnum.OFFLINE:
      return 'ออฟไลน์';
    case ConnectionStatusEnum.UNKNOWN:
    default:
      return 'ไม่ทราบ';
  }
}

export function InactiveHospitalList({ hospitals }: InactiveHospitalListProps) {
  const [expanded, setExpanded] = useState(true);
  const router = useRouter();

  if (hospitals.length === 0) return null;

  return (
    <div className="rounded-2xl bg-white/50 p-4">
      <button
        type="button"
        onClick={() => setExpanded((prev) => !prev)}
        className="flex w-full items-center justify-between rounded-lg px-1 py-2 text-sm font-medium text-slate-400 transition-colors hover:text-slate-600"
      >
        <span>โรงพยาบาลอื่นๆ ({hospitals.length} แห่ง)</span>
        {expanded ? (
          <ChevronUp className="h-4 w-4" />
        ) : (
          <ChevronDown className="h-4 w-4" />
        )}
      </button>

      {expanded && (
        <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {hospitals.map((h) => (
            <button
              key={h.hcode}
              type="button"
              onClick={() => router.push(`/hospitals/${h.hcode}`)}
              className="flex items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-slate-400 transition-colors hover:bg-white hover:text-slate-600 cursor-pointer"
            >
              <span className="truncate">
                {h.name} ({h.level})
              </span>
              <span className="ml-auto flex shrink-0 items-center gap-1">
                <span
                  className={`inline-block h-2 w-2 rounded-full ${getStatusDotClass(h.connectionStatus)}`}
                  aria-hidden="true"
                />
                <span className="text-sm">{getStatusLabel(h.connectionStatus)}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
