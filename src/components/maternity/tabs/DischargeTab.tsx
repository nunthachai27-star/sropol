// DischargeTab — composite write to ipt + iptadm via dischargePatient.
//
// HOSxP source reference:
//   C:\Projects\BMS XE2 Application\BMS HOSxP XE\hosxpxe\HOSxPIPDRegistryPackage\
//     HOSxPIPDPatientAdmitDischargeEntryFrameUnit.{pas,dfm}
//
// Field semantics learned from the Delphi form:
//   - dchdate / dchtime           — when the patient was discharged
//   - dchtype  (varchar 2 FK)     — circumstances of discharge (dchtype master).
//   - dchstts  (varchar 2 FK)     — clinical outcome at discharge (dchstts master).
//   - dch_doctor                  — discharging doctor (free-text doctor code)
//   - ipt_spclty (varchar 2 FK)   — specialty at discharge (spclty master).
//                                   '03' = สูติกรรม (Obstetrics), maternity LR canon.
//   - dch_severe_type_id (int FK) — severity at discharge (ipt_severe_type, 1..4).
//   - followup (Y/N)              — whether followup is required.
//   - confirm_discharge (Y/N)     — CRITICAL gate. WARD_BEDS_OCCUPANCY filters
//                                   on confirm_discharge='N'; until this flips
//                                   to 'Y' the patient stays on the active ward
//                                   roster even with dchdate/dchtime filled.
//                                   Our service forces it to 'Y' on save.
//
// User-friendly UX in this revision:
//   * 4 quick-scenario chips (Normal Delivery / Refer / AMA / Stillbirth)
//     pre-fill the most common Maternity LR discharge patterns in one tap.
//   * Specialty chips default to '03' (สูติกรรม) — maternity canon — with the
//     full master available via the dropdown for cross-spec discharges.
//   * Severity chips render with clinical tones (ระดับ 1 ok green → 4 crit rose).
//   * Followup is a clear Y/N toggle chip.
//   * Section-grouped layout: ข้อมูลการจำหน่าย / ผลการรักษา / ติดตามต่อเนื่อง.
//   * Required-field asterisks; live ระยะเวลานอน calculation; explicit
//     "confirm_discharge" banner so the nurse knows the save is final.
'use client';

import { useEffect, useState } from 'react';
import useSWR from 'swr';
import { useBmsSession } from '@/hooks/useBmsSession';
import {
  dischargePatient,
  listDchStatuses,
  listDchTypes,
  listIptSevereTypes,
  listSpecialties,
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
  ipt_spclty: string;
  dch_severe_type_id: string; // empty = not set; numeric string otherwise
  dch_doctor: string;
  followup: 'Y' | 'N';
}

// Maternity-LR canonical defaults — '01' (With Approval) for type, '04'
// (Normal Delivery) for status, '03' (สูติกรรม) for specialty. The nurse
// can change any before confirming. Date+time auto-fill to "now".
const EMPTY_DRAFT: DraftState = {
  dchdate: '',
  dchtime: '',
  dchtype: '01',
  dchstts: '04',
  ipt_spclty: '03',
  dch_severe_type_id: '',
  dch_doctor: '',
  followup: 'N',
};

// ─── Quick-scenario presets (common LR patterns) ───────────────────────────

interface ScenarioPreset {
  id: string;
  label: string;
  hint: string;
  patch: Partial<DraftState>;
  tone: 'ok' | 'warn' | 'crit';
}

const SCENARIOS: ScenarioPreset[] = [
  {
    id: 'normal-home',
    label: 'คลอดปกติ ส่งกลับบ้าน',
    hint: 'dchtype 01 · dchstts 04 · followup N',
    patch: { dchtype: '01', dchstts: '04', followup: 'N' },
    tone: 'ok',
  },
  {
    id: 'refer-out',
    label: 'ส่งต่อโรงพยาบาล',
    hint: 'dchtype 04 · dchstts 03 · followup Y',
    patch: { dchtype: '04', dchstts: '03', followup: 'Y' },
    tone: 'warn',
  },
  {
    id: 'ama',
    label: 'ขออนุญาตกลับเอง',
    hint: 'dchtype 02 · dchstts 03',
    patch: { dchtype: '02', dchstts: '03', followup: 'N' },
    tone: 'warn',
  },
  {
    id: 'stillbirth',
    label: 'ทารกเสียชีวิตในครรภ์',
    hint: 'dchstts 08 · followup Y',
    patch: { dchstts: '08', followup: 'Y' },
    tone: 'crit',
  },
];

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

