// Task 38: BedTab — read-only display of bed/room info. The data already lives
// in the BedOccupancy that the parent drawer loaded, so this tab takes
// `occupant` directly instead of refetching. No SWR, no service call.
'use client';

import type { BedOccupancy } from '@/types/maternity-ward';

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

function formatRoom(occupant: BedOccupancy): string {
  return occupant.roomname ? `${occupant.roomno} — ${occupant.roomname}` : occupant.roomno;
}

function formatAdmit(occupant: BedOccupancy): string {
  return occupant.regtime ? `${occupant.regdate} ${occupant.regtime}` : occupant.regdate;
}

export function BedTab({ occupant }: { occupant: BedOccupancy | null }) {
  if (!occupant) {
    return <div className="p-4 text-slate-500">ไม่พบข้อมูล</div>;
  }

  return (
    <div className="space-y-6 p-4">
      <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
        <Field label="เตียง" value={occupant.bedno} />
        <Field label="ห้อง" value={formatRoom(occupant)} />
        <Field label="ประเภทเตียง" value={occupant.bedtype} />
        <Field label="แอดมิต" value={formatAdmit(occupant)} />
      </dl>
    </div>
  );
}
