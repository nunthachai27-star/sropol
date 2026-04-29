// BedTab — current location card + bed-move history timeline.
//
// Bedmove history matters for the LR audit trail: it shows where the patient
// has been during this admission, who moved them, and why. This is clinically
// load-bearing for incident review (e.g. "the partograph desat happened
// while the patient was in transit between rooms") and operational metrics
// (LR throughput / bed turnover).
//
// Layout:
//   1. Current location card — bed/room/bedtype + admit timestamp + length
//      of stay (live-computed from regdate/regtime).
//   2. Move history — chronological list (newest first) with from → to
//      transition, reason, and staff who performed the move. Empty state
//      when iptbedmove has no rows for this AN.
'use client';

import useSWR from 'swr';
import { useBmsSession } from '@/hooks/useBmsSession';
import { getPatientBedMoves } from '@/services/maternity-ward';
import type { BedMoveRow, BedOccupancy } from '@/types/maternity-ward';
import { cn } from '@/lib/utils';

// ─── Helpers ───────────────────────────────────────────────────────────────

function formatRoom(occupant: BedOccupancy): string {
  if (occupant.roomname && occupant.roomno) {
    return `${occupant.roomno} — ${occupant.roomname}`;
  }
  return occupant.roomname ?? occupant.roomno ?? '—';
}

function formatAdmit(occupant: BedOccupancy): string {
  if (!occupant.regdate) return '—';
  return occupant.regtime ? `${occupant.regdate} ${occupant.regtime}` : occupant.regdate;
}

function admitDateObj(occupant: BedOccupancy): Date | null {
  if (!occupant.regdate) return null;
  const date = occupant.regdate.slice(0, 10);
  const time = (occupant.regtime ?? '00:00:00').slice(0, 8);
  const d = new Date(`${date}T${time}`);
  return Number.isFinite(d.getTime()) ? d : null;
}

// Computes admit duration in human-readable Thai units (days / hours / minutes).
function lengthOfStay(occupant: BedOccupancy): string {
  const d = admitDateObj(occupant);
  if (!d) return '—';
  const ms = Date.now() - d.getTime();
  if (ms < 0) return '—';
  const totalMin = Math.floor(ms / 60_000);
  const days = Math.floor(totalMin / (24 * 60));
  const hours = Math.floor((totalMin % (24 * 60)) / 60);
  const mins = totalMin % 60;
  if (days > 0) return `${days} วัน ${hours} ชม.`;
  if (hours > 0) return `${hours} ชม. ${mins} นาที`;
  return `${mins} นาที`;
}

function moveTimeLabel(row: BedMoveRow): string {
  const d = (row.movedate ?? '').slice(0, 10);
  const t = (row.movetime ?? '').slice(0, 5);
  if (!d) return '—';
  return t ? `${d} ${t}` : d;
}

function locationLabel(
  ward: string | null | undefined,
  wardName: string | null | undefined,
  bedno: string | null | undefined,
  roomno?: string | null | undefined,
): string {
  const parts: string[] = [];
  const wardLabel = wardName ? `${wardName}` : ward ? `Ward ${ward}` : '';
  if (wardLabel) parts.push(wardLabel);
  if (bedno) parts.push(`เตียง ${bedno}`);
  if (roomno) parts.push(`ห้อง ${roomno}`);
  return parts.length > 0 ? parts.join(' · ') : '—';
}

// ─── Field primitive — used inside the current-location card ───────────────

function Field({
  label,
  value,
  hint,
  emphasis,
}: {
  label: string;
  value: string | number | null | undefined;
  hint?: string;
  emphasis?: 'primary' | 'cyan';
}) {
  const display = value === null || value === undefined || value === '' ? '—' : String(value);
  const valueCls =
    emphasis === 'primary'
      ? 'text-[18px] font-bold tracking-tight text-slate-900'
      : emphasis === 'cyan'
        ? 'text-[15px] font-semibold text-cyan-700'
        : 'text-[14px] font-medium text-slate-900';
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className={valueCls}>{display}</dd>
      {hint && <dd className="text-[11px] text-slate-500">{hint}</dd>}
    </div>
  );
}

// ─── Main ──────────────────────────────────────────────────────────────────

