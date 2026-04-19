// Task 31: VitalsTab read-only.
// Task 42: extended with CRUD (Add / Edit / Save / Delete / Cancel) following
// the canonical pattern from PartographTab. Editable fields: hr, bps, bpd,
// temperature, rr (5 fields). Note: the source table has no native PK; the
// upsert service mints a surrogate via get_serialnumber. Rows fetched without
// a surrogate (legacy data) cannot be edited inline — they show a disabled
// edit button. New rows mint a fresh PK and are always editable.
'use client';

import { useState } from 'react';
import useSWR from 'swr';
import { useBmsSession } from '@/hooks/useBmsSession';
import {
  deleteVitalSign,
  getPatientVitalSigns,
  upsertVitalSign,
} from '@/services/maternity-ward';
import type { VitalSignRow } from '@/types/maternity-ward';

type EditableField = 'hr' | 'bps' | 'bpd' | 'temperature' | 'rr';

type EditState = Partial<Record<EditableField, string>> & {
  ipt_pregnancy_vital_sign_id?: number;
};

function toNumberOrNull(v: string | undefined): number | null {
  if (v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function VitalsTab({ an }: { an: string }) {
  const { config, userInfo } = useBmsSession();
  const { data, error, isLoading, mutate } = useSWR<VitalSignRow[]>(
    config ? ['vitals', config.apiUrl, an] : null,
    () => getPatientVitalSigns(config!, an),
  );

  const [editingId, setEditingId] = useState<number | 'new' | null>(null);
  const [draft, setDraft] = useState<EditState>({});
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
    setDraft({});
  }

  function startEdit(row: VitalSignRow) {
    if (row.ipt_pregnancy_vital_sign_id === undefined) return;
    setEditingId(row.ipt_pregnancy_vital_sign_id);
    setDraft({
      ipt_pregnancy_vital_sign_id: row.ipt_pregnancy_vital_sign_id,
      hr: row.hr?.toString() ?? '',
      bps: row.bps?.toString() ?? '',
      bpd: row.bpd?.toString() ?? '',
      temperature: row.temperature?.toString() ?? '',
      rr: row.rr?.toString() ?? '',
    });
  }

  function cancel() {
    setEditingId(null);
    setDraft({});
  }

  async function save() {
    if (!config || !userInfo) return;
    setSaving(true);
    try {
      const payload: Partial<VitalSignRow> = {
        hr: toNumberOrNull(draft.hr),
        bps: toNumberOrNull(draft.bps),
        bpd: toNumberOrNull(draft.bpd),
        temperature: toNumberOrNull(draft.temperature),
        rr: toNumberOrNull(draft.rr),
      };
      if (typeof draft.ipt_pregnancy_vital_sign_id === 'number') {
        payload.ipt_pregnancy_vital_sign_id = draft.ipt_pregnancy_vital_sign_id;
      }
      await upsertVitalSign(config, userInfo, an, payload, hcode);
      await mutate();
      setEditingId(null);
      setDraft({});
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: number) {
    if (!config || !userInfo) return;
    if (!window.confirm('ยืนยันการลบรายการนี้หรือไม่?')) return;
    setSaving(true);
    try {
      await deleteVitalSign(config, userInfo, id, hcode);
      await mutate();
    } finally {
      setSaving(false);
    }
  }

  function fieldInput(name: EditableField) {
    return (
      <input
        type="text"
        inputMode="numeric"
        value={draft[name] ?? ''}
        onChange={(e) => setDraft((d) => ({ ...d, [name]: e.target.value }))}
        className="w-16 rounded border border-slate-300 px-1 py-0.5 text-sm"
        aria-label={name}
      />
    );
  }

  function editRow(key: string) {
    return (
      <tr key={key} className="border-b bg-amber-50">
        <td className="py-2">{fieldInput('hr')}</td>
        <td className="space-x-1">
          {fieldInput('bps')}
          /{fieldInput('bpd')}
        </td>
        <td>{fieldInput('temperature')}</td>
        <td>{fieldInput('rr')}</td>
        <td>-</td>
        <td>-</td>
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
        <h3 className="text-sm font-medium text-slate-700">บันทึกสัญญาณชีพ</h3>
        <button
          type="button"
          onClick={startAdd}
          disabled={editingId !== null}
          className="rounded bg-emerald-600 px-3 py-1 text-xs text-white disabled:opacity-50"
        >
          + เพิ่มข้อมูลใหม่
        </button>
      </div>
      {isEmpty ? (
        <div className="p-4 text-slate-500">ไม่พบข้อมูล</div>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-xs text-slate-500">
              <th className="py-2">HR</th>
              <th>BP</th>
              <th>Temp</th>
              <th>RR</th>
              <th>FHS</th>
              <th>Dilation</th>
              <th className="text-right">การจัดการ</th>
            </tr>
          </thead>
          <tbody>
            {editingId === 'new' && editRow('new')}
            {rows.map((row, i) => {
              const id = row.ipt_pregnancy_vital_sign_id;
              if (id !== undefined && editingId === id) {
                return editRow(`edit-${id}`);
              }
              return (
                <tr key={id ?? i} className="border-b">
                  <td className="py-2">{row.hr ?? '-'}</td>
                  <td>
                    {row.bps ?? '-'}/{row.bpd ?? '-'}
                  </td>
                  <td>{row.temperature ?? '-'}</td>
                  <td>{row.rr ?? '-'}</td>
                  <td>{row.fetal_heart_sound ?? '-'}</td>
                  <td>{row.cervical_open_size ?? '-'}</td>
                  <td className="space-x-2 text-right">
                    <button
                      type="button"
                      onClick={() => startEdit(row)}
                      disabled={editingId !== null || id === undefined}
                      title={id === undefined ? 'รายการนี้ไม่มี PK ไม่สามารถแก้ไข' : ''}
                      className="rounded border border-slate-300 px-2 py-1 text-xs text-slate-700 disabled:opacity-50"
                    >
                      แก้ไข
                    </button>
                    <button
                      type="button"
                      onClick={() => id !== undefined && remove(id)}
                      disabled={editingId !== null || saving || id === undefined}
                      className="rounded border border-red-300 px-2 py-1 text-xs text-red-700 disabled:opacity-50"
                    >
                      ลบ
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
