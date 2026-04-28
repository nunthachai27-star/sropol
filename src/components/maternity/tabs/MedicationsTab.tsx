// MedicationsTab — labour_medication CRUD with table + inline-edit row.
// Visual matches the v2 dialog design language (Section primitive, large
// readable typography, cyan-700 brand button, slate-200 borders) so the tab
// stops looking like a different app from the rest of the kiosk.
//
// Data improvement: PATIENT_LABOUR_MED_BY_AN now LEFT JOINs s_drugitems to
// surface a human-readable drug name (`medication_name`) next to the raw
// icode. The list shows the name as the primary identifier; icode lives as
// a small mono caption beneath it.
//
// Tests preserved: existing aria-labels (icode, qty, drugusage,
// medication_note_text), button names (เพิ่มรายการยา / แก้ไข / บันทึก /
// ยกเลิก / ลบ), empty-state phrase (ไม่พบข้อมูล), and getByText for icode /
// drugusage / note are all kept.
'use client';

import { useEffect, useRef, useState } from 'react';
import useSWR from 'swr';
import { useBmsSession } from '@/hooks/useBmsSession';
import {
  deleteLabourMedication,
  getPatientLabourMedications,
  searchDrugs,
  upsertLabourMedication,
} from '@/services/maternity-ward';
import type { LabourMedRow } from '@/types/maternity-ward';
import type { ConnectionConfig } from '@/types/bms-browser';
import { cn } from '@/lib/utils';

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

// ─── Drug picker — debounced autocomplete over s_drugitems ───────────────
// Mirrors the Delphi medication-search dialog (R81/R92-R99 in
// HOSxPMedicationOrderFrameUnit). User types a drug name fragment; after
// 300 ms of idle, searchDrugs() runs the LIKE query and the dropdown
// surfaces up to 50 matches. Click a result to populate the row's icode
// (visible in the dedicated icode input below the picker, which keeps the
// existing tests' getByLabelText('icode') queryable).

interface DrugSuggestion {
  icode: string;
  label: string;
}

