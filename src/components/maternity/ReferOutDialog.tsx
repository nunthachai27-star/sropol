// ReferOutDialog — full-form modal for the discharge-by-transfer flow.
//
// HOSxP source reference:
//   ReferButtonClick in HOSxPIPDPatientAdmitDischargeEntryFrameUnit.pas
//     loads HOSxPReferPackage.bpl and opens HOSxPReferOutEntryForm.
//   The Delphi form is keyed by referout.vn = AN (one row per admission).
//
// Sections (matches the analysis we agreed on):
//   1. ปลายทาง (Destination)        — refer_hospcode + date/time + doctor + spclty
//   2. เหตุผลและประเภท              — refer_cause / refer_type / emergency level
//   3. ข้อมูลคลินิก (clinical brief) — pre_diagnosis, pdx, pmh, hpi, lab,
//                                     treatment, request, ptstatus
//   4. ทีมส่งต่อ (transit team)     — with_doctor / nurse / ambulance + plate
//
// Validation: refer_hospcode + refer_cause + refer_type are required.
// On INSERT, mintSerial mints referout_id; on UPDATE we forward it.
// hospcode + refer_hospcode are kept aligned in the service layer.
'use client';

import { useEffect, useMemo, useState } from 'react';
import useSWR from 'swr';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  getPatientReferOut,
  listReferCauses,
  listReferTypes,
  listReferoutEmergencyTypes,
  searchDoctors,
  searchHospcodes,
  searchIcd10,
  searchSpecialties,
  upsertReferOut,
} from '@/services/maternity-ward';
import type { ConnectionConfig, UserInfo } from '@/types/bms-browser';
import type { ReferOutRow } from '@/types/maternity-ward';
import { cn } from '@/lib/utils';
import {
  BeDateInput,
  BeTimeInput,
} from '@/components/maternity/shared/BeDateTimeInputs';
import { LookupAutocomplete, type LookupItem } from './shared/LookupAutocomplete';

interface DraftState {
  referout_id?: number;
  refer_hospcode: string;
  refer_hospcode_name: string;     // display label paired with refer_hospcode
  refer_date: string;
  refer_time: string;
  doctor: string;                  // doctor.code committed to DB
  doctor_name: string;             // display label paired with doctor
  spclty: string;
  spclty_name: string;             // display label paired with spclty
  refer_cause: string;             // numeric string (master id) or '' for unset
  refer_type: string;
  referout_emergency_type_id: string;
  pre_diagnosis: string;
  pdx: string;                     // ICD10 code committed to DB
  pdx_name: string;                // display label (Thai or English) paired with pdx
  pmh: string;
  hpi: string;
  lab_text: string;
  treatment_text: string;
  request_text: string;
  ptstatus_text: string;
  with_doctor: 'Y' | 'N';
  with_nurse: 'Y' | 'N';
  with_ambulance: 'Y' | 'N';
  car_registration_no: string;
}

const EMPTY_DRAFT: DraftState = {
  refer_hospcode: '',
  refer_hospcode_name: '',
  refer_date: '',
  refer_time: '',
  doctor: '',
  doctor_name: '',
  spclty: '03', // maternity-LR default
  spclty_name: 'สูติกรรม',
  refer_cause: '1',
  refer_type: '1',
  referout_emergency_type_id: '',
  pre_diagnosis: '',
  pdx: '',
  pdx_name: '',
  pmh: '',
  hpi: '',
  lab_text: '',
  treatment_text: '',
  request_text: '',
  ptstatus_text: '',
  with_doctor: 'N',
  with_nurse: 'Y',
  with_ambulance: 'Y',
  car_registration_no: '',
};

export interface ReferOutDialogProps {
  open: boolean;
  config: ConnectionConfig | null;
  userInfo: UserInfo | null;
  hcode: string;
  an: string;
  hn: string | null | undefined;
  /** Default refer date/time (typically the discharge date/time on the
   *  parent tab). Used only when no existing referout row is found. */
  defaultDate?: string;
  defaultTime?: string;
  onClose: () => void;
  /** Fired after a successful save so the parent tab can reflect that
   *  refer-out data now exists (clears the "no referral data" warning). */
  onSaved?: (row: ReferOutRow) => void;
}

const inputCls =
  'h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-[14px] text-slate-900 shadow-sm transition-colors hover:border-slate-300 focus:border-cyan-500 focus:outline-none focus:ring-2 focus:ring-cyan-500/20';
