// Task 32: PreLabourTab read-only.
// Task 43: extended with form-based CRUD covering BOTH ipt_pregnancy and
// ipt_labour. Single Save writes both tables sequentially (best-effort: if
// pregnancy succeeds and labour fails, the second-step error surfaces in a
// Thai inline message and the failed side stays editable). No delete — these
// are 1:1 records per AN, not list rows.
'use client';

import { useState } from 'react';
import useSWR from 'swr';
import { useBmsSession } from '@/hooks/useBmsSession';
import {
  getPatientLabour,
  getPatientPregnancy,
  upsertLabour,
  upsertPregnancy,
} from '@/services/maternity-ward';
import type { LabourRecord, PregnancyRecord } from '@/types/maternity-ward';

interface FieldProps {
  label: string;
  value: string | number | null | undefined;
}

function Field({ label, value }: FieldProps) {
  const display = value === null || value === undefined || value === '' ? '-' : String(value);
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="text-sm font-medium text-slate-900">{display}</dd>
    </div>
  );
}

interface FormInputProps {
  label: string;
  value: string;
  onChange: (v: string) => void;
  ariaLabel: string;
}

function FormInput({ label, value, onChange, ariaLabel }: FormInputProps) {
  return (
    <div className="flex flex-col gap-0.5">
      <label className="text-xs text-slate-500">{label}</label>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={ariaLabel}
        className="rounded border border-slate-300 px-2 py-1 text-sm"
      />
    </div>
  );
}

function toNumberOrNull(v: string): number | null {
  if (v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

interface DraftState {
  preg_number: string;
  preg_ga: string;
  anc_complete: string;
  labour_g: string;
  labour_ga: string;
  anc_count: string;
}

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
  const [draft, setDraft] = useState<DraftState>({
    preg_number: '',
    preg_ga: '',
    anc_complete: '',
    labour_g: '',
    labour_ga: '',
    anc_count: '',
  });
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

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
  if (!labour.data && !pregnancy.data) {
    return <div className="p-4 text-slate-500">ไม่พบข้อมูล</div>;
  }

  const hcode = userInfo?.hospcode ?? '';

  function startEdit() {
    setDraft({
      preg_number: pregnancy.data?.preg_number?.toString() ?? '',
      preg_ga: pregnancy.data?.ga?.toString() ?? '',
      anc_complete: pregnancy.data?.anc_complete ?? '',
      labour_g: labour.data?.g?.toString() ?? '',
      labour_ga: labour.data?.ga?.toString() ?? '',
      anc_count: labour.data?.anc_count?.toString() ?? '',
    });
    setSaveError(null);
    setEditing(true);
  }

  function cancel() {
    setEditing(false);
    setSaveError(null);
  }

  async function save() {
    if (!config || !userInfo) return;
    setSaving(true);
    setSaveError(null);
    try {
      // Sequential best-effort: pregnancy first, then labour. If labour fails,
      // surface a Thai message naming which side broke so the user knows the
      // pregnancy side already persisted.
      try {
        await upsertPregnancy(
          config,
          userInfo,
          an,
          {
            preg_number: toNumberOrNull(draft.preg_number),
            ga: toNumberOrNull(draft.preg_ga),
            anc_complete: draft.anc_complete || null,
          },
          hcode,
        );
      } catch (e) {
        setSaveError(`บันทึก ipt_pregnancy ไม่สำเร็จ: ${(e as Error).message}`);
        return;
      }
      try {
        await upsertLabour(
          config,
          userInfo,
          an,
          {
            g: toNumberOrNull(draft.labour_g),
            ga: toNumberOrNull(draft.labour_ga),
            anc_count: toNumberOrNull(draft.anc_count),
          },
          hcode,
        );
      } catch (e) {
        setSaveError(
          `บันทึก ipt_pregnancy สำเร็จ แต่ ipt_labour ไม่สำเร็จ: ${(e as Error).message}`,
        );
        return;
      }
      await Promise.all([labour.mutate(), pregnancy.mutate()]);
      setEditing(false);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6 p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium text-slate-700">ข้อมูลก่อนคลอด</h2>
        {!editing ? (
          <button
            type="button"
            onClick={startEdit}
            className="rounded border border-slate-300 px-3 py-1 text-xs text-slate-700"
          >
            แก้ไข
          </button>
        ) : (
          <div className="space-x-2">
            <button
              type="button"
              onClick={save}
              disabled={saving}
              className="rounded bg-blue-600 px-3 py-1 text-xs text-white disabled:opacity-50"
            >
              {saving ? 'กำลังบันทึก…' : 'บันทึก'}
            </button>
            <button
              type="button"
              onClick={cancel}
              disabled={saving}
              className="rounded border border-slate-300 px-3 py-1 text-xs text-slate-700"
            >
              ยกเลิก
            </button>
          </div>
        )}
      </div>
      {saveError && (
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {saveError}
        </div>
      )}
      <section>
        <h3 className="mb-2 text-sm font-semibold text-slate-700">Pregnancy (ipt_pregnancy)</h3>
        {editing ? (
          <div className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
            <FormInput
              label="Preg #"
              ariaLabel="preg_number"
              value={draft.preg_number}
              onChange={(v) => setDraft((d) => ({ ...d, preg_number: v }))}
            />
            <FormInput
              label="GA"
              ariaLabel="preg_ga"
              value={draft.preg_ga}
              onChange={(v) => setDraft((d) => ({ ...d, preg_ga: v }))}
            />
            <FormInput
              label="ANC complete"
              ariaLabel="anc_complete"
              value={draft.anc_complete}
              onChange={(v) => setDraft((d) => ({ ...d, anc_complete: v }))}
            />
          </div>
        ) : (
          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
            <Field label="Preg #" value={pregnancy.data?.preg_number ?? null} />
            <Field label="GA" value={pregnancy.data?.ga ?? null} />
            <Field label="ANC complete" value={pregnancy.data?.anc_complete ?? null} />
            <Field label="Labor date" value={pregnancy.data?.labor_date ?? null} />
          </dl>
        )}
      </section>
      <section>
        <h3 className="mb-2 text-sm font-semibold text-slate-700">Labour (ipt_labour)</h3>
        {editing ? (
          <div className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
            <FormInput
              label="G"
              ariaLabel="labour_g"
              value={draft.labour_g}
              onChange={(v) => setDraft((d) => ({ ...d, labour_g: v }))}
            />
            <FormInput
              label="GA"
              ariaLabel="labour_ga"
              value={draft.labour_ga}
              onChange={(v) => setDraft((d) => ({ ...d, labour_ga: v }))}
            />
            <FormInput
              label="ANC count"
              ariaLabel="anc_count"
              value={draft.anc_count}
              onChange={(v) => setDraft((d) => ({ ...d, anc_count: v }))}
            />
          </div>
        ) : (
          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
            <Field label="G" value={labour.data?.g ?? null} />
            <Field label="GA" value={labour.data?.ga ?? null} />
            <Field label="ANC count" value={labour.data?.anc_count ?? null} />
            <Field label="Labour ID" value={labour.data?.ipt_labour_id ?? null} />
          </dl>
        )}
      </section>
    </div>
  );
}
