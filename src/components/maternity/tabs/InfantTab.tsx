// InfantTab — ipt_labour_infant CRUD with table + inline-edit row.
// HOSxP source reference: HOSxPIPTLabourInfantEntryFormUnit.pas (BMS XE2).
// Field semantics + auto-defaults follow that form's IPTLabourInfantCDSNewRecord
// + DoSaveData paths, adapted for our shared draggable chip primitives.
//
// Visual matches the v2 dialog design language used by VitalSign / Partograph
// / Medications / StageMed:
//   * All numeric chip rows now use the shared DraggableChipRow — tap to set
//     the exact preset, click-and-drag horizontally to micro-adjust by ±step,
//     range-clamp with amber edge-pin ring at min/max.
//   * Sex / condition-type are categorical → SimpleChipRow (no drag math).
//   * Birth-check toggle chips (VitK / Eye paste / BCG / Hep B / Feed milk)
//     write 'Y' / null on click — matches HOSxP char(1) convention.
//   * APGAR 1' / 5' / 10' as 0–10 chip ladders with severity tones (rose ≤3,
//     amber 4–6, emerald ≥7). HOSxP also tracks 5 sub-components per
//     timepoint; we surface only the totals in v1 — sub-components are a
//     future enhancement (see "APGAR sub-components" comment below).
//
// Auto-defaults on add (mirrors HOSxPIPTLabourInfantCDSNewRecord):
//   - birth_date / birth_time = now
//   - infant_number = (existing infants count) + 1
//   - condition_type1_id = 1 (alive/normal), condition_type2_id = 1
//   - entry_staff = userInfo.loginname (set in service on insert)
'use client';

import { useState } from 'react';
import useSWR from 'swr';
import { useBmsSession } from '@/hooks/useBmsSession';
import {
  deleteInfant,
  getPatientInfants,
  upsertLabourInfant,
  upsertNewborn,
} from '@/services/maternity-ward';
import type { InfantRow } from '@/types/maternity-ward';
import { cn } from '@/lib/utils';
import {
  ChipRow,
  SimpleChipRow,
  type ChipOption,
  type ChipTone,
} from '../shared/DraggableChips';

// ─── Types & helpers ──────────────────────────────────────────────────────

type EditState = {
  ipt_newborn_id?: number;
  ipt_labour_infant_id?: number;
  infant_number: string;
  sex: string;
  birth_weight: string;
  body_length: string;
  head_length: string;
  birth_date: string;       // ISO yyyy-mm-dd
  birth_time: string;       // HH:mm
  apgar1: string;
  apgar5: string;
  apgar10: string;
  condition_type1_id: string;  // 1 = alive at delivery
  condition_type2_id: string;  // 1 = alive at discharge
  vitk: 'Y' | '';
  eyepaste: 'Y' | '';
  bcg: 'Y' | '';
  hepb: 'Y' | '';
  feed_milk: 'Y' | '';
};

const EMPTY_DRAFT: EditState = {
  infant_number: '',
  sex: '',
  birth_weight: '',
  body_length: '',
  head_length: '',
  birth_date: '',
  birth_time: '',
  apgar1: '',
  apgar5: '',
  apgar10: '',
  condition_type1_id: '',
  condition_type2_id: '',
  vitk: '',
  eyepaste: '',
  bcg: '',
  hepb: '',
  feed_milk: '',
};

