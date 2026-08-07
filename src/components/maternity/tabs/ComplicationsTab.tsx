// ComplicationsTab — labour complication CRUD keyed by ipt_labour_id
// (resolved from getPatientLabour(an)).
//
// Bug fixed (2026-04-28): the query selected `lcl.name AS complication_name`
// but the live `labour_complication` table column is
// `labour_complication_name`. The SQL error caused the tab to render either
// empty or with a "โหลดไม่สำเร็จ" banner — fixed at the query layer.
//
// UX upgrades — match the Medications/DR Med tabs:
//   * v2 design language (cyan brand bar, slate-900 title rule, large
//     readable typography, hoisted EditRow).
//   * Complication-name dropdown sourced from labour_complication. Users
//     pick a known complication instead of typing the integer ID — the
//     picker writes labour_complication_id under the hood while showing
//     the Thai/English name in the input.
//   * Clearer empty-state when no ipt_labour record yet — explains why
//     Add is disabled and points at the Pre-labour / Stage tabs.
'use client';

import { useMemo, useRef, useState } from 'react';
import useSWR from 'swr';
import { useBmsSession } from '@/hooks/useBmsSession';
import {
  deleteComplication,
  getPatientComplications,
  getPatientLabour,
  listLabourComplications,
  upsertComplication,
} from '@/services/maternity-ward';
import type { ComplicationRow, LabourRecord } from '@/types/maternity-ward';
import type { ConnectionConfig } from '@/types/bms-browser';
import { AnchoredDropdown } from '../shared/AnchoredDropdown';

type EditState = {
  ipt_labour_complication_id?: number;
  labour_complication_id: string;
  complication_note: string;
  labour_stage_id: string;
};

const EMPTY_DRAFT: EditState = {
  labour_complication_id: '',
  complication_note: '',
  labour_stage_id: '',
};

