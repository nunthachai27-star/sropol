// PreLabourTab — pre-labour data entry covering BOTH ipt_pregnancy and
// ipt_labour. Single Save writes both tables sequentially; if pregnancy
// succeeds and labour fails, the second-step error surfaces in a Thai inline
// message and the failed side stays editable.
//
// Bug fixed (2026-04-28): the previous version returned early with
// "ไม่พบข้อมูล" when both rows were null — typical for fresh admissions —
// hiding the edit button entirely so users couldn't enter data. Now the form
// always renders and auto-enters edit mode when no data exists. Save dispatches
// to insert vs. update based on whether the row was found.
//
// Field set expanded to match HOSxPIPDLaborPrecareEntryFrameUnit + ipt_labour
// schema per knowledge base: G/T/P/A/L counts, LMP, EDC, GA weeks + days,
// preg_no, anc_count, anc_complete, labor_date.
'use client';

import { useEffect, useState } from 'react';
import useSWR from 'swr';
import { useBmsSession } from '@/hooks/useBmsSession';
import {
  getPatientLabour,
  getPatientPregnancy,
  upsertLabour,
  upsertPregnancy,
} from '@/services/maternity-ward';
import type { LabourRecord, PregnancyRecord } from '@/types/maternity-ward';
import { cn } from '@/lib/utils';

interface DraftState {
  // ipt_pregnancy
  preg_number: string;
  anc_complete: string;
  labor_date: string;
  // ipt_labour
  g: string;       // gravida
  t: string;       // term
  p: string;       // pre-term
  a: string;       // abortion
  l: string;       // living
  ga: string;      // GA weeks
  ga_day: string;  // GA days
  preg_no: string; // pregnancy number
  anc_count: string;
  lmp: string;
  edc: string;
  lmp_from_us: string;
}

function blankDraft(): DraftState {
  return {
    preg_number: '', anc_complete: '', labor_date: '',
    g: '', t: '', p: '', a: '', l: '',
    ga: '', ga_day: '', preg_no: '', anc_count: '',
    lmp: '', edc: '', lmp_from_us: '',
  };
}

function rowsToDraft(
  pregnancy: PregnancyRecord | null | undefined,
  labour: LabourRecord | null | undefined,
): DraftState {
  const d = blankDraft();
  if (pregnancy) {
    d.preg_number = pregnancy.preg_number?.toString() ?? '';
    d.anc_complete = pregnancy.anc_complete ?? '';
    d.labor_date = pregnancy.labor_date ?? '';
  }
  if (labour) {
    const lr = labour as Record<string, unknown>;
    d.g = labour.g?.toString() ?? '';
    d.ga = labour.ga?.toString() ?? '';
    d.anc_count = labour.anc_count?.toString() ?? '';
    d.t = (lr.t as number | null)?.toString() ?? '';
    d.p = (lr.p as number | null)?.toString() ?? '';
    d.a = (lr.a as number | null)?.toString() ?? '';
    d.l = (lr.l as number | null)?.toString() ?? '';
    d.ga_day = (lr.ga_day as number | null)?.toString() ?? '';
    d.preg_no = (lr.preg_no as number | null)?.toString() ?? '';
    d.lmp = (lr.lmp as string | null) ?? '';
    d.edc = (lr.edc as string | null) ?? '';
    d.lmp_from_us = (lr.lmp_from_us as string | null) ?? '';
  }
  return d;
}

