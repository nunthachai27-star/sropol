// PartographEntryDialog — modal port of HOSxPIPDLabourPartographEntryFormUnit.
// Batch 1 (done): 7 Thai sections covering all 21 editable columns + Save /
// Cancel / Delete / Copy-Prev.
// Batch 2 (this pass): abnormal-range highlighting, live status panel, auto
// hour_no, BeforePost validation, soft confirmations. Mirrors the semantics of
// ApplyAbnormalStyles + UpdateStatusPanel + ComputeHourNo +
// PartographCDSBeforePost + DoSoftConfirmations from the Delphi unit.
'use client';

import { useMemo, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { PartographRow } from '@/types/maternity-ward';
import { cn, formatRelativeTime } from '@/lib/utils';

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

type SectionProps = {
  title: string;
  /** Tailwind grid-cols classes for the inner field grid. */
  cols?: string;
  /** Quick-pick chip row to render between the heading and the fields. */
  chips?: React.ReactNode;
  children: React.ReactNode;
};
// Tight two-line section: a small header strip plus a dense field grid.
function Section({ title, cols = 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-4', chips, children }: SectionProps) {
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

// Same shape as Section but uses native <details> so the section can collapse
// while keeping its children in the DOM (so getByLabelText still finds them).
// `defaultOpen` should be `true` if any child field has a value — the parent
// computes that and passes it in so editing existing rows opens what's filled.
function CollapsibleSection({
  title,
  cols = 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-4',
  defaultOpen = false,
  badge,
  chips,
  children,
}: SectionProps & { defaultOpen?: boolean; badge?: string }) {
  return (
    <details
      open={defaultOpen}
      className="group rounded-md border border-slate-200 bg-white"
    >
      <summary className="flex cursor-pointer list-none items-center justify-between border-b border-slate-100 bg-slate-50/60 px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-slate-600 hover:bg-slate-100/60">
        <span className="flex items-center gap-2">
          <span
            aria-hidden
            className="inline-block transition-transform group-open:rotate-90"
          >
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

// Quick-pick chips — one tap to set a value. Appears above the corresponding
// numeric/select input so the most-frequent values are reachable without
// typing. Selected state is derived from the current draft string.
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

// Quick-pick chip catalogues for partograph fields. Values mirror the most
// commonly entered measurements per Thai LR practice + WHO partograph
// guidelines. Order is most-common → least.
const FHR_CHIPS = [
  { value: '130', label: '130' },
  { value: '140', label: '140' },
  { value: '145', label: '145' },
  { value: '150', label: '150' },
  { value: '155', label: '155' },
];
const CX_CHIPS = [
  { value: '0', label: '0' },
  { value: '2', label: '2' },
  { value: '4', label: '4' },
  { value: '6', label: '6' },
  { value: '8', label: '8' },
  { value: '10', label: '10' },
];
const STRENGTH_CHIPS = [
  { value: 'Mild', label: 'Mild' },
  { value: 'Moderate', label: 'Moderate' },
  { value: 'Strong', label: 'Strong' },
];
const DESCENT_CHIPS = [
  { value: '5/5', label: '5/5' },
  { value: '4/5', label: '4/5' },
  { value: '3/5', label: '3/5' },
  { value: '2/5', label: '2/5' },
  { value: '1/5', label: '1/5' },
  { value: '0/5', label: '0/5' },
];
const AMNIOTIC_CHIPS = [
  { value: 'Clear', label: 'Clear' },
  { value: 'Meconium (light)', label: 'Mec L' },
  { value: 'Meconium (thick)', label: 'Mec T' },
  { value: 'Blood', label: 'Blood' },
  { value: 'Absent', label: 'Absent' },
];
const MOULDING_CHIPS = [
  { value: '0', label: '0' },
  { value: '+', label: '+' },
  { value: '++', label: '++' },
  { value: '+++', label: '+++' },
];

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
}: FieldProps) {
  const inputId = `pf-${name}`;
  const baseCls =
    'h-9 w-full rounded-md border bg-white px-2.5 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-1';
  const normalCls = 'border-slate-300 focus:border-emerald-500 focus:ring-emerald-500';
  const abnormalCls =
    'border-rose-400 bg-rose-50/40 font-semibold text-rose-700 focus:border-rose-500 focus:ring-rose-500';
  const inputCls = cn(baseCls, abnormal ? abnormalCls : normalCls);
  // colSpan-full is kept for the note textarea; everything else rides the
  // section's default grid template for maximum density.
  return (
    <div
      className={cn(
        'flex flex-col gap-0.5',
        colSpan === 'full' && 'col-span-full',
      )}
    >
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
        className="sm:max-w-5xl max-h-[92vh] overflow-y-auto gap-2 p-3"
        showCloseButton={false}
      >
        {/* Compact title + live status strip on one row. The status panel is
            the UpdateStatusPanel port (obs count · last entry · phase). */}
        <DialogHeader className="flex-row items-center justify-between gap-3">
          <DialogTitle className="text-base">
            {mode === 'add' ? 'เพิ่มบันทึก Partograph' : 'แก้ไขบันทึก Partograph'}
          </DialogTitle>
          <div
            data-testid="partograph-status"
            className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-slate-600"
          >
            <span>
              <span className="font-semibold text-slate-800 tabular-nums">{obsCount}</span> รายการ
            </span>
            <span aria-hidden className="text-slate-300">·</span>
            <span>
              ล่าสุด{' '}
              <span className="tabular-nums">{lastEntry ? formatRelativeTime(lastEntry) : '—'}</span>
            </span>
            <span aria-hidden className="text-slate-300">·</span>
            <span
              className={cn(
                'rounded px-2 py-0.5 text-[11px] font-semibold tracking-wide',
                phase === 'ACTIVE'
                  ? 'bg-emerald-100 text-emerald-800'
                  : 'bg-slate-100 text-slate-700',
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
          className="flex flex-col gap-2"
        >
          {/* Timestamp + hour number on one inline row. */}
          <section className="grid grid-cols-2 gap-2 rounded-md border border-slate-200 bg-slate-50 px-2 py-1.5 sm:grid-cols-4">
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
            <Section
              title="ทารกในครรภ์"
              cols="grid-cols-3"
              chips={
                <ChipRow
                  ariaLabel="FHR quick picks"
                  options={FHR_CHIPS}
                  selected={draft.fetal_heart_rate}
                  onPick={(v) => set('fetal_heart_rate', v)}
                />
              }
            >
              <Field
                name="fetal_heart_rate"
                label="FHR"
                hint="110–160"
                value={draft.fetal_heart_rate}
                onChange={(v) => set('fetal_heart_rate', v)}
                abnormal={abnormal.fetal_heart_rate}
              />
              <Field name="amniotic_fluid" label="น้ำคร่ำ" value={draft.amniotic_fluid} options={AMNIOTIC_OPTIONS} onChange={(v) => set('amniotic_fluid', v)} />
              <Field name="moulding" label="Moulding" value={draft.moulding} options={MOULDING_OPTIONS} onChange={(v) => set('moulding', v)} />
            </Section>

            <Section
              title="ความก้าวหน้าของการคลอด"
              cols="grid-cols-2"
              chips={
                <div className="flex flex-col gap-1.5">
                  <div className="flex items-center gap-2">
                    <span className="w-16 shrink-0 text-[10px] font-medium uppercase tracking-wider text-slate-500">Cx</span>
                    <ChipRow
                      ariaLabel="Cervical dilation quick picks"
                      options={CX_CHIPS}
                      selected={draft.cervical_dilation_cm}
                      onPick={(v) => set('cervical_dilation_cm', v)}
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="w-16 shrink-0 text-[10px] font-medium uppercase tracking-wider text-slate-500">Descent</span>
                    <ChipRow
                      ariaLabel="Descent of head quick picks"
                      options={DESCENT_CHIPS}
                      selected={draft.descent_of_head}
                      onPick={(v) => set('descent_of_head', v)}
                    />
                  </div>
                </div>
              }
            >
              <Field name="cervical_dilation_cm" label="ปากมดลูก (ซม)" hint="0–10" type="float" value={draft.cervical_dilation_cm} onChange={(v) => set('cervical_dilation_cm', v)} />
              <Field name="descent_of_head" label="Descent" value={draft.descent_of_head} options={DESCENT_OPTIONS} onChange={(v) => set('descent_of_head', v)} />
            </Section>
          </div>

          <Section
            title="การหดรัดตัวของมดลูก"
            cols="grid-cols-3"
            chips={
              <ChipRow
                ariaLabel="Contraction strength quick picks"
                options={STRENGTH_CHIPS}
                selected={draft.contraction_strength}
                onPick={(v) => set('contraction_strength', v)}
              />
            }
          >
            <Field name="contraction_per_10min" label="ครั้ง/10นาที" value={draft.contraction_per_10min} onChange={(v) => set('contraction_per_10min', v)} />
            <Field name="contraction_duration_sec" label="ระยะเวลา (วิ)" value={draft.contraction_duration_sec} onChange={(v) => set('contraction_duration_sec', v)} />
            <Field name="contraction_strength" label="ความแรง" value={draft.contraction_strength} options={CONTRACTION_STRENGTH_OPTIONS} onChange={(v) => set('contraction_strength', v)} />
          </Section>

          {/* Maternal vitals — moved up before drugs because pulse/BP are
              checked every 30 min during active labour vs. drugs adjusted only
              when augmenting. */}
          <Section title="สัญญาณชีพมารดา" cols="grid-cols-2 sm:grid-cols-4">
            <Field
              name="pulse"
              label="Pulse"
              hint="60–100"
              value={draft.pulse}
              onChange={(v) => set('pulse', v)}
              abnormal={abnormal.pulse}
            />
            <Field
              name="bp_systolic"
              label="BP Sys"
              hint="<140"
              value={draft.bp_systolic}
              onChange={(v) => set('bp_systolic', v)}
              abnormal={abnormal.bp_systolic}
            />
            <Field
              name="bp_diastolic"
              label="BP Dia"
              hint="<90"
              value={draft.bp_diastolic}
              onChange={(v) => set('bp_diastolic', v)}
              abnormal={abnormal.bp_diastolic}
            />
            <Field
              name="temperature"
              label="Temp °C"
              hint="<38"
              type="float"
              value={draft.temperature}
              onChange={(v) => set('temperature', v)}
              abnormal={abnormal.temperature}
            />
          </Section>

          {/* ── Below-fold sections (default-collapsed unless the row being
                edited has data in them). Adjust on demand: drugs only when
                augmenting, urine only at void, note only when needed. */}

          <CollapsibleSection
            title="ยาและสารน้ำ"
            cols="grid-cols-3"
            defaultOpen={
              draft.oxytocin_uml !== '' ||
              draft.oxytocin_drops_min !== '' ||
              draft.drugs_iv_fluids !== ''
            }
            badge="เมื่อมีการให้ยา/สารน้ำ"
          >
            <Field name="oxytocin_uml" label="Oxy U/mL" type="float" value={draft.oxytocin_uml} onChange={(v) => set('oxytocin_uml', v)} />
            <Field name="oxytocin_drops_min" label="Oxy หยด/นาที" value={draft.oxytocin_drops_min} onChange={(v) => set('oxytocin_drops_min', v)} />
            <Field name="drugs_iv_fluids" label="IV / ยา" type="text" value={draft.drugs_iv_fluids} onChange={(v) => set('drugs_iv_fluids', v)} />
          </CollapsibleSection>

          <CollapsibleSection
            title="ปัสสาวะ"
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
            cols="grid-cols-1"
            defaultOpen={draft.note !== ''}
          >
            <Field name="note" label="Note" type="textarea" value={draft.note} onChange={(v) => set('note', v)} colSpan="full" />
          </CollapsibleSection>

          {error && (
            <div
              role="alert"
              className="rounded-md border border-rose-200 bg-rose-50 px-3 py-1.5 text-xs text-rose-700"
            >
              {error}
            </div>
          )}

          <div className="sticky bottom-0 -mx-3 -mb-3 flex flex-wrap items-center gap-2 border-t border-slate-200 bg-white/95 px-3 py-2.5 backdrop-blur">
            <button
              type="button"
              onClick={handleCopyPrev}
              disabled={!prevRow || saving}
              className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:border-emerald-400 hover:text-emerald-700 disabled:opacity-50"
              title="คัดลอกสัญญาณชีพและปัสสาวะจากครั้งก่อน"
            >
              คัดลอกครั้งก่อน
            </button>
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
