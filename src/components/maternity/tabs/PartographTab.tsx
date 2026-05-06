// PartographTab — list + chart view of ipt_labour_partograph rows.
// Batch 1: modal dialog with all 21 clinical fields.
// Batch 2: abnormal highlighting, status panel, auto hour_no, BeforePost
//          validation, soft confirmations.
// Batch 3 (this pass): sub-tabs for ตาราง (table) and กราฟ (WHO partograph
//          chart with CDSS severity badge). Mirrors the Delphi
//          HOSxPIPDLabourPartographEntryFrameUnit's two-page cxPageControl
//          and its "[วิกฤต N / เตือน N / ระวัง N]" tab caption behavior.
'use client';

import { useMemo, useState } from 'react';
import useSWR from 'swr';
import { useBmsSession } from '@/hooks/useBmsSession';
import {
  deletePartograph,
  getPatientPartograph,
  upsertPartograph,
} from '@/services/maternity-ward';
import type { BedOccupancy, PartographRow } from '@/types/maternity-ward';
import type { PartographObservationDto } from '@/types/api';
import { calculateAge } from '@/lib/utils';
import { maskName } from '@/lib/pii-mask';
import { analyzePartograph, countBySeverity } from '@/services/partogram';
import { PartographEntryDialog } from '@/components/maternity/PartographEntryDialog';
import { PartographForm } from '@/components/maternity/partograph/PartographForm';
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from '@/components/ui/tabs';
import { cn } from '@/lib/utils';

type DialogState =
  | { open: false }
  | { open: true; mode: 'add'; row: null }
  | { open: true; mode: 'edit'; row: PartographRow };

// Map the storage row to the DTO shape expected by PartogramChart / CDSS.
function rowToObs(row: PartographRow): PartographObservationDto {
  return {
    id: String(row.ipt_labour_partograph_id),
    observeDatetime: row.observe_datetime,
    hourNo: row.hour_no,
    fetalHeartRate: row.fetal_heart_rate,
    amnioticFluid: row.amniotic_fluid,
    amnioticTypeName: null,
    moulding: row.moulding,
    cervicalDilationCm: row.cervical_dilation_cm,
    descentOfHead: row.descent_of_head,
    contractionPer10Min: row.contraction_per_10min,
    contractionDurationSec: row.contraction_duration_sec,
    contractionStrength: row.contraction_strength,
    oxytocinUml: row.oxytocin_uml,
    oxytocinDropsMin: row.oxytocin_drops_min,
    drugsIvFluids: row.drugs_iv_fluids,
    pulse: row.pulse,
    bpSystolic: row.bp_systolic,
    bpDiastolic: row.bp_diastolic,
    temperature: row.temperature,
    urineVolumeMl: row.urine_volume_ml,
    urineProtein: row.urine_protein,
    urineGlucose: row.urine_glucose,
    urineAcetone: row.urine_acetone,
    note: row.note,
    entryStaff: null,
  };
}

function buildFormHeader(an: string, occupant: BedOccupancy | null | undefined) {
  if (!occupant) return { an };
  const patientName = [occupant.pname, occupant.fname, occupant.lname]
    .filter(Boolean)
    .join(' ')
    .trim();
  let age: string | undefined;
  if (occupant.birthday) {
    const d = new Date(occupant.birthday);
    if (!Number.isNaN(d.getTime())) age = String(calculateAge(d));
  }
  // Partial GPAL — BedOccupancy only carries gravida + ga today. The other
  // fields (P/A/L) need an ipt_labour fetch; skipping them here matches what
  // the drawer already has on hand without an extra BMS round-trip.
  const gpalParts: string[] = [];
  if (occupant.gravida != null) gpalParts.push(`G${occupant.gravida}`);
  if (occupant.ga != null) gpalParts.push(`GA${occupant.ga}`);
  const admitAt =
    occupant.regdate && occupant.regtime
      ? `${occupant.regdate}T${occupant.regtime.length === 5 ? `${occupant.regtime}:00` : occupant.regtime}`
      : occupant.regdate ?? undefined;
  return {
    an,
    hn: occupant.hn,
    patientName: patientName ? maskName(patientName) : undefined,
    gpal: gpalParts.length > 0 ? gpalParts.join(' ') : undefined,
    age,
    admitAt,
  };
}

