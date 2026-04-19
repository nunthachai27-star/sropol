// Task 37: InfantTab — read-only table of newborn rows for an admission.
// PATIENT_INFANTS_BY_AN joins ipt_newborn with ipt_labour_infant on .an, so a
// stillbirth (newborn row but no infant row) still surfaces. Row keying prefers
// ipt_labour_infant_id, falls back to ipt_newborn_id, then index — required
// because either join side may be NULL.
'use client';

import useSWR from 'swr';
import { useBmsSession } from '@/hooks/useBmsSession';
import { getPatientInfants } from '@/services/maternity-ward';
import type { InfantRow } from '@/types/maternity-ward';

function rowKey(row: InfantRow, index: number): string | number {
  return row.ipt_labour_infant_id ?? row.ipt_newborn_id ?? index;
}

export function InfantTab({ an }: { an: string }) {
  const { config } = useBmsSession();
  const { data, error, isLoading } = useSWR<InfantRow[]>(
    config ? ['infants', config.apiUrl, an] : null,
    () => getPatientInfants(config!, an),
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
            <th className="py-2">เพศ</th>
            <th>น้ำหนักแรกเกิด (กรัม)</th>
            <th>HN ทารก</th>
          </tr>
        </thead>
        <tbody>
          {data.map((row, index) => (
            <tr key={rowKey(row, index)} className="border-b">
              <td className="py-2">{row.sex ?? '-'}</td>
              <td>{row.birth_weight ?? '-'}</td>
              <td>{(row.infant_hn as string | undefined) ?? '-'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
