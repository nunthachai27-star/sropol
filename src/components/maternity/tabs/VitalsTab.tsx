// VitalsTab — list + chart view of ipd_nurse_note rows.
// Batch 2.1 (this pass): switched data source from ipt_pregnancy_vital_sign
// to ipd_nurse_note (the comprehensive HOSxP nurse-note table). Dialog
// carries the header + core vitals + biometric + physical exam + obstetric
// + note sections; Batches 2.2 and 2.3 will expand it to the remaining
// ~40 fields (fluid I/O, scores, text blocks).
'use client';

import { useState } from 'react';
import useSWR from 'swr';
import { useBmsSession } from '@/hooks/useBmsSession';
import { deleteNurseNote, getPatientNurseNotes, upsertNurseNote } from '@/services/maternity-ward';
import type { NurseNoteRow } from '@/types/maternity-ward';
import { VitalSignChart } from '@/components/maternity/vitals/VitalSignChart';
import { VitalSignEntryDialog } from '@/components/maternity/VitalSignEntryDialog';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';

type DialogState =
  | { open: false }
  | { open: true; mode: 'add'; row: null }
  | { open: true; mode: 'edit'; row: NurseNoteRow };

export function VitalsTab({ an }: { an: string }) {
  const { config, userInfo, marketplaceToken } = useBmsSession();
  const { data, error, isLoading, mutate } = useSWR<NurseNoteRow[]>(
    config ? ['nurse-notes', config.apiUrl, an] : null,
    () => getPatientNurseNotes(config!, an),
  );

  const [dialog, setDialog] = useState<DialogState>({ open: false });
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
  const isEmpty = rows.length === 0;

  function openAdd() {
    setDialog({ open: true, mode: 'add', row: null });
  }
  function openEdit(row: NurseNoteRow) {
    if (row.nurse_note_id === undefined) return;
    setDialog({ open: true, mode: 'edit', row });
  }
  function closeDialog() {
    setDialog({ open: false });
  }

  async function handleSave(payload: Partial<NurseNoteRow>) {
    if (!config || !userInfo) return;
    setSaving(true);
    try {
      await upsertNurseNote(config, userInfo, an, payload, hcode);
      await mutate();
      closeDialog();
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: number) {
    if (!config || !userInfo) return;
    setSaving(true);
    try {
      await deleteNurseNote(config, userInfo, id, hcode);
      await mutate();
      closeDialog();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="p-4">
      <Tabs defaultValue="chart" className="gap-3">
        <div className="flex items-center gap-3">
          <TabsList variant="line" className="justify-start">
            <TabsTrigger value="chart">กราฟ</TabsTrigger>
            <TabsTrigger value="table">ตาราง</TabsTrigger>
          </TabsList>
          <button
            type="button"
            onClick={openAdd}
            disabled={dialog.open}
            className="ml-auto rounded bg-emerald-600 px-3 py-1 text-xs font-medium text-white disabled:opacity-50"
          >
            + เพิ่มข้อมูลใหม่
          </button>
        </div>

        <TabsContent value="chart">
          <div className="overflow-auto">
            <VitalSignChart an={an} config={config} marketplaceToken={marketplaceToken} />
          </div>
        </TabsContent>

        <TabsContent value="table">
          {isEmpty ? (
            <div className="p-4 text-slate-500">ไม่พบข้อมูล</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs text-slate-500">
                    <th className="py-2">วันที่/เวลา</th>
                    <th>Pulse</th>
                    <th>BP</th>
                    <th>Temp</th>
                    <th>RR</th>
                    <th>SpO₂</th>
                    <th className="text-right">การจัดการ</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, i) => {
                    const id = row.nurse_note_id;
                    return (
                      <tr key={id ?? i} className="border-b">
                        <td className="py-2 tabular-nums">
                          {row.note_date ?? '-'}
                          {row.note_time ? ` ${String(row.note_time).slice(0, 5)}` : ''}
                        </td>
                        <td>{row.pulse ?? '-'}</td>
                        <td>
                          {row.bp_systolic ?? '-'}/{row.bp_diastolic ?? '-'}
                        </td>
                        <td>{row.temperature ?? '-'}</td>
                        <td>{row.respiratory_rate ?? '-'}</td>
                        <td>{row.spo2_ra ?? '-'}</td>
                        <td className="text-right">
                          <button
                            type="button"
                            onClick={() => openEdit(row)}
                            disabled={dialog.open || id === undefined}
                            title={id === undefined ? 'รายการนี้ไม่มี PK ไม่สามารถแก้ไข' : ''}
                            className="rounded border border-slate-300 px-2 py-1 text-xs text-slate-700 disabled:opacity-50"
                          >
                            แก้ไข
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </TabsContent>
      </Tabs>

      {dialog.open && (
        <VitalSignEntryDialog
          key={dialog.mode === 'edit' ? `edit-${dialog.row.nurse_note_id}` : 'add'}
          open
          mode={dialog.mode}
          initialRow={dialog.mode === 'edit' ? dialog.row : null}
          saving={saving}
          onSave={(payload) => void handleSave(payload)}
          onDelete={(id) => void handleDelete(id)}
          onCancel={closeDialog}
        />
      )}
    </div>
  );
}