export function PartographTab({
  an,
  occupant,
}: {
  an: string;
  occupant?: BedOccupancy | null;
}) {
  const { config, userInfo } = useBmsSession();
  const { data, error, isLoading, mutate } = useSWR<PartographRow[]>(
    config ? ['partograph', config.apiUrl, an] : null,
    () => getPatientPartograph(config!, an),
  );

  const [dialog, setDialog] = useState<DialogState>({ open: false });
  const [saving, setSaving] = useState(false);

  // Map + CDSS analysis — derived from SWR data so the Chart sub-tab reflects
  // edits without refetching. Memoized so the chart doesn't re-render unless
  // data actually changed.
  const rows = useMemo<PartographRow[]>(() => data ?? [], [data]);
  const observations = useMemo(() => rows.map(rowToObs), [rows]);
  const alerts = useMemo(
    () => (observations.length > 0 ? analyzePartograph({ an }, observations) : []),
    [an, observations],
  );
  const cdssCounts = useMemo(
    () => ({
      critical: countBySeverity(alerts, 'CRITICAL'),
      alert: countBySeverity(alerts, 'ALERT'),
      warn: countBySeverity(alerts, 'WARN'),
    }),
    [alerts],
  );

  if (!config) {
    return <div className="p-4 text-slate-500">ไม่พร้อมใช้งาน (ไม่มี BMS session)</div>;
  }
  if (isLoading) return <div className="p-4 text-slate-500">กำลังโหลด…</div>;
  if (error) {
    return <div className="p-4 text-red-600">โหลดไม่สำเร็จ: {(error as Error).message}</div>;
  }

  const hcode = userInfo?.hospcode ?? '';
  const isEmpty = rows.length === 0 && !(dialog.open && dialog.mode === 'add');

  function openAdd() {
    setDialog({ open: true, mode: 'add', row: null });
  }
  function openEdit(row: PartographRow) {
    setDialog({ open: true, mode: 'edit', row });
  }
  function closeDialog() {
    setDialog({ open: false });
  }

  async function handleSave(payload: Partial<PartographRow>) {
    if (!config || !userInfo) return;
    setSaving(true);
    try {
      await upsertPartograph(config, userInfo, an, payload, hcode);
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
      await deletePartograph(config, userInfo, id, hcode);
      await mutate();
      closeDialog();
    } finally {
      setSaving(false);
    }
  }

  // Compact badge matching the Delphi chart-tab caption — only the most severe
  // bucket is shown (e.g. critical wins over alert). Hidden when empty.
  const badge = cdssCounts.critical > 0
    ? { label: `วิกฤต ${cdssCounts.critical}`, cls: 'bg-rose-100 text-rose-700' }
    : cdssCounts.alert > 0
      ? { label: `เตือน ${cdssCounts.alert}`, cls: 'bg-amber-100 text-amber-800' }
      : cdssCounts.warn > 0
        ? { label: `ระวัง ${cdssCounts.warn}`, cls: 'bg-sky-100 text-sky-800' }
        : null;

  return (
    <div className="p-4">
      <Tabs defaultValue="chart" className="gap-3">
        {/* Tab header row — Add button is a direct sibling of the tablist so
            it stays reachable whichever sub-tab is active. */}
        <div className="flex items-center gap-3">
          <TabsList variant="line" className="justify-start">
            <TabsTrigger value="chart" className="gap-2">
              <span>กราฟ</span>
              {badge && (
                <span
                  className={cn(
                    'rounded px-1.5 py-0.5 text-[10px] font-semibold tracking-wide',
                    badge.cls,
                  )}
                >
                  {badge.label}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="table">ตาราง</TabsTrigger>
          </TabsList>
          <button
            type="button"
            onClick={openAdd}
            disabled={dialog.open}
            className="ml-auto rounded bg-emerald-600 px-3 py-1 text-xs font-medium text-white disabled:opacity-50"
          >
            + เพิ่มเวลาใหม่
          </button>
        </div>

        <TabsContent value="table">
          {isEmpty ? (
            <div className="p-4 text-slate-500">ไม่พบข้อมูล</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs text-slate-500">
                    <th className="py-2">เวลา</th>
                    <th>ชั่วโมง</th>
                    <th>FHR</th>
                    <th>ปากมดลูก (ซม)</th>
                    <th>การหด</th>
                    <th>BP</th>
                    <th className="text-right">การจัดการ</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.ipt_labour_partograph_id} className="border-b">
                      <td className="py-2">{row.observe_datetime}</td>
                      <td>{row.hour_no ?? '-'}</td>
                      <td>{row.fetal_heart_rate ?? '-'}</td>
                      <td>{row.cervical_dilation_cm ?? '-'}</td>
                      <td>{row.contraction_per_10min ?? '-'}</td>
                      <td>
                        {row.bp_systolic ?? '-'}/{row.bp_diastolic ?? '-'}
                      </td>
                      <td className="space-x-2 text-right">
                        <button
                          type="button"
                          onClick={() => openEdit(row)}
                          disabled={dialog.open}
                          className="rounded border border-slate-300 px-2 py-1 text-xs text-slate-700 disabled:opacity-50"
                        >
                          แก้ไข
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </TabsContent>

        <TabsContent value="chart">
          {/* SVG port of the Delphi HOSxPLaborPackage PartographRenderUnit —
              renders the full WHO partograph form (20 strips) regardless of
              whether there is any observation data yet, so nurses can see the
              paper template and reference lines on admission. */}
          <div className="overflow-auto">
            <PartographForm
              header={buildFormHeader(an, occupant)}
              observations={observations}
              alerts={alerts}
              onObservationClick={(o) => {
                // Map the chart's DTO back to the storage row by PK.
                const row = rows.find(
                  (r) => String(r.ipt_labour_partograph_id) === o.id,
                );
                if (row) openEdit(row);
              }}
            />
          </div>
        </TabsContent>
      </Tabs>

      {dialog.open && (
        <PartographEntryDialog
          // Remount on mode/row change so useState re-seeds from the new row.
          key={dialog.mode === 'edit' ? `edit-${dialog.row.ipt_labour_partograph_id}` : 'add'}
          open
          mode={dialog.mode}
          initialRow={dialog.mode === 'edit' ? dialog.row : null}
          observations={rows}
          saving={saving}
          onSave={(payload) => void handleSave(payload)}
          onDelete={(id) => void handleDelete(id)}
          onCancel={closeDialog}
        />
      )}
    </div>
  );
}
