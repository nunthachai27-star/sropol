// MedicationsTab — labour_medication CRUD with table + inline-edit row.
// Visual matches the v2 dialog design language; data + UX upgrades:
//   * Drug name autocomplete via PATIENT_LABOUR_MED_BY_AN ⨝ s_drugitems
//     (medication_name) plus inline DRUG_LOOKUP search.
//   * DrugUsagePicker — autocomplete over the `drugusage` master table
//     (mirrors HOSxPMedicationOrderFrameUnit R84-R86). Falls back to chip
//     presets + free-text typing.
//   * EditRow + the picker components live at module scope so React keeps
//     a stable component identity across parent re-renders — fixes the
//     prior remount bug where picking a drug blanked the search input.
'use client';

import { useEffect, useRef, useState } from 'react';
import useSWR from 'swr';
import { useBmsSession } from '@/hooks/useBmsSession';
import {
  deleteLabourMedication,
  getPatientLabourMedications,
  searchDrugUsage,
  searchDrugs,
  upsertLabourMedication,
} from '@/services/maternity-ward';
import type { LabourMedRow } from '@/types/maternity-ward';
import type { ConnectionConfig } from '@/types/bms-browser';
import { cn } from '@/lib/utils';
import { ChipRow as DraggableChipRow, type ChipOption } from '../shared/DraggableChips';
import { AnchoredDropdown } from '../shared/AnchoredDropdown';

// ─── Types & helpers ──────────────────────────────────────────────────────

type EditState = {
  labour_medication_id?: number;
  icode: string;
  qty: string;
  drugusage: string;
  medication_note_text: string;
};

const EMPTY_DRAFT: EditState = {
  icode: '',
  qty: '',
  drugusage: '',
  medication_note_text: '',
};

