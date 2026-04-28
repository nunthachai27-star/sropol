// VitalSignEntryDialog — modal port of HOSxPIPDPatientAdmitNurseNoteEntryForm.
// Batch 2.1 (this pass): switches the backend from ipt_pregnancy_vital_sign to
// ipd_nurse_note and lands the header + core vitals + biometric +
// physical-exam + obstetric + note sections. Batches 2.2 and 2.3 add extended
// vitals / scores / fluid I/O / stool-urine / text blocks on top of this
// same shell.
'use client';

import { useMemo, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { NurseNoteRow } from '@/types/maternity-ward';
import { cn } from '@/lib/utils';

type Mode = 'add' | 'edit';

export interface VitalSignEntryDialogProps {
  open: boolean;
  mode: Mode;
  initialRow: NurseNoteRow | null;
  saving: boolean;
  onSave: (payload: Partial<NurseNoteRow>) => void;
  onDelete: (id: number) => void;
  onCancel: () => void;
}

// Full nurse-note field catalog covering Batches 2.1 → 2.3.
type AnyField =
  | 'note_date' | 'note_time'
  // Core + extended vitals
  | 'temperature'
  | 'pulse' | 'heart_rate'
  | 'bp_systolic' | 'bp_diastolic'
  | 'ibps' | 'ibpd' | 'imap'
  | 'respiratory_rate'
  | 'spo2_ra' | 'spo2_o2' | 'etco2'
  | 'cvp' | 'icp' | 'pvc'
  | 'pain_score' | 'sedation_score' | 'news2_score' | 'sos_score'
  | 'has_hypercapnic_rf' | 'has_oxygen_ventilator'
  // Biometric
  | 'weight' | 'height' | 'bmi' | 'bsa' | 'waist' | 'weight_loss'
  // Physical exam
  | 'lung_text' | 'heart_text'
  | 'abdomen_text' | 'fetal_heart_text'
  // Obstetric
  | 'cervical_open_size' | 'eff' | 'station'
  // Fluid intake
  | 'fluid_intake_oral' | 'fluid_intake_parenteral'
  | 'fluid_intake_1' | 'fluid_intake_1_int'
  | 'fluid_intake_2' | 'fluid_intake_2_int'
  | 'fluid_intake_3' | 'fluid_intake_3_int'
  | 'fluid_intake_4' | 'fluid_intake_4_int'
  | 'fluid_intake_medication1' | 'fluid_intake_medication1_int'
  | 'fluid_intake_medication2' | 'fluid_intake_medication2_int'
  | 'fluid_intake_medication3' | 'fluid_intake_medication3_int'
  // Fluid output
  | 'fluid_output_urine' | 'fluid_output_emesis'
  | 'fluid_output_drainage' | 'fluid_output_drainage_2'
  | 'fluid_output_drainage_3' | 'fluid_output_drainage_4'
  | 'fluid_output_aspiration' | 'fluid_blood_loss'
  // Stool / urine
  | 'urine_qty' | 'urine_qty_unit'
  | 'stools_qty' | 'stools_qty_unit'
  // Text blocks
  | 'ipd_nurse_note_diet_text' | 'medication_text' | 'bottom_note_text'
  | 'note';

type DraftState = Record<AnyField, string>;

const STATION_OPTIONS = ['', '5/5', '4/5', '3/5', '2/5', '1/5', '0/5'];
const YN_OPTIONS = ['', 'Y', 'N'];
const URINE_UNIT_OPTIONS = ['', 'ml', 'cc', 'ครั้ง'];
const STOOL_UNIT_OPTIONS = ['', 'ครั้ง', 'g'];

function blankDraft(): DraftState {
  return {
    note_date: '', note_time: '',
    temperature: '',
    pulse: '', heart_rate: '',
    bp_systolic: '', bp_diastolic: '',
    ibps: '', ibpd: '', imap: '',
    respiratory_rate: '',
    spo2_ra: '', spo2_o2: '', etco2: '',
    cvp: '', icp: '', pvc: '',
    pain_score: '', sedation_score: '', news2_score: '', sos_score: '',
    has_hypercapnic_rf: '', has_oxygen_ventilator: '',
    weight: '', height: '', bmi: '', bsa: '', waist: '', weight_loss: '',
    lung_text: '', heart_text: '',
    abdomen_text: '', fetal_heart_text: '',
    cervical_open_size: '', eff: '', station: '',
    fluid_intake_oral: '', fluid_intake_parenteral: '',
    fluid_intake_1: '', fluid_intake_1_int: '',
    fluid_intake_2: '', fluid_intake_2_int: '',
    fluid_intake_3: '', fluid_intake_3_int: '',
    fluid_intake_4: '', fluid_intake_4_int: '',
    fluid_intake_medication1: '', fluid_intake_medication1_int: '',
    fluid_intake_medication2: '', fluid_intake_medication2_int: '',
    fluid_intake_medication3: '', fluid_intake_medication3_int: '',
    fluid_output_urine: '', fluid_output_emesis: '',
    fluid_output_drainage: '', fluid_output_drainage_2: '',
    fluid_output_drainage_3: '', fluid_output_drainage_4: '',
    fluid_output_aspiration: '', fluid_blood_loss: '',
    urine_qty: '', urine_qty_unit: '',
    stools_qty: '', stools_qty_unit: '',
    ipd_nurse_note_diet_text: '', medication_text: '', bottom_note_text: '',
    note: '',
  };
}

function todayLocal(): { date: string; time: string } {
  const d = new Date();
  const p = (n: number) => n.toString().padStart(2, '0');
  return {
    date: `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`,
    time: `${p(d.getHours())}:${p(d.getMinutes())}`,
  };
}

function asStr(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : '';
  return String(v);
}

function rowToDraft(row: NurseNoteRow | null): DraftState {
  const d = blankDraft();
  if (!row) {
    const now = todayLocal();
    d.note_date = now.date;
    d.note_time = now.time;
    return d;
  }
  // Generic copy — iterate the draft keys and pull from the row when present.
  for (const k of Object.keys(d) as AnyField[]) {
    const v = (row as Record<string, unknown>)[k];
    if (v === null || v === undefined) continue;
    if (k === 'note_time' && typeof v === 'string') {
      d[k] = v.slice(0, 5);
    } else {
      d[k] = asStr(v);
    }
  }
  if (!d.note_date) d.note_date = asStr(row.note_date);
  return d;
}

function toIntOrNull(v: string): number | null {
  if (v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}
function toFloatOrNull(v: string): number | null {
  if (v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function toStrOrNull(v: string): string | null {
  return v === '' ? null : v;
}

// Per-field coercion map — determines how each draft string becomes its
// payload value. Defaults to text when not listed (e.g. *_text, *_qty_unit).
const FLOAT_FIELDS: AnyField[] = [
  'temperature', 'weight', 'height', 'bmi', 'bsa', 'waist', 'weight_loss',
  'cervical_open_size', 'eff',
  'imap', 'cvp',
  // Fluid counts can be decimal (e.g. intake oral 250.5 ml).
  'fluid_intake_oral', 'fluid_intake_parenteral',
  'fluid_intake_1_int', 'fluid_intake_2_int',
  'fluid_intake_3_int', 'fluid_intake_4_int',
  'fluid_intake_medication1_int', 'fluid_intake_medication2_int',
  'fluid_intake_medication3_int',
  'fluid_output_urine', 'fluid_output_emesis',
  'fluid_output_drainage', 'fluid_output_drainage_2',
  'fluid_output_drainage_3', 'fluid_output_drainage_4',
  'fluid_output_aspiration', 'fluid_blood_loss',
  'urine_qty', 'stools_qty',
];
const INT_FIELDS: AnyField[] = [
  'pulse', 'heart_rate', 'bp_systolic', 'bp_diastolic',
  'ibps', 'ibpd',
  'respiratory_rate',
  'spo2_ra', 'spo2_o2', 'etco2',
  'icp', 'pvc',
  'pain_score', 'sedation_score', 'news2_score', 'sos_score',
];

function buildPayload(draft: DraftState): Partial<NurseNoteRow> {
  const payload: Record<string, unknown> = {};
  for (const k of Object.keys(draft) as AnyField[]) {
    const v = draft[k];
    if (k === 'note_date') {
      payload.note_date = toStrOrNull(v);
    } else if (k === 'note_time') {
      payload.note_time = v ? `${v}:00` : null;
    } else if (FLOAT_FIELDS.includes(k)) {
      payload[k] = toFloatOrNull(v);
    } else if (INT_FIELDS.includes(k)) {
      payload[k] = toIntOrNull(v);
    } else {
      payload[k] = toStrOrNull(v);
    }
  }
  return payload as Partial<NurseNoteRow>;
}

// Abnormal-range rules mirror HOSxPIPDPulseTempChart's clinical thresholds.
function abnormal(draft: DraftState): Partial<Record<AnyField, boolean>> {
  const temp = toFloatOrNull(draft.temperature);
  const pulse = toIntOrNull(draft.pulse);
  const bps = toIntOrNull(draft.bp_systolic);
  const bpd = toIntOrNull(draft.bp_diastolic);
  const rr = toIntOrNull(draft.respiratory_rate);
  const spo2ra = toIntOrNull(draft.spo2_ra);
  return {
    temperature: temp !== null && temp >= 38,
    pulse: pulse !== null && pulse > 0 && (pulse < 60 || pulse > 100),
    bp_systolic: bps !== null && bps >= 140,
    bp_diastolic: bpd !== null && bpd >= 90,
    respiratory_rate: rr !== null && rr > 0 && (rr < 12 || rr > 24),
    spo2_ra: spo2ra !== null && spo2ra > 0 && spo2ra < 95,
  };
}

// At least one clinical field must be set — note_date + note_time alone
// doesn't count. Everything else on the form counts.
function hasClinicalValue(p: Partial<NurseNoteRow>): boolean {
  const ignore = new Set<keyof NurseNoteRow>(['note_date', 'note_time']);
  return Object.entries(p).some(([k, v]) => {
    if (ignore.has(k as keyof NurseNoteRow)) return false;
    return v !== undefined && v !== null && v !== '';
  });
}

// ─── UI primitives ─────────────────────────────────────────────────────────

interface SectionShellProps {
  title: string;
  cols?: string;
  /** Quick-pick chip row rendered between the heading and the fields. */
  chips?: React.ReactNode;
  children: React.ReactNode;
}

function Section({
  title,
  cols = 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-4',
  chips,
  children,
}: SectionShellProps) {
  return (
    <section className="rounded-md border border-slate-200 bg-white">
      <h4 className="border-b border-slate-100 bg-slate-50/60 px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-slate-600">
        {title}
      </h4>
      {chips && <div className="px-3 pt-2">{chips}</div>}
      <div className={cn('grid gap-x-3 gap-y-2 p-3', cols)}>{children}</div>
    </section>
  );
}

// Native <details>-based collapsible. Children stay in DOM when collapsed so
// getByLabelText still finds every input — important because the test suite
// asserts every nurse-note column is queryable from the dialog.
function CollapsibleSection({
  title,
  cols = 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-4',
  defaultOpen = false,
  badge,
  chips,
  children,
}: SectionShellProps & { defaultOpen?: boolean; badge?: string }) {
  return (
    <details
      open={defaultOpen}
      className="group rounded-md border border-slate-200 bg-white"
    >
      <summary className="flex cursor-pointer list-none items-center justify-between border-b border-slate-100 bg-slate-50/60 px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-slate-600 hover:bg-slate-100/60">
        <span className="flex items-center gap-2">
          <span aria-hidden className="inline-block transition-transform group-open:rotate-90">
            ▸
          </span>
          {title}
          {badge && (
            <span className="text-[10px] font-normal normal-case tracking-normal text-slate-400">
              · {badge}
            </span>
          )}
        </span>
        <span className="text-[10px] font-normal text-slate-400 group-open:hidden">
          คลิกเพื่อขยาย
        </span>
      </summary>
      {chips && <div className="px-3 pt-2">{chips}</div>}
      <div className={cn('grid gap-x-3 gap-y-2 p-3', cols)}>{children}</div>
    </details>
  );
}

function ChipRow({
  options,
  selected,
  onPick,
  ariaLabel,
}: {
  options: ReadonlyArray<{ value: string; label: string }>;
  selected: string;
  onPick: (v: string) => void;
  ariaLabel?: string;
}) {
  return (
    <div className="flex flex-wrap gap-1" role="group" aria-label={ariaLabel}>
      {options.map((o) => {
        const isSelected = selected === o.value;
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => onPick(o.value)}
            className={cn(
              'rounded-md border px-2 py-0.5 text-[11px] font-medium transition-colors tabular-nums',
              isSelected
                ? 'border-emerald-500 bg-emerald-50 text-emerald-700'
                : 'border-slate-200 bg-white text-slate-600 hover:border-emerald-400 hover:bg-emerald-50/40',
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

const PAIN_CHIPS = [
  { value: '0', label: '0' },
  { value: '2', label: '2' },
  { value: '4', label: '4' },
  { value: '6', label: '6' },
  { value: '8', label: '8' },
  { value: '10', label: '10' },
];
const TEMP_CHIPS = [
  { value: '36.5', label: '36.5' },
  { value: '37.0', label: '37.0' },
  { value: '37.5', label: '37.5' },
  { value: '38.0', label: '38.0' },
  { value: '38.5', label: '38.5' },
];

interface FieldProps {
  name: AnyField;
  label: string;
  hint?: string;
  value: string;
  onChange: (v: string) => void;
  type?: 'int' | 'float' | 'text' | 'textarea' | 'date' | 'time';
  options?: readonly string[];
  colSpan?: 'full';
  abnormal?: boolean;
}

function Field({
  name, label, hint, value, onChange, type = 'int', options, colSpan, abnormal,
}: FieldProps) {
  const inputId = `nn-${name}`;
  const baseCls =
    'h-9 w-full rounded-md border bg-white px-2.5 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-1';
  const normalCls = 'border-slate-300 focus:border-emerald-500 focus:ring-emerald-500';
  const abnormalCls =
    'border-rose-400 bg-rose-50/40 font-semibold text-rose-700 focus:border-rose-500 focus:ring-rose-500';
  const inputCls = cn(baseCls, abnormal ? abnormalCls : normalCls);
  return (
    <div className={cn('flex flex-col gap-0.5', colSpan === 'full' && 'col-span-full')}>
      <label
        htmlFor={inputId}
        className="flex items-baseline gap-1.5 text-xs font-medium text-slate-700"
      >
        <span className="truncate">{label}</span>
        {hint && <span className="text-[11px] font-normal text-slate-400">{hint}</span>}
        {abnormal && (
          <span
            data-testid={`abnormal-${name}`}
            className="ml-auto rounded-sm bg-rose-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-rose-700"
            title="ผิดปกติ — แจ้งแพทย์"
          >
            ผิดปกติ
          </span>
        )}
      </label>
      {options ? (
        <select
          id={inputId}
          aria-label={name}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={inputCls}
        >
          {options.map((opt) => (
            <option key={opt} value={opt}>
              {opt === '' ? '—' : opt}
            </option>
          ))}
        </select>
      ) : type === 'textarea' ? (
        <textarea
          id={inputId}
          aria-label={name}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          rows={2}
          className={cn(inputCls, 'h-auto py-1 leading-snug')}
        />
      ) : type === 'date' ? (
        <input
          id={inputId}
          aria-label={name}
          type="date"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={inputCls}
        />
      ) : type === 'time' ? (
        <input
          id={inputId}
          aria-label={name}
          type="time"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={inputCls}
        />
      ) : (
        <input
          id={inputId}
          aria-label={name}
          type="text"
          inputMode={type === 'text' ? 'text' : type === 'float' ? 'decimal' : 'numeric'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={inputCls}
        />
      )}
    </div>
  );
}

// ─── Main ──────────────────────────────────────────────────────────────────

export function VitalSignEntryDialog({
  open,
  mode,
  initialRow,
  saving,
  onSave,
  onDelete,
  onCancel,
}: VitalSignEntryDialogProps) {
  const [draft, setDraft] = useState<DraftState>(() => rowToDraft(initialRow));
  const [error, setError] = useState<string | null>(null);
  const abn = useMemo(() => abnormal(draft), [draft]);

  function set(field: AnyField, value: string) {
    setDraft((d) => ({ ...d, [field]: value }));
    if (error) setError(null);
  }

  function handleSave() {
    const payload = buildPayload(draft);
    if (!hasClinicalValue(payload)) {
      setError('กรุณากรอกข้อมูลอย่างน้อย 1 ฟิลด์ทางคลินิก');
      return;
    }
    if (mode === 'edit' && initialRow?.nurse_note_id) {
      (payload as Partial<NurseNoteRow>).nurse_note_id =
        initialRow.nurse_note_id;
    }
    onSave(payload);
  }

  function handleDelete() {
    if (mode !== 'edit' || !initialRow?.nurse_note_id) return;
    if (!window.confirm('ยืนยันการลบรายการนี้หรือไม่?')) return;
    onDelete(initialRow.nurse_note_id);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onCancel();
      }}
    >
      <DialogContent
        className="sm:max-w-5xl max-h-[92vh] overflow-y-auto gap-2 p-3"
        showCloseButton={false}
      >
        <DialogHeader>
          <DialogTitle className="text-base">
            {mode === 'add' ? 'เพิ่มบันทึกสัญญาณชีพ' : 'แก้ไขบันทึกสัญญาณชีพ'}
          </DialogTitle>
        </DialogHeader>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleSave();
          }}
          className="flex flex-col gap-2"
        >
          {/* ── Tier 1: always-visible essentials.
                Date/time → core vitals → free-text note. These three sections
                cover ~95% of every-shift entry. */}

          <Section title="วันที่และเวลา" cols="grid-cols-2 sm:grid-cols-4">
            <Field name="note_date" label="วันที่" type="date" value={draft.note_date} onChange={(v) => set('note_date', v)} />
            <Field name="note_time" label="เวลา" type="time" value={draft.note_time} onChange={(v) => set('note_time', v)} />
          </Section>

          <Section
            title="สัญญาณชีพหลัก"
            cols="grid-cols-2 sm:grid-cols-3 lg:grid-cols-4"
            chips={
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center gap-2">
                  <span className="w-12 shrink-0 text-[10px] font-medium uppercase tracking-wider text-slate-500">Temp</span>
                  <ChipRow ariaLabel="Temperature quick picks" options={TEMP_CHIPS} selected={draft.temperature} onPick={(v) => set('temperature', v)} />
                </div>
                <div className="flex items-center gap-2">
                  <span className="w-12 shrink-0 text-[10px] font-medium uppercase tracking-wider text-slate-500">Pain</span>
                  <ChipRow ariaLabel="Pain score quick picks" options={PAIN_CHIPS} selected={draft.pain_score} onPick={(v) => set('pain_score', v)} />
                </div>
              </div>
            }
          >
            <Field name="temperature" label="Temp" hint="°C · <38" type="float" value={draft.temperature} onChange={(v) => set('temperature', v)} abnormal={abn.temperature} />
            <Field name="pulse" label="Pulse" hint="60–100" value={draft.pulse} onChange={(v) => set('pulse', v)} abnormal={abn.pulse} />
            <Field name="heart_rate" label="HR" hint="60–100" value={draft.heart_rate} onChange={(v) => set('heart_rate', v)} />
            <Field name="bp_systolic" label="BP Sys" hint="<140" value={draft.bp_systolic} onChange={(v) => set('bp_systolic', v)} abnormal={abn.bp_systolic} />
            <Field name="bp_diastolic" label="BP Dia" hint="<90" value={draft.bp_diastolic} onChange={(v) => set('bp_diastolic', v)} abnormal={abn.bp_diastolic} />
            <Field name="respiratory_rate" label="RR" hint="12–24" value={draft.respiratory_rate} onChange={(v) => set('respiratory_rate', v)} abnormal={abn.respiratory_rate} />
            <Field name="spo2_ra" label="SpO₂ (RA)" hint="%" value={draft.spo2_ra} onChange={(v) => set('spo2_ra', v)} abnormal={abn.spo2_ra} />
            <Field name="spo2_o2" label="SpO₂ (on O₂)" hint="%" value={draft.spo2_o2} onChange={(v) => set('spo2_o2', v)} />
            <Field name="pain_score" label="Pain" hint="0–10" value={draft.pain_score} onChange={(v) => set('pain_score', v)} />
          </Section>

          {/* ── Tier 2: contextual sections — auto-open when the row being
                edited has data; default-collapsed when adding a fresh entry
                so the dialog isn't a wall of empty inputs. */}

          <CollapsibleSection
            title="ร่างกาย"
            cols="grid-cols-2 sm:grid-cols-3 lg:grid-cols-6"
            defaultOpen={
              !!draft.weight || !!draft.weight_loss || !!draft.height ||
              !!draft.bmi || !!draft.bsa || !!draft.waist
            }
            badge="แรกรับ / สัปดาห์ละครั้ง"
          >
            <Field name="weight" label="น้ำหนัก" hint="kg" type="float" value={draft.weight} onChange={(v) => set('weight', v)} />
            <Field name="weight_loss" label="น้ำหนักลด" hint="kg" type="float" value={draft.weight_loss} onChange={(v) => set('weight_loss', v)} />
            <Field name="height" label="ส่วนสูง" hint="cm" type="float" value={draft.height} onChange={(v) => set('height', v)} />
            <Field name="bmi" label="BMI" type="float" value={draft.bmi} onChange={(v) => set('bmi', v)} />
            <Field name="bsa" label="BSA" hint="m²" type="float" value={draft.bsa} onChange={(v) => set('bsa', v)} />
            <Field name="waist" label="รอบเอว" hint="cm" type="float" value={draft.waist} onChange={(v) => set('waist', v)} />
          </CollapsibleSection>

          <CollapsibleSection
            title="การตรวจร่างกาย"
            cols="grid-cols-1 sm:grid-cols-2"
            defaultOpen={
              !!draft.lung_text || !!draft.heart_text ||
              !!draft.abdomen_text || !!draft.fetal_heart_text
            }
            badge="ตามรอบประเมิน"
          >
            <Field name="lung_text" label="Lung" type="text" value={draft.lung_text} onChange={(v) => set('lung_text', v)} />
            <Field name="heart_text" label="Heart" type="text" value={draft.heart_text} onChange={(v) => set('heart_text', v)} />
            <Field name="abdomen_text" label="Abdomen" type="text" value={draft.abdomen_text} onChange={(v) => set('abdomen_text', v)} />
            <Field name="fetal_heart_text" label="Fetal heart sound" type="text" value={draft.fetal_heart_text} onChange={(v) => set('fetal_heart_text', v)} />
          </CollapsibleSection>

          <CollapsibleSection
            title="PV"
            cols="grid-cols-2 sm:grid-cols-3"
            defaultOpen={!!draft.cervical_open_size || !!draft.eff || !!draft.station}
            badge="ผู้ป่วยอยู่ในระยะคลอด"
          >
            <Field name="cervical_open_size" label="ปากมดลูก" hint="ซม · 0–10" type="float" value={draft.cervical_open_size} onChange={(v) => set('cervical_open_size', v)} />
            <Field name="eff" label="Eff" hint="%" type="float" value={draft.eff} onChange={(v) => set('eff', v)} />
            <Field name="station" label="Station" value={draft.station} options={STATION_OPTIONS} onChange={(v) => set('station', v)} />
          </CollapsibleSection>

          {/* ── Tier 3: specialty / ICU sections. Default-collapsed; opened
                only when their data is present (typically post-op or HCU
                patients). Kept in DOM for getByLabelText accessibility. */}

          <CollapsibleSection
            title="IBP · CVP · ICP"
            cols="grid-cols-2 sm:grid-cols-3 lg:grid-cols-6"
            defaultOpen={
              !!draft.ibps || !!draft.ibpd || !!draft.imap ||
              !!draft.cvp || !!draft.icp || !!draft.pvc
            }
            badge="ICU / post-op"
          >
            <Field name="ibps" label="IBP Sys" value={draft.ibps} onChange={(v) => set('ibps', v)} />
            <Field name="ibpd" label="IBP Dia" value={draft.ibpd} onChange={(v) => set('ibpd', v)} />
            <Field name="imap" label="IMAP" type="float" value={draft.imap} onChange={(v) => set('imap', v)} />
            <Field name="cvp" label="CVP" type="float" value={draft.cvp} onChange={(v) => set('cvp', v)} />
            <Field name="icp" label="ICP" value={draft.icp} onChange={(v) => set('icp', v)} />
            <Field name="pvc" label="PVC" value={draft.pvc} onChange={(v) => set('pvc', v)} />
          </CollapsibleSection>

          <CollapsibleSection
            title="EtCO₂ · Scores · ออกซิเจน"
            cols="grid-cols-2 sm:grid-cols-3 lg:grid-cols-6"
            defaultOpen={
              !!draft.etco2 || !!draft.sedation_score || !!draft.news2_score ||
              !!draft.sos_score || !!draft.has_hypercapnic_rf || !!draft.has_oxygen_ventilator
            }
            badge="ผู้ป่วยใส่เครื่อง / Early Warning"
          >
            <Field name="etco2" label="EtCO₂" value={draft.etco2} onChange={(v) => set('etco2', v)} />
            <Field name="sedation_score" label="Sedation" value={draft.sedation_score} onChange={(v) => set('sedation_score', v)} />
            <Field name="news2_score" label="NEWS2" value={draft.news2_score} onChange={(v) => set('news2_score', v)} />
            <Field name="sos_score" label="SOS" value={draft.sos_score} onChange={(v) => set('sos_score', v)} />
            <Field name="has_hypercapnic_rf" label="Hypercapnic RF" value={draft.has_hypercapnic_rf} options={YN_OPTIONS} onChange={(v) => set('has_hypercapnic_rf', v)} />
            <Field name="has_oxygen_ventilator" label="O₂/Vent" value={draft.has_oxygen_ventilator} options={YN_OPTIONS} onChange={(v) => set('has_oxygen_ventilator', v)} />
          </CollapsibleSection>

          <CollapsibleSection
            title="น้ำเข้า"
            cols="grid-cols-2 sm:grid-cols-4"
            defaultOpen={
              !!draft.fluid_intake_oral || !!draft.fluid_intake_parenteral ||
              !!draft.fluid_intake_1 || !!draft.fluid_intake_1_int ||
              !!draft.fluid_intake_2 || !!draft.fluid_intake_2_int ||
              !!draft.fluid_intake_3 || !!draft.fluid_intake_3_int ||
              !!draft.fluid_intake_4 || !!draft.fluid_intake_4_int
            }
            badge="I/O charting"
          >
            <Field name="fluid_intake_oral" label="Oral" hint="ml" type="float" value={draft.fluid_intake_oral} onChange={(v) => set('fluid_intake_oral', v)} />
            <Field name="fluid_intake_parenteral" label="Parenteral" hint="ml" type="float" value={draft.fluid_intake_parenteral} onChange={(v) => set('fluid_intake_parenteral', v)} />
            <Field name="fluid_intake_1" label="Fluid 1" type="text" value={draft.fluid_intake_1} onChange={(v) => set('fluid_intake_1', v)} />
            <Field name="fluid_intake_1_int" label="Qty 1" hint="ml" type="float" value={draft.fluid_intake_1_int} onChange={(v) => set('fluid_intake_1_int', v)} />
            <Field name="fluid_intake_2" label="Fluid 2" type="text" value={draft.fluid_intake_2} onChange={(v) => set('fluid_intake_2', v)} />
            <Field name="fluid_intake_2_int" label="Qty 2" hint="ml" type="float" value={draft.fluid_intake_2_int} onChange={(v) => set('fluid_intake_2_int', v)} />
            <Field name="fluid_intake_3" label="Fluid 3" type="text" value={draft.fluid_intake_3} onChange={(v) => set('fluid_intake_3', v)} />
            <Field name="fluid_intake_3_int" label="Qty 3" hint="ml" type="float" value={draft.fluid_intake_3_int} onChange={(v) => set('fluid_intake_3_int', v)} />
            <Field name="fluid_intake_4" label="Fluid 4" type="text" value={draft.fluid_intake_4} onChange={(v) => set('fluid_intake_4', v)} />
            <Field name="fluid_intake_4_int" label="Qty 4" hint="ml" type="float" value={draft.fluid_intake_4_int} onChange={(v) => set('fluid_intake_4_int', v)} />
          </CollapsibleSection>

          <CollapsibleSection
            title="ยา/ยาน้ำ"
            cols="grid-cols-2 sm:grid-cols-4"
            defaultOpen={
              !!draft.fluid_intake_medication1 || !!draft.fluid_intake_medication1_int ||
              !!draft.fluid_intake_medication2 || !!draft.fluid_intake_medication2_int ||
              !!draft.fluid_intake_medication3 || !!draft.fluid_intake_medication3_int
            }
          >
            <Field name="fluid_intake_medication1" label="Medication 1" type="text" value={draft.fluid_intake_medication1} onChange={(v) => set('fluid_intake_medication1', v)} />
            <Field name="fluid_intake_medication1_int" label="Qty 1" hint="ml" type="float" value={draft.fluid_intake_medication1_int} onChange={(v) => set('fluid_intake_medication1_int', v)} />
            <Field name="fluid_intake_medication2" label="Medication 2" type="text" value={draft.fluid_intake_medication2} onChange={(v) => set('fluid_intake_medication2', v)} />
            <Field name="fluid_intake_medication2_int" label="Qty 2" hint="ml" type="float" value={draft.fluid_intake_medication2_int} onChange={(v) => set('fluid_intake_medication2_int', v)} />
            <Field name="fluid_intake_medication3" label="Medication 3" type="text" value={draft.fluid_intake_medication3} onChange={(v) => set('fluid_intake_medication3', v)} />
            <Field name="fluid_intake_medication3_int" label="Qty 3" hint="ml" type="float" value={draft.fluid_intake_medication3_int} onChange={(v) => set('fluid_intake_medication3_int', v)} />
          </CollapsibleSection>

          <CollapsibleSection
            title="น้ำออก"
            cols="grid-cols-2 sm:grid-cols-4"
            defaultOpen={
              !!draft.fluid_output_urine || !!draft.fluid_output_emesis ||
              !!draft.fluid_output_drainage || !!draft.fluid_output_drainage_2 ||
              !!draft.fluid_output_drainage_3 || !!draft.fluid_output_drainage_4 ||
              !!draft.fluid_output_aspiration || !!draft.fluid_blood_loss
            }
            badge="I/O charting"
          >
            <Field name="fluid_output_urine" label="Urine" hint="ml" type="float" value={draft.fluid_output_urine} onChange={(v) => set('fluid_output_urine', v)} />
            <Field name="fluid_output_emesis" label="Emesis" hint="ml" type="float" value={draft.fluid_output_emesis} onChange={(v) => set('fluid_output_emesis', v)} />
            <Field name="fluid_output_drainage" label="Drainage 1" hint="ml" type="float" value={draft.fluid_output_drainage} onChange={(v) => set('fluid_output_drainage', v)} />
            <Field name="fluid_output_drainage_2" label="Drainage 2" hint="ml" type="float" value={draft.fluid_output_drainage_2} onChange={(v) => set('fluid_output_drainage_2', v)} />
            <Field name="fluid_output_drainage_3" label="Drainage 3" hint="ml" type="float" value={draft.fluid_output_drainage_3} onChange={(v) => set('fluid_output_drainage_3', v)} />
            <Field name="fluid_output_drainage_4" label="Drainage 4" hint="ml" type="float" value={draft.fluid_output_drainage_4} onChange={(v) => set('fluid_output_drainage_4', v)} />
            <Field name="fluid_output_aspiration" label="Aspiration" hint="ml" type="float" value={draft.fluid_output_aspiration} onChange={(v) => set('fluid_output_aspiration', v)} />
            <Field name="fluid_blood_loss" label="Blood loss" hint="ml" type="float" value={draft.fluid_blood_loss} onChange={(v) => set('fluid_blood_loss', v)} />
          </CollapsibleSection>

          <CollapsibleSection
            title="อุจจาระ · ปัสสาวะ"
            cols="grid-cols-2 sm:grid-cols-4"
            defaultOpen={
              !!draft.urine_qty || !!draft.urine_qty_unit ||
              !!draft.stools_qty || !!draft.stools_qty_unit
            }
          >
            <Field name="urine_qty" label="Urine" type="float" value={draft.urine_qty} onChange={(v) => set('urine_qty', v)} />
            <Field name="urine_qty_unit" label="Urine unit" value={draft.urine_qty_unit} options={URINE_UNIT_OPTIONS} onChange={(v) => set('urine_qty_unit', v)} />
            <Field name="stools_qty" label="Stools" type="float" value={draft.stools_qty} onChange={(v) => set('stools_qty', v)} />
            <Field name="stools_qty_unit" label="Stools unit" value={draft.stools_qty_unit} options={STOOL_UNIT_OPTIONS} onChange={(v) => set('stools_qty_unit', v)} />
          </CollapsibleSection>

          <CollapsibleSection
            title="อาหารและยา"
            cols="grid-cols-1 sm:grid-cols-2"
            defaultOpen={!!draft.ipd_nurse_note_diet_text || !!draft.medication_text}
          >
            <Field name="ipd_nurse_note_diet_text" label="Diet" type="text" value={draft.ipd_nurse_note_diet_text} onChange={(v) => set('ipd_nurse_note_diet_text', v)} />
            <Field name="medication_text" label="Medication" type="text" value={draft.medication_text} onChange={(v) => set('medication_text', v)} />
          </CollapsibleSection>

          {/* บันทึกเพิ่มเติม stays always-visible — note + bottom_note are
              the highest-traffic free-text fields and need no friction. */}
          <Section title="บันทึกเพิ่มเติม" cols="grid-cols-1">
            <Field name="note" label="Note" type="textarea" value={draft.note} onChange={(v) => set('note', v)} colSpan="full" />
            <Field name="bottom_note_text" label="Bottom note" type="textarea" value={draft.bottom_note_text} onChange={(v) => set('bottom_note_text', v)} colSpan="full" />
          </Section>

          {error && (
            <div
              role="alert"
              className="rounded-md border border-rose-200 bg-rose-50 px-3 py-1.5 text-xs text-rose-700"
            >
              {error}
            </div>
          )}

          <div className="sticky bottom-0 -mx-3 -mb-3 flex flex-wrap items-center gap-2 border-t border-slate-200 bg-white/95 px-3 py-2.5 backdrop-blur">
            {mode === 'edit' && (
              <button
                type="button"
                onClick={handleDelete}
                disabled={saving}
                className="rounded-md border border-rose-300 bg-white px-3 py-1.5 text-sm font-medium text-rose-700 hover:bg-rose-50 disabled:opacity-50"
              >
                ลบ
              </button>
            )}
            <div className="ml-auto flex gap-2">
              <button
                type="button"
                onClick={onCancel}
                disabled={saving}
                className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                ยกเลิก
              </button>
              <button
                type="submit"
                disabled={saving}
                className="rounded-md bg-emerald-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
              >
                {saving ? 'กำลังบันทึก…' : 'บันทึก'}
              </button>
            </div>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