function FormLabel({ children, required }: { children: React.ReactNode; required?: boolean }) {
  return (
    <label className="text-[12px] font-semibold text-slate-700">
      {children}
      {required && <span className="ml-0.5 text-rose-600">*</span>}
    </label>
  );
}

// Tonal chip with selected/unselected state — used for specialty / severity /
// followup quick-pick rows. No drag (categorical values).
function ToneChip({
  label,
  selected,
  tone,
  onClick,
  hint,
}: {
  label: string;
  selected: boolean;
  tone: 'cyan' | 'emerald' | 'amber' | 'rose' | 'lime';
  onClick: () => void;
  hint?: string;
}) {
  const tones: Record<typeof tone, { selected: string; unselected: string }> = {
    cyan: {
      selected: 'border-cyan-600 bg-cyan-600 text-white shadow-sm ring-2 ring-cyan-600/20',
      unselected: 'border-slate-200 bg-white text-slate-700 hover:border-cyan-400 hover:bg-cyan-50/60 hover:text-cyan-700',
    },
    emerald: {
      selected: 'border-emerald-600 bg-emerald-600 text-white shadow-sm ring-2 ring-emerald-600/20',
      unselected: 'border-emerald-300 bg-emerald-50/40 text-emerald-700 hover:border-emerald-500 hover:bg-emerald-50',
    },
    lime: {
      selected: 'border-lime-600 bg-lime-600 text-white shadow-sm ring-2 ring-lime-600/20',
      unselected: 'border-lime-300 bg-lime-50/40 text-lime-700 hover:border-lime-500 hover:bg-lime-50',
    },
    amber: {
      selected: 'border-amber-600 bg-amber-600 text-white shadow-sm ring-2 ring-amber-600/20',
      unselected: 'border-amber-300 bg-amber-50/40 text-amber-700 hover:border-amber-500 hover:bg-amber-50',
    },
    rose: {
      selected: 'border-rose-600 bg-rose-600 text-white shadow-sm ring-2 ring-rose-600/20',
      unselected: 'border-rose-300 bg-rose-50/40 text-rose-700 hover:border-rose-500 hover:bg-rose-50',
    },
  };
  const t = tones[tone];
  return (
    <button
      type="button"
      onClick={onClick}
      title={hint}
      className={cn(
        'rounded-md border px-3 py-1.5 text-[12px] font-semibold transition-all',
        selected ? t.selected : t.unselected,
      )}
    >
      {label}
    </button>
  );
}

// ─── Main ──────────────────────────────────────────────────────────────────