function toNumberOrNull(v: string): number | null {
  if (v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

const STAGE_OPTIONS = [
  { value: '', label: '—' },
  { value: '1', label: '1 · ระยะที่ 1 (Latent / Active)' },
  { value: '2', label: '2 · ระยะที่ 2 (Pushing / Birth)' },
  { value: '3', label: '3 · ระยะที่ 3 (Placenta)' },
];

// ─── ComplicationPicker — name dropdown over labour_complication ─────────

interface ComplicationOption {
  labour_complication_id: number;
  name: string;
}

function ComplicationPicker({
  config,
  selectedId,
  onPick,
}: {
  config: ConnectionConfig;
  selectedId: string;
  onPick: (opt: ComplicationOption) => void;
}) {
  const { data: options } = useSWR<ComplicationOption[]>(
    config ? ['labour-complication-list', config.apiUrl] : null,
    () => listLabourComplications(config),
  );

  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Resolve the selected name from the option list whenever selectedId or
  // options change, so editing an existing row populates the search input
  // with the current complication's name.
  const selectedName = useMemo(() => {
    if (!selectedId || !options) return '';
    const sid = Number(selectedId);
    return options.find((o) => o.labour_complication_id === sid)?.name ?? '';
  }, [selectedId, options]);

  // Render-phase adjust (react.dev "you might not need an effect"): seed the
  // search input with the resolved name the first time it becomes available
  // for this selection, without clobbering subsequent user typing.
  const [seededFor, setSeededFor] = useState('');
  if (selectedName && selectedName !== seededFor && query === '') {
    setSeededFor(selectedName);
    setQuery(selectedName);
  }

  const filtered = useMemo(() => {
    if (!options) return [];
    const q = query.trim().toLowerCase();
    if (q === '' || q === selectedName.toLowerCase()) return options.slice(0, 50);
    return options.filter((o) => o.name.toLowerCase().includes(q)).slice(0, 50);
  }, [options, query, selectedName]);

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
        placeholder="พิมพ์เพื่อค้นหา หรือคลิกเลือก…"
        aria-label="complication_search"
        className="h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-[14px] text-slate-900 shadow-sm transition-colors hover:border-slate-300 focus:border-cyan-500 focus:outline-none focus:ring-2 focus:ring-cyan-500/20"
      />
      <AnchoredDropdown
        open={open && filtered.length > 0}
        anchorRef={inputRef}
        onDismiss={() => setOpen(false)}
      >
        {filtered.map((o) => (
          <button
            key={o.labour_complication_id}
            type="button"
            onClick={() => {
              onPick(o);
              setQuery(o.name);
              setOpen(false);
            }}
            className="flex w-full items-center justify-between gap-3 border-b border-slate-100 px-3 py-2 text-left transition-colors last:border-b-0 hover:bg-cyan-50/60"
          >
            <span className="text-[14px] font-semibold text-slate-900">{o.name}</span>
            <span className="font-mono text-[11px] text-slate-500">
              #{o.labour_complication_id}
            </span>
          </button>
        ))}
      </AnchoredDropdown>
    </>
  );
}

// ─── EditRow — module-scope ───────────────────────────────────────────────

interface EditRowProps {
  config: ConnectionConfig;
  draft: EditState;
  setDraft: React.Dispatch<React.SetStateAction<EditState>>;
  saving: boolean;
  onCancel: () => void;
  onSave: () => void;
}

function EditRow({ config, draft, setDraft, saving, onCancel, onSave }: EditRowProps) {
  return (
    <tr className="bg-cyan-50/40">
      <td colSpan={4} className="px-4 py-4">
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-[2fr_0.7fr_2fr]">
            <div className="flex flex-col gap-1">
              <label className="text-[12px] font-semibold text-slate-700">ภาวะแทรกซ้อน</label>
              <ComplicationPicker
                config={config}
                selectedId={draft.labour_complication_id}
                onPick={(opt) =>
                  setDraft((d) => ({
                    ...d,
                    labour_complication_id: String(opt.labour_complication_id),
                  }))
                }
              />
              {/* Hidden input so getByLabelText('labour_complication_id') still
                  resolves for the existing tests; also lets a power user enter
                  the integer ID directly when needed. */}
              <input
                type="text"
                aria-label="labour_complication_id"
                value={draft.labour_complication_id}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, labour_complication_id: e.target.value }))
                }
                placeholder="ID (เลือกจากรายการ หรือพิมพ์เอง)"
                className="h-9 w-full rounded-md border border-slate-200 bg-white px-3 font-mono text-[12px] text-slate-700 shadow-sm focus:border-cyan-500 focus:outline-none focus:ring-2 focus:ring-cyan-500/20"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[12px] font-semibold text-slate-700">ระยะ</label>
              <select
                aria-label="labour_stage_id"
                value={draft.labour_stage_id}
                onChange={(e) => setDraft((d) => ({ ...d, labour_stage_id: e.target.value }))}
                className="h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-[14px] text-slate-900 shadow-sm focus:border-cyan-500 focus:outline-none focus:ring-2 focus:ring-cyan-500/20"
              >
                {STAGE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[12px] font-semibold text-slate-700">หมายเหตุ</label>
              <input
                type="text"
                aria-label="complication_note"
                value={draft.complication_note}
                onChange={(e) => setDraft((d) => ({ ...d, complication_note: e.target.value }))}
                placeholder="รายละเอียดที่ต้องบันทึก"
                className="h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-[14px] text-slate-900 shadow-sm focus:border-cyan-500 focus:outline-none focus:ring-2 focus:ring-cyan-500/20"
              />
            </div>
          </div>
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
              disabled={saving || !draft.labour_complication_id.trim()}
              className="rounded-md border-2 border-cyan-700 bg-cyan-700 px-5 py-2 text-[13px] font-bold text-white transition-colors hover:bg-cyan-800 disabled:opacity-40"
              title={!draft.labour_complication_id.trim() ? 'ต้องเลือกภาวะแทรกซ้อนก่อน' : undefined}
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

export function ComplicationsTab({ an }: { an: string }) {
  const { config, userInfo } = useBmsSession();
  const labour = useSWR<LabourRecord | null>(config ? ['labour', config.apiUrl, an] : null, () =>
    getPatientLabour(config!, an),
  );
  // Use null/undefined check, NOT truthy: ipt_labour_id=0 is a real value
  // for legacy rows on the test hospital (sentinel-keyed admissions). The
  // earlier `!iptLabourId` falsy check disabled the Add button + skipped the
  // comps fetch for any AN whose labour row carried id=0 — surfaced by user
  // bug report on AN 000056222.
  const iptLabourId =
    labour.data?.ipt_labour_id !== undefined && labour.data?.ipt_labour_id !== null
      ? labour.data.ipt_labour_id
      : null;
  const hasLabour = iptLabourId !== null;
  const comps = useSWR<ComplicationRow[]>(
    config && hasLabour ? ['complications', config.apiUrl, iptLabourId] : null,
    () => getPatientComplications(config!, iptLabourId as number),
  );

  const [editingId, setEditingId] = useState<number | 'new' | null>(null);
  const [draft, setDraft] = useState<EditState>(EMPTY_DRAFT);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  if (!config) {
    return <div className="p-4 text-slate-500">ไม่พร้อมใช้งาน (ไม่มี BMS session)</div>;
  }
  if (labour.isLoading || (hasLabour && comps.isLoading)) {
    return <div className="p-4 text-slate-500">กำลังโหลด…</div>;
  }
  const err = labour.error ?? comps.error;
  if (err) {
    return <div className="p-4 text-red-600">โหลดไม่สำเร็จ: {(err as Error).message}</div>;
  }

  const hcode = userInfo?.hospcode ?? '';
  const rows = comps.data ?? [];
  const noLabour = !hasLabour;
  const isEmpty = (noLabour || rows.length === 0) && editingId !== 'new';

  function startAdd() {
    setEditingId('new');
    setDraft(EMPTY_DRAFT);
    setSaveError(null);
  }

  function startEdit(row: ComplicationRow) {
    setEditingId(row.ipt_labour_complication_id);
    setDraft({
      ipt_labour_complication_id: row.ipt_labour_complication_id,
      labour_complication_id: row.labour_complication_id?.toString() ?? '',
      complication_note: row.complication_note ?? '',
      labour_stage_id: row.labour_stage_id?.toString() ?? '',
    });
    setSaveError(null);
  }

  function cancel() {
    setEditingId(null);
    setDraft(EMPTY_DRAFT);
    setSaveError(null);
  }

  async function save() {
    if (!config || !userInfo) return;
    // Explicit null check — id=0 is valid on legacy sentinel labour rows.
    if (iptLabourId === null) {
      setSaveError(
        'ไม่พบข้อมูล ipt_labour สำหรับ AN นี้ — กรุณาสร้างข้อมูลที่แท็บ ก่อนคลอด หรือ Stage ก่อน',
      );
      return;
    }
    // ipt_labour_complication.labour_complication_id and labour_stage_id are
    // both NOT NULL in HOSxP. The picker can leave them blank, which would
    // surface as a 500 from the BMS tunnel — block here with an actionable
    // Thai message instead.
    const complicationId = toNumberOrNull(draft.labour_complication_id);
    const stageId = toNumberOrNull(draft.labour_stage_id);
    if (complicationId === null) {
      setSaveError('กรุณาเลือกภาวะแทรกซ้อนก่อนบันทึก');
      return;
    }
    if (stageId === null) {
      setSaveError('กรุณาเลือกระยะ (Stage) ก่อนบันทึก');
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      const payload: Partial<ComplicationRow> = {
        labour_complication_id: complicationId,
        complication_note: draft.complication_note || null,
        labour_stage_id: stageId,
      };
      if (typeof draft.ipt_labour_complication_id === 'number') {
        payload.ipt_labour_complication_id = draft.ipt_labour_complication_id;
      }
      try {
        await upsertComplication(config, userInfo, iptLabourId, payload, hcode);
      } catch (e) {
        // Surface the actual error so silent-failure mode (the user's bug
        // report "ไม่สามารถเพิ่มข้อมูล") becomes visible — previously a
        // throw inside try/finally only flipped saving off without ever
        // showing what went wrong.
        setSaveError(`บันทึกไม่สำเร็จ: ${(e as Error).message}`);
        return;
      }
      await comps.mutate();
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
      await deleteComplication(config, userInfo, id, hcode);
      await comps.mutate();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b-2 border-slate-900 pb-3">
        <div className="flex items-center gap-3">
          <span aria-hidden className="block h-1.5 w-8 bg-cyan-600" />
          <h2 className="text-[18px] font-bold tracking-tight text-slate-900">ภาวะแทรกซ้อน</h2>
          {rows.length > 0 && (
            <span className="rounded-md bg-slate-100 px-2.5 py-1 text-[12px] font-semibold text-slate-700">
              {rows.length} รายการ
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={startAdd}
          disabled={editingId !== null || noLabour}
          title={noLabour ? 'ต้องสร้าง ipt_labour record ก่อน — กรอกแท็บ ก่อนคลอด หรือ Stage' : ''}
          className="rounded-md border-2 border-cyan-700 bg-cyan-700 px-4 py-2 text-[14px] font-bold text-white transition-colors hover:bg-cyan-800 disabled:opacity-40"
        >
          + เพิ่มภาวะแทรกซ้อน
        </button>
      </div>

      {saveError && (
        <div
          role="alert"
          className="rounded-md border border-rose-300 bg-rose-50 px-3 py-2 text-[13px] font-semibold text-rose-700 shadow-sm"
        >
          {saveError}
        </div>
      )}

      {/* Empty state — distinguishes "no labour record" from "no complications". */}
      {isEmpty ? (
        <div className="rounded-lg border-2 border-dashed border-slate-200 bg-white p-8 text-center">
          <div className="text-[14px] font-medium text-slate-600">ไม่พบข้อมูล</div>
          {noLabour ? (
            <div className="mt-1 text-[12px] text-slate-500">
              ยังไม่มีข้อมูล <code className="font-mono">ipt_labour</code> สำหรับ AN{' '}
              <span className="font-mono font-semibold">{an}</span> — ไปที่แท็บ{' '}
              <strong>ก่อนคลอด</strong> หรือ <strong>Stage</strong> เพื่อสร้างข้อมูลก่อน
            </div>
          ) : (
            <div className="mt-1 text-[12px] text-slate-500">
              กดปุ่ม <strong>+ เพิ่มภาวะแทรกซ้อน</strong> ด้านบนเพื่อบันทึกใหม่
            </div>
          )}
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg bg-white shadow-sm ring-1 ring-slate-200">
          <table className="w-full text-[14px]">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-left text-[12px] font-bold uppercase tracking-wide text-slate-600">
                <th className="px-4 py-3">ภาวะแทรกซ้อน</th>
                <th className="px-4 py-3">หมายเหตุ</th>
                <th className="px-4 py-3 text-right">ระยะ</th>
                <th className="px-4 py-3 text-right">การจัดการ</th>
              </tr>
            </thead>
            <tbody>
              {editingId === 'new' && (
                <EditRow
                  config={config}
                  draft={draft}
                  setDraft={setDraft}
                  saving={saving}
                  onCancel={cancel}
                  onSave={save}
                />
              )}
              {rows.map((row) =>
                editingId === row.ipt_labour_complication_id ? (
                  <EditRow
                    key={`edit-${row.ipt_labour_complication_id}`}
                    config={config}
                    draft={draft}
                    setDraft={setDraft}
                    saving={saving}
                    onCancel={cancel}
                    onSave={save}
                  />
                ) : (
                  <tr
                    key={row.ipt_labour_complication_id}
                    className="border-b border-slate-100 last:border-b-0 hover:bg-slate-50/50"
                  >
                    <td className="px-4 py-3">
                      <div className="flex flex-col gap-0.5">
                        <span className="font-semibold text-slate-900">
                          {row.complication_name ?? '—'}
                        </span>
                        <span className="font-mono text-[11px] text-slate-500">
                          #{row.labour_complication_id ?? '—'}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-slate-700">{row.complication_note ?? '—'}</td>
                    <td className="px-4 py-3 text-right font-semibold tabular-nums text-slate-900">
                      {row.labour_stage_id ?? '—'}
                    </td>
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
                          onClick={() => remove(row.ipt_labour_complication_id)}
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
