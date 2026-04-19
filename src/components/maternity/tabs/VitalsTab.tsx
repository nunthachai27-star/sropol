// Task 31: VitalsTab — read-only table of ipt_pregnancy_vital_sign rows for
// a single admission. The source table has no single-column PK, so we use
// the array index as a React key. CRUD task 42 will need a different keying
// strategy (likely a composite client-side key or a server-derived hash).
'use client';

import useSWR from 'swr';
import { useBmsSession } from '@/hooks/useBmsSession';
import { getPatientVitalSigns } from '@/services/maternity-ward';
import type { VitalSignRow } from '@/types/maternity-ward';

export function VitalsTab({ an }: { an: string }) {
  const { config } = useBmsSession();
  const { data, error, isLoading } = useSWR<VitalSignRow[]>(
    config ? ['vitals', config.apiUrl, an] : null,
    () => getPatientVitalSigns(config!, an),
  );

  if (!config) {
    return <div className="p-4 text-slate-500">ไม่พร้อมใช้งาน (ไม่มี BMS session)</div>;
  }
  if (isLoading) return <div className="p-4 text-slate-500">กำลังโหลด…</div>;
  if (error) {
    return <div className="p-4 text-red-600">โหลดไม่สำเร็จ: {(error as Error).message}</div>;
  }
  if (!data || data.length === 0) {
    return <div className="p-4 text-slate-500">ไม่พบข้อมูล</div>;
  }

  return (
    <div className="overflow-x-auto p-4">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left text-xs text-slate-500">
            <th className="py-2">HR</th>
            <th>BP</th>
            <th>Temp</th>
            <th>RR</th>
            <th>FHS</th>
            <th>Dilation</th>
          </tr>
        </thead>
        <tbody>
          {data.map((row, i) => (
            <tr key={i} className="border-b">
              <td className="py-2">{row.hr ?? '-'}</td>
              <td>
                {row.bps ?? '-'}/{row.bpd ?? '-'}
              </td>
              <td>{row.temperature ?? '-'}</td>
              <td>{row.rr ?? '-'}</td>
              <td>{row.fetal_heart_sound ?? '-'}</td>
              <td>{row.cervical_open_size ?? '-'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