export function DischargeTab({ occupant }: { occupant: BedOccupancy | null }) {
  const { config, userInfo } = useBmsSession();
  const [draft, setDraft] = useState<DraftState>(EMPTY_DRAFT);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [discharged, setDischarged] = useState(false);
  const [activeScenario, setActiveScenario] = useState<string | null>(null);

  // Master-table fetches — small, cacheable, never invalidate on focus.
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
  const specialties = useSWR(
    config ? ['spclty-list', config.apiUrl] : null,
    () => listSpecialties(config!),
    { revalidateOnFocus: false },
  );
  const severeTypes = useSWR(
    config ? ['ipt-severe-type-list', config.apiUrl] : null,
    () => listIptSevereTypes(config!),
    { revalidateOnFocus: false },
  );

  // Auto-fill date+time on mount — only when the form is freshly empty.
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
  const losStr =
    admit && draft.dchdate && draft.dchtime
      ? lengthOfStayBetween(admit, draft.dchdate, draft.dchtime)
      : '—';

  function nameForType(code: string): string | undefined {
    return dchTypes.data?.find((t) => t.dchtype === code)?.name;
  }
  function nameForStatus(code: string): string | undefined {
    return dchStatuses.data?.find((s) => s.dchstts === code)?.name;
  }
  function nameForSpclty(code: string): string | undefined {
    return specialties.data?.find((s) => s.spclty === code)?.name;
  }
  function nameForSeverity(id: string): string | undefined {
    if (id === '') return undefined;
    const n = Number(id);
    return severeTypes.data?.find((s) => s.ipt_severe_type_id === n)?.ipt_severe_type_name;
  }

  function applyScenario(s: ScenarioPreset) {
    setDraft((d) => ({ ...d, ...s.patch }));
    setActiveScenario(s.id);
  }

  // Severity tone ladder: 1 = ok green, 2 = lime, 3 = warn amber, 4 = crit rose.
  function severityTone(id: number): 'emerald' | 'lime' | 'amber' | 'rose' {
    if (id <= 1) return 'emerald';
    if (id === 2) return 'lime';
    if (id === 3) return 'amber';
    return 'rose';
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
        ipt_spclty: draft.ipt_spclty || null,
        dch_severe_type_id:
          draft.dch_severe_type_id !== '' ? Number(draft.dch_severe_type_id) : null,
        followup: draft.followup,
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
              label="แผนก"
              value={
                nameForSpclty(draft.ipt_spclty)
                  ? `${draft.ipt_spclty} · ${nameForSpclty(draft.ipt_spclty)}`
                  : draft.ipt_spclty
              }
            />
            <ReadField
              label="ประเภทจำหน่าย"
              value={
                nameForType(draft.dchtype)
                  ? `${draft.dchtype} · ${nameForType(draft.dchtype)}`
                  : draft.dchtype
              }
            />
            <ReadField
              label="สถานะจำหน่าย"
              value={
                nameForStatus(draft.dchstts)
                  ? `${draft.dchstts} · ${nameForStatus(draft.dchstts)}`
                  : draft.dchstts
              }
            />
            <ReadField label="ความรุนแรง" value={nameForSeverity(draft.dch_severe_type_id)} />
            <ReadField label="แพทย์จำหน่าย" value={draft.dch_doctor} />
            <ReadField label="ติดตามต่อเนื่อง" value={draft.followup === 'Y' ? 'ใช่' : 'ไม่'} />
          </dl>
        </section>
      </div>
    );
  }

  // ─── Active-admission view ──────────────────────────────────────────────
  return (
    <div className="space-y-4 p-4">
      {/* Title bar */}
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
              [occupant.bedno, occupant.roomname || occupant.roomno]
                .filter(Boolean)
                .join(' · ') || '—'
            }
          />
        </dl>
      </section>

      {/* Quick scenarios */}
      <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-1 text-[11px] font-bold uppercase tracking-wide text-slate-500">
          สถานการณ์ที่พบบ่อย — แตะหนึ่งครั้งเพื่อเติมค่าทั้งหมด
        </div>
        <div className="mb-3 text-[11px] text-slate-500">
          ปรับค่าได้ในแบบฟอร์มด้านล่าง — สถานการณ์เป็น preset เพื่อความเร็ว
        </div>
        <div className="flex flex-wrap gap-2">
          {SCENARIOS.map((s) => (
            <ToneChip
              key={s.id}
              label={s.label}
              hint={s.hint}
              selected={activeScenario === s.id}
              tone={s.tone === 'ok' ? 'emerald' : s.tone === 'warn' ? 'amber' : 'rose'}
              onClick={() => applyScenario(s)}
            />
          ))}
        </div>
      </section>

      {saveError && (
        <div role="alert" className="rounded-md border border-rose-300 bg-rose-50 px-3 py-2 text-[13px] font-semibold text-rose-700">
          {saveError}
        </div>
      )}

      {/* Section 1: ข้อมูลการจำหน่าย */}
      <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-3 flex items-center gap-2 text-[11px] font-bold uppercase tracking-wide text-slate-500">
          <span className="block h-2 w-2 rounded-full bg-cyan-500" aria-hidden />
          ข้อมูลการจำหน่าย
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="flex flex-col gap-1">
            <FormLabel required>วันที่จำหน่าย</FormLabel>
            <input
              type="date"
              value={draft.dchdate}
              onChange={(e) => setDraft((d) => ({ ...d, dchdate: e.target.value }))}
              aria-label="dchdate"
              className={cn(inputCls, 'tabular-nums')}
            />
          </div>
          <div className="flex flex-col gap-1">
            <FormLabel required>เวลาจำหน่าย</FormLabel>
            <input
              type="time"
              step="1"
              value={draft.dchtime}
              onChange={(e) => setDraft((d) => ({ ...d, dchtime: e.target.value }))}
              aria-label="dchtime"
              className={cn(inputCls, 'tabular-nums font-semibold')}
            />
          </div>
          <div className="flex flex-col gap-1 sm:col-span-2">
            <FormLabel>แพทย์ผู้สั่งจำหน่าย</FormLabel>
            <input
              type="text"
              value={draft.dch_doctor}
              onChange={(e) => setDraft((d) => ({ ...d, dch_doctor: e.target.value }))}
              aria-label="dch_doctor"
              placeholder="รหัสหรือชื่อแพทย์"
              className={inputCls}
            />
          </div>
          <div className="flex flex-col gap-1.5 sm:col-span-2 lg:col-span-4">
            <FormLabel>แผนกที่จำหน่าย</FormLabel>
            <div className="flex flex-wrap gap-2">
              {/* Top 4 most-used specialties as chips; full list still
                  available via the dropdown below. Maternity-LR canon is '03'. */}
              {(specialties.data ?? [])
                .filter((s) => ['01', '02', '03', '04', '05'].includes(s.spclty))
                .map((s) => (
                  <ToneChip
                    key={s.spclty}
                    label={`${s.spclty} · ${s.name.replace(/x+$/, '').slice(0, 30)}`}
                    selected={draft.ipt_spclty === s.spclty}
                    tone="cyan"
                    onClick={() => setDraft((d) => ({ ...d, ipt_spclty: s.spclty }))}
                  />
                ))}
            </div>
            <select
              value={draft.ipt_spclty}
              onChange={(e) => setDraft((d) => ({ ...d, ipt_spclty: e.target.value }))}
              aria-label="ipt_spclty"
              className={cn(inputCls, 'max-w-md')}
            >
              {(specialties.data ?? []).map((s) => (
                <option key={s.spclty} value={s.spclty}>
                  {s.spclty} · {s.name}
                </option>
              ))}
              {(!specialties.data || specialties.data.length === 0) && (
                <option value={draft.ipt_spclty}>{draft.ipt_spclty}</option>
              )}
            </select>
          </div>
        </div>
      </section>

      {/* Section 2: ผลการรักษา */}
      <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-3 flex items-center gap-2 text-[11px] font-bold uppercase tracking-wide text-slate-500">
          <span className="block h-2 w-2 rounded-full bg-violet-500" aria-hidden />
          ผลการรักษา
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1">
            <FormLabel required>ประเภทจำหน่าย (dchtype)</FormLabel>
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
              {(!dchTypes.data || dchTypes.data.length === 0) && (
                <option value={draft.dchtype}>{draft.dchtype}</option>
              )}
            </select>
            <div className="text-[11px] text-slate-500">
              {nameForType(draft.dchtype) ?? 'รหัสจาก dchtype master'}
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <FormLabel required>สถานะจำหน่าย (dchstts)</FormLabel>
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
          <div className="flex flex-col gap-1.5 sm:col-span-2">
            <FormLabel>ความรุนแรงตอนจำหน่าย</FormLabel>
            <div className="flex flex-wrap gap-2">
              <ToneChip
                label="ไม่ระบุ"
                selected={draft.dch_severe_type_id === ''}
                tone="cyan"
                onClick={() => setDraft((d) => ({ ...d, dch_severe_type_id: '' }))}
              />
              {(severeTypes.data ?? []).map((s) => (
                <ToneChip
                  key={s.ipt_severe_type_id}
                  label={s.ipt_severe_type_name.trim()}
                  selected={draft.dch_severe_type_id === String(s.ipt_severe_type_id)}
                  tone={severityTone(s.ipt_severe_type_id)}
                  onClick={() =>
                    setDraft((d) => ({ ...d, dch_severe_type_id: String(s.ipt_severe_type_id) }))
                  }
                />
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Section 3: ติดตามต่อเนื่อง */}
      <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-3 flex items-center gap-2 text-[11px] font-bold uppercase tracking-wide text-slate-500">
          <span className="block h-2 w-2 rounded-full bg-emerald-500" aria-hidden />
          ติดตามต่อเนื่อง · ระยะเวลานอน
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <FormLabel>ต้องการนัดติดตาม?</FormLabel>
            <div className="flex gap-2">
              <ToneChip
                label="ไม่ต้องนัดติดตาม"
                selected={draft.followup === 'N'}
                tone="cyan"
                onClick={() => setDraft((d) => ({ ...d, followup: 'N' }))}
              />
              <ToneChip
                label="ต้องนัดติดตาม"
                selected={draft.followup === 'Y'}
                tone="emerald"
                onClick={() => setDraft((d) => ({ ...d, followup: 'Y' }))}
              />
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <FormLabel>ระยะเวลานอน (คำนวณ)</FormLabel>
            <div className="flex h-10 items-center rounded-md bg-slate-50 px-3 text-[14px] font-semibold text-cyan-700">
              {losStr}
            </div>
            <div className="text-[11px] text-slate-500">
              นับจากวัน/เวลาแอดมิต ถึงวัน/เวลาจำหน่าย
            </div>
          </div>
        </div>
      </section>

      {/* Confirm-discharge banner + save */}
      <section className="rounded-lg border-2 border-rose-200 bg-rose-50 p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-col gap-1">
            <div className="text-[13px] font-bold text-rose-900">
              ⚠ การกดยืนยันจะตั้งค่า <span className="font-mono">confirm_discharge = 'Y'</span> ใน HOSxP
            </div>
            <div className="text-[12px] text-rose-700">
              ผู้ป่วยจะถูกย้ายออกจากรายชื่อเตียงในหอผู้ป่วยทันทีหลังบันทึก
            </div>
          </div>
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