function DrugPicker({
  config,
  selectedLabel,
  onPick,
}: {
  config: ConnectionConfig;
  /** Label to display in the search box on first render — usually the
   *  joined medication_name from the row being edited. Empty for "new". */
  selectedLabel: string;
  onPick: (s: DrugSuggestion) => void;
}) {
  const [query, setQuery] = useState(selectedLabel);
  const [suggestions, setSuggestions] = useState<DrugSuggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Debounce: schedule a search 300 ms after the last keystroke. Re-typing
  // resets the timer. Skip when the input matches the last-picked label
  // (avoids re-querying when the user just selected a result).
  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length === 0 || trimmed === selectedLabel) {
      setSuggestions([]);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      setLoading(true);
      searchDrugs(config, trimmed)
        .then((rows) => {
          if (!cancelled) setSuggestions(rows);
        })
        .catch(() => {
          if (!cancelled) setSuggestions([]);
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, selectedLabel, config]);

  // Close dropdown on outside click
  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  return (
    <div ref={containerRef} className="relative">
      <input
        type="text"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        placeholder="พิมพ์ชื่อยา เช่น Pethi…"
        aria-label="drug_search"
        className="h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-[14px] text-slate-900 shadow-sm transition-colors hover:border-slate-300 focus:border-cyan-500 focus:outline-none focus:ring-2 focus:ring-cyan-500/20"
      />
      {open && (suggestions.length > 0 || loading) && (
        <div className="absolute left-0 right-0 top-full z-10 mt-1 max-h-72 overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-lg">
          {loading && suggestions.length === 0 && (
            <div className="px-3 py-2 text-[12px] text-slate-500">กำลังค้นหา…</div>
          )}
          {suggestions.map((s) => (
            <button
              key={s.icode}
              type="button"
              onClick={() => {
                onPick(s);
                setQuery(s.label);
                setOpen(false);
                setSuggestions([]);
              }}
              className="flex w-full flex-col gap-0.5 border-b border-slate-100 px-3 py-2 text-left transition-colors last:border-b-0 hover:bg-cyan-50/60"
            >
              <span className="text-[14px] font-semibold text-slate-900">{s.label}</span>
              <span className="font-mono text-[11px] text-slate-500">{s.icode}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// Common drug-usage strings — Thai LR practice. Tap to set; the field stays
// fully editable for one-off cases (the chip is just an accelerator).
const DRUGUSAGE_PRESETS = [
  '1x1 oral', '1x2 oral', '1x3 oral', '1x4 oral',
  'PRN', 'stat', 'IV bolus', 'IM',
];
const QTY_PRESETS = ['1', '2', '3', '5', '10'];

function ChipRow({
  options,
  selected,
  onPick,
  ariaLabel,
}: {
  options: readonly string[];
  selected: string;
  onPick: (v: string) => void;
  ariaLabel: string;
}) {
  return (
    <div className="flex flex-wrap gap-1.5" role="group" aria-label={ariaLabel}>
      {options.map((opt) => {
        const isSelected = selected === opt;
        return (
          <button
            key={opt}
            type="button"
            onClick={() => onPick(opt)}
            className={cn(
              'rounded-md border px-2.5 py-1 text-[12px] font-semibold transition-all',
              isSelected
                ? 'border-cyan-600 bg-cyan-600 text-white shadow-sm ring-2 ring-cyan-600/20'
                : 'border-slate-200 bg-white text-slate-700 hover:border-cyan-400 hover:bg-cyan-50/60 hover:text-cyan-700',
            )}
          >
            {opt}
          </button>
        );
      })}
    </div>
  );
}

// ─── shared inputs ─────────────────────────────────────────────────────────

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

// ─── Main ──────────────────────────────────────────────────────────────────

export function MedicationsTab({ an }: { an: string }) {
  const { config, userInfo } = useBmsSession();
  const { data, error, isLoading, mutate } = useSWR<LabourMedRow[]>(
    config ? ['labour-meds', config.apiUrl, an] : null,
    () => getPatientLabourMedications(config!, an),
  );

  const [editingId, setEditingId] = useState<number | 'new' | null>(null);
  const [draft, setDraft] = useState<EditState>(EMPTY_DRAFT);
  const [saving, setSaving] = useState(false);

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
  }
  function cancel() {
    setEditingId(null);
    setDraft(EMPTY_DRAFT);
  }
  async function save() {
    if (!config || !userInfo) return;
    setSaving(true);
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
      await upsertLabourMedication(config, userInfo, an, payload, hcode);
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

  // Inline edit row — used for both new add and existing edit. Spans the
  // full table width via colSpan so the form stays inline rather than
  // breaking out into a modal.
  function EditRow({ keyPrefix, initialDrugLabel }: { keyPrefix: string; initialDrugLabel: string }) {
    return (
      <tr className="bg-cyan-50/40">
        <td colSpan={5} className="px-4 py-4">
          <div className="space-y-4">
            {/* DRUG SECTION — name search + icode display */}
            <div className="rounded-md border border-cyan-200 bg-white p-3">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-[2fr_1fr]">
                <div className="flex flex-col gap-1">
                  <label className="text-[12px] font-semibold text-slate-700">
                    ค้นหายา · Drug name
                  </label>
                  <DrugPicker
                    config={config!}
                    selectedLabel={initialDrugLabel}
                    onPick={(s) => setDraft((d) => ({ ...d, icode: s.icode }))}
                  />
                  <div className="text-[11px] text-slate-500">
                    พิมพ์ชื่อยาบางส่วน — แตะเลือกจากผลค้นหา
                  </div>
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-[12px] font-semibold text-slate-700">
                    รหัสยา · icode
                  </label>
                  <InlineInput
                    ariaLabel="icode"
                    value={draft.icode}
                    onChange={(v) => setDraft((d) => ({ ...d, icode: v }))}
                    placeholder="ระบบเติมเอง"
                  />
                  <div className="text-[11px] text-slate-500">
                    เลือกจากผลค้นหา หรือพิมพ์เอง
                  </div>
                </div>
              </div>
            </div>

            {/* QTY + USAGE — chip presets above each input */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-[0.6fr_1.4fr_2fr]">
              <div className="flex flex-col gap-1.5">
                <label className="text-[12px] font-semibold text-slate-700">จำนวน</label>
                <ChipRow
                  ariaLabel="qty quick picks"
                  options={QTY_PRESETS}
                  selected={draft.qty}
                  onPick={(v) => setDraft((d) => ({ ...d, qty: v }))}
                />
                <InlineInput
                  ariaLabel="qty"
                  value={draft.qty}
                  onChange={(v) => setDraft((d) => ({ ...d, qty: v }))}
                  type="number"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-[12px] font-semibold text-slate-700">วิธีใช้</label>
                <ChipRow
                  ariaLabel="drugusage quick picks"
                  options={DRUGUSAGE_PRESETS}
                  selected={draft.drugusage}
                  onPick={(v) => setDraft((d) => ({ ...d, drugusage: v }))}
                />
                <InlineInput
                  ariaLabel="drugusage"
                  value={draft.drugusage}
                  onChange={(v) => setDraft((d) => ({ ...d, drugusage: v }))}
                  placeholder="เช่น 1x3 oral หรือพิมพ์เอง"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-[12px] font-semibold text-slate-700">หมายเหตุ</label>
                {/* Spacer to align the input with the two chip-ed columns */}
                <div className="h-7" aria-hidden />
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
                onClick={cancel}
                disabled={saving}
                className="rounded-md border border-slate-300 bg-white px-4 py-2 text-[13px] font-semibold text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-40"
              >
                ยกเลิก
              </button>
              <button
                type="button"
                onClick={save}
                disabled={saving || !draft.icode.trim()}
                className="rounded-md border-2 border-cyan-700 bg-cyan-700 px-5 py-2 text-[13px] font-bold text-white transition-colors hover:bg-cyan-800 disabled:opacity-40"
                title={!draft.icode.trim() ? 'ต้องเลือกยาก่อน' : undefined}
              >
                {saving ? 'กำลังบันทึก…' : 'บันทึก'}
              </button>
            </div>
            <span data-key={keyPrefix} className="hidden" />
          </div>
        </td>
      </tr>
    );
  }

  return (
    <div className="space-y-4 p-4">
      {/* Title + add button */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b-2 border-slate-900 pb-3">
        <div className="flex items-center gap-3">
          <span aria-hidden className="block h-1.5 w-8 bg-cyan-600" />
          <h2 className="text-[18px] font-bold tracking-tight text-slate-900">
            บันทึกการให้ยา
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
              {editingId === 'new' && <EditRow keyPrefix="new" initialDrugLabel="" />}
              {rows.map((row) =>
                editingId === row.labour_medication_id ? (
                  <EditRow
                    key={`edit-${row.labour_medication_id}`}
                    keyPrefix={`edit-${row.labour_medication_id}`}
                    initialDrugLabel={row.medication_name ?? ''}
                  />
                ) : (
                  <tr
                    key={row.labour_medication_id}
                    className="border-b border-slate-100 last:border-b-0 hover:bg-slate-50/50"
                  >
                    {/* Drug — name primary, icode secondary; if name JOIN
                        returned null we still show icode as text so the
                        existing getByText('D0001') test keeps passing. */}
                    <td className="px-4 py-3">
                      <div className="flex flex-col gap-0.5">
                        {row.medication_name ? (
                          <>
                            <span className="font-semibold text-slate-900">{row.medication_name}</span>
                            <span className="font-mono text-[11px] text-slate-500">{row.icode}</span>
                          </>
                        ) : (
                          <span className="font-mono font-semibold text-slate-900">{row.icode}</span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right font-semibold tabular-nums text-slate-900">
                      {row.qty ?? '—'}
                    </td>
                    <td className="px-4 py-3 text-slate-700">{row.drugusage ?? '—'}</td>
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
