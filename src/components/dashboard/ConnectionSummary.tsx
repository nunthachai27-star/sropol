// ConnectionSummary — compact card showing online/offline/unknown hospital counts
'use client';

import type { DashboardHospital } from '@/types/api';
import { ConnectionStatus as ConnectionStatusEnum } from '@/types/domain';

interface ConnectionSummaryProps {
  hospitals: DashboardHospital[];
}

interface StatusRow {
  key: ConnectionStatusEnum;
  label: string;
  dotClass: string;
}

const STATUS_ROWS: StatusRow[] = [
  {
    key: ConnectionStatusEnum.ONLINE,
    label: 'ออนไลน์',
    dotClass: 'bg-green-500',
  },
  {
    key: ConnectionStatusEnum.OFFLINE,
    label: 'ออฟไลน์',
    dotClass: 'bg-red-500',
  },
  {
    key: ConnectionStatusEnum.UNKNOWN,
    label: 'ไม่ทราบ',
    dotClass: 'bg-gray-400',
  },
];

function countByStatus(
  hospitals: DashboardHospital[],
  status: ConnectionStatusEnum,
): number {
  return hospitals.filter((h) => h.connectionStatus === status).length;
}

export function ConnectionSummary({ hospitals }: ConnectionSummaryProps) {
  return (
    <div className="rounded-2xl bg-white p-6 shadow-[0_1px_3px_rgba(0,0,0,0.04),0_4px_12px_rgba(0,0,0,0.03)]">
      <h3 className="text-sm uppercase tracking-wider font-semibold text-slate-400">
        สถานะการเชื่อมต่อ
      </h3>

      <div className="mt-4 flex flex-col gap-3">
        {STATUS_ROWS.map((row) => {
          const count = countByStatus(hospitals, row.key);
          return (
            <div key={row.key} className="flex items-center justify-between text-sm">
              <div className="flex items-center gap-2">
                <span
                  className={`inline-block h-2.5 w-2.5 rounded-full ${row.dotClass}`}
                  aria-hidden="true"
                />
                <span className="text-slate-600">{row.label}</span>
              </div>
              <span className="font-mono font-semibold text-slate-800">
                {count}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