function toNumberOrNull(v: string): number | null {
  if (v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// (Removed DRUGUSAGE_PRESETS: previous hardcoded chip values were Thai
// description strings like '1x3 oral' / 'PRN' — but `labour_medication.drugusage`
// is a varchar(7) FK to drugusage.drugusage (the CODE, e.g. '1703' or 'P11').
// Committing a description corrupted real rows: a saved value of '13pt(1 เม'
// in the field on this BMS proves the bug. The drugusage lookup picker is now
// the only source of truth — it commits the code while displaying the
// shortlist for human readability.)
// Numeric qty chips support click-and-drag micro-adjust (±1 per 8px) —
// nurses tap a preset then drag to fine-tune (e.g., 5 → 7) without retyping.
const QTY_CHIPS: ChipOption[] = [
  { value: '1', label: '1' },
  { value: '2', label: '2' },
  { value: '3', label: '3' },
  { value: '5', label: '5' },
  { value: '10', label: '10' },
];

// ─── Generic LookupPicker — used for both drug + drugusage ───────────────
// Module-scope component so React preserves its instance + local query
// state across parent re-renders.

interface LookupItem {
  primary: string; // visible label (drug full name / shortlist)
  secondary: string; // small caption (icode / drugusage code)
  payload: string; // value committed via onPick (icode / shortlist)
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

interface InlineInputProps {
  ariaLabel: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: 'text' | 'number';
}
function InlineInput({ ariaLabel, value, onChange, placeholder, type = 'text' }: InlineInputProps) {
  return (
    <input
      type={type === 'number' ? 'text' : type}
      inputMode={type === 'number' ? 'numeric' : undefined}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      aria-label={ariaLabel}
      className={cn(
        'h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-[14px] text-slate-900 shadow-sm transition-colors hover:border-slate-300 focus:border-cyan-500 focus:outline-none focus:ring-2 focus:ring-cyan-500/20',
        type === 'number' && 'font-semibold tabular-nums',
      )}
    />
  );
}

// ─── EditRow — module-scope so React preserves the picker instances across
// parent re-renders. Receives all needed state via props.

interface EditRowProps {
  config: ConnectionConfig;
  draft: EditState;
  setDraft: React.Dispatch<React.SetStateAction<EditState>>;
  initialDrugLabel: string;
  initialDrugUsage: string;
  saving: boolean;
  onCancel: () => void;
  onSave: () => void;
}

function EditRow({
  config,
  draft,
  setDraft,
  initialDrugLabel,
  initialDrugUsage,
  saving,
  onCancel,
  onSave,
}: EditRowProps) {
  return (
    <tr className="bg-cyan-50/40">
      <td colSpan={5} className="px-4 py-4">
        <div className="space-y-4">
          {/* DRUG SECTION */}
          <div className="rounded-md border border-cyan-200 bg-white p-3">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-[2fr_1fr]">
              <div className="flex flex-col gap-1">
                <label className="text-[12px] font-semibold text-slate-700">
                  ค้นหายา · Drug name
                </label>
                <LookupPicker
                  ariaLabel="drug_search"
                  placeholder="พิมพ์ชื่อยา เช่น Pethi…"
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

          {/* QTY + USAGE + NOTE */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-[0.6fr_2fr_1.4fr]">
            {/* qty with draggable chip presets — tap to set, drag to micro-adjust */}
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

            {/* drugusage — search by description, store the code.
                The picker shows shortlist (description) as the visible primary
                + drugusage code as the small secondary. Picking commits the
                CODE to draft.drugusage; the displayed text in the search box
                shows the description for the nurse's confirmation. */}
            <div className="flex flex-col gap-1.5">
              <label className="text-[12px] font-semibold text-slate-700">วิธีใช้</label>
              <LookupPicker
                ariaLabel="drugusage_search"
                placeholder="ค้นหาวิธีใช้ — พิมพ์คำอธิบายหรือรหัส…"
                initialQuery={initialDrugUsage}
                fetch={async (q) => {
                  const rows = await searchDrugUsage(config, q);
                  return rows.map((r) => ({
                    primary: r.shortlist,
                    secondary: r.drugusage,
                    payload: r.drugusage,
                  }));
                }}
                onPick={(it) => setDraft((d) => ({ ...d, drugusage: it.payload }))}
              />
              <InlineInput
                ariaLabel="drugusage"
                value={draft.drugusage}
                onChange={(v) => setDraft((d) => ({ ...d, drugusage: v }))}
                placeholder="รหัส drugusage (เช่น 1703)"
              />
              <div className="text-[11px] text-slate-500">
                บันทึก: รหัสจาก dropdown — ไม่ใช่คำอธิบาย
              </div>
            </div>

            {/* note */}
            <div className="flex flex-col gap-1.5">
              <label className="text-[12px] font-semibold text-slate-700">หมายเหตุ</label>
              <div className="h-7" aria-hidden />
              <div className="h-10" aria-hidden />
              <InlineInput
                ariaLabel="medication_note_text"
                value={draft.medication_note_text}
                onChange={(v) => setDraft((d) => ({ ...d, medication_note_text: v }))}
                placeholder="เช่น ก่อนอาหาร"
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

export function MedicationsTab({ an }: { an: string }) {
  const { config, userInfo } = useBmsSession();
  const { data, error, isLoading, mutate } = useSWR<LabourMedRow[]>(
    config ? ['labour-meds', config.apiUrl, an] : null,
    () => getPatientLabourMedications(config!, an),
  );

  const [editingId, setEditingId] = useState<number | 'new' | null>(null);
  const [draft, setDraft] = useState<EditState>(EMPTY_DRAFT);
  const [initialDrugLabel, setInitialDrugLabel] = useState('');
  const [initialDrugUsage, setInitialDrugUsage] = useState('');
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
    setEditingId('new');
    setDraft(EMPTY_DRAFT);
    setInitialDrugLabel('');
    setInitialDrugUsage('');
  }
  function startEdit(row: LabourMedRow) {
    setEditingId(row.labour_medication_id);
    setDraft({
      labour_medication_id: row.labour_medication_id,
      icode: row.icode ?? '',
      qty: row.qty?.toString() ?? '',
      drugusage: row.drugusage ?? '',
      medication_note_text: row.medication_note_text ?? '',
    });
    setInitialDrugLabel(row.medication_name ?? '');
    // Seed the picker with the description (drugusage_text) for human
    // readability; the underlying field stores the code (drugusage). When the
    // legacy data has a corrupted code (description string accidentally
    // written into the column), drugusage_text will be null — fall back to
    // the raw code so the user at least sees what's stored and can fix it.
    setInitialDrugUsage(row.drugusage_text ?? row.drugusage ?? '');
  }
  function cancel() {
    setEditingId(null);
    setDraft(EMPTY_DRAFT);
  }
  async function save() {
    if (!config || !userInfo) return;
    // labour_medication.icode is NOT NULL in HOSxP. An empty drug picker
    // would slip through as '' on the insert and create an unresolvable row.
    if (!draft.icode || draft.icode.trim() === '') {
      setSaveError('กรุณาเลือกยาก่อนบันทึก');
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      const payload: Partial<LabourMedRow> = {
        icode: draft.icode,
        qty: toNumberOrNull(draft.qty),
        drugusage: draft.drugusage || null,
        medication_note_text: draft.medication_note_text || null,
      };
      if (typeof draft.labour_medication_id === 'number') {
        payload.labour_medication_id = draft.labour_medication_id;
      }
      try {
        await upsertLabourMedication(config, userInfo, an, payload, hcode);
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
      await deleteLabourMedication(config, userInfo, id, hcode);
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
          <h2 className="text-[18px] font-bold tracking-tight text-slate-900">บันทึกการให้ยา</h2>
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
            กดปุ่ม <strong>+ เพิ่มรายการยา</strong> ด้านบนเพื่อบันทึกยาใหม่
          </div>
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg bg-white shadow-sm ring-1 ring-slate-200">
          <table className="w-full text-[14px]">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-left text-[12px] font-bold uppercase tracking-wide text-slate-600">
                <th className="px-4 py-3">ยา</th>
                <th className="px-4 py-3 text-right">จำนวน</th>
                <th className="px-4 py-3">วิธีใช้</th>
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
                  initialDrugUsage={initialDrugUsage}
                  saving={saving}
                  onCancel={cancel}
                  onSave={save}
                />
              )}
              {rows.map((row) =>
                editingId === row.labour_medication_id ? (
                  <EditRow
                    key={`edit-${row.labour_medication_id}`}
                    config={config}
                    draft={draft}
                    setDraft={setDraft}
                    initialDrugLabel={initialDrugLabel}
                    initialDrugUsage={initialDrugUsage}
                    saving={saving}
                    onCancel={cancel}
                    onSave={save}
                  />
                ) : (
                  <tr
                    key={row.labour_medication_id}
                    className="border-b border-slate-100 last:border-b-0 hover:bg-slate-50/50"
                  >
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
                    <td className="px-4 py-3 text-right font-semibold tabular-nums text-slate-900">
                      {row.qty ?? '—'}
                    </td>
                    <td className="px-4 py-3 text-slate-700">
                      {row.drugusage_text ? (
                        <div className="flex flex-col gap-0.5">
                          <span>{row.drugusage_text}</span>
                          <span className="font-mono text-[11px] text-slate-500">
                            {row.drugusage}
                          </span>
                        </div>
                      ) : row.drugusage ? (
                        <span className="font-mono">{row.drugusage}</span>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="px-4 py-3 text-slate-700">{row.medication_note_text ?? '—'}</td>
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
                          onClick={() => remove(row.labour_medication_id)}
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