export function BedTab({ occupant }: { occupant: BedOccupancy | null }) {
  const { config } = useBmsSession();
  const moves = useSWR<BedMoveRow[]>(
    config && occupant ? ['bed-moves', config.apiUrl, occupant.an] : null,
    () => getPatientBedMoves(config!, occupant!.an),
  );

  if (!occupant) {
    return <div className="p-4 text-slate-500">ไม่พบข้อมูล</div>;
  }

  const moveRows = moves.data ?? [];

  return (
    <div className="space-y-4 p-4">
      {/* Title bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b-2 border-slate-900 pb-3">
        <div className="flex items-center gap-3">
          <span aria-hidden className="block h-1.5 w-8 bg-cyan-600" />
          <h2 className="text-[18px] font-bold tracking-tight text-slate-900">เตียง</h2>
        </div>
        <span className="rounded-md bg-slate-100 px-2.5 py-1 font-mono text-[12px] font-semibold text-slate-700">
          AN {occupant.an}
        </span>
      </div>

      {/* Current location card */}
      <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-3 flex items-center gap-2 text-[11px] font-bold uppercase tracking-wide text-slate-500">
          <span className="block h-2 w-2 rounded-full bg-emerald-500" aria-hidden />
          ตำแหน่งปัจจุบัน
        </div>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4">
          <Field label="เตียง" value={occupant.bedno} emphasis="primary" />
          <Field label="ห้อง" value={formatRoom(occupant)} emphasis="cyan" />
          <Field label="ประเภทเตียง" value={occupant.bedtype} />
          <Field label="วอร์ด" value={occupant.ward} />
          <Field label="แอดมิต" value={formatAdmit(occupant)} />
          <Field label="ระยะเวลานอน" value={lengthOfStay(occupant)} emphasis="cyan" />
        </dl>
      </section>

      {/* Move-history timeline */}
      <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wide text-slate-500">
            <span className="block h-2 w-2 rounded-full bg-violet-500" aria-hidden />
            ประวัติการย้ายเตียง
          </div>
          {moveRows.length > 0 && (
            <span className="rounded-md bg-slate-100 px-2.5 py-1 text-[12px] font-semibold text-slate-700">
              {moveRows.length} ครั้ง
            </span>
          )}
        </div>

        {moves.isLoading ? (
          <div className="text-[13px] text-slate-500">กำลังโหลด…</div>
        ) : moves.error ? (
          <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-[13px] text-rose-700">
            โหลดไม่สำเร็จ: {(moves.error as Error).message}
          </div>
        ) : moveRows.length === 0 ? (
          <div className="rounded-md border-2 border-dashed border-slate-200 bg-slate-50/40 p-6 text-center">
            <div className="text-[13px] font-medium text-slate-600">ยังไม่มีการย้ายเตียง</div>
            <div className="mt-1 text-[11px] text-slate-500">
              ผู้ป่วยยังคงอยู่ที่ตำแหน่งเดิมตั้งแต่แอดมิต
            </div>
          </div>
        ) : (
          <ol className="relative space-y-3 border-l-2 border-violet-200 pl-5">
            {moveRows.map((row, idx) => {
              const fromStr = locationLabel(row.oward, row.oward_name, row.obedno);
              const toStr = locationLabel(row.nward, row.nward_name, row.nbedno, row.nroomno);
              const isFirstAdmit = !row.oward && !row.obedno;
              return (
                <li
                  key={row.iptbedmove_id ?? idx}
                  className="relative rounded-md border border-slate-200 bg-white p-3 shadow-sm"
                >
                  <span
                    className={cn(
                      'absolute -left-[27px] top-4 block h-3 w-3 rounded-full ring-4 ring-white',
                      isFirstAdmit ? 'bg-emerald-500' : 'bg-violet-500',
                    )}
                    aria-hidden
                  />
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <span className="font-mono text-[13px] font-bold tabular-nums text-slate-900">
                      {moveTimeLabel(row)}
                    </span>
                    {isFirstAdmit ? (
                      <span className="rounded-full border border-emerald-300 bg-emerald-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-emerald-700">
                        แอดมิต
                      </span>
                    ) : (
                      <span className="rounded-full border border-violet-300 bg-violet-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-violet-700">
                        ย้ายเตียง
                      </span>
                    )}
                  </div>
                  <div className="mt-1.5 text-[14px] text-slate-800">
                    {isFirstAdmit ? (
                      <>
                        <span className="text-slate-500">เข้าเตียงแรก:</span>{' '}
                        <span className="font-semibold text-slate-900">{toStr}</span>
                      </>
                    ) : (
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-slate-700">{fromStr}</span>
                        <span aria-hidden className="text-slate-400">→</span>
                        <span className="font-semibold text-slate-900">{toStr}</span>
                      </div>
                    )}
                  </div>
                  {(row.movereason || row.staff) && (
                    <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-0.5 text-[12px]">
                      {row.movereason && (
                        <span className="text-slate-600">
                          <span className="text-slate-400">เหตุผล: </span>
                          <span className="font-medium text-slate-800">{row.movereason}</span>
                        </span>
                      )}
                      {row.staff && (
                        <span className="font-mono text-slate-500">โดย {row.staff}</span>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ol>
        )}
      </section>
    </div>
  );
}
