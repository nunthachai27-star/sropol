// Task 32: PreLabourTab — read-only summary of the pregnancy + labour records
// for an admission. Two SWR fetches run in parallel; rendering branches reflect
// the merged state (loading/error if any subquery is loading/failing) so the
// UI never surfaces a half-loaded view.
'use client';

import useSWR from 'swr';
import { useBmsSession } from '@/hooks/useBmsSession';
import {
  getPatientLabour,
  getPatientPregnancy,
} from '@/services/maternity-ward';
import type { LabourRecord, PregnancyRecord } from '@/types/maternity-ward';

interface FieldProps {
  label: string;
  value: string | number | null | undefined;
}

function Field({ label, value }: FieldProps) {
  const display = value === null || value === undefined || value === '' ? '-' : String(value);
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="text-sm font-medium text-slate-900">{display}</dd>
    </div>
  );
}

export function PreLabourTab({ an }: { an: string }) {
  const { config } = useBmsSession();
  const labour = useSWR<LabourRecord | null>(
    config ? ['labour', config.apiUrl, an] : null,
    () => getPatientLabour(config!, an),
  );
  const pregnancy = useSWR<PregnancyRecord | null>(
    config ? ['pregnancy', config.apiUrl, an] : null,
    () => getPatientPregnancy(config!, an),
  );

  if (!config) {
    return <div className="p-4 text-slate-500">ไม่พร้อมใช้งาน (ไม่มี BMS session)</div>;
  }
  if (labour.isLoading || pregnancy.isLoading) {
    return <div className="p-4 text-slate-500">กำลังโหลด…</div>;
  }
  const err = labour.error ?? pregnancy.error;
  if (err) {
    return <div className="p-4 text-red-600">โหลดไม่สำเร็จ: {(err as Error).message}</div>;
  }
  if (!labour.data && !pregnancy.data) {
    return <div className="p-4 text-slate-500">ไม่พบข้อมูล</div>;
  }

  return (
    <div className="space-y-6 p-4">
      <section>
        <h3 className="mb-2 text-sm font-semibold text-slate-700">Pregnancy (ipt_pregnancy)</h3>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
          <Field label="Preg #" value={pregnancy.data?.preg_number ?? null} />
          <Field label="GA" value={pregnancy.data?.ga ?? null} />
          <Field label="ANC complete" value={pregnancy.data?.anc_complete ?? null} />
          <Field label="Labor date" value={pregnancy.data?.labor_date ?? null} />
        </dl>
      </section>
      <section>
        <h3 className="mb-2 text-sm font-semibold text-slate-700">Labour (ipt_labour)</h3>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
          <Field label="G" value={labour.data?.g ?? null} />
          <Field label="GA" value={labour.data?.ga ?? null} />
          <Field label="ANC count" value={labour.data?.anc_count ?? null} />
          <Field label="Labour ID" value={labour.data?.ipt_labour_id ?? null} />
        </dl>
      </section>
    </div>
  );
}