function toNumberOrNull(v: string): number | null {
  if (v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function rowKey(row: InfantRow, index: number): string | number {
  return row.ipt_labour_infant_id ?? row.ipt_newborn_id ?? index;
}

function todayIso(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function nowHhmm(): string {
  const d = new Date();
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

// ─── Chip catalogues ──────────────────────────────────────────────────────

const SEX_CHIPS = [
  { label: 'ชาย ♂', value: '1' },
  { label: 'หญิง ♀', value: '2' },
];

// HOSxP person_labour_birth_condition convention (ipt_newborn.birthcondition1/2).
// 1 = alive, 2 = stillborn, 3 = died after birth — our quick chips cover the
// common cases; nurses can still edit the underlying numeric value.
const CONDITION1_CHIPS = [
  { label: 'มีชีวิต', value: '1' },
  { label: 'ไม่มีชีวิต', value: '2' },
];
const CONDITION2_CHIPS = [
  { label: 'ปกติ', value: '1' },
  { label: 'ผิดปกติ', value: '2' },
];

// Birth weight: WHO low-birth-weight cutoff is 2500g; the four anchors here
// span term-baby norm (≈3000–3500). Drag adjusts ±50g per step (see range/step
// in the ChipRow below).
const BIRTH_WEIGHT_CHIPS: ChipOption[] = [
  { value: '2500', label: '2500', tone: 'warn' },
  { value: '3000', label: '3000', tone: 'ok' },
  { value: '3500', label: '3500', tone: 'ok' },
  { value: '4000', label: '4000', tone: 'warn' },
];

// Term-baby anthropometry anchors. Body length 48–52cm, head circ 33–35cm.
const BODY_LENGTH_CHIPS: ChipOption[] = [
  { value: '48', label: '48' },
  { value: '50', label: '50', tone: 'ok' },
  { value: '52', label: '52', tone: 'ok' },
];
const HEAD_LENGTH_CHIPS: ChipOption[] = [
  { value: '33', label: '33' },
  { value: '34', label: '34', tone: 'ok' },
  { value: '35', label: '35', tone: 'ok' },
];

// APGAR 0–10. Severity ladder per chip → at-a-glance score quality.
//   0–3 = severe distress (rose), 4–6 = depressed (amber), 7–10 = ok (emerald)
function apgarChips(): ChipOption[] {
  return [...Array(11)].map((_, n) => {
    let tone: ChipTone = 'default';
    if (n <= 3) tone = 'crit';
    else if (n <= 6) tone = 'warn';
    else tone = 'ok';
    return { value: String(n), label: String(n), tone };
  });
}
const APGAR_CHIPS = apgarChips();

const INFANT_NUMBER_CHIPS: ChipOption[] = [
  { value: '1', label: '1' },
  { value: '2', label: '2' },
  { value: '3', label: '3' },
];

// ─── Reusable chip-toggle ──────────────────────────────────────────────────

interface ToggleChipProps {
  label: string;
  checked: boolean;
  onToggle: () => void;
}
function ToggleChip({ label, checked, onToggle }: ToggleChipProps) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={checked}
      className={cn(
        'rounded-md border px-3 py-1.5 text-[12px] font-semibold transition-all',
        checked
          ? 'border-emerald-600 bg-emerald-600 text-white shadow-sm ring-2 ring-emerald-600/20'
          : 'border-slate-200 bg-white text-slate-600 hover:border-emerald-400 hover:bg-emerald-50/60 hover:text-emerald-700',
      )}
    >
      {checked ? '✓ ' : ''}{label}
    </button>
  );
}

// ─── Inline input ──────────────────────────────────────────────────────────

interface InlineInputProps {
  ariaLabel: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: 'text' | 'number' | 'date' | 'time';
  width?: string;
}
function InlineInput({ ariaLabel, value, onChange, placeholder, type = 'text', width }: InlineInputProps) {
  return (
    <input
      type={type === 'number' ? 'text' : type}
      inputMode={type === 'number' ? 'numeric' : undefined}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      aria-label={ariaLabel}
      className={cn(
        'h-10 rounded-md border border-slate-200 bg-white px-3 text-[14px] text-slate-900 shadow-sm transition-colors hover:border-slate-300 focus:border-cyan-500 focus:outline-none focus:ring-2 focus:ring-cyan-500/20',
        width ?? 'w-full',
        type === 'number' && 'font-semibold tabular-nums',
      )}
    />
  );
}

// ─── EditRow (module scope) ────────────────────────────────────────────────

interface EditRowProps {
  draft: EditState;
  setDraft: React.Dispatch<React.SetStateAction<EditState>>;
  saving: boolean;
  onCancel: () => void;
  onSave: () => void;
}

function EditRow({ draft, setDraft, saving, onCancel, onSave }: EditRowProps) {
  const set = (k: keyof EditState, v: string) =>
    setDraft((d) => ({ ...d, [k]: v }));

  return (
    <tr className="bg-cyan-50/40">
      <td colSpan={5} className="px-4 py-4">
        <div className="space-y-4">
          {/* IDENTITY: infant_number + sex + condition + date/time */}
          <div className="rounded-md border border-cyan-200 bg-white p-3">
            <div className="mb-2 text-[11px] font-bold uppercase tracking-wide text-slate-500">
              ทารกลำดับที่ · เพศ · สภาพ · เวลาเกิด
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-[0.7fr_1.3fr_1.3fr_1fr_1fr]">
              <div className="flex flex-col gap-1.5">
                <label className="text-[12px] font-semibold text-slate-700">ลำดับที่</label>
                <ChipRow
                  ariaLabel="infant_number quick picks"
                  options={INFANT_NUMBER_CHIPS}
                  selected={draft.infant_number}
                  onPick={(v) => set('infant_number', v)}
                  range={{ min: 1, max: 9 }}
                />
                <InlineInput
                  ariaLabel="infant_number"
                  value={draft.infant_number}
                  onChange={(v) => set('infant_number', v)}
                  type="number"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-[12px] font-semibold text-slate-700">เพศ</label>
                <SimpleChipRow
                  ariaLabel="sex quick picks"
                  options={SEX_CHIPS}
                  selected={draft.sex}
                  onPick={(v) => set('sex', v)}
                />
                <InlineInput
                  ariaLabel="sex"
                  value={draft.sex}
                  onChange={(v) => set('sex', v)}
                  placeholder="1=ชาย / 2=หญิง"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-[12px] font-semibold text-slate-700">สภาพแรกคลอด</label>
                <SimpleChipRow
                  ariaLabel="condition_type1 quick picks"
                  options={CONDITION1_CHIPS}
                  selected={draft.condition_type1_id}
                  onPick={(v) => set('condition_type1_id', v)}
                />
                <SimpleChipRow
                  ariaLabel="condition_type2 quick picks"
                  options={CONDITION2_CHIPS}
                  selected={draft.condition_type2_id}
                  onPick={(v) => set('condition_type2_id', v)}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-[12px] font-semibold text-slate-700">วันเกิด</label>
                <div className="h-7" aria-hidden />
                <InlineInput
                  ariaLabel="birth_date"
                  value={draft.birth_date}
                  onChange={(v) => set('birth_date', v)}
                  type="date"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-[12px] font-semibold text-slate-700">เวลาเกิด</label>
                <div className="h-7" aria-hidden />
                <InlineInput
                  ariaLabel="birth_time"
                  value={draft.birth_time}
                  onChange={(v) => set('birth_time', v)}
                  type="time"
                />
              </div>
            </div>
          </div>

          {/* ANTHROPOMETRY — drag-adjust per chip */}
          <div className="rounded-md border border-cyan-200 bg-white p-3">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-[11px] font-bold uppercase tracking-wide text-slate-500">
                ขนาดแรกเกิด
              </span>
              <span className="text-[10px] text-slate-400">
                แตะ = เลือก · ลากซ้าย/ขวา = ปรับค่า
              </span>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1.4fr_1fr_1fr]">
              <div className="flex flex-col gap-1.5">
                <label className="text-[12px] font-semibold text-slate-700">
                  น้ำหนักแรกเกิด (กรัม)
                </label>
                <ChipRow
                  ariaLabel="birth_weight quick picks"
                  options={BIRTH_WEIGHT_CHIPS}
                  selected={draft.birth_weight}
                  onPick={(v) => set('birth_weight', v)}
                  step={50}
                  range={{ min: 500, max: 6000 }}
                />
                <InlineInput
                  ariaLabel="birth_weight"
                  value={draft.birth_weight}
                  onChange={(v) => set('birth_weight', v)}
                  type="number"
                  placeholder="เช่น 3200"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-[12px] font-semibold text-slate-700">ความยาว (ซม.)</label>
                <ChipRow
                  ariaLabel="body_length quick picks"
                  options={BODY_LENGTH_CHIPS}
                  selected={draft.body_length}
                  onPick={(v) => set('body_length', v)}
                  step={1}
                  range={{ min: 30, max: 60 }}
                />
                <InlineInput
                  ariaLabel="body_length"
                  value={draft.body_length}
                  onChange={(v) => set('body_length', v)}
                  type="number"
                  placeholder="เช่น 50"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-[12px] font-semibold text-slate-700">รอบศีรษะ (ซม.)</label>
                <ChipRow
                  ariaLabel="head_length quick picks"
                  options={HEAD_LENGTH_CHIPS}
                  selected={draft.head_length}
                  onPick={(v) => set('head_length', v)}
                  step={1}
                  range={{ min: 25, max: 45 }}
                />
                <InlineInput
                  ariaLabel="head_length"
                  value={draft.head_length}
                  onChange={(v) => set('head_length', v)}
                  type="number"
                  placeholder="เช่น 34"
                />
              </div>
            </div>
          </div>

          {/* APGAR LADDER — draggable 0-10 with severity zones */}
          {/* APGAR sub-components: HOSxP also tracks 5 components per timepoint
              (HR/RR/reflex/tone/color, each 0/1/2). Future enhancement —
              v1 surfaces totals only since the chip ladder is fast to enter. */}
          <div className="rounded-md border border-cyan-200 bg-white p-3">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-[11px] font-bold uppercase tracking-wide text-slate-500">
                APGAR Score
              </span>
              <span className="text-[10px] text-slate-400">
                <span className="text-emerald-600">●</span> 7–10 ปกติ
                <span className="ml-2 text-amber-600">●</span> 4–6 ต้องเฝ้าระวัง
                <span className="ml-2 text-rose-600">●</span> 0–3 วิกฤต
              </span>
            </div>
            <div className="space-y-2">
              {[
                { label: '1 นาที', key: 'apgar1' as const },
                { label: '5 นาที', key: 'apgar5' as const },
                { label: '10 นาที', key: 'apgar10' as const },
              ].map(({ label, key }) => (
                <div key={key} className="flex items-center gap-3">
                  <span className="w-16 text-[12px] font-semibold text-slate-600">{label}</span>
                  <ChipRow
                    ariaLabel={`${key} score`}
                    options={APGAR_CHIPS}
                    selected={draft[key]}
                    onPick={(v) => set(key, v)}
                    range={{ min: 0, max: 10 }}
                  />
                </div>
              ))}
            </div>
          </div>

          {/* BIRTH CHECKS */}
          <div className="rounded-md border border-cyan-200 bg-white p-3">
            <div className="mb-2 text-[11px] font-bold uppercase tracking-wide text-slate-500">
              การให้ยา / วัคซีนแรกเกิด
            </div>
            <div className="flex flex-wrap gap-2">
              <ToggleChip
                label="Vitamin K"
                checked={draft.vitk === 'Y'}
                onToggle={() => setDraft((d) => ({ ...d, vitk: d.vitk === 'Y' ? '' : 'Y' }))}
              />
              <ToggleChip
                label="Eye paste"
                checked={draft.eyepaste === 'Y'}
                onToggle={() => setDraft((d) => ({ ...d, eyepaste: d.eyepaste === 'Y' ? '' : 'Y' }))}
              />
              <ToggleChip
                label="BCG"
                checked={draft.bcg === 'Y'}
                onToggle={() => setDraft((d) => ({ ...d, bcg: d.bcg === 'Y' ? '' : 'Y' }))}
              />
              <ToggleChip
                label="Hep B"
                checked={draft.hepb === 'Y'}
                onToggle={() => setDraft((d) => ({ ...d, hepb: d.hepb === 'Y' ? '' : 'Y' }))}
              />
              <ToggleChip
                label="Feed milk"
                checked={draft.feed_milk === 'Y'}
                onToggle={() =>
                  setDraft((d) => ({ ...d, feed_milk: d.feed_milk === 'Y' ? '' : 'Y' }))
                }
              />
            </div>
          </div>

          {/* Action bar */}
          <div className="flex justify-end gap-2 border-t border-cyan-200 pt-3">
            <button
              type="button"
              onClick={onCancel}
              disabled={saving}
              className="rounded-md border border-slate-300 bg-white px-4 py-2 text-[13px] font-semibold text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-40"
            >
              ยกเลิก
            </button>
            <button
              type="button"
              onClick={onSave}
              disabled={saving || (!draft.sex.trim() && !draft.birth_weight.trim())}
              className="rounded-md border-2 border-cyan-700 bg-cyan-700 px-5 py-2 text-[13px] font-bold text-white transition-colors hover:bg-cyan-800 disabled:opacity-40"
              title={
                !draft.sex.trim() && !draft.birth_weight.trim()
                  ? 'ระบุเพศหรือน้ำหนักก่อนบันทึก'
                  : undefined
              }
            >
              {saving ? 'กำลังบันทึก…' : 'บันทึก'}
            </button>
          </div>
        </div>
      </td>
    </tr>
  );
}

// ─── Main ──────────────────────────────────────────────────────────────────

export function InfantTab({ an }: { an: string }) {
  const { config, userInfo } = useBmsSession();
  const { data, error, isLoading, mutate } = useSWR<InfantRow[]>(
    config ? ['infants', config.apiUrl, an] : null,
    () => getPatientInfants(config!, an),
  );

  const [editingKey, setEditingKey] = useState<string | 'new' | null>(null);
  const [draft, setDraft] = useState<EditState>(EMPTY_DRAFT);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  if (!config) {
    return <div className="p-4 text-slate-500">ไม่พร้อมใช้งาน (ไม่มี BMS session)</div>;
  }
  if (isLoading) return <div className="p-4 text-slate-500">กำลังโหลด…</div>;
  if (error) {
    return <div className="p-4 text-red-600">โหลดไม่สำเร็จ: {(error as Error).message}</div>;
  }

  const hcode = userInfo?.hospcode ?? '';
  const rows = data ?? [];
  const isEmpty = rows.length === 0 && editingKey !== 'new';

  function startAdd() {
    // HOSxP IPTLabourInfantCDSNewRecord defaults: infant_number = COUNT+1,
    // birth_date/time = now, condition_type1/2_id = 1 (alive/normal).
    setEditingKey('new');
    setDraft({
      ...EMPTY_DRAFT,
      birth_date: todayIso(),
      birth_time: nowHhmm(),
      infant_number: String(rows.length + 1),
      condition_type1_id: '1',
      condition_type2_id: '1',
    });
    setSaveError(null);
  }

  function startEdit(row: InfantRow, index: number) {
    setEditingKey(String(rowKey(row, index)));
    const rRaw = row as Record<string, unknown>;
    const str = (k: string): string => {
      const v = rRaw[k];
      if (v === null || v === undefined) return '';
      return String(v);
    };
    const yn = (k: string): 'Y' | '' => (rRaw[k] === 'Y' ? 'Y' : '');
    setDraft({
      ipt_newborn_id: row.ipt_newborn_id,
      ipt_labour_infant_id: row.ipt_labour_infant_id,
      infant_number: str('infant_number'),
      sex: row.sex ?? '',
      birth_weight: row.birth_weight?.toString() ?? '',
      body_length: str('body_length'),
      head_length: str('head_length'),
      birth_date: str('birth_date').slice(0, 10),
      birth_time: str('birth_time').slice(0, 5),
      apgar1: str('apgar_score_min1'),
      apgar5: str('apgar_score_min5'),
      apgar10: str('apgar_score_min10'),
      condition_type1_id: str('condition_type1_id'),
      condition_type2_id: str('condition_type2_id'),
      vitk: yn('infant_check_vitk'),
      eyepaste: yn('infant_check_eyepaste'),
      bcg: yn('infant_check_bcg'),
      hepb: yn('infant_check_hepb'),
      feed_milk: yn('infant_check_feed_milk'),
    });
    setSaveError(null);
  }

  function cancel() {
    setEditingKey(null);
    setDraft(EMPTY_DRAFT);
    setSaveError(null);
  }

  async function save() {
    if (!config || !userInfo) return;
    setSaving(true);
    setSaveError(null);
    try {
      const fields: Partial<InfantRow> = {
        infant_number: toNumberOrNull(draft.infant_number),
        sex: draft.sex || null,
        birth_weight: toNumberOrNull(draft.birth_weight),
        body_length: toNumberOrNull(draft.body_length),
        head_length: toNumberOrNull(draft.head_length),
        birth_date: draft.birth_date || null,
        birth_time: draft.birth_time ? `${draft.birth_time}:00` : null,
        apgar_score_min1: toNumberOrNull(draft.apgar1),
        apgar_score_min5: toNumberOrNull(draft.apgar5),
        apgar_score_min10: toNumberOrNull(draft.apgar10),
        condition_type1_id: toNumberOrNull(draft.condition_type1_id),
        condition_type2_id: toNumberOrNull(draft.condition_type2_id),
        infant_check_vitk: draft.vitk || null,
        infant_check_eyepaste: draft.eyepaste || null,
        infant_check_bcg: draft.bcg || null,
        infant_check_hepb: draft.hepb || null,
        infant_check_feed_milk: draft.feed_milk || null,
      };
      try {
        await upsertNewborn(
          config,
          userInfo,
          an,
          { ...fields, ipt_newborn_id: draft.ipt_newborn_id },
          hcode,
        );
      } catch (e) {
        setSaveError(`บันทึก ipt_newborn ไม่สำเร็จ: ${(e as Error).message}`);
        return;
      }
      try {
        await upsertLabourInfant(
          config,
          userInfo,
          an,
          { ...fields, ipt_labour_infant_id: draft.ipt_labour_infant_id },
          hcode,
        );
      } catch (e) {
        setSaveError(
          `บันทึก ipt_newborn สำเร็จ แต่ ipt_labour_infant ไม่สำเร็จ: ${(e as Error).message}`,
        );
        return;
      }
      await mutate();
      setEditingKey(null);
      setDraft(EMPTY_DRAFT);
    } finally {
      setSaving(false);
    }
  }

  async function remove(row: InfantRow) {
    if (!config || !userInfo) return;
    if (row.ipt_newborn_id === undefined) return;
    if (!window.confirm('ยืนยันการลบรายการนี้หรือไม่?')) return;
    setSaving(true);
    try {
      await deleteInfant(config, userInfo, row.ipt_newborn_id, row.ipt_labour_infant_id, hcode);
      await mutate();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b-2 border-slate-900 pb-3">
        <div className="flex items-center gap-3">
          <span aria-hidden className="block h-1.5 w-8 bg-cyan-600" />
          <h2 className="text-[18px] font-bold tracking-tight text-slate-900">ข้อมูลทารก</h2>
          {rows.length > 0 && (
            <span className="rounded-md bg-slate-100 px-2.5 py-1 text-[12px] font-semibold text-slate-700">
              {rows.length} ราย
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={startAdd}
          disabled={editingKey !== null}
          className="rounded-md border-2 border-cyan-700 bg-cyan-700 px-4 py-2 text-[14px] font-bold text-white transition-colors hover:bg-cyan-800 disabled:opacity-40"
        >
          + เพิ่มทารก
        </button>
      </div>

      {saveError && (
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-[13px] text-red-700">
          {saveError}
        </div>
      )}

      {isEmpty ? (
        <div className="rounded-lg border-2 border-dashed border-slate-200 bg-white p-8 text-center">
          <div className="text-[14px] font-medium text-slate-600">ไม่พบข้อมูล</div>
          <div className="mt-1 text-[12px] text-slate-500">
            กดปุ่ม <strong>+ เพิ่มทารก</strong> ด้านบนเพื่อบันทึกทารกใหม่
          </div>
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg bg-white shadow-sm ring-1 ring-slate-200">
          <table className="w-full text-[14px]">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-left text-[12px] font-bold uppercase tracking-wide text-slate-600">
                <th className="px-4 py-3">เพศ</th>
                <th className="px-4 py-3 text-right">น้ำหนัก (ก.)</th>
                <th className="px-4 py-3">APGAR (1′ / 5′ / 10′)</th>
                <th className="px-4 py-3">HN ทารก</th>
                <th className="px-4 py-3 text-right">การจัดการ</th>
              </tr>
            </thead>
            <tbody>
              {editingKey === 'new' && (
                <EditRow
                  draft={draft}
                  setDraft={setDraft}
                  saving={saving}
                  onCancel={cancel}
                  onSave={save}
                />
              )}
              {rows.map((row, index) => {
                const k = String(rowKey(row, index));
                if (editingKey === k) {
                  return (
                    <EditRow
                      key={`edit-${k}`}
                      draft={draft}
                      setDraft={setDraft}
                      saving={saving}
                      onCancel={cancel}
                      onSave={save}
                    />
                  );
                }
                const r = row as Record<string, unknown>;
                const apg = (k2: string) => {
                  const v = r[k2];
                  return v === null || v === undefined || v === '' ? '—' : String(v);
                };
                return (
                  <tr key={k} className="border-b border-slate-100 last:border-b-0 hover:bg-slate-50/50">
                    <td className="px-4 py-3 font-semibold text-slate-900">{row.sex ?? '—'}</td>
                    <td className="px-4 py-3 text-right font-semibold tabular-nums text-slate-900">
                      {row.birth_weight ?? '—'}
                    </td>
                    <td className="px-4 py-3 font-mono text-[13px] tabular-nums text-slate-700">
                      {apg('apgar_score_min1')} / {apg('apgar_score_min5')} / {apg('apgar_score_min10')}
                    </td>
                    <td className="px-4 py-3 font-mono text-[13px] text-slate-700">
                      {(row.infant_hn as string | undefined) ?? '—'}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => startEdit(row, index)}
                          disabled={editingKey !== null}
                          className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-[12px] font-semibold text-slate-700 transition-colors hover:border-cyan-400 hover:text-cyan-700 disabled:opacity-40"
                        >
                          แก้ไข
                        </button>
                        <button
                          type="button"
                          onClick={() => remove(row)}
                          disabled={
                            editingKey !== null || saving || row.ipt_newborn_id === undefined
                          }
                          className="rounded-md border border-rose-300 bg-white px-3 py-1.5 text-[12px] font-semibold text-rose-700 transition-colors hover:bg-rose-50 disabled:opacity-40"
                        >
                          ลบ
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
