// Task 36: ComplicationsTab read-only.
// Task 47: extended with table+inline-edit CRUD. Editable fields:
// labour_complication_id (free-number input for v1; lookup picker is future
// work), complication_note, labour_stage_id. CRUD is keyed by ipt_labour_id
// resolved from getPatientLabour(an). Add/Edit/Delete are disabled until that
// resolves; if no labour record exists for the AN, complications cannot be
// created (matches HOSxP FK).
'use client';

import { useState } from 'react';
import useSWR from 'swr';
import { useBmsSession } from '@/hooks/useBmsSession';
import {
  deleteComplication,
  getPatientComplications,
  getPatientLabour,
  upsertComplication,
} from '@/services/maternity-ward';
import type { ComplicationRow, LabourRecord } from '@/types/maternity-ward';

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

export function ComplicationsTab({ an }: { an: string }) {
  const { config, userInfo } = useBmsSession();
  const labour = useSWR<LabourRecord | null>(
    config ? ['labour', config.apiUrl, an] : null,
    () => getPatientLabour(config!, an),
  );
  const iptLabourId = labour.data?.ipt_labour_id ?? null;
  const comps = useSWR<ComplicationRow[]>(
    config && iptLabourId ? ['complications', config.apiUrl, iptLabourId] : null,
    () => getPatientComplications(config!, iptLabourId!),
  );

  const [editingId, setEditingId] = useState<number | 'new' | null>(null);
  const [draft, setDraft] = useState<EditState>(EMPTY_DRAFT);
  const [saving, setSaving] = useState(false);

  if (!config) {
    return <div className="p-4 text-slate-500">ไม่พร้อมใช้งาน (ไม่มี BMS session)</div>;
  }
  if (labour.isLoading || (iptLabourId && comps.isLoading)) {
    return <div className="p-4 text-slate-500">กำลังโหลด…</div>;
  }
  const err = labour.error ?? comps.error;
  if (err) {
    return <div className="p-4 text-red-600">โหลดไม่สำเร็จ: {(err as Error).message}</div>;
  }

  const hcode = userInfo?.hospcode ?? '';
  const rows = comps.data ?? [];
  const noLabour = !iptLabourId;
  const isEmpty = (noLabour || rows.length === 0) && editingId !== 'new';

  function startAdd() {
    setEditingId('new');
    setDraft(EMPTY_DRAFT);
  }

  function startEdit(row: ComplicationRow) {
    setEditingId(row.ipt_labour_complication_id);
    setDraft({
      ipt_labour_complication_id: row.ipt_labour_complication_id,
      labour_complication_id: row.labour_complication_id?.toString() ?? '',
      complication_note: row.complication_note ?? '',
      labour_stage_id: row.labour_stage_id?.toString() ?? '',
    });
  }

  function cancel() {
    setEditingId(null);
    setDraft(EMPTY_DRAFT);
  }

  async function save() {
    if (!config || !userInfo || !iptLabourId) return;
    setSaving(true);
    try {
      const payload: Partial<ComplicationRow> = {
        labour_complication_id: toNumberOrNull(draft.labour_complication_id),
        complication_note: draft.complication_note || null,
        labour_stage_id: toNumberOrNull(draft.labour_stage_id),
      };
      if (typeof draft.ipt_labour_complication_id === 'number') {
        payload.ipt_labour_complication_id = draft.ipt_labour_complication_id;
      }
      await upsertComplication(config, userInfo, iptLabourId, payload, hcode);
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

  function textInput(
    name: keyof Omit<EditState, 'ipt_labour_complication_id'>,
    width = 'w-32',
  ) {
    return (
      <input
        type="text"
        value={draft[name] ?? ''}
        onChange={(e) => setDraft((d) => ({ ...d, [name]: e.target.value }))}
        className={`${width} rounded border border-slate-300 px-1 py-0.5 text-sm`}
        aria-label={name}
      />
    );
  }

  function editRow(key: string) {
    return (
      <tr key={key} className="border-b bg-amber-50">
        <td className="py-2">{textInput('labour_complication_id', 'w-20')}</td>
        <td>{textInput('complication_note', 'w-40')}</td>
        <td>{textInput('labour_stage_id', 'w-16')}</td>
        <td className="space-x-2 text-right">
          <button
            type="button"
            onClick={save}
            disabled={saving}
            className="rounded bg-blue-600 px-2 py-1 text-xs text-white disabled:opacity-50"
          >
            {saving ? 'กำลังบันทึก…' : 'บันทึก'}
          </button>
          <button
            type="button"
            onClick={cancel}
            disabled={saving}
            className="rounded border border-slate-300 px-2 py-1 text-xs text-slate-700"
          >
            ยกเลิก
          </button>
        </td>
      </tr>
    );
  }

  return (
    <div className="overflow-x-auto p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-medium text-slate-700">ภาวะแทรกซ้อน</h3>
        <button
          type="button"
          onClick={startAdd}
          disabled={editingId !== null || noLabour}
          title={noLabour ? 'ไม่มี ipt_labour record — ไม่สามารถเพิ่ม' : ''}
          className="rounded bg-emerald-600 px-3 py-1 text-xs text-white disabled:opacity-50"
        >
          + เพิ่มภาวะแทรกซ้อน
        </button>
      </div>
      {isEmpty ? (
        <div className="p-4 text-slate-500">ไม่พบข้อมูล</div>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-xs text-slate-500">
              <th className="py-2">ภาวะแทรกซ้อน</th>
              <th>หมายเหตุ</th>
              <th>Stage</th>
              <th className="text-right">การจัดการ</th>
            </tr>
          </thead>
          <tbody>
            {editingId === 'new' && editRow('new')}
            {rows.map((row) =>
              editingId === row.ipt_labour_complication_id ? (
                editRow(`edit-${row.ipt_labour_complication_id}`)
              ) : (
                <tr key={row.ipt_labour_complication_id} className="border-b">
                  <td className="py-2">
                    {row.complication_name ?? row.labour_complication_id ?? '-'}
                  </td>
                  <td>{row.complication_note ?? '-'}</td>
                  <td>{row.labour_stage_id ?? '-'}</td>
                  <td className="space-x-2 text-right">
                    <button
                      type="button"
                      onClick={() => startEdit(row)}
                      disabled={editingId !== null}
                      className="rounded border border-slate-300 px-2 py-1 text-xs text-slate-700 disabled:opacity-50"
                    >
                      แก้ไข
                    </button>
                    <button
                      type="button"
                      onClick={() => remove(row.ipt_labour_complication_id)}
                      disabled={editingId !== null || saving}
                      className="rounded border border-red-300 px-2 py-1 text-xs text-red-700 disabled:opacity-50"
                    >
                      ลบ
                    </button>
                  </td>
                </tr>
              ),
            )}
          </tbody>
        </table>
      )}
    </div>
  );
}
