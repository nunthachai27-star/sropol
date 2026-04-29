// DischargeTab — composite write to ipt + iptadm via dischargePatient.
//
// HOSxP source reference:
//   C:\Projects\BMS XE2 Application\BMS HOSxP XE\hosxpxe\HOSxPIPDRegistryPackage\
//     HOSxPIPDPatientAdmitDischargeEntryFrameUnit.{pas,dfm}
//
// Field semantics learned from the Delphi form:
//   - dchdate / dchtime           — when the patient was discharged
//   - dchtype  (varchar 2 FK)     — circumstances of discharge (dchtype master).
//                                   '01' With Approval, '02' Against Advice,
//                                   '04' By Transfer, '08'/'09' Dead, etc.
//   - dchstts  (varchar 2 FK)     — clinical outcome at discharge (dchstts master).
//                                   '01' Complete Recovery, '04' Normal Delivery
//                                   (canonical for maternity LR), '08' Dead Stillbirth, etc.
//   - dch_doctor                  — discharging doctor (free-text doctor code)
//   - confirm_discharge           — Y/N toggle in HOSxP — when N, all dch fields
//                                   are nulled. We model "discharged vs not" as
//                                   read-only status here; undo flow is future work.
//
// Bug fixed (this revision): previous tab hardcoded dchtype/dchstts options
// as '1','2','3' — but the master tables key on varchar(2) codes ('01'..'09').
// Hardcoded values silently violated the FK. Now the tab loads the live
// dchtype/dchstts master tables and displays "code · name" in the dropdowns.
'use client';

import { useEffect, useState } from 'react';
import useSWR from 'swr';
import { useBmsSession } from '@/hooks/useBmsSession';
import {
  dischargePatient,
  listDchStatuses,
  listDchTypes,
} from '@/services/maternity-ward';
import type { BedOccupancy } from '@/types/maternity-ward';
import { cn } from '@/lib/utils';

// ─── Helpers ───────────────────────────────────────────────────────────────

function formatAdmit(occupant: BedOccupancy): string {
  if (!occupant.regdate) return '—';
  return occupant.regtime ? `${occupant.regdate} ${occupant.regtime}` : occupant.regdate;
}

function admitDate(occupant: BedOccupancy): Date | null {
  if (!occupant.regdate) return null;
  const date = occupant.regdate.slice(0, 10);
  const time = (occupant.regtime ?? '00:00:00').slice(0, 8);
  const d = new Date(`${date}T${time}`);
  return Number.isFinite(d.getTime()) ? d : null;
}

function lengthOfStayBetween(admit: Date, dischargeDate: string, dischargeTime: string): string {
  const dt = `${dischargeDate}T${(dischargeTime || '00:00:00').slice(0, 8)}`;
  const d = new Date(dt);
  if (!Number.isFinite(d.getTime())) return '—';
  const ms = d.getTime() - admit.getTime();
  if (ms < 0) return '—';
  const totalMin = Math.floor(ms / 60_000);
  const days = Math.floor(totalMin / 1440);
  const hours = Math.floor((totalMin % 1440) / 60);
  const mins = totalMin % 60;
  if (days > 0) return `${days} วัน ${hours} ชม.`;
  if (hours > 0) return `${hours} ชม. ${mins} นาที`;
  return `${mins} นาที`;
}

