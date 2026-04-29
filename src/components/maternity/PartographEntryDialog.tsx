// PartographEntryDialog — modal port of HOSxPIPDLabourPartographEntryFormUnit.
// Batch 1 (done): 7 Thai sections covering all 21 editable columns + Save /
// Cancel / Delete / Copy-Prev.
// Batch 2 (this pass): abnormal-range highlighting, live status panel, auto
// hour_no, BeforePost validation, soft confirmations. Mirrors the semantics of
// ApplyAbnormalStyles + UpdateStatusPanel + ComputeHourNo +
// PartographCDSBeforePost + DoSoftConfirmations from the Delphi unit.
'use client';

import { useMemo, useRef, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { PartographRow } from '@/types/maternity-ward';
import { cn, formatRelativeTime } from '@/lib/utils';
import { ChipRow, type ChipTone } from './shared/DraggableChips';

type Mode = 'add' | 'edit';

export interface PartographEntryDialogProps {
  open: boolean;
  mode: Mode;
  /** The row being edited, or null when adding. */
  initialRow: PartographRow | null;
  /** All observations for this AN (used for prev-row / hour_no / soft-confirm). */
  observations: PartographRow[];
  saving: boolean;
  onSave: (payload: Partial<PartographRow>) => void;
  onDelete: (id: number) => void;
  onCancel: () => void;
}

// Editable column catalogue, mirrored from the Delphi DBEdit bindings.
type AnyEditableField =
  | 'observe_datetime'
  | 'hour_no'
  | 'fetal_heart_rate'
  | 'cervical_dilation_cm'
  | 'contraction_per_10min'
  | 'contraction_duration_sec'
  | 'oxytocin_uml'
  | 'oxytocin_drops_min'
  | 'pulse'
  | 'bp_systolic'
  | 'bp_diastolic'
  | 'temperature'
  | 'urine_volume_ml'
  | 'drugs_iv_fluids'
  | 'note'
  | 'amniotic_fluid'
  | 'moulding'
  | 'descent_of_head'
  | 'contraction_strength'
  | 'urine_protein'
  | 'urine_acetone'
  | 'urine_glucose';

// Options preserved from the Delphi cxDBComboBox Properties.Items; keeps the
// port self-contained instead of pulling the `labour_amniotic_type` etc
// lookup tables over BMS for now. Future: wire via getBmsLookup.
const AMNIOTIC_OPTIONS = ['', 'Clear', 'Meconium (light)', 'Meconium (thick)', 'Blood', 'Absent'];
const MOULDING_OPTIONS = ['', '0', '+', '++', '+++'];
const DESCENT_OPTIONS = ['', '5/5', '4/5', '3/5', '2/5', '1/5', '0/5'];
const CONTRACTION_STRENGTH_OPTIONS = ['', 'Mild', 'Moderate', 'Strong'];
const URINE_DIPSTICK_OPTIONS = ['', 'negative', 'trace', '1+', '2+', '3+', '4+'];

type DraftState = Record<AnyEditableField, string> & {
  // Tracks whether the user has manually touched hour_no; when false, we keep
  // auto-deriving it from observe_datetime (matches the Delphi hint behavior).
  _hourNoTouched: boolean;
};

function blankDraft(): DraftState {
  return {
    observe_datetime: '',
    hour_no: '',
    fetal_heart_rate: '',
    amniotic_fluid: '',
    moulding: '',
    cervical_dilation_cm: '',
    descent_of_head: '',
    contraction_per_10min: '',
    contraction_duration_sec: '',
    contraction_strength: '',
    oxytocin_uml: '',
    oxytocin_drops_min: '',
    drugs_iv_fluids: '',
    pulse: '',
    bp_systolic: '',
    bp_diastolic: '',
    temperature: '',
    urine_volume_ml: '',
    urine_protein: '',
    urine_acetone: '',
    urine_glucose: '',
    note: '',
    _hourNoTouched: false,
  };
}

function toLocalDatetimeInput(iso: string | null | undefined): string {
  if (!iso) return '';
  // Trim seconds + timezone so `<input type="datetime-local">` accepts it.
  const m = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})/.exec(iso);
  return m ? `${m[1]}T${m[2]}` : '';
}