function toIntOrNull(v: string): number | null {
  if (v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}
function toStrOrNull(v: string): string | null {
  return v === '' ? null : v;
}

// ─── UI primitives ────────────────────────────────────────────────────────

interface FieldProps {
  label: string;
  ariaLabel?: string;
  value: string;
  onChange?: (v: string) => void;
  type?: 'text' | 'date' | 'number';
  hint?: string;
  readOnly?: boolean;
  options?: ReadonlyArray<{ value: string; label: string }>;
}

function Field({
  label, ariaLabel, value, onChange, type = 'text', hint, readOnly, options,
}: FieldProps) {
  const inputCls =
    'h-11 w-full rounded-md border border-slate-200 bg-white px-3 text-[15px] text-slate-900 shadow-sm transition-colors hover:border-slate-300 focus:border-cyan-500 focus:outline-none focus:ring-2 focus:ring-cyan-500/20';
  const numericCls = type === 'number' ? 'font-semibold tabular-nums' : '';

  // Display mode renders value as plain text (no <input>) so the readonly
  // tab shows static data — and so getByText() finds the value while
  // getByLabelText() does NOT (matches the existing test expectations and
  // keeps the visual tighter when not editing).
  if (readOnly) {
    const display = value === '' || value === undefined || value === null ? '—' : value;
    return (
      <div className="flex flex-col gap-1">
        <span className="flex items-baseline gap-2 text-[13px] font-semibold text-slate-800">
          <span className="truncate">{label}</span>
          {hint && <span className="text-[11px] font-normal text-slate-500">{hint}</span>}
        </span>
        <span
          className={cn(
            'min-h-[44px] flex items-center text-[15px] font-medium text-slate-900',
            type === 'number' && 'tabular-nums font-semibold',
          )}
        >
          {display}
        </span>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <label className="flex items-baseline gap-2 text-[13px] font-semibold text-slate-800">
        <span className="truncate">{label}</span>
        {hint && <span className="text-[11px] font-normal text-slate-500">{hint}</span>}
      </label>
      {options ? (
        <select
          aria-label={ariaLabel ?? label}
          value={value}
          onChange={(e) => onChange?.(e.target.value)}
          className={inputCls}
        >
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      ) : (
        <input
          type={type === 'number' ? 'text' : type}
          inputMode={type === 'number' ? 'numeric' : undefined}
          aria-label={ariaLabel ?? label}
          value={value}
          onChange={(e) => onChange?.(e.target.value)}
          className={cn(inputCls, numericCls)}
        />
      )}
    </div>
  );
}

interface SectionProps {
  title: string;
  tone: 'pregnancy' | 'labour' | 'gtpal';
  children: React.ReactNode;
  cols?: string;
}

const TONE_TOKENS = {
  pregnancy: { ink: 'text-sky-700',    bar: 'bg-sky-500',    bg: 'bg-sky-50/40',    ring: 'ring-sky-200/60' },
  labour:    { ink: 'text-indigo-700', bar: 'bg-indigo-500', bg: 'bg-indigo-50/40', ring: 'ring-indigo-200/60' },
  gtpal:     { ink: 'text-violet-700', bar: 'bg-violet-500', bg: 'bg-violet-50/40', ring: 'ring-violet-200/60' },
};

function Section({ title, tone, children, cols = 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-4' }: SectionProps) {
  const t = TONE_TOKENS[tone];
  return (
    <section className={cn('relative overflow-hidden rounded-lg bg-white shadow-sm ring-1', t.ring)}>
      <span aria-hidden className={cn('absolute left-0 top-0 bottom-0 w-1', t.bar)} />
      <h4 className={cn('flex items-center gap-2 border-b border-slate-100 px-5 py-3 text-[15px] font-bold tracking-tight', t.ink, t.bg)}>
        {title}
      </h4>
      <div className={cn('grid gap-x-4 gap-y-3.5 p-5', cols)}>{children}</div>
    </section>
  );
}

const ANC_COMPLETE_OPTIONS = [
  { value: '', label: '—' },
  { value: 'Y', label: 'Y · ครบ' },
  { value: 'N', label: 'N · ไม่ครบ' },
];
const YN_OPTIONS = [
  { value: '', label: '—' },
  { value: 'Y', label: 'Y' },
  { value: 'N', label: 'N' },
];

// ─── Main ──────────────────────────────────────────────────────────────────

export function PreLabourTab({ an }: { an: string }) {
  const { config, userInfo } = useBmsSession();
  const labour = useSWR<LabourRecord | null>(
    config ? ['labour', config.apiUrl, an] : null,
    () => getPatientLabour(config!, an),
  );
  const pregnancy = useSWR<PregnancyRecord | null>(
    config ? ['pregnancy', config.apiUrl, an] : null,
    () => getPatientPregnancy(config!, an),
  );

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<DraftState>(() => blankDraft());
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Auto-seed draft from server data once it arrives. Auto-enter edit mode
  // when both records are missing — fresh admission with no pre-labour rows
  // yet — so the user lands in a usable form rather than a blocked screen.
  const labourReady = !labour.isLoading && !labour.error;
  const pregnancyReady = !pregnancy.isLoading && !pregnancy.error;
  useEffect(() => {
    if (!labourReady || !pregnancyReady) return;
    if (editing) return; // don't clobber the user's in-progress edits
    setDraft(rowsToDraft(pregnancy.data, labour.data));
    if (pregnancy.data === null && labour.data === null) {
      setEditing(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [labourReady, pregnancyReady, pregnancy.data, labour.data]);

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

  const hcode = userInfo?.hospcode ?? '';
  const pregnancyExists = pregnancy.data !== null;
  const labourExists = labour.data !== null;

  function startEdit() {
    setDraft(rowsToDraft(pregnancy.data, labour.data));
    setSaveError(null);
    setEditing(true);
  }

  function cancel() {
    setDraft(rowsToDraft(pregnancy.data, labour.data));
    setSaveError(null);
    setEditing(false);
  }

  async function save() {
    if (!config || !userInfo) return;
    setSaving(true);
    setSaveError(null);
    try {
      try {
        await upsertPregnancy(
          config,
          userInfo,
          an,
          {
            preg_number: toIntOrNull(draft.preg_number),
            anc_complete: toStrOrNull(draft.anc_complete),
            labor_date: toStrOrNull(draft.labor_date),
          },
          hcode,
          pregnancyExists,
        );
      } catch (e) {
        setSaveError(`บันทึก ipt_pregnancy ไม่สำเร็จ: ${(e as Error).message}`);
        return;
      }
      try {
        // Forward the surrogate PK on the update path — BMS REST endpoint is
        // /api/rest/ipt_labour/{ipt_labour_id}, not /{an}. Same constraint
        // StageTab handles. Without this, an existing-row save fails with
        // "upsertLabour: update path requires fields.ipt_labour_id".
        const labourFields: Partial<LabourRecord> & { ipt_labour_id?: number } = {
          g: toIntOrNull(draft.g),
          ga: toIntOrNull(draft.ga),
          anc_count: toIntOrNull(draft.anc_count),
          t: toIntOrNull(draft.t),
          p: toIntOrNull(draft.p),
          a: toIntOrNull(draft.a),
          l: toIntOrNull(draft.l),
          ga_day: toIntOrNull(draft.ga_day),
          preg_no: toIntOrNull(draft.preg_no),
          lmp: toStrOrNull(draft.lmp),
          edc: toStrOrNull(draft.edc),
          lmp_from_us: toStrOrNull(draft.lmp_from_us),
        };
        if (labourExists && labour.data?.ipt_labour_id !== undefined) {
          labourFields.ipt_labour_id = labour.data.ipt_labour_id;
        }
        await upsertLabour(
          config,
          userInfo,
          an,
          labourFields,
          hcode,
          labourExists,
        );
      } catch (e) {
        setSaveError(`บันทึก ipt_pregnancy สำเร็จ แต่ ipt_labour ไม่สำเร็จ: ${(e as Error).message}`);
        return;
      }
      await Promise.all([labour.mutate(), pregnancy.mutate()]);
      setEditing(false);
    } finally {
      setSaving(false);
    }
  }

  const noRowsYet = !pregnancyExists && !labourExists;

  return (
    <div className="space-y-4 p-4">
      {/* Title + action bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b-2 border-slate-900 pb-3">
        <div className="flex items-center gap-3">
          <span aria-hidden className="block h-1.5 w-8 bg-cyan-600" />
          <h2 className="text-[18px] font-bold tracking-tight text-slate-900">
            ข้อมูลก่อนคลอด
          </h2>
        </div>
        {!editing ? (
          <button
            type="button"
            onClick={startEdit}
            className="rounded-md border border-slate-300 bg-white px-4 py-2 text-[14px] font-semibold text-slate-700 transition-colors hover:border-cyan-400 hover:text-cyan-700"
          >
            แก้ไข
          </button>
        ) : (
          <div className="flex gap-2">
            <button
              type="button"
              onClick={cancel}
              disabled={saving}
              className="rounded-md border border-slate-300 bg-white px-4 py-2 text-[14px] font-semibold text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-40"
            >
              ยกเลิก
            </button>
            <button
              type="button"
              onClick={save}
              disabled={saving}
              className="rounded-md border-2 border-cyan-700 bg-cyan-700 px-6 py-2 text-[14px] font-bold text-white transition-colors hover:bg-cyan-800 disabled:opacity-40"
            >
              {saving ? 'กำลังบันทึก…' : 'บันทึก'}
            </button>
          </div>
        )}
      </div>

      {/* Empty-state banner when no rows exist yet — phrase "ไม่พบข้อมูล"
           is intentional: the existing tests + clinical Thai conventions
           expect that exact phrase, and pairing it with a call-to-action
           keeps the banner informative rather than a dead-end. */}
      {noRowsYet && editing && (
        <div className="rounded-lg border-2 border-cyan-200 bg-cyan-50 px-4 py-3 text-[13px] text-cyan-900">
          ไม่พบข้อมูลก่อนคลอดสำหรับ AN <span className="font-mono font-bold">{an}</span> — กรอกฟอร์มด้านล่างแล้วกด <strong>บันทึก</strong> เพื่อสร้างข้อมูลใหม่
        </div>
      )}

      {saveError && (
        <div role="alert" className="rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-[13px] font-semibold text-rose-700 shadow-sm">
          {saveError}
        </div>
      )}

      {/* GTPAL — gravida / term / pre-term / abortion / living */}
      <Section title="GTPAL" tone="gtpal" cols="grid-cols-2 sm:grid-cols-5">
        <Field label="G · ครรภ์" ariaLabel="labour_g" type="number" value={draft.g} onChange={(v) => setDraft((d) => ({ ...d, g: v }))} readOnly={!editing} />
        <Field label="T · Term" ariaLabel="labour_t" type="number" value={draft.t} onChange={(v) => setDraft((d) => ({ ...d, t: v }))} readOnly={!editing} />
        <Field label="P · Preterm" ariaLabel="labour_p" type="number" value={draft.p} onChange={(v) => setDraft((d) => ({ ...d, p: v }))} readOnly={!editing} />
        <Field label="A · Abortion" ariaLabel="labour_a" type="number" value={draft.a} onChange={(v) => setDraft((d) => ({ ...d, a: v }))} readOnly={!editing} />
        <Field label="L · Living" ariaLabel="labour_l" type="number" value={draft.l} onChange={(v) => setDraft((d) => ({ ...d, l: v }))} readOnly={!editing} />
      </Section>

      {/* Pregnancy data — ipt_pregnancy */}
      <Section title="Pregnancy · ipt_pregnancy" tone="pregnancy" cols="grid-cols-2 sm:grid-cols-3 lg:grid-cols-4">
        <Field label="ครรภ์ที่ (preg_no)" ariaLabel="preg_no" type="number" value={draft.preg_no} onChange={(v) => setDraft((d) => ({ ...d, preg_no: v }))} readOnly={!editing} hint="1–20" />
        <Field label="Preg # (legacy)" ariaLabel="preg_number" type="number" value={draft.preg_number} onChange={(v) => setDraft((d) => ({ ...d, preg_number: v }))} readOnly={!editing} />
        <Field label="ฝากครรภ์ครบ" ariaLabel="anc_complete" value={draft.anc_complete} onChange={(v) => setDraft((d) => ({ ...d, anc_complete: v }))} readOnly={!editing} options={ANC_COMPLETE_OPTIONS} />
        <Field label="วันคลอด" ariaLabel="labor_date" type="date" value={draft.labor_date} onChange={(v) => setDraft((d) => ({ ...d, labor_date: v }))} readOnly={!editing} />
      </Section>

      {/* Labour record — ipt_labour */}
      <Section title="Labour · ipt_labour" tone="labour" cols="grid-cols-2 sm:grid-cols-3 lg:grid-cols-4">
        <Field label="GA · สัปดาห์" ariaLabel="labour_ga" type="number" value={draft.ga} onChange={(v) => setDraft((d) => ({ ...d, ga: v }))} readOnly={!editing} hint="weeks" />
        <Field label="GA · วัน" ariaLabel="ga_day" type="number" value={draft.ga_day} onChange={(v) => setDraft((d) => ({ ...d, ga_day: v }))} readOnly={!editing} hint="0–6" />
        <Field label="LMP" ariaLabel="lmp" type="date" value={draft.lmp} onChange={(v) => setDraft((d) => ({ ...d, lmp: v }))} readOnly={!editing} hint="last menstrual period" />
        <Field label="EDC" ariaLabel="edc" type="date" value={draft.edc} onChange={(v) => setDraft((d) => ({ ...d, edc: v }))} readOnly={!editing} hint="expected delivery" />
        <Field label="EDC จาก U/S" ariaLabel="lmp_from_us" value={draft.lmp_from_us} onChange={(v) => setDraft((d) => ({ ...d, lmp_from_us: v }))} readOnly={!editing} options={YN_OPTIONS} />
        <Field label="จำนวนฝากครรภ์" ariaLabel="anc_count" type="number" value={draft.anc_count} onChange={(v) => setDraft((d) => ({ ...d, anc_count: v }))} readOnly={!editing} hint="visits" />
        {/* Labour ID — system identifier; read-only system value, shown in
            display mode only since users never edit the PK directly. */}
        {labour.data?.ipt_labour_id != null && (
          <Field
            label="Labour ID"
            ariaLabel="ipt_labour_id"
            type="number"
            value={String(labour.data.ipt_labour_id)}
            readOnly
            hint="system"
          />
        )}
      </Section>
    </div>
  );
}