function todayIso(): string {
  const d = new Date();
  const p = (n: number) => n.toString().padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
function nowHhmmss(): string {
  const d = new Date();
  const p = (n: number) => n.toString().padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

interface DraftState {
  dchdate: string;
  dchtime: string;
  dchtype: string;
  dchstts: string;
  dch_doctor: string;
}

// Maternity-LR canonical defaults — '01' (With Approval) for type and
// '04' (Normal Delivery) for status. The nurse can change either before
// confirming. Date+time auto-fill to "now".
const EMPTY_DRAFT: DraftState = {
  dchdate: '',
  dchtime: '',
  dchtype: '01',
  dchstts: '04',
  dch_doctor: '',
};

// ─── Field primitives ──────────────────────────────────────────────────────

function ReadField({
  label,
  value,
  emphasis,
}: {
  label: string;
  value: string | number | null | undefined;
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
    </div>
  );
}

const inputCls =
  'h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-[14px] text-slate-900 shadow-sm transition-colors hover:border-slate-300 focus:border-cyan-500 focus:outline-none focus:ring-2 focus:ring-cyan-500/20';

// ─── Main ──────────────────────────────────────────────────────────────────

export function DischargeTab({ occupant }: { occupant: BedOccupancy | null }) {
  const { config, userInfo } = useBmsSession();
  const [draft, setDraft] = useState<DraftState>(EMPTY_DRAFT);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [discharged, setDischarged] = useState(false);

  // Load discharge type + status masters once. Both are small (~10 rows
  // each on test BMS) so we cache them in SWR module memory and resolve
  // the saved code to its readable name client-side.
  const dchTypes = useSWR(
    config ? ['dchtype-list', config.apiUrl] : null,
    () => listDchTypes(config!),
    { revalidateOnFocus: false },
  );
  const dchStatuses = useSWR(
    config ? ['dchstts-list', config.apiUrl] : null,
    () => listDchStatuses(config!),
    { revalidateOnFocus: false },
  );

  // Auto-fill date+time to "now" the first time the form mounts. Avoid
  // overwriting a value the nurse already typed.
  useEffect(() => {
    setDraft((d) =>
      d.dchdate === '' && d.dchtime === ''
        ? { ...d, dchdate: todayIso(), dchtime: nowHhmmss() }
        : d,
    );
  }, []);

  if (!occupant) {
    return <div className="p-4 text-slate-500">ไม่พบข้อมูล</div>;
  }

  const hcode = userInfo?.hospcode ?? '';
  const admit = admitDate(occupant);

  function nameForType(code: string): string | undefined {
    return dchTypes.data?.find((t) => t.dchtype === code)?.name;
  }
  function nameForStatus(code: string): string | undefined {
    return dchStatuses.data?.find((s) => s.dchstts === code)?.name;
  }

  async function confirmAndSave() {
    if (!config || !userInfo || !occupant) return;
    if (!draft.dchdate || !draft.dchtime) {
      setSaveError('กรุณาระบุวันที่และเวลาจำหน่าย');
      return;
    }
    if (!window.confirm('ยืนยันการจำหน่ายผู้ป่วย? การดำเนินการนี้จะเปลี่ยนสถานะใน HOSxP')) {
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      await dischargePatient(config, userInfo, hcode, {
        an: occupant.an,
        dchdate: draft.dchdate,
        dchtime: draft.dchtime,
        dchtype: draft.dchtype,
        dchstts: draft.dchstts,
        dch_doctor: draft.dch_doctor || null,
      });
      setDischarged(true);
    } catch (e) {
      setSaveError(`จำหน่ายไม่สำเร็จ: ${(e as Error).message}`);
    } finally {
      setSaving(false);
    }
  }

  // ─── Discharged-confirmation view ────────────────────────────────────────
  if (discharged) {
    const losStr = admit ? lengthOfStayBetween(admit, draft.dchdate, draft.dchtime) : '—';
    return (
      <div className="space-y-4 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b-2 border-slate-900 pb-3">
          <div className="flex items-center gap-3">
            <span aria-hidden className="block h-1.5 w-8 bg-emerald-600" />
            <h2 className="text-[18px] font-bold tracking-tight text-slate-900">การจำหน่าย</h2>
            <span className="rounded-full border border-emerald-300 bg-emerald-50 px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide text-emerald-700">
              จำหน่ายแล้ว
            </span>
          </div>
          <span className="rounded-md bg-slate-100 px-2.5 py-1 font-mono text-[12px] font-semibold text-slate-700">
            AN {occupant.an}
          </span>
        </div>
        <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-[13px] text-emerald-800">
          ดำเนินการจำหน่ายเรียบร้อย ({draft.dchdate} {draft.dchtime})
        </div>
        <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <dl className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3 lg:grid-cols-4">
            <ReadField label="AN" value={occupant.an} />
            <ReadField label="แอดมิตเมื่อ" value={formatAdmit(occupant)} />
            <ReadField label="จำหน่ายเมื่อ" value={`${draft.dchdate} ${draft.dchtime}`} emphasis="primary" />
            <ReadField label="ระยะเวลานอน" value={losStr} emphasis="cyan" />
            <ReadField
              label="ประเภทจำหน่าย"
              value={nameForType(draft.dchtype) ? `${draft.dchtype} · ${nameForType(draft.dchtype)}` : draft.dchtype}
            />
            <ReadField
              label="สถานะจำหน่าย"
              value={nameForStatus(draft.dchstts) ? `${draft.dchstts} · ${nameForStatus(draft.dchstts)}` : draft.dchstts}
            />
            <ReadField label="แพทย์จำหน่าย" value={draft.dch_doctor} />
          </dl>
        </section>
      </div>
    );
  }

  // ─── Active-admission view ──────────────────────────────────────────────
  return (
    <div className="space-y-4 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b-2 border-slate-900 pb-3">
        <div className="flex items-center gap-3">
          <span aria-hidden className="block h-1.5 w-8 bg-cyan-600" />
          <h2 className="text-[18px] font-bold tracking-tight text-slate-900">การจำหน่าย</h2>
          <span className="rounded-full border border-cyan-300 bg-cyan-50 px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide text-cyan-700">
            ยังไม่มีการจำหน่าย
          </span>
        </div>
        <span className="rounded-md bg-slate-100 px-2.5 py-1 font-mono text-[12px] font-semibold text-slate-700">
          AN {occupant.an}
        </span>
      </div>

      {/* Patient summary */}
      <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-3 text-[11px] font-bold uppercase tracking-wide text-slate-500">
          รายการแอดมิตปัจจุบัน
        </div>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3 lg:grid-cols-4">
          <ReadField label="AN" value={occupant.an} />
          <ReadField label="HN" value={occupant.hn} />
          <ReadField label="แอดมิตเมื่อ" value={formatAdmit(occupant)} emphasis="cyan" />
          <ReadField
            label="เตียง · ห้อง"
            value={
              [occupant.bedno, occupant.roomname || occupant.roomno].filter(Boolean).join(' · ') || '—'
            }
          />
        </dl>
      </section>

      {/* Discharge entry form */}
      <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-3 text-[11px] font-bold uppercase tracking-wide text-slate-500">
          บันทึกการจำหน่าย
        </div>

        {saveError && (
          <div role="alert" className="mb-3 rounded-md border border-rose-300 bg-rose-50 px-3 py-2 text-[13px] font-semibold text-rose-700">
            {saveError}
          </div>
        )}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="flex flex-col gap-1">
            <label className="text-[12px] font-semibold text-slate-700">วันที่จำหน่าย</label>
            <input
              type="date"
              value={draft.dchdate}
              onChange={(e) => setDraft((d) => ({ ...d, dchdate: e.target.value }))}
              aria-label="dchdate"
              className={cn(inputCls, 'tabular-nums')}
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[12px] font-semibold text-slate-700">เวลาจำหน่าย</label>
            <input
              type="time"
              step="1"
              value={draft.dchtime}
              onChange={(e) => setDraft((d) => ({ ...d, dchtime: e.target.value }))}
              aria-label="dchtime"
              className={cn(inputCls, 'tabular-nums font-semibold')}
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[12px] font-semibold text-slate-700">ประเภทจำหน่าย</label>
            <select
              value={draft.dchtype}
              onChange={(e) => setDraft((d) => ({ ...d, dchtype: e.target.value }))}
              aria-label="dchtype"
              className={inputCls}
            >
              {(dchTypes.data ?? []).map((t) => (
                <option key={t.dchtype} value={t.dchtype}>
                  {t.dchtype} · {t.name}
                </option>
              ))}
              {/* Fallback if master not yet loaded so the form is usable
                  even on a slow tunnel — preserves the saved default. */}
              {(!dchTypes.data || dchTypes.data.length === 0) && (
                <option value={draft.dchtype}>{draft.dchtype}</option>
              )}
            </select>
            <div className="text-[11px] text-slate-500">
              {nameForType(draft.dchtype) ?? 'รหัสจาก dchtype master'}
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[12px] font-semibold text-slate-700">สถานะจำหน่าย</label>
            <select
              value={draft.dchstts}
              onChange={(e) => setDraft((d) => ({ ...d, dchstts: e.target.value }))}
              aria-label="dchstts"
              className={inputCls}
            >
              {(dchStatuses.data ?? []).map((s) => (
                <option key={s.dchstts} value={s.dchstts}>
                  {s.dchstts} · {s.name}
                </option>
              ))}
              {(!dchStatuses.data || dchStatuses.data.length === 0) && (
                <option value={draft.dchstts}>{draft.dchstts}</option>
              )}
            </select>
            <div className="text-[11px] text-slate-500">
              {nameForStatus(draft.dchstts) ?? 'รหัสจาก dchstts master'}
            </div>
          </div>
          <div className="flex flex-col gap-1 sm:col-span-2">
            <label className="text-[12px] font-semibold text-slate-700">แพทย์จำหน่าย (ทางเลือก)</label>
            <input
              type="text"
              value={draft.dch_doctor}
              onChange={(e) => setDraft((d) => ({ ...d, dch_doctor: e.target.value }))}
              aria-label="dch_doctor"
              placeholder="รหัสหรือชื่อแพทย์"
              className={inputCls}
            />
          </div>
          <div className="flex flex-col gap-1 sm:col-span-2">
            <label className="text-[12px] font-semibold text-slate-700">ระยะเวลานอน (คำนวณ)</label>
            <div className="flex h-10 items-center rounded-md bg-slate-50 px-3 text-[14px] font-semibold text-cyan-700">
              {admit && draft.dchdate && draft.dchtime
                ? lengthOfStayBetween(admit, draft.dchdate, draft.dchtime)
                : '—'}
            </div>
            <div className="text-[11px] text-slate-500">นับจากวัน/เวลาแอดมิต ถึงวัน/เวลาจำหน่าย</div>
          </div>
        </div>

        <div className="mt-5 flex items-center justify-end gap-2 border-t border-slate-200 pt-4">
          <button
            type="button"
            onClick={confirmAndSave}
            disabled={saving || !config}
            className="rounded-md border-2 border-rose-700 bg-rose-700 px-5 py-2 text-[14px] font-bold text-white transition-colors hover:bg-rose-800 disabled:opacity-40"
          >
            {saving ? 'กำลังบันทึก…' : 'ยืนยันการจำหน่าย'}
          </button>
        </div>
      </section>
    </div>
  );
}