function nowLocalDatetime(): string {
  const d = new Date();
  const p = (n: number) => n.toString().padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

function rowToDraft(row: PartographRow | null): DraftState {
  const d = blankDraft();
  if (!row) {
    d.observe_datetime = nowLocalDatetime();
    return d;
  }
  d.observe_datetime = toLocalDatetimeInput(row.observe_datetime) || nowLocalDatetime();
  d.hour_no = row.hour_no?.toString() ?? '';
  d._hourNoTouched = row.hour_no !== null && row.hour_no !== undefined;
  d.fetal_heart_rate = row.fetal_heart_rate?.toString() ?? '';
  d.amniotic_fluid = row.amniotic_fluid ?? '';
  d.moulding = row.moulding ?? '';
  d.cervical_dilation_cm = row.cervical_dilation_cm?.toString() ?? '';
  d.descent_of_head = row.descent_of_head ?? '';
  d.contraction_per_10min = row.contraction_per_10min?.toString() ?? '';
  d.contraction_duration_sec = row.contraction_duration_sec?.toString() ?? '';
  d.contraction_strength = row.contraction_strength ?? '';
  d.oxytocin_uml = row.oxytocin_uml?.toString() ?? '';
  d.oxytocin_drops_min = row.oxytocin_drops_min?.toString() ?? '';
  d.drugs_iv_fluids = row.drugs_iv_fluids ?? '';
  d.pulse = row.pulse?.toString() ?? '';
  d.bp_systolic = row.bp_systolic?.toString() ?? '';
  d.bp_diastolic = row.bp_diastolic?.toString() ?? '';
  d.temperature = row.temperature?.toString() ?? '';
  d.urine_volume_ml = row.urine_volume_ml?.toString() ?? '';
  d.urine_protein = row.urine_protein ?? '';
  d.urine_acetone = row.urine_acetone ?? '';
  d.urine_glucose = row.urine_glucose ?? '';
  d.note = row.note ?? '';
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

function buildPayload(draft: DraftState): Partial<PartographRow> {
  return {
    // Re-serialize the local datetime back to ISO-ish so the server stays
    // timezone-agnostic (BMS stores naive datetimes).
    observe_datetime: draft.observe_datetime
      ? `${draft.observe_datetime}:00`
      : undefined,
    hour_no: toIntOrNull(draft.hour_no),
    fetal_heart_rate: toIntOrNull(draft.fetal_heart_rate),
    amniotic_fluid: toStrOrNull(draft.amniotic_fluid),
    moulding: toStrOrNull(draft.moulding),
    cervical_dilation_cm: toFloatOrNull(draft.cervical_dilation_cm),
    descent_of_head: toStrOrNull(draft.descent_of_head),
    contraction_per_10min: toIntOrNull(draft.contraction_per_10min),
    contraction_duration_sec: toIntOrNull(draft.contraction_duration_sec),
    contraction_strength: toStrOrNull(draft.contraction_strength),
    oxytocin_uml: toFloatOrNull(draft.oxytocin_uml),
    oxytocin_drops_min: toIntOrNull(draft.oxytocin_drops_min),
    drugs_iv_fluids: toStrOrNull(draft.drugs_iv_fluids),
    pulse: toIntOrNull(draft.pulse),
    bp_systolic: toIntOrNull(draft.bp_systolic),
    bp_diastolic: toIntOrNull(draft.bp_diastolic),
    temperature: toFloatOrNull(draft.temperature),
    urine_volume_ml: toIntOrNull(draft.urine_volume_ml),
    urine_protein: toStrOrNull(draft.urine_protein),
    urine_acetone: toStrOrNull(draft.urine_acetone),
    urine_glucose: toStrOrNull(draft.urine_glucose),
    note: toStrOrNull(draft.note),
  };
}

// Abnormal-range rules — identical thresholds to Delphi's MarkAbnormal calls.
// Returned as a plain record so the render path is a pure lookup.
function abnormalRanges(draft: DraftState): Partial<Record<AnyEditableField, boolean>> {
  const fhr = toIntOrNull(draft.fetal_heart_rate);
  const pulse = toIntOrNull(draft.pulse);
  const bps = toIntOrNull(draft.bp_systolic);
  const bpd = toIntOrNull(draft.bp_diastolic);
  const temp = toFloatOrNull(draft.temperature);
  return {
    fetal_heart_rate: fhr !== null && fhr > 0 && (fhr < 110 || fhr > 160),
    pulse: pulse !== null && pulse > 0 && (pulse < 60 || pulse > 100),
    bp_systolic: bps !== null && bps >= 140,
    bp_diastolic: bpd !== null && bpd >= 90,
    temperature: temp !== null && temp >= 38,
  };
}

// HasObservationValue port — at least one clinical field must be set.
function hasClinicalValue(payload: Partial<PartographRow>): boolean {
  const checked: (keyof PartographRow)[] = [
    'fetal_heart_rate',
    'amniotic_fluid',
    'moulding',
    'cervical_dilation_cm',
    'descent_of_head',
    'contraction_per_10min',
    'contraction_duration_sec',
    'contraction_strength',
    'oxytocin_uml',
    'oxytocin_drops_min',
    'drugs_iv_fluids',
    'pulse',
    'bp_systolic',
    'bp_diastolic',
    'temperature',
    'urine_volume_ml',
    'urine_protein',
    'urine_acetone',
    'urine_glucose',
  ];
  return checked.some((k) => {
    const v = payload[k];
    return v !== undefined && v !== null && v !== '';
  });
}

// BeforePost port — returns a Thai error string when the payload is
// semantically invalid, or null when it's OK to proceed.
function beforePostValidation(
  payload: Partial<PartographRow>,
  nowMs: number,
): string | null {
  if (payload.observe_datetime) {
    const obsMs = Date.parse(payload.observe_datetime);
    if (Number.isFinite(obsMs) && obsMs > nowMs) {
      return 'เวลาที่สังเกตต้องไม่อยู่ในอนาคต';
    }
  }
  const hasUml = payload.oxytocin_uml !== null && payload.oxytocin_uml !== undefined;
  const hasDrops = payload.oxytocin_drops_min !== null && payload.oxytocin_drops_min !== undefined;
  if (hasUml !== hasDrops) {
    return 'Oxytocin U/mL และ หยด/นาที ต้องกรอกทั้งคู่ หรือปล่อยว่างทั้งคู่';
  }
  const per10 = payload.contraction_per_10min;
  if (per10 !== null && per10 !== undefined && per10 > 0) {
    const dur = payload.contraction_duration_sec;
    const str = payload.contraction_strength;
    if (dur === null || dur === undefined || !str) {
      return 'เมื่อระบุการหดรัดตัวของมดลูก > 0 ต้องระบุระยะเวลาและความแรงด้วย';
    }
  }
  return null;
}

// ComputeHourNo port — derive hour_no from observe_datetime against the
// earliest OTHER observation for this AN.
function computeHourNo(
  observeDatetimeIso: string | undefined,
  observations: PartographRow[],
  excludeId: number | undefined,
): number | null {
  if (!observeDatetimeIso) return null;
  const obsMs = Date.parse(observeDatetimeIso);
  if (!Number.isFinite(obsMs)) return null;
  const others = observations.filter(
    (o) => o.ipt_labour_partograph_id !== excludeId && !!o.observe_datetime,
  );
  if (others.length === 0) return 1;
  const firstMs = Math.min(
    ...others.map((o) => Date.parse(o.observe_datetime!)).filter(Number.isFinite),
  );
  if (!Number.isFinite(firstMs)) return 1;
  if (obsMs <= firstMs) return 1;
  return Math.floor((obsMs - firstMs) / 3_600_000) + 1;
}

// DoSoftConfirmations port — returns a list of Thai confirm messages. The
// caller should window.confirm() each in turn and abort on the first "no".
function softConfirmations(
  payload: Partial<PartographRow>,
  observations: PartographRow[],
  excludeId: number | undefined,
): string[] {
  const msgs: string[] = [];
  if (!payload.observe_datetime) return msgs;
  const obsMs = Date.parse(payload.observe_datetime);
  if (!Number.isFinite(obsMs)) return msgs;
  const priors = observations
    .filter((o) => o.ipt_labour_partograph_id !== excludeId && !!o.observe_datetime)
    .map((o) => ({ ...o, _ms: Date.parse(o.observe_datetime!) }))
    .filter((o) => Number.isFinite(o._ms))
    .sort((a, b) => b._ms - a._ms);
  if (priors.length === 0) return msgs;

  const dup = priors.find((p) => Math.abs(p._ms - obsMs) / 60_000 <= 5);
  if (dup) {
    const time = new Date(dup._ms).toLocaleTimeString('th-TH', {
      timeZone: 'Asia/Bangkok',
      hour: '2-digit',
      minute: '2-digit',
    });
    msgs.push(`มีข้อมูล partograph ภายใน 5 นาทีที่เวลา ${time} ต้องการบันทึกต่อหรือไม่ ?`);
  }

  const newest = priors[0];
  const prevDil = newest.cervical_dilation_cm;
  const curDil = payload.cervical_dilation_cm;
  if (
    prevDil !== null &&
    prevDil !== undefined &&
    prevDil > 0 &&
    curDil !== null &&
    curDil !== undefined &&
    curDil > 0 &&
    curDil < prevDil
  ) {
    msgs.push(
      `Cervical dilation ลดลงจาก ${prevDil} cm เป็น ${curDil} cm ต้องการบันทึกต่อหรือไม่ ?`,
    );
  }

  if ((obsMs - newest._ms) / 3_600_000 > 2) {
    msgs.push('ข้อมูลล่าสุดเก่ากว่า 2 ชั่วโมง ต้องการบันทึกต่อหรือไม่ ?');
  }
  return msgs;
}

// Categorical clinical palette — mirrors the v2 ward bed-tile color system so
// section identity carries through from the at-a-glance grid into the entry
// dialog. Each tone is a (foreground, soft background, ring) trio.
type SectionTone =
  | 'fhr'       // rose / heart
  | 'labour'    // indigo / partograph progress
  | 'cont'      // violet / contractions
  | 'vitals'    // cyan / nurse-note vitals
  | 'interv'    // emerald / IV / Oxytocin
  | 'urine'     // amber
  | 'pps'       // sky / postpartum
  | 'biometric' // amber
  | 'pv'        // indigo
  | 'pe'        // emerald
  | 'icu'       // rose
  | 'fluid'     // sky
  | 'slate';    // neutral

const TONE_TOKENS: Record<
  SectionTone,
  { ink: string; bar: string; bg: string; ring: string }
> = {
  fhr:       { ink: 'text-rose-700',     bar: 'bg-rose-500',     bg: 'bg-rose-50/40',     ring: 'ring-rose-200/60' },
  labour:    { ink: 'text-indigo-700',   bar: 'bg-indigo-500',   bg: 'bg-indigo-50/40',   ring: 'ring-indigo-200/60' },
  cont:      { ink: 'text-violet-700',   bar: 'bg-violet-500',   bg: 'bg-violet-50/40',   ring: 'ring-violet-200/60' },
  vitals:    { ink: 'text-cyan-700',     bar: 'bg-cyan-500',     bg: 'bg-cyan-50/40',     ring: 'ring-cyan-200/60' },
  interv:    { ink: 'text-emerald-700',  bar: 'bg-emerald-500',  bg: 'bg-emerald-50/40',  ring: 'ring-emerald-200/60' },
  urine:     { ink: 'text-amber-700',    bar: 'bg-amber-500',    bg: 'bg-amber-50/40',    ring: 'ring-amber-200/60' },
  pps:       { ink: 'text-sky-700',      bar: 'bg-sky-500',      bg: 'bg-sky-50/40',      ring: 'ring-sky-200/60' },
  biometric: { ink: 'text-amber-700',    bar: 'bg-amber-500',    bg: 'bg-amber-50/40',    ring: 'ring-amber-200/60' },
  pv:        { ink: 'text-indigo-700',   bar: 'bg-indigo-500',   bg: 'bg-indigo-50/40',   ring: 'ring-indigo-200/60' },
  pe:        { ink: 'text-emerald-700',  bar: 'bg-emerald-500',  bg: 'bg-emerald-50/40',  ring: 'ring-emerald-200/60' },
  icu:       { ink: 'text-rose-700',     bar: 'bg-rose-500',     bg: 'bg-rose-50/40',     ring: 'ring-rose-200/60' },
  fluid:     { ink: 'text-sky-700',      bar: 'bg-sky-500',      bg: 'bg-sky-50/40',      ring: 'ring-sky-200/60' },
  slate:     { ink: 'text-slate-600',    bar: 'bg-slate-400',    bg: 'bg-slate-50/60',    ring: 'ring-slate-200/60' },
};

type SectionProps = {
  title: string;
  /** Tailwind grid-cols classes for the inner field grid. */
  cols?: string;
  /** Quick-pick chip row to render between the heading and the fields. */
  chips?: React.ReactNode;
  /** Categorical clinical color — sets the left bar + heading + tinted background. */
  tone?: SectionTone;
  children: React.ReactNode;
};
// Section: a colored 3px left bar carries categorical identity (matches the
// v2 ward bed-tile color system), a mono caps title in the same hue, and a
// dense field grid below. The optional `chips` slot renders quick-pick rows
// between the heading and the field grid.
function Section({
  title,
  cols = 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-4',
  chips,
  tone = 'slate',
  children,
}: SectionProps) {
  const t = TONE_TOKENS[tone];
  return (
    <section className={cn('relative overflow-hidden rounded-lg bg-white shadow-sm ring-1', t.ring)}>
      <span aria-hidden className={cn('absolute left-0 top-0 bottom-0 w-1', t.bar)} />
      <h4
        className={cn(
          'flex items-center gap-2 border-b border-slate-100 px-5 py-3 text-[15px] font-bold tracking-tight',
          t.ink,
          t.bg,
        )}
      >
        {title}
      </h4>
      {chips && <div className="border-b border-slate-100 bg-slate-50/40 px-5 py-3">{chips}</div>}
      <div className={cn('grid gap-x-4 gap-y-3.5 p-5', cols)}>{children}</div>
    </section>
  );
}

// Controlled-state collapsible — children always render so fireEvent.change
// in jsdom still updates state when the section is closed. Visibility is
// CSS-only (`hidden`).
function CollapsibleSection({
  title,
  cols = 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-4',
  defaultOpen = false,
  badge,
  chips,
  tone = 'slate',
  children,
}: SectionProps & { defaultOpen?: boolean; badge?: string }) {
  const [open, setOpen] = useState(defaultOpen);
  const t = TONE_TOKENS[tone];
  return (
    <section className={cn('relative overflow-hidden rounded-lg bg-white shadow-sm ring-1', t.ring)}>
      <span aria-hidden className={cn('absolute left-0 top-0 bottom-0 w-1', t.bar)} />
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className={cn(
          'flex w-full items-center justify-between border-b border-slate-100 px-5 py-3 text-[15px] font-bold tracking-tight transition-colors hover:bg-slate-50',
          t.ink,
          t.bg,
        )}
      >
        <span className="flex items-center gap-2.5">
          <span
            aria-hidden
            className={cn('inline-block text-[12px] transition-transform', open && 'rotate-90')}
          >
            ▸
          </span>
          {title}
          {badge && (
            <span className="text-[12px] font-normal text-slate-500">
              · {badge}
            </span>
          )}
        </span>
        {!open && (
          <span className="text-[12px] font-medium text-slate-400">
            คลิกเพื่อขยาย
          </span>
        )}
      </button>
      <div className={cn(!open && 'hidden')}>
        {chips && <div className="border-b border-slate-100 bg-slate-50/40 px-5 py-3">{chips}</div>}
        <div className={cn('grid gap-x-4 gap-y-3.5 p-5', cols)}>{children}</div>
      </div>
    </section>
  );
}

// DraggableChip / ChipRow / ChipTone live in ./shared/DraggableChips so every
// numeric helper chip across maternity tabs + dialogs behaves identically.

// Quick-pick chip catalogues. Per-chip `tone` color-codes clinical zone:
// ok=green (normal), warn=amber (borderline), crit=red (abnormal),
// default=neutral cyan. Categorical chips (Strength/Descent/Amniotic) keep
// the neutral default since their values aren't on a severity axis.
const FHR_CHIPS = [
  { value: '130', label: '130', tone: 'ok' as ChipTone },
  { value: '140', label: '140', tone: 'ok' as ChipTone },
  { value: '145', label: '145', tone: 'ok' as ChipTone },
  { value: '150', label: '150', tone: 'ok' as ChipTone },
  { value: '155', label: '155', tone: 'ok' as ChipTone },
];
const CX_CHIPS = [
  { value: '0',  label: '0' },
  { value: '2',  label: '2' },
  { value: '4',  label: '4' },  // active phase begins
  { value: '6',  label: '6' },
  { value: '8',  label: '8' },
  { value: '10', label: '10' }, // fully dilated
];
const DESCENT_CHIPS = [
  { value: '5/5', label: '5/5' },
  { value: '4/5', label: '4/5' },
  { value: '3/5', label: '3/5' },
  { value: '2/5', label: '2/5' },
  { value: '1/5', label: '1/5' },
  { value: '0/5', label: '0/5' },
];
const STRENGTH_CHIPS = [
  { value: 'Mild',     label: 'Mild' },
  { value: 'Moderate', label: 'Moderate' },
  { value: 'Strong',   label: 'Strong' },
];
const CONTR_FREQ_CHIPS = [
  { value: '1', label: '1' },
  { value: '2', label: '2' },
  { value: '3', label: '3', tone: 'ok'   as ChipTone },
  { value: '4', label: '4', tone: 'ok'   as ChipTone },
  { value: '5', label: '5', tone: 'warn' as ChipTone }, // tachysystole border
];
const CONTR_DUR_CHIPS = [
  { value: '30', label: '30' },
  { value: '40', label: '40', tone: 'ok' as ChipTone },
  { value: '50', label: '50', tone: 'ok' as ChipTone },
  { value: '60', label: '60', tone: 'ok' as ChipTone },
];
const PULSE_CHIPS = [
  { value: '60',  label: '60',  tone: 'ok' as ChipTone },
  { value: '70',  label: '70',  tone: 'ok' as ChipTone },
  { value: '80',  label: '80',  tone: 'ok' as ChipTone },
  { value: '90',  label: '90',  tone: 'ok' as ChipTone },
  { value: '100', label: '100', tone: 'ok' as ChipTone },
];
const BP_SYS_CHIPS = [
  { value: '100', label: '100', tone: 'ok'   as ChipTone },
  { value: '110', label: '110', tone: 'ok'   as ChipTone },
  { value: '120', label: '120', tone: 'ok'   as ChipTone },
  { value: '130', label: '130', tone: 'warn' as ChipTone },
  { value: '140', label: '140', tone: 'crit' as ChipTone },
];
const BP_DIA_CHIPS = [
  { value: '60', label: '60', tone: 'ok'   as ChipTone },
  { value: '70', label: '70', tone: 'ok'   as ChipTone },
  { value: '80', label: '80', tone: 'ok'   as ChipTone },
  { value: '90', label: '90', tone: 'crit' as ChipTone },
];
const TEMP_CHIPS = [
  { value: '36.5', label: '36.5', tone: 'ok'   as ChipTone },
  { value: '37.0', label: '37.0', tone: 'ok'   as ChipTone },
  { value: '37.5', label: '37.5', tone: 'ok'   as ChipTone },
  { value: '38.0', label: '38.0', tone: 'warn' as ChipTone },
  { value: '38.5', label: '38.5', tone: 'crit' as ChipTone },
];
const OXY_UML_CHIPS = [
  { value: '5',  label: '5' },
  { value: '10', label: '10' },
  { value: '15', label: '15' },
  { value: '20', label: '20' },
];
const OXY_DROPS_CHIPS = [
  { value: '10', label: '10' },
  { value: '20', label: '20' },
  { value: '30', label: '30' },
  { value: '40', label: '40' },
];

// Compact "label + chips" row used inside Section `chips` slots. Aligns the
// label column across stacked rows so vertical scan stays readable.
function ChipLabelRow({
  label,
  options,
  selected,
  onPick,
  ariaLabel,
}: {
  label: string;
  options: ReadonlyArray<{ value: string; label: string }>;
  selected: string;
  onPick: (v: string) => void;
  ariaLabel?: string;
}) {
  return (
    <div className="flex items-center gap-3">
      <span className="w-20 shrink-0 text-[12px] font-semibold text-slate-700">
        {label}
      </span>
      <ChipRow
        options={options}
        selected={selected}
        onPick={onPick}
        ariaLabel={ariaLabel ?? label}
      />
    </div>
  );
}

interface FieldProps {
  name: AnyEditableField;
  label: string;
  hint?: string;
  value: string;
  onChange: (v: string) => void;
  type?: 'int' | 'float' | 'text' | 'datetime' | 'textarea';
  options?: readonly string[];
  colSpan?: 'full';
  abnormal?: boolean;
  abnormalHint?: string;
  /** Quick-pick chip presets rendered INLINE below the input. Tap → onChange(value).
   *  Each chip can carry a `tone` to color-code clinical zone (normal=green,
   *  borderline=amber, abnormal=red) or VAS severity ladder (Pain). */
  chips?: ReadonlyArray<{ value: string; label: string; tone?: ChipTone }>;
  /** Min/max bounds for chip drag-adjust. The DraggableChip clamps the
   *  previewed value to [min, max] and shows an amber edge-pinned ring when
   *  the drag tries to push past either end — the nurse sees they've hit the
   *  legal range. Required for any field that uses `chips` with numeric
   *  values; categorical chips ('Mild' / '5/5') ignore the range and don't
   *  drag at all. */
  chipRange?: { min: number; max: number };
}

function Field({
  name,
  label,
  hint,
  value,
  onChange,
  type = 'int',
  options,
  colSpan,
  abnormal,
  chips,
  chipRange,
}: FieldProps) {
  const inputId = `pf-${name}`;
  // Numeric fields render in IBM Plex Mono with tabular-nums so columns align
  // visually across stacked rows (matches the v2 ward tile typography).
  const isNumeric = type === 'int' || type === 'float';
  const baseCls =
    'h-11 w-full rounded-md border bg-white px-3.5 text-[15px] text-slate-900 shadow-sm transition-colors focus:outline-none focus:ring-2';
  const numericCls = isNumeric ? 'font-semibold tabular-nums' : '';
  const normalCls = 'border-slate-200 hover:border-slate-300 focus:border-cyan-500 focus:ring-cyan-500/20';
  const abnormalCls =
    'border-rose-400 bg-rose-50/40 font-semibold text-rose-700 focus:border-rose-500 focus:ring-rose-500/30';
  const inputCls = cn(baseCls, numericCls, abnormal ? abnormalCls : normalCls);
  // colSpan-full is kept for the note textarea; everything else rides the
  // section's default grid template for maximum density.
  return (
    <div
      className={cn(
        'flex flex-col gap-1',
        colSpan === 'full' && 'col-span-full',
      )}
    >
      <label
        htmlFor={inputId}
        className="flex items-baseline gap-2 text-[13px] font-semibold text-slate-800"
      >
        <span className="truncate">{label}</span>
        {hint && (
          <span className="text-[11px] font-normal text-slate-500">
            {hint}
          </span>
        )}
        {abnormal && (
          <span
            data-testid={`abnormal-${name}`}
            className="ml-auto rounded bg-rose-600 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wider text-white shadow-sm"
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
      ) : type === 'datetime' ? (
        <input
          id={inputId}
          aria-label={name}
          type="datetime-local"
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
      {chips && chips.length > 0 && (
        <ChipRow
          ariaLabel={`${name} quick picks`}
          options={chips}
          selected={value}
          onPick={onChange}
          step={type === 'float' ? 0.1 : 1}
          isFloat={type === 'float'}
          range={chipRange}
        />
      )}
    </div>
  );
}

export function PartographEntryDialog({
  open,
  mode,
  initialRow,
  observations,
  saving,
  onSave,
  onDelete,
  onCancel,
}: PartographEntryDialogProps) {
  // The parent remounts us (via `key`) when add/edit/different row changes, so
  // initializing once from `initialRow` is correct — no re-seeding effect.
  const [draft, setDraft] = useState<DraftState>(() => rowToDraft(initialRow));
  const [error, setError] = useState<string | null>(null);

  const excludeId = initialRow?.ipt_labour_partograph_id;

  // Previous (newest) observation, excluding the row being edited.
  const prevRow = useMemo<PartographRow | null>(() => {
    const priors = observations
      .filter((o) => o.ipt_labour_partograph_id !== excludeId && !!o.observe_datetime)
      .sort((a, b) => (b.observe_datetime ?? '').localeCompare(a.observe_datetime ?? ''));
    return priors[0] ?? null;
  }, [observations, excludeId]);

  // Auto hour_no: applied only while the user hasn't touched the field.
  const autoHourNo = useMemo(() => {
    const obsIso = draft.observe_datetime ? `${draft.observe_datetime}:00` : '';
    return computeHourNo(obsIso, observations, excludeId);
  }, [draft.observe_datetime, observations, excludeId]);

  const effectiveHourNo = draft._hourNoTouched
    ? draft.hour_no
    : autoHourNo !== null
      ? String(autoHourNo)
      : '';

  const abnormal = useMemo(() => abnormalRanges(draft), [draft]);

  // Status panel derivations — mirrors UpdateStatusPanel.
  const obsCount = observations.filter((o) => o.ipt_labour_partograph_id !== excludeId).length;
  const dilationNow = toFloatOrNull(draft.cervical_dilation_cm);
  const prevDil = prevRow?.cervical_dilation_cm ?? null;
  const phase =
    (dilationNow !== null && dilationNow >= 4) || (prevDil !== null && prevDil >= 4)
      ? 'ACTIVE'
      : 'LATENT';
  const lastEntry = prevRow?.observe_datetime ?? null;

  function set(field: AnyEditableField, value: string) {
    setDraft((d) => ({
      ...d,
      [field]: value,
      // Mark hour_no as user-touched so auto-derive stops overwriting it.
      ...(field === 'hour_no' ? { _hourNoTouched: true } : null),
    }));
    if (error) setError(null);
  }

  function handleCopyPrev() {
    if (!prevRow) return;
    setDraft((d) => ({
      ...d,
      pulse: prevRow.pulse?.toString() ?? '',
      bp_systolic: prevRow.bp_systolic?.toString() ?? '',
      bp_diastolic: prevRow.bp_diastolic?.toString() ?? '',
      temperature: prevRow.temperature?.toString() ?? '',
      urine_volume_ml: prevRow.urine_volume_ml?.toString() ?? '',
      urine_protein: prevRow.urine_protein ?? '',
      urine_acetone: prevRow.urine_acetone ?? '',
      urine_glucose: prevRow.urine_glucose ?? '',
    }));
  }

  function handleSave() {
    const payload = buildPayload({
      ...draft,
      // Auto hour_no feeds into save unless user typed one.
      hour_no: draft._hourNoTouched ? draft.hour_no : String(autoHourNo ?? ''),
    });
    if (!hasClinicalValue(payload)) {
      setError('กรุณากรอกข้อมูลอย่างน้อย 1 ฟิลด์ทางคลินิก');
      return;
    }
    const validationError = beforePostValidation(payload, Date.now());
    if (validationError) {
      setError(validationError);
      return;
    }
    for (const msg of softConfirmations(payload, observations, excludeId)) {
      if (!window.confirm(msg)) return;
    }
    if (mode === 'edit' && initialRow?.ipt_labour_partograph_id) {
      payload.ipt_labour_partograph_id = initialRow.ipt_labour_partograph_id;
    }
    onSave(payload);
  }

  function handleDelete() {
    if (mode !== 'edit' || !initialRow?.ipt_labour_partograph_id) return;
    if (!window.confirm('ยืนยันการลบรายการนี้หรือไม่?')) return;
    onDelete(initialRow.ipt_labour_partograph_id);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onCancel();
      }}
    >
      <DialogContent
        className="sm:max-w-5xl max-h-[92vh] overflow-y-auto gap-3 bg-slate-50 p-4"
        showCloseButton={false}
      >
        {/* Title strip — clinical-blue brand mark + live status pills */}
        <DialogHeader className="flex-row items-center justify-between gap-3 border-b-2 border-slate-900 pb-4">
          <div className="flex items-center gap-3">
            <span aria-hidden className="block h-1.5 w-8 bg-cyan-600" />
            <DialogTitle className="text-[18px] font-bold tracking-tight text-slate-900">
              {mode === 'add' ? 'เพิ่มบันทึก Partograph' : 'แก้ไขบันทึก Partograph'}
            </DialogTitle>
          </div>
          <div
            data-testid="partograph-status"
            className="flex flex-wrap items-center gap-2 text-[12px] text-slate-600"
          >
            <span className="rounded-md bg-white px-2.5 py-1 font-medium ring-1 ring-slate-200">
              <span className="font-bold text-slate-900 tabular-nums">{obsCount}</span> รายการ
            </span>
            <span className="rounded-md bg-white px-2.5 py-1 font-medium ring-1 ring-slate-200">
              ล่าสุด <span className="tabular-nums font-bold text-slate-900">{lastEntry ? formatRelativeTime(lastEntry) : '—'}</span>
            </span>
            <span
              className={cn(
                'rounded-md px-2.5 py-1 text-[12px] font-bold uppercase tracking-wide ring-1',
                phase === 'ACTIVE'
                  ? 'bg-emerald-600 text-white ring-emerald-700'
                  : 'bg-slate-200 text-slate-700 ring-slate-300',
              )}
            >
              {phase === 'ACTIVE' ? 'ACTIVE PHASE' : 'LATENT PHASE'}
            </span>
          </div>
        </DialogHeader>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleSave();
          }}
          className="flex flex-col gap-3"
        >
          {/* Timestamp + hour-no — compact strip with mono numerics. */}
          <section className="grid grid-cols-2 gap-3 rounded-lg bg-white p-3 shadow-sm ring-1 ring-slate-200 sm:grid-cols-4">
            <Field
              name="observe_datetime"
              label="เวลาสังเกต"
              type="datetime"
              value={draft.observe_datetime}
              onChange={(v) => set('observe_datetime', v)}
            />
            <Field
              name="hour_no"
              label="ชั่วโมงที่"
              hint={
                draft._hourNoTouched
                  ? autoHourNo !== null
                    ? `· auto: ${autoHourNo}`
                    : undefined
                  : '· auto'
              }
              value={effectiveHourNo}
              onChange={(v) => set('hour_no', v)}
            />
          </section>

          {/* ── Priority sections (always visible, ordered by entry frequency
                in active labour: fetal → progress → contractions → maternal
                vitals). Each top section has tap-friendly chip rows above the
                relevant input so common values are reachable without typing. */}

          <div className="grid gap-2 lg:grid-cols-2">
            <Section title="ทารกในครรภ์" tone="fhr" cols="grid-cols-3">
              <Field
                name="fetal_heart_rate"
                label="FHR"
                hint="110–160"
                value={draft.fetal_heart_rate}
                onChange={(v) => set('fetal_heart_rate', v)}
                abnormal={abnormal.fetal_heart_rate}
                chips={FHR_CHIPS}
                chipRange={{ min: 60, max: 220 }}
              />
              <Field name="amniotic_fluid" label="น้ำคร่ำ" value={draft.amniotic_fluid} options={AMNIOTIC_OPTIONS} onChange={(v) => set('amniotic_fluid', v)} />
              <Field name="moulding" label="Moulding" value={draft.moulding} options={MOULDING_OPTIONS} onChange={(v) => set('moulding', v)} />
            </Section>

            <Section title="ความก้าวหน้าของการคลอด" tone="labour" cols="grid-cols-2">
              <Field
                name="cervical_dilation_cm"
                label="ปากมดลูก (ซม)"
                hint="0–10"
                type="float"
                value={draft.cervical_dilation_cm}
                onChange={(v) => set('cervical_dilation_cm', v)}
                chips={CX_CHIPS}
                chipRange={{ min: 0, max: 10 }}
              />
              <Field
                name="descent_of_head"
                label="Descent"
                value={draft.descent_of_head}
                options={DESCENT_OPTIONS}
                onChange={(v) => set('descent_of_head', v)}
                chips={DESCENT_CHIPS}
              />
            </Section>
          </div>

          <Section title="การหดรัดตัวของมดลูก" tone="cont" cols="grid-cols-3">
            <Field
              name="contraction_per_10min"
              label="ครั้ง/10นาที"
              value={draft.contraction_per_10min}
              onChange={(v) => set('contraction_per_10min', v)}
              chips={CONTR_FREQ_CHIPS}
              chipRange={{ min: 0, max: 10 }}
            />
            <Field
              name="contraction_duration_sec"
              label="ระยะเวลา (วิ)"
              value={draft.contraction_duration_sec}
              onChange={(v) => set('contraction_duration_sec', v)}
              chips={CONTR_DUR_CHIPS}
              chipRange={{ min: 10, max: 120 }}
            />
            <Field
              name="contraction_strength"
              label="ความแรง"
              value={draft.contraction_strength}
              options={CONTRACTION_STRENGTH_OPTIONS}
              onChange={(v) => set('contraction_strength', v)}
              chips={STRENGTH_CHIPS}
            />
          </Section>

          {/* Maternal vitals — moved up before drugs because pulse/BP are
              checked every 30 min during active labour vs. drugs adjusted only
              when augmenting. */}
          <Section title="สัญญาณชีพมารดา" tone="vitals" cols="grid-cols-2 sm:grid-cols-4">
            <Field
              name="pulse"
              label="Pulse"
              hint="60–100"
              value={draft.pulse}
              onChange={(v) => set('pulse', v)}
              abnormal={abnormal.pulse}
              chips={PULSE_CHIPS}
              chipRange={{ min: 30, max: 200 }}
            />
            <Field
              name="bp_systolic"
              label="BP Sys"
              hint="<140"
              value={draft.bp_systolic}
              onChange={(v) => set('bp_systolic', v)}
              abnormal={abnormal.bp_systolic}
              chips={BP_SYS_CHIPS}
              chipRange={{ min: 60, max: 220 }}
            />
            <Field
              name="bp_diastolic"
              label="BP Dia"
              hint="<90"
              value={draft.bp_diastolic}
              onChange={(v) => set('bp_diastolic', v)}
              abnormal={abnormal.bp_diastolic}
              chips={BP_DIA_CHIPS}
              chipRange={{ min: 30, max: 130 }}
            />
            <Field
              name="temperature"
              label="Temp °C"
              hint="<38"
              type="float"
              value={draft.temperature}
              onChange={(v) => set('temperature', v)}
              abnormal={abnormal.temperature}
              chips={TEMP_CHIPS}
              chipRange={{ min: 34, max: 42 }}
            />
          </Section>

          {/* ── Below-fold sections (default-collapsed unless the row being
                edited has data in them). Adjust on demand: drugs only when
                augmenting, urine only at void, note only when needed. */}

          <CollapsibleSection
            title="ยาและสารน้ำ"
            tone="interv"
            cols="grid-cols-3"
            defaultOpen={
              draft.oxytocin_uml !== '' ||
              draft.oxytocin_drops_min !== '' ||
              draft.drugs_iv_fluids !== ''
            }
            badge="เมื่อมีการให้ยา/สารน้ำ"
          >
            <Field
              name="oxytocin_uml"
              label="Oxy U/mL"
              type="float"
              value={draft.oxytocin_uml}
              onChange={(v) => set('oxytocin_uml', v)}
              chips={OXY_UML_CHIPS}
              chipRange={{ min: 0, max: 100 }}
            />
            <Field
              name="oxytocin_drops_min"
              label="Oxy หยด/นาที"
              value={draft.oxytocin_drops_min}
              onChange={(v) => set('oxytocin_drops_min', v)}
              chips={OXY_DROPS_CHIPS}
              chipRange={{ min: 0, max: 100 }}
            />
            <Field name="drugs_iv_fluids" label="IV / ยา" type="text" value={draft.drugs_iv_fluids} onChange={(v) => set('drugs_iv_fluids', v)} />
          </CollapsibleSection>

          <CollapsibleSection
            title="ปัสสาวะ"
            tone="urine"
            cols="grid-cols-2 sm:grid-cols-4"
            defaultOpen={
              draft.urine_volume_ml !== '' ||
              draft.urine_protein !== '' ||
              draft.urine_acetone !== '' ||
              draft.urine_glucose !== ''
            }
            badge="ทุกการ void"
          >
            <Field name="urine_volume_ml" label="ปริมาตร (ml)" value={draft.urine_volume_ml} onChange={(v) => set('urine_volume_ml', v)} />
            <Field name="urine_protein" label="Protein" value={draft.urine_protein} options={URINE_DIPSTICK_OPTIONS} onChange={(v) => set('urine_protein', v)} />
            <Field name="urine_acetone" label="Acetone" value={draft.urine_acetone} options={URINE_DIPSTICK_OPTIONS} onChange={(v) => set('urine_acetone', v)} />
            <Field name="urine_glucose" label="Glucose" value={draft.urine_glucose} options={URINE_DIPSTICK_OPTIONS} onChange={(v) => set('urine_glucose', v)} />
          </CollapsibleSection>

          <CollapsibleSection
            title="บันทึกเพิ่มเติม"
            tone="slate"
            cols="grid-cols-1"
            defaultOpen={draft.note !== ''}
          >
            <Field name="note" label="Note" type="textarea" value={draft.note} onChange={(v) => set('note', v)} colSpan="full" />
          </CollapsibleSection>

          {error && (
            <div
              role="alert"
              className="rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 font-mono text-[11px] font-semibold uppercase tracking-[0.08em] text-rose-700 shadow-sm"
            >
              {error}
            </div>
          )}

          <div className="sticky bottom-0 -mx-4 -mb-4 flex flex-wrap items-center gap-2 border-t-2 border-slate-900 bg-white/95 px-4 py-3 backdrop-blur">
            <button
              type="button"
              onClick={handleCopyPrev}
              disabled={!prevRow || saving}
              className="rounded-md border border-slate-300 bg-white px-4 py-2.5 text-[14px] font-semibold text-slate-700 transition-colors hover:border-cyan-400 hover:text-cyan-700 disabled:opacity-40"
              title="คัดลอกสัญญาณชีพและปัสสาวะจากครั้งก่อน"
            >
              คัดลอกครั้งก่อน
            </button>
            {mode === 'edit' && (
              <button
                type="button"
                onClick={handleDelete}
                disabled={saving}
                className="rounded-md border border-rose-300 bg-white px-4 py-2.5 text-[14px] font-semibold text-rose-700 transition-colors hover:bg-rose-50 disabled:opacity-40"
              >
                ลบ
              </button>
            )}
            <div className="ml-auto flex gap-2">
              <button
                type="button"
                onClick={onCancel}
                disabled={saving}
                className="rounded-md border border-slate-300 bg-white px-4 py-2.5 text-[14px] font-semibold text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-40"
              >
                ยกเลิก
              </button>
              <button
                type="submit"
                disabled={saving}
                className="rounded-md border-2 border-cyan-700 bg-cyan-700 px-6 py-2.5 text-[14px] font-bold text-white transition-colors hover:bg-cyan-800 disabled:opacity-40"
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
