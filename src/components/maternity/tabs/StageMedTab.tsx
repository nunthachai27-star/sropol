// StageMedTab — labour_stage_medication CRUD with table + inline-edit row.
// Mirrors the v2 design of MedicationsTab so the kiosk reads as one app:
//   * Drug-name autocomplete (LookupPicker over s_drugitems via searchDrugs).
//   * qty chip presets above a free-text input.
//   * Date + time pickers (medication_date / medication_time).
//   * Hoisted EditRow + module-scope helpers — fixes the same remount bug
//     the Medications tab originally had.
//   * v2 visual: cyan brand bar, slate-900 title rule, 18px bold title,
//     hoverable rows, dashed empty-state with CTA.
//
// Service notes:
//   * PATIENT_STAGE_MED_BY_AN was reduced to a single LEFT JOIN
//     (s_drugitems only) because BMS Validation rejected the second JOIN
//     (opduser) in this tunnel — the row's `staff` (loginname) is shown
//     directly when the joined name is absent.
//   * getPatientStageMedications sorts client-side by (medication_date,
//     medication_time) — BMS validator also rejects ORDER BY in this query.
'use client';

import { useEffect, useRef, useState } from 'react';
import useSWR from 'swr';
import { useBmsSession } from '@/hooks/useBmsSession';
import {
  deleteStageMedication,
  getPatientStageMedications,
  searchDrugs,
  upsertStageMedication,
} from '@/services/maternity-ward';
import type { StageMedRow } from '@/types/maternity-ward';
import type { ConnectionConfig } from '@/types/bms-browser';
import { cn } from '@/lib/utils';
import { BeDateInput, BeTimeInput } from '@/components/maternity/shared/BeDateTimeInputs';
import { ChipRow as DraggableChipRow, type ChipOption } from '../shared/DraggableChips';
import { AnchoredDropdown } from '../shared/AnchoredDropdown';

// ─── Types & helpers ──────────────────────────────────────────────────────

type EditState = {
  labour_stage_medication_id?: number;
  icode: string;
  med_number: string;
  qty: string;
  medication_date: string;
  medication_time: string;
  medication_note: string;
};

const EMPTY_DRAFT: EditState = {
  icode: '',
  med_number: '',
  qty: '',
  medication_date: '',
  medication_time: '',
  medication_note: '',
};