const textareaCls =
  'min-h-[80px] w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-[14px] text-slate-900 shadow-sm transition-colors hover:border-slate-300 focus:border-cyan-500 focus:outline-none focus:ring-2 focus:ring-cyan-500/20';

function FormLabel({ children, required }: { children: React.ReactNode; required?: boolean }) {
  return (
    <label className="text-[12px] font-semibold text-slate-700">
      {children}
      {required && <span className="ml-0.5 text-rose-600">*</span>}
    </label>
  );
}

// Tone chip for category pickers (refer_cause / refer_type / emergency).
function ToneChip({
  label,
  selected,
  tone,
  onClick,
}: {
  label: string;
  selected: boolean;
  tone: 'cyan' | 'emerald' | 'lime' | 'amber' | 'rose';
  onClick: () => void;
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
      className={cn(
        'rounded-md border px-3 py-1.5 text-[12px] font-semibold transition-all',
        selected ? t.selected : t.unselected,
      )}
    >
      {label}
    </button>
  );
}

// Severity tone for emergency type — 1 Life threatening = rose, 5 Non acute = emerald.
function emergencyTone(id: number): 'emerald' | 'lime' | 'amber' | 'rose' {
  if (id === 1) return 'rose';
  if (id === 2) return 'rose';
  if (id === 3) return 'amber';
  if (id === 4) return 'lime';
  return 'emerald';
}

export function ReferOutDialog({
  open,
  config,
  userInfo,
  hcode,
  an,
  hn,
  defaultDate,
  defaultTime,
  onClose,
  onSaved,
}: ReferOutDialogProps) {
  const [draft, setDraft] = useState<DraftState>(EMPTY_DRAFT);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Lookups
  const causes = useSWR(
    open && config ? ['refer-cause-list', config.apiUrl] : null,
    () => listReferCauses(config!),
    { revalidateOnFocus: false },
  );
  const types = useSWR(
    open && config ? ['refer-type-list', config.apiUrl] : null,
    () => listReferTypes(config!),
    { revalidateOnFocus: false },
  );
  const emergencies = useSWR(
    open && config ? ['refer-emergency-list', config.apiUrl] : null,
    () => listReferoutEmergencyTypes(config!),
    { revalidateOnFocus: false },
  );

  // Existing referout — populates the dialog so the nurse can edit.
  const existing = useSWR<ReferOutRow | null>(
    open && config ? ['referout', config.apiUrl, an] : null,
    () => getPatientReferOut(config!, an),
    { revalidateOnFocus: false },
  );

  // Hydrate the draft when the dialog opens or when the existing row arrives.
  useEffect(() => {
    if (!open) return;
    const row = existing.data;
    if (row) {
      const num = (v: unknown): string => (v === null || v === undefined ? '' : String(v));
      const yn = (v: unknown): 'Y' | 'N' => (v === 'Y' ? 'Y' : 'N');
      // valueLabel fields stay empty on hydrate from existing row — the
      // LookupAutocomplete components show the raw code in the input until
      // the operator picks again. (Storing the resolved name on the row
      // would require denormalizing across writes; not worth the cost.)
      setDraft({
        referout_id: row.referout_id,
        refer_hospcode: num(row.refer_hospcode ?? row.hospcode),
        refer_hospcode_name: '',
        refer_date: num(row.refer_date).slice(0, 10) || defaultDate || '',
        refer_time: num(row.refer_time).slice(0, 8) || defaultTime || '',
        doctor: num(row.doctor),
        doctor_name: '',
        spclty: num(row.spclty) || '03',
        spclty_name: '',
        refer_cause: num(row.refer_cause) || '1',
        refer_type: num(row.refer_type) || '1',
        referout_emergency_type_id: num(row.referout_emergency_type_id),
        pre_diagnosis: num(row.pre_diagnosis),
        pdx: num(row.pdx),
        pdx_name: '',
        pmh: num(row.pmh),
        hpi: num(row.hpi),
        lab_text: num(row.lab_text),
        treatment_text: num(row.treatment_text),
        request_text: num(row.request_text),
        ptstatus_text: num(row.ptstatus_text),
        with_doctor: yn(row.with_doctor),
        with_nurse: yn(row.with_nurse),
        with_ambulance: yn(row.with_ambulance),
        car_registration_no: num(row.car_registration_no),
      });
    } else if (existing.data === null && !existing.isLoading) {
      // Fresh refer-out, no existing row.
      setDraft({
        ...EMPTY_DRAFT,
        refer_date: defaultDate ?? '',
        refer_time: defaultTime ?? '',
      });
    }
  }, [open, existing.data, existing.isLoading, defaultDate, defaultTime]);

  const causeChips = useMemo(() => causes.data ?? [], [causes.data]);
  const typeChips = useMemo(() => types.data ?? [], [types.data]);
  const emergencyChips = useMemo(() => emergencies.data ?? [], [emergencies.data]);

  async function save() {
    if (!config || !userInfo) return;
    if (!draft.refer_hospcode.trim()) {
      setSaveError('กรุณาระบุโรงพยาบาลปลายทาง');
      return;
    }
    if (draft.refer_cause === '' || draft.refer_type === '') {
      setSaveError('กรุณาระบุเหตุผลและประเภทการส่งต่อ');
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      const result = await upsertReferOut(
        config,
        userInfo,
        {
          referout_id: draft.referout_id,
          an,
          hn: hn ?? null,
          refer_hospcode: draft.refer_hospcode || null,
          refer_date: draft.refer_date || null,
          refer_time: draft.refer_time ? `${draft.refer_time}:00`.slice(0, 8) : null,
          doctor: draft.doctor || null,
          spclty: draft.spclty || null,
          refer_cause: draft.refer_cause !== '' ? Number(draft.refer_cause) : null,
          refer_type: draft.refer_type !== '' ? Number(draft.refer_type) : null,
          referout_emergency_type_id:
            draft.referout_emergency_type_id !== ''
              ? Number(draft.referout_emergency_type_id)
              : null,
          pre_diagnosis: draft.pre_diagnosis || null,
          pdx: draft.pdx || null,
          pmh: draft.pmh || null,
          hpi: draft.hpi || null,
          lab_text: draft.lab_text || null,
          treatment_text: draft.treatment_text || null,
          request_text: draft.request_text || null,
          ptstatus_text: draft.ptstatus_text || null,
          with_doctor: draft.with_doctor,
          with_nurse: draft.with_nurse,
          with_ambulance: draft.with_ambulance,
          car_registration_no: draft.car_registration_no || null,
        },
        hcode,
      );
      if (onSaved) onSaved(result);
      onClose();
    } catch (e) {
      setSaveError(`บันทึกไม่สำเร็จ: ${(e as Error).message}`);
    } finally {
      setSaving(false);
    }
  }

  const setF = <K extends keyof DraftState>(k: K, v: DraftState[K]) =>
    setDraft((d) => ({ ...d, [k]: v }));

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent
        className="sm:max-w-5xl max-h-[92vh] overflow-y-auto gap-3 bg-slate-50 p-4"
        showCloseButton={false}
      >
        <DialogHeader className="flex-row items-center justify-between gap-3 border-b-2 border-slate-900 pb-4">
          <div className="flex items-center gap-3">
            <span aria-hidden className="block h-1.5 w-8 bg-amber-600" />
            <DialogTitle className="text-[18px] font-bold tracking-tight text-slate-900">
              ส่งต่อโรงพยาบาล (Refer Out)
            </DialogTitle>
            {draft.referout_id !== undefined && (
              <span className="rounded-md bg-slate-100 px-2.5 py-1 font-mono text-[11px] font-semibold text-slate-700">
                referout_id {draft.referout_id}
              </span>
            )}
          </div>
        </DialogHeader>

        {existing.isLoading && (
          <div className="rounded-md border border-slate-200 bg-white px-3 py-2 text-[12px] text-slate-500">
            กำลังโหลดข้อมูลเดิม…
          </div>
        )}

        {saveError && (
          <div role="alert" className="rounded-md border border-rose-300 bg-rose-50 px-3 py-2 text-[13px] font-semibold text-rose-700">
            {saveError}
          </div>
        )}

        {/* Section 1 · ปลายทาง */}
        <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <div className="mb-3 flex items-center gap-2 text-[11px] font-bold uppercase tracking-wide text-slate-500">
            <span className="block h-2 w-2 rounded-full bg-cyan-500" aria-hidden />
            ปลายทาง · Destination
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="flex flex-col gap-1 sm:col-span-2 lg:col-span-2">
              <FormLabel required>โรงพยาบาลปลายทาง</FormLabel>
              {config ? (
                <LookupAutocomplete
                  ariaLabel="refer_hospcode_search"
                  placeholder="พิมพ์ชื่อโรงพยาบาลหรือรหัส 5/9 หลัก…"
                  value={draft.refer_hospcode}
                  valueLabel={draft.refer_hospcode_name}
                  fetch={async (q) => {
                    const rows = await searchHospcodes(config, q);
                    return rows.map<LookupItem>((r) => ({
                      value: r.hospcode,
                      primary: r.name,
                      secondary: r.hospcode,
                    }));
                  }}
                  onPick={(it) =>
                    setDraft((d) => ({
                      ...d,
                      refer_hospcode: it.value,
                      refer_hospcode_name: it.primary,
                    }))
                  }
                />
              ) : (
                <input className={inputCls} disabled />
              )}
              {draft.refer_hospcode && (
                <div className="font-mono text-[11px] text-slate-500">
                  รหัส: {draft.refer_hospcode}
                </div>
              )}
            </div>
            <div className="flex flex-col gap-1">
              <FormLabel required>วันที่ส่งต่อ</FormLabel>
              <BeDateInput
                aria-label="refer_date"
                value={draft.refer_date}
                onChange={(v) => setF('refer_date', v)}
                className={cn(inputCls, 'tabular-nums')}
              />
            </div>
            <div className="flex flex-col gap-1">
              <FormLabel required>เวลาส่งต่อ</FormLabel>
              <BeTimeInput
                aria-label="refer_time"
                value={draft.refer_time.slice(0, 5)}
                onChange={(v) => setF('refer_time', v)}
                className={cn(inputCls, 'tabular-nums font-semibold')}
              />
            </div>
            <div className="flex flex-col gap-1 sm:col-span-2">
              <FormLabel>แพทย์ผู้ส่งต่อ</FormLabel>
              {config ? (
                <LookupAutocomplete
                  ariaLabel="refer_doctor"
                  placeholder="พิมพ์ชื่อแพทย์ หรือรหัส…"
                  value={draft.doctor}
                  valueLabel={draft.doctor_name}
                  fetch={async (q) => {
                    const rows = await searchDoctors(config, q);
                    return rows.map<LookupItem>((r) => ({
                      value: r.code,
                      primary: r.name,
                      secondary: r.code,
                    }));
                  }}
                  onPick={(it) =>
                    setDraft((d) => ({ ...d, doctor: it.value, doctor_name: it.primary }))
                  }
                />
              ) : (
                <input className={inputCls} disabled />
              )}
              {draft.doctor && (
                <div className="font-mono text-[11px] text-slate-500">รหัส: {draft.doctor}</div>
              )}
            </div>
            <div className="flex flex-col gap-1 sm:col-span-2">
              <FormLabel>แผนกที่ส่งต่อ (spclty)</FormLabel>
              {config ? (
                <LookupAutocomplete
                  ariaLabel="refer_spclty"
                  placeholder="พิมพ์ชื่อแผนก เช่น สูติกรรม…"
                  value={draft.spclty}
                  valueLabel={draft.spclty_name}
                  fetch={async (q) => {
                    const rows = await searchSpecialties(config, q);
                    return rows.map<LookupItem>((r) => ({
                      value: r.spclty,
                      primary: r.name,
                      secondary: r.spclty,
                    }));
                  }}
                  onPick={(it) =>
                    setDraft((d) => ({ ...d, spclty: it.value, spclty_name: it.primary }))
                  }
                />
              ) : (
                <input className={inputCls} disabled />
              )}
              <div className="text-[11px] text-slate-500">
                ค่า default 03 = สูติกรรม · รหัสปัจจุบัน:{' '}
                <span className="font-mono font-semibold">{draft.spclty || '—'}</span>
              </div>
            </div>
          </div>
        </section>

        {/* Section 2 · เหตุผลและประเภท */}
        <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <div className="mb-3 flex items-center gap-2 text-[11px] font-bold uppercase tracking-wide text-slate-500">
            <span className="block h-2 w-2 rounded-full bg-violet-500" aria-hidden />
            เหตุผล + ประเภท + ความเร่งด่วน
          </div>
          <div className="space-y-4">
            <div className="flex flex-col gap-1.5">
              <FormLabel required>เหตุผลการส่งต่อ (refer_cause)</FormLabel>
              <div className="flex flex-wrap gap-2">
                {causeChips.map((c) => (
                  <ToneChip
                    key={c.id}
                    label={`${c.id} · ${c.name}`}
                    selected={draft.refer_cause === String(c.id)}
                    tone="cyan"
                    onClick={() => setF('refer_cause', String(c.id))}
                  />
                ))}
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <FormLabel required>ประเภทการส่งต่อ (refer_type)</FormLabel>
              <div className="flex flex-wrap gap-2">
                {typeChips.map((t) => (
                  <ToneChip
                    key={t.refer_type}
                    label={`${t.refer_type} · ${t.refer_type_name}`}
                    selected={draft.refer_type === String(t.refer_type)}
                    tone="cyan"
                    onClick={() => setF('refer_type', String(t.refer_type))}
                  />
                ))}
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <FormLabel>ระดับความเร่งด่วน (emergency type)</FormLabel>
              <div className="flex flex-wrap gap-2">
                <ToneChip
                  label="ไม่ระบุ"
                  selected={draft.referout_emergency_type_id === ''}
                  tone="cyan"
                  onClick={() => setF('referout_emergency_type_id', '')}
                />
                {emergencyChips.map((e) => (
                  <ToneChip
                    key={e.referout_emergency_type_id}
                    label={`${e.referout_emergency_type_id} · ${e.referout_emergency_type_name}`}
                    selected={
                      draft.referout_emergency_type_id === String(e.referout_emergency_type_id)
                    }
                    tone={emergencyTone(e.referout_emergency_type_id)}
                    onClick={() =>
                      setF('referout_emergency_type_id', String(e.referout_emergency_type_id))
                    }
                  />
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* Section 3 · ข้อมูลคลินิก */}
        <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <div className="mb-3 flex items-center gap-2 text-[11px] font-bold uppercase tracking-wide text-slate-500">
            <span className="block h-2 w-2 rounded-full bg-emerald-500" aria-hidden />
            ข้อมูลคลินิก · Clinical brief
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1 sm:col-span-2">
              <FormLabel>วินิจฉัยเบื้องต้น (pre_diagnosis)</FormLabel>
              <input
                type="text"
                value={draft.pre_diagnosis}
                onChange={(e) => setF('pre_diagnosis', e.target.value)}
                aria-label="pre_diagnosis"
                placeholder="คำวินิจฉัยสั้น เช่น Postpartum hemorrhage"
                className={inputCls}
              />
            </div>
            <div className="flex flex-col gap-1">
              <FormLabel>ICD10 หลัก (pdx)</FormLabel>
              {config ? (
                <LookupAutocomplete
                  ariaLabel="pdx"
                  placeholder="พิมพ์รหัสหรือชื่อโรค (TH/EN)…"
                  value={draft.pdx}
                  valueLabel={draft.pdx_name}
                  fetch={async (q) => {
                    const rows = await searchIcd10(config, q);
                    return rows.map<LookupItem>((r) => ({
                      value: r.code,
                      primary: r.tname || r.name,
                      secondary: r.code,
                    }));
                  }}
                  onPick={(it) =>
                    setDraft((d) => ({ ...d, pdx: it.value, pdx_name: it.primary }))
                  }
                />
              ) : (
                <input className={inputCls} disabled />
              )}
              {draft.pdx && (
                <div className="font-mono text-[11px] text-slate-500">รหัส: {draft.pdx}</div>
              )}
            </div>
            <div /> {/* layout filler */}
            <div className="flex flex-col gap-1">
              <FormLabel>PMH (อดีตประวัติ)</FormLabel>
              <textarea
                value={draft.pmh}
                onChange={(e) => setF('pmh', e.target.value)}
                aria-label="pmh"
                placeholder="โรคประจำตัว ประวัติคลอดก่อน ผ่าตัด ฯลฯ"
                className={textareaCls}
                rows={3}
              />
            </div>
            <div className="flex flex-col gap-1">
              <FormLabel>HPI (ประวัติการป่วยปัจจุบัน)</FormLabel>
              <textarea
                value={draft.hpi}
                onChange={(e) => setF('hpi', e.target.value)}
                aria-label="hpi"
                placeholder="อาการนำ ระยะเวลา การดำเนินโรค"
                className={textareaCls}
                rows={3}
              />
            </div>
            <div className="flex flex-col gap-1">
              <FormLabel>ผลตรวจห้องแล็บ (lab_text)</FormLabel>
              <textarea
                value={draft.lab_text}
                onChange={(e) => setF('lab_text', e.target.value)}
                aria-label="lab_text"
                placeholder="Hb, Hct, electrolytes, blood-bank crossmatch ฯลฯ"
                className={textareaCls}
                rows={3}
              />
            </div>
            <div className="flex flex-col gap-1">
              <FormLabel>การรักษาที่ให้ก่อนส่ง (treatment_text)</FormLabel>
              <textarea
                value={draft.treatment_text}
                onChange={(e) => setF('treatment_text', e.target.value)}
                aria-label="treatment_text"
                placeholder="IV fluid, oxytocin, blood transfusion ฯลฯ"
                className={textareaCls}
                rows={3}
              />
            </div>
            <div className="flex flex-col gap-1">
              <FormLabel>คำขอจากโรงพยาบาลปลายทาง (request_text)</FormLabel>
              <textarea
                value={draft.request_text}
                onChange={(e) => setF('request_text', e.target.value)}
                aria-label="request_text"
                placeholder="ขอรับการตรวจ/รักษา/ผ่าตัด อะไรเป็นพิเศษ"
                className={textareaCls}
                rows={3}
              />
            </div>
            <div className="flex flex-col gap-1">
              <FormLabel>สถานะผู้ป่วยขณะส่ง (ptstatus_text)</FormLabel>
              <textarea
                value={draft.ptstatus_text}
                onChange={(e) => setF('ptstatus_text', e.target.value)}
                aria-label="ptstatus_text"
                placeholder="Vital signs, conscious level, IV ที่กำลังให้ ฯลฯ"
                className={textareaCls}
                rows={3}
              />
            </div>
          </div>
        </section>

        {/* Section 4 · ทีมส่งต่อ */}
        <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <div className="mb-3 flex items-center gap-2 text-[11px] font-bold uppercase tracking-wide text-slate-500">
            <span className="block h-2 w-2 rounded-full bg-amber-500" aria-hidden />
            ทีมส่งต่อและพาหนะ
          </div>
          <div className="space-y-3">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div className="flex flex-col gap-1.5">
                <FormLabel>แพทย์ร่วมไป</FormLabel>
                <div className="flex gap-2">
                  <ToneChip
                    label="ไม่ไป"
                    selected={draft.with_doctor === 'N'}
                    tone="cyan"
                    onClick={() => setF('with_doctor', 'N')}
                  />
                  <ToneChip
                    label="ไปด้วย"
                    selected={draft.with_doctor === 'Y'}
                    tone="emerald"
                    onClick={() => setF('with_doctor', 'Y')}
                  />
                </div>
              </div>
              <div className="flex flex-col gap-1.5">
                <FormLabel>พยาบาลร่วมไป</FormLabel>
                <div className="flex gap-2">
                  <ToneChip
                    label="ไม่ไป"
                    selected={draft.with_nurse === 'N'}
                    tone="cyan"
                    onClick={() => setF('with_nurse', 'N')}
                  />
                  <ToneChip
                    label="ไปด้วย"
                    selected={draft.with_nurse === 'Y'}
                    tone="emerald"
                    onClick={() => setF('with_nurse', 'Y')}
                  />
                </div>
              </div>
              <div className="flex flex-col gap-1.5">
                <FormLabel>รถพยาบาล</FormLabel>
                <div className="flex gap-2">
                  <ToneChip
                    label="ไม่มี"
                    selected={draft.with_ambulance === 'N'}
                    tone="cyan"
                    onClick={() => setF('with_ambulance', 'N')}
                  />
                  <ToneChip
                    label="มี"
                    selected={draft.with_ambulance === 'Y'}
                    tone="emerald"
                    onClick={() => setF('with_ambulance', 'Y')}
                  />
                </div>
              </div>
            </div>
            <div className="flex flex-col gap-1 sm:max-w-md">
              <FormLabel>ทะเบียนรถ (car_registration_no)</FormLabel>
              <input
                type="text"
                value={draft.car_registration_no}
                onChange={(e) => setF('car_registration_no', e.target.value)}
                aria-label="car_registration_no"
                placeholder="กข 1234 สุรินทร์"
                className={inputCls}
              />
            </div>
          </div>
        </section>

        {/* Action bar */}
        <div className="flex items-center justify-end gap-2 border-t border-slate-200 pt-3">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="rounded-md border border-slate-300 bg-white px-4 py-2 text-[13px] font-semibold text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-40"
          >
            ยกเลิก
          </button>
          <button
            type="button"
            onClick={save}
            disabled={saving || !config || !userInfo}
            className="rounded-md border-2 border-amber-700 bg-amber-700 px-5 py-2 text-[14px] font-bold text-white transition-colors hover:bg-amber-800 disabled:opacity-40"
          >
            {saving
              ? 'กำลังบันทึก…'
              : draft.referout_id !== undefined
                ? 'บันทึกการแก้ไข'
                : 'บันทึกข้อมูลส่งต่อ'}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