function toNumberOrNull(v: string): number | null {
  if (v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function todayLocal(): { date: string; time: string } {
  const d = new Date();
  const p = (n: number) => n.toString().padStart(2, '0');
  return {
    date: `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`,
    time: `${p(d.getHours())}:${p(d.getMinutes())}`,
  };
}

// Numeric qty chips support click-and-drag micro-adjust (±1 per 8px) —
// nurses tap a preset then drag to fine-tune (e.g., 5 → 7) without retyping.
const QTY_CHIPS: ChipOption[] = [
  { value: '1', label: '1' },
  { value: '2', label: '2' },
  { value: '3', label: '3' },
  { value: '5', label: '5' },
  { value: '10', label: '10' },
];

// ─── LookupPicker — same shape as Medications tab ─────────────────────────

interface LookupItem {
  primary: string;
  secondary: string;
  payload: string;
}

interface LookupPickerProps {
  ariaLabel: string;
  placeholder: string;
  initialQuery: string;
  fetch: (q: string) => Promise<LookupItem[]>;
  onPick: (item: LookupItem) => void;
}

// TODO(constitution-III): consolidate onto shared/LookupAutocomplete — see
// docs/superpowers/plans/2026-07-13-robustness-c-concurrency-ops-quality.md C7
function LookupPicker({ ariaLabel, placeholder, initialQuery, fetch, onPick }: LookupPickerProps) {
  const [query, setQuery] = useState(initialQuery);
  const [items, setItems] = useState<LookupItem[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [lastPicked, setLastPicked] = useState(initialQuery);

  // Derived visible list — search is "active" only when there's a trimmed
  // query that doesn't equal the last picked value; no effect-driven clear.
  const trimmed = query.trim();
  const searchActive = trimmed.length > 0 && trimmed !== lastPicked;
  const visibleItems = searchActive ? items : [];

  useEffect(() => {
    if (!searchActive) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      setLoading(true);
      fetch(trimmed)
        .then((rows) => {
          if (!cancelled) setItems(rows);
        })
        .catch(() => {
          if (!cancelled) setItems([]);
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [trimmed, searchActive, fetch]);

  return (
    <>
      <input
        ref={inputRef}
        type="text"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        placeholder={placeholder}
        aria-label={ariaLabel}
        className="h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-[14px] text-slate-900 shadow-sm transition-colors hover:border-slate-300 focus:border-cyan-500 focus:outline-none focus:ring-2 focus:ring-cyan-500/20"
      />
      <AnchoredDropdown
        open={open && (visibleItems.length > 0 || loading)}
        anchorRef={inputRef}
        onDismiss={() => setOpen(false)}
      >
        {loading && visibleItems.length === 0 && (
          <div className="px-3 py-2 text-[12px] text-slate-500">กำลังค้นหา…</div>
        )}
        {visibleItems.map((it, idx) => (
          <button
            key={`${it.payload}-${idx}`}
            type="button"
            onClick={() => {
              onPick(it);
              setLastPicked(it.primary);
              setQuery(it.primary);
              setOpen(false);
              setItems([]);
            }}
            className="flex w-full flex-col gap-0.5 border-b border-slate-100 px-3 py-2 text-left transition-colors last:border-b-0 hover:bg-cyan-50/60"
          >
            <span className="text-[14px] font-semibold text-slate-900">{it.primary}</span>
            {it.secondary && (
              <span className="font-mono text-[11px] text-slate-500">{it.secondary}</span>
            )}
          </button>
        ))}
      </AnchoredDropdown>
    </>
  );
}

// ─── Inline input ──────────────────────────────────────────────────────────
// Chip row primitives now live in shared/DraggableChips so qty chips support
// click-to-set + click-and-drag micro-adjust like the vital-sign editor.

interface InlineInputProps {
  ariaLabel: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: 'text' | 'number' | 'date' | 'time';
}
function InlineInput({ ariaLabel, value, onChange, placeholder, type = 'text' }: InlineInputProps) {
  const baseCls =
    'h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-[14px] text-slate-900 shadow-sm transition-colors hover:border-slate-300 focus:border-cyan-500 focus:outline-none focus:ring-2 focus:ring-cyan-500/20';
  if (type === 'date') {
    return (
      <BeDateInput aria-label={ariaLabel} value={value} onChange={onChange} className={baseCls} />
    );
  }
  if (type === 'time') {
    return (
      <BeTimeInput
        aria-label={ariaLabel}
        value={value}
        onChange={onChange}
        className={cn(baseCls, 'font-semibold tabular-nums')}
      />
    );
  }
  return (
    <input
      type={type === 'number' ? 'text' : type}
      inputMode={type === 'number' ? 'numeric' : undefined}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      aria-label={ariaLabel}
      className={cn(baseCls, type === 'number' && 'font-semibold tabular-nums')}
    />
  );
}

// ─── EditRow — module-scope so React preserves picker instances ──────────

interface EditRowProps {
  config: ConnectionConfig;
  draft: EditState;
  setDraft: React.Dispatch<React.SetStateAction<EditState>>;
  initialDrugLabel: string;
  saving: boolean;
  onCancel: () => void;
  onSave: () => void;
}

function EditRow({
  config,
  draft,
  setDraft,
  initialDrugLabel,
  saving,
  onCancel,
  onSave,
}: EditRowProps) {
  return (
    <tr className="bg-cyan-50/40">
      <td colSpan={6} className="px-4 py-4">
        <div className="space-y-4">
          {/* DRUG SECTION — name autocomplete + icode display */}
          <div className="rounded-md border border-cyan-200 bg-white p-3">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-[2fr_1fr]">
              <div className="flex flex-col gap-1">
                <label className="text-[12px] font-semibold text-slate-700">
                  ค้นหายา · Drug name
                </label>
                <LookupPicker
                  ariaLabel="drug_search"
                  placeholder="พิมพ์ชื่อยา เช่น Oxytocin…"
                  initialQuery={initialDrugLabel}
                  fetch={async (q) => {
                    const rows = await searchDrugs(config, q);
                    return rows.map((r) => ({
                      primary: r.label,
                      secondary: r.icode,
                      payload: r.icode,
                    }));
                  }}
                  onPick={(it) => setDraft((d) => ({ ...d, icode: it.payload }))}
                />
                <div className="text-[11px] text-slate-500">
                  พิมพ์ชื่อยาบางส่วน — แตะเลือกจากผลค้นหา
                </div>
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[12px] font-semibold text-slate-700">รหัสยา · icode</label>
                <InlineInput
                  ariaLabel="icode"
                  value={draft.icode}
                  onChange={(v) => setDraft((d) => ({ ...d, icode: v }))}
                  placeholder="ระบบเติมเอง"
                />
                <div className="text-[11px] text-slate-500">เลือกจากผลค้นหา หรือพิมพ์เอง</div>
              </div>
            </div>
          </div>

          {/* TIMING + QTY + SEQUENCE */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_0.8fr_0.8fr_1fr]">
            <div className="flex flex-col gap-1">
              <label className="text-[12px] font-semibold text-slate-700">วันที่</label>
              <InlineInput
                ariaLabel="medication_date"
                value={draft.medication_date}
                onChange={(v) => setDraft((d) => ({ ...d, medication_date: v }))}
                type="date"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[12px] font-semibold text-slate-700">เวลา</label>
              <InlineInput
                ariaLabel="medication_time"
                value={draft.medication_time}
                onChange={(v) => setDraft((d) => ({ ...d, medication_time: v }))}
                type="time"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-[12px] font-semibold text-slate-700">จำนวน</label>
              <DraggableChipRow
                ariaLabel="qty quick picks"
                options={QTY_CHIPS}
                selected={draft.qty}
                onPick={(v) => setDraft((d) => ({ ...d, qty: v }))}
                step={1}
                range={{ min: 1, max: 99 }}
              />
              <InlineInput
                ariaLabel="qty"
                value={draft.qty}
                onChange={(v) => setDraft((d) => ({ ...d, qty: v }))}
                type="number"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[12px] font-semibold text-slate-700">ลำดับ (med #)</label>
              <InlineInput
                ariaLabel="med_number"
                value={draft.med_number}
                onChange={(v) => setDraft((d) => ({ ...d, med_number: v }))}
                type="number"
                placeholder="1"
              />
            </div>
          </div>

          {/* NOTE */}
          <div className="flex flex-col gap-1">
            <label className="text-[12px] font-semibold text-slate-700">หมายเหตุ</label>
            <InlineInput
              ariaLabel="medication_note"
              value={draft.medication_note}
              onChange={(v) => setDraft((d) => ({ ...d, medication_note: v }))}
              placeholder="เช่น IV bolus, IM, oral"
            />
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
              disabled={saving || !draft.icode.trim()}
              className="rounded-md border-2 border-cyan-700 bg-cyan-700 px-5 py-2 text-[13px] font-bold text-white transition-colors hover:bg-cyan-800 disabled:opacity-40"
              title={!draft.icode.trim() ? 'ต้องเลือกยาก่อน' : undefined}
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

export function StageMedTab({ an }: { an: string }) {
  const { config, userInfo } = useBmsSession();
  const { data, error, isLoading, mutate } = useSWR<StageMedRow[]>(
    config ? ['stage-meds', config.apiUrl, an] : null,
    () => getPatientStageMedications(config!, an),
  );

  const [editingId, setEditingId] = useState<number | 'new' | null>(null);
  const [draft, setDraft] = useState<EditState>(EMPTY_DRAFT);
  const [initialDrugLabel, setInitialDrugLabel] = useState('');
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
  const isEmpty = rows.length === 0 && editingId !== 'new';

  function startAdd() {
    const now = todayLocal();
    setEditingId('new');
    setDraft({
      ...EMPTY_DRAFT,
      medication_date: now.date,
      medication_time: now.time,
    });
    setInitialDrugLabel('');
  }
  function startEdit(row: StageMedRow) {
    setEditingId(row.labour_stage_medication_id);
    setDraft({
      labour_stage_medication_id: row.labour_stage_medication_id,
      icode: row.icode ?? '',
      med_number: row.med_number?.toString() ?? '',
      qty: row.qty?.toString() ?? '',
      medication_date: row.medication_date ?? '',
      medication_time: (row.medication_time ?? '').slice(0, 5),
      medication_note: row.medication_note ?? '',
    });
    setInitialDrugLabel(row.medication_name ?? '');
  }
  function cancel() {
    setEditingId(null);
    setDraft(EMPTY_DRAFT);
  }
  async function save() {
    if (!config || !userInfo) return;
    // labour_stage_medication.icode is NOT NULL in HOSxP.
    if (!draft.icode || draft.icode.trim() === '') {
      setSaveError('กรุณาเลือกยาก่อนบันทึก');
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      const payload: Partial<StageMedRow> = {
        icode: draft.icode,
        med_number: toNumberOrNull(draft.med_number),
        qty: toNumberOrNull(draft.qty),
        medication_date: draft.medication_date || null,
        medication_time: draft.medication_time || null,
        medication_note: draft.medication_note || null,
      };
      if (typeof draft.labour_stage_medication_id === 'number') {
        payload.labour_stage_medication_id = draft.labour_stage_medication_id;
      }
      try {
        await upsertStageMedication(config, userInfo, an, payload, hcode);
      } catch (e) {
        setSaveError(`บันทึกไม่สำเร็จ: ${(e as Error).message}`);
        return;
      }
      await mutate();
      setEditingId(null);
      setDraft(EMPTY_DRAFT);
    } finally {
      setSaving(false);
    }
  }
  async function remove(id: number) {
    if (!config || !userInfo) return;
    if (!window.confirm('ยืนยันการลบรายการนี้หรือไม่?')) return;
    setSaving(true);
    try {
      await deleteStageMedication(config, userInfo, id, hcode);
      await mutate();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4 p-4">
      {/* Title + add button */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b-2 border-slate-900 pb-3">
        <div className="flex items-center gap-3">
          <span aria-hidden className="block h-1.5 w-8 bg-cyan-600" />
          <h2 className="text-[18px] font-bold tracking-tight text-slate-900">
            บันทึกการให้ยาในห้องคลอด
          </h2>
          {rows.length > 0 && (
            <span className="rounded-md bg-slate-100 px-2.5 py-1 text-[12px] font-semibold text-slate-700">
              {rows.length} รายการ
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={startAdd}
          disabled={editingId !== null}
          className="rounded-md border-2 border-cyan-700 bg-cyan-700 px-4 py-2 text-[14px] font-bold text-white transition-colors hover:bg-cyan-800 disabled:opacity-40"
        >
          + เพิ่มรายการยา
        </button>
      </div>

      {saveError && (
        <div
          role="alert"
          className="rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 font-mono text-[12px] font-semibold text-rose-700 shadow-sm"
        >
          {saveError}
        </div>
      )}

      {isEmpty ? (
        <div className="rounded-lg border-2 border-dashed border-slate-200 bg-white p-8 text-center">
          <div className="text-[14px] font-medium text-slate-600">ไม่พบข้อมูล</div>
          <div className="mt-1 text-[12px] text-slate-500">
            กดปุ่ม <strong>+ เพิ่มรายการยา</strong> ด้านบนเพื่อบันทึกยาที่ให้ในห้องคลอด
          </div>
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg bg-white shadow-sm ring-1 ring-slate-200">
          <table className="w-full text-[14px]">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-left text-[12px] font-bold uppercase tracking-wide text-slate-600">
                <th className="px-4 py-3">วันที่ · เวลา</th>
                <th className="px-4 py-3">ยา</th>
                <th className="px-4 py-3">ผู้บันทึก</th>
                <th className="px-4 py-3 text-right">จำนวน</th>
                <th className="px-4 py-3">หมายเหตุ</th>
                <th className="px-4 py-3 text-right">การจัดการ</th>
              </tr>
            </thead>
            <tbody>
              {editingId === 'new' && (
                <EditRow
                  config={config}
                  draft={draft}
                  setDraft={setDraft}
                  initialDrugLabel={initialDrugLabel}
                  saving={saving}
                  onCancel={cancel}
                  onSave={save}
                />
              )}
              {rows.map((row) =>
                editingId === row.labour_stage_medication_id ? (
                  <EditRow
                    key={`edit-${row.labour_stage_medication_id}`}
                    config={config}
                    draft={draft}
                    setDraft={setDraft}
                    initialDrugLabel={initialDrugLabel}
                    saving={saving}
                    onCancel={cancel}
                    onSave={save}
                  />
                ) : (
                  <tr
                    key={row.labour_stage_medication_id}
                    className="border-b border-slate-100 last:border-b-0 hover:bg-slate-50/50"
                  >
                    <td className="px-4 py-3">
                      <div className="flex flex-col gap-0.5">
                        <span className="font-mono font-semibold tabular-nums text-slate-900">
                          {row.medication_date ?? '—'}
                        </span>
                        <span className="font-mono text-[11px] tabular-nums text-slate-500">
                          {row.medication_time ?? '—'}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-col gap-0.5">
                        {row.medication_name ? (
                          <>
                            <span className="font-semibold text-slate-900">
                              {row.medication_name}
                            </span>
                            <span className="font-mono text-[11px] text-slate-500">
                              {row.icode}
                            </span>
                          </>
                        ) : (
                          <span className="font-mono font-semibold text-slate-900">
                            {row.icode}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-slate-700">
                      {row.staff_name ?? row.staff ?? '—'}
                    </td>
                    <td className="px-4 py-3 text-right font-semibold tabular-nums text-slate-900">
                      {row.qty ?? '—'}
                    </td>
                    <td className="px-4 py-3 text-slate-700">{row.medication_note ?? '—'}</td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => startEdit(row)}
                          disabled={editingId !== null}
                          className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-[12px] font-semibold text-slate-700 transition-colors hover:border-cyan-400 hover:text-cyan-700 disabled:opacity-40"
                        >
                          แก้ไข
                        </button>
                        <button
                          type="button"
                          onClick={() => remove(row.labour_stage_medication_id)}
                          disabled={editingId !== null || saving}
                          className="rounded-md border border-rose-300 bg-white px-3 py-1.5 text-[12px] font-semibold text-rose-700 transition-colors hover:bg-rose-50 disabled:opacity-40"
                        >
                          ลบ
                        </button>
                      </div>
                    </td>
                  </tr>
                ),
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
