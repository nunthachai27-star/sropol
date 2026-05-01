// HospitalsTab — manage the operational hospital list (add from MOPH
// registry / delete / open full settings dialog). Editing is delegated to
// `HospitalEditDialog` which groups General + BMS Tunnel + Webhook Keys
// into a single larger panel.
'use client';

import { useEffect, useMemo, useState } from 'react';
import useSWR from 'swr';
import { Plus, Pencil, Trash2, Building2, Database } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { LoadingState } from '@/components/shared/LoadingState';
import { HospitalLevel, HospitalServiceType } from '@/types/domain';
import { HospitalEditDialog, type AdminHospital } from './HospitalEditDialog';

// Short Thai abbreviations for the compact list row — the full label lives
// in the edit dialog's radio-card tiles.
const SERVICE_TYPE_LABEL: Record<string, string> = {
  [HospitalServiceType.PROVINCIAL_HUB]: 'จังหวัด/ศูนย์',
  [HospitalServiceType.DISTRICT_WITH_MATERNITY]: 'รพช. มีห้องคลอด',
  [HospitalServiceType.DISTRICT_NO_MATERNITY]: 'รพช. ไม่มีห้องคลอด',
};

interface MophHospital {
  hcode: string;
  name: string;
  hospitalTypeId: number | null;
  bedCount: number | null;
  provinceCode: string | null;
  districtCode: string | null;
}

interface ConfigResponse {
  config: { active_province_code?: string | null };
}

interface ProvincesResponse {
  provinces: Array<{ code: string; name: string }>;
}

interface DataCountsResponse {
  counts: Record<string, { totalRows: number; perTable: Record<string, number> }>;
}

const LEVEL_OPTIONS = Object.values(HospitalLevel);

// hospital_type_id → default HospitalLevel guess (admin can override).
function guessLevel(typeId: number | null): HospitalLevel {
  if (typeId === 5) return HospitalLevel.A_S;
  if (typeId === 6) return HospitalLevel.M1;
  if (typeId === 7) return HospitalLevel.F2;
  return HospitalLevel.F3;
}

interface HospitalsTabProps {
  /** When set, auto-opens the edit dialog for this hcode once the hospital
   *  list has loaded. Used by the admin page to bridge map-pin clicks into
   *  the edit flow. Consumer must clear via onAutoEditConsumed after open. */
  autoEditHcode?: string | null;
  onAutoEditConsumed?: () => void;
}

export function HospitalsTab({ autoEditHcode, onAutoEditConsumed }: HospitalsTabProps = {}) {
  const { data: hospitalsData, isLoading, error, mutate } = useSWR<{ hospitals: AdminHospital[] }>(
    '/api/admin/hospitals',
  );
  const { data: configData } = useSWR<ConfigResponse>('/api/admin/config');
  const { data: provincesData } = useSWR<ProvincesResponse>('/api/admin/provinces');
  const { data: dataCountsData } = useSWR<DataCountsResponse>(
    '/api/admin/hospitals/data-counts',
    { refreshInterval: 30_000 }, // refresh every 30s so counts trail polling sync
  );

  const activeProvince = configData?.config?.active_province_code ?? '40';
  const { data: mophData } = useSWR<{ hospitals: MophHospital[] }>(
    `/api/admin/moph-hospitals?province=${activeProvince}`,
  );

  const [addOpen, setAddOpen] = useState(false);
  const [editHospital, setEditHospital] = useState<AdminHospital | null>(null);

  const [pickedHcode, setPickedHcode] = useState('');
  const [pickedLevel, setPickedLevel] = useState<string>(HospitalLevel.F2);
  const [addMessage, setAddMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const provinceByCode = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of provincesData?.provinces ?? []) map.set(p.code, p.name);
    return map;
  }, [provincesData]);

  const availableMoph = useMemo(() => {
    const registered = new Set((hospitalsData?.hospitals ?? []).map((h) => h.hcode));
    return (mophData?.hospitals ?? []).filter((m) => !registered.has(m.hcode));
  }, [hospitalsData, mophData]);

  // Auto-open the edit dialog when parent signals via autoEditHcode (admin
  // map pin click). Runs after the list loads and clears the signal so a
  // second click on the same hospital re-triggers. Declared before the
  // early-return to preserve hook call order.
  useEffect(() => {
    if (!autoEditHcode || !hospitalsData?.hospitals) return;
    const found = hospitalsData.hospitals.find((h) => h.hcode === autoEditHcode);
    if (!found) return;
    setEditHospital(found);
    onAutoEditConsumed?.();
  }, [autoEditHcode, hospitalsData, onAutoEditConsumed]);

  if (isLoading) {
    return <LoadingState message="กำลังโหลดรายการโรงพยาบาล..." />;
  }

  if (error) {
    // Surface the real failure (e.g. "column X does not exist" after a schema
    // mismatch) so the admin can tell the difference between "no hospitals
    // registered yet" and "server failed to answer".
    return (
      <div
        className="border-2 bg-white px-4 py-3"
        style={{ borderColor: 'var(--risk-high)' }}
      >
        <div
          className="mb-1 font-mono text-[11px] font-semibold uppercase tracking-[0.08em]"
          style={{ color: 'var(--risk-high)' }}
        >
          โหลดรายการโรงพยาบาลไม่สำเร็จ
        </div>
        <div className="font-mono text-[12px] text-[var(--ink-navy-dim)]">
          {(error as Error).message}
        </div>
        <div className="mt-2 font-mono text-[10px] text-[var(--ink-navy-muted)]">
          มักเกิดเมื่อ schema DB ไม่ sync กับโค้ดล่าสุด — ลองรีสตาร์ท dev server เพื่อให้ schema-sync
          ALTER column ที่ขาด
        </div>
      </div>
    );
  }

  const hospitals = hospitalsData?.hospitals ?? [];

  const openAdd = () => {
    setPickedHcode('');
    setPickedLevel(HospitalLevel.F2);
    setAddMessage(null);
    setAddOpen(true);
  };

  const handleAdd = async () => {
    if (!pickedHcode) {
      setAddMessage('กรุณาเลือกโรงพยาบาลจากทะเบียน MOPH');
      return;
    }
    const moph = availableMoph.find((m) => m.hcode === pickedHcode);
    if (!moph) {
      setAddMessage('ไม่พบรหัสโรงพยาบาลที่เลือก');
      return;
    }
    setBusy(true);
    try {
      const res = await fetch('/api/admin/hospitals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          hcode: moph.hcode,
          name: moph.name,
          level: pickedLevel,
          provinceCode: moph.provinceCode,
          districtCode: moph.districtCode,
          isActive: true,
        }),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(err?.error ?? 'เพิ่มไม่สำเร็จ');
      }
      await mutate();
      setAddOpen(false);
    } catch (e) {
      setAddMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async (h: AdminHospital) => {
    if (!confirm(`ลบ ${h.name} (${h.hcode})?\nข้อมูลการตั้งค่า BMS จะถูกลบไปด้วย`)) {
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/hospitals/${h.hcode}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(err?.error ?? 'ลบไม่สำเร็จ');
      }
      await mutate();
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--ink-navy-muted)]">
          REGISTERED HOSPITALS · {hospitals.length}
        </div>
        <Button onClick={openAdd} className="gap-1.5">
          <Plus className="h-4 w-4" />
          เพิ่มโรงพยาบาล
        </Button>
      </div>

      <div className="border bg-white" style={{ borderColor: 'var(--rule-strong)' }}>
        <div
          className="grid grid-cols-[90px,1fr,70px,130px,120px,60px,90px,110px] items-center border-b px-3 py-2 font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--ink-navy-muted)]"
          style={{ borderColor: 'var(--rule-strong)' }}
        >
          <span>HCODE</span>
          <span>NAME</span>
          <span>LEVEL</span>
          <span>SERVICE</span>
          <span>PROVINCE</span>
          <span>ACTIVE</span>
          <span className="text-right">DATA</span>
          <span className="text-right">ACTIONS</span>
        </div>
        {hospitals.length === 0 ? (
          <div className="px-3 py-6 text-center text-[13px] text-[var(--ink-navy-dim)]">
            ยังไม่มีโรงพยาบาลในระบบ — กด &ldquo;เพิ่มโรงพยาบาล&rdquo;
          </div>
        ) : (
          hospitals.map((h) => (
            <div
              key={h.hcode}
              className="grid grid-cols-[90px,1fr,70px,130px,120px,60px,90px,110px] items-center border-b px-3 py-2 text-sm last:border-b-0"
              style={{ borderColor: 'var(--rule-hair)', color: 'var(--ink-navy)' }}
            >
              <span className="font-mono text-[12px] text-[var(--ink-navy-dim)]">{h.hcode}</span>
              <span className="flex items-center gap-2">
                <Building2 className="h-3.5 w-3.5 text-[var(--ink-navy-muted)]" />
                {h.name}
              </span>
              <span className="font-mono text-[11px]">{h.level}</span>
              <span className="font-mono text-[10px] text-[var(--ink-navy-dim)]">
                {SERVICE_TYPE_LABEL[h.serviceType ?? ''] ?? '—'}
              </span>
              <span className="font-mono text-[11px] text-[var(--ink-navy-dim)]">
                {h.provinceCode ? `${provinceByCode.get(h.provinceCode) ?? '-'} · ${h.provinceCode}` : '—'}
              </span>
              <span
                className="font-mono text-[11px]"
                style={{ color: h.isActive ? 'var(--risk-low)' : 'var(--ink-navy-muted)' }}
              >
                {h.isActive ? 'YES' : 'NO'}
              </span>
              <span className="flex justify-end">
                {(() => {
                  const total = dataCountsData?.counts?.[h.hcode]?.totalRows;
                  const perTable = dataCountsData?.counts?.[h.hcode]?.perTable;
                  if (dataCountsData === undefined) {
                    return (
                      <span className="font-mono text-[11px] text-[var(--ink-navy-muted)]">…</span>
                    );
                  }
                  const tooltip = perTable
                    ? Object.entries(perTable)
                        .filter(([, v]) => v > 0)
                        .map(([k, v]) => `${k}: ${v.toLocaleString('th-TH')}`)
                        .join('\n') || 'ไม่มีข้อมูล'
                    : 'ไม่มีข้อมูล';
                  return (
                    <button
                      type="button"
                      onClick={() => setEditHospital(h)}
                      title={`คลิกเพื่อจัดการข้อมูล\n${tooltip}`}
                      className="inline-flex items-center gap-1 border px-1.5 py-0.5 font-mono text-[11px] tabular-nums hover:bg-[var(--accent-navy-soft)]"
                      style={{
                        borderColor: 'var(--rule-strong)',
                        color: total && total > 0 ? 'var(--accent-navy)' : 'var(--ink-navy-muted)',
                        background: total && total > 0 ? 'var(--surface-cool)' : 'transparent',
                      }}
                      disabled={busy}
                    >
                      <Database className="h-3 w-3" />
                      {(total ?? 0).toLocaleString('th-TH')}
                    </button>
                  );
                })()}
              </span>
              <span className="flex justify-end gap-1">
                <button
                  onClick={() => setEditHospital(h)}
                  className="inline-flex items-center gap-1 border px-2 py-1 font-mono text-[11px] hover:bg-[var(--accent-navy-soft)]"
                  style={{ borderColor: 'var(--rule-strong)', color: 'var(--ink-navy-dim)' }}
                  disabled={busy}
                >
                  <Pencil className="h-3 w-3" />
                  แก้
                </button>
                <button
                  onClick={() => handleDelete(h)}
                  className="inline-flex items-center gap-1 border px-2 py-1 font-mono text-[11px] hover:bg-red-50"
                  style={{ borderColor: 'var(--rule-strong)', color: '#b91c1c' }}
                  disabled={busy}
                >
                  <Trash2 className="h-3 w-3" />
                  ลบ
                </button>
              </span>
            </div>
          ))
        )}
      </div>

      {/* Add dialog (MOPH registry picker) */}
      <Dialog open={addOpen} onOpenChange={(o) => !o && setAddOpen(false)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>เพิ่มโรงพยาบาลจากทะเบียน MOPH</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-[12px] text-[var(--ink-navy-dim)]">
              ค้นหาในจังหวัดปัจจุบัน ({provinceByCode.get(activeProvince) ?? activeProvince}) —
              มี {availableMoph.length} รายการที่ยังไม่ถูกเพิ่ม
            </p>
            <select
              value={pickedHcode}
              onChange={(e) => {
                setPickedHcode(e.target.value);
                const moph = availableMoph.find((m) => m.hcode === e.target.value);
                if (moph) setPickedLevel(guessLevel(moph.hospitalTypeId));
              }}
              className="h-9 w-full border bg-white px-2 font-mono text-sm"
              style={{ borderColor: 'var(--rule-strong)' }}
            >
              <option value="">— เลือกโรงพยาบาล —</option>
              {availableMoph.map((m) => (
                <option key={m.hcode} value={m.hcode}>
                  {m.hcode} · {m.name} {m.bedCount ? `(${m.bedCount} เตียง)` : ''}
                </option>
              ))}
            </select>
            <div>
              <label className="mb-1 block font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--ink-navy-muted)]">
                LEVEL
              </label>
              <select
                value={pickedLevel}
                onChange={(e) => setPickedLevel(e.target.value)}
                className="h-9 w-full border bg-white px-2 font-mono text-sm"
                style={{ borderColor: 'var(--rule-strong)' }}
              >
                {LEVEL_OPTIONS.map((l) => (
                  <option key={l} value={l}>
                    {l}
                  </option>
                ))}
              </select>
            </div>
            {addMessage ? (
              <div className="text-[12px]" style={{ color: '#b91c1c' }}>
                {addMessage}
              </div>
            ) : null}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setAddOpen(false)} disabled={busy}>
              ยกเลิก
            </Button>
            <Button onClick={handleAdd} disabled={busy || !pickedHcode} className="gap-1.5">
              <Plus className="h-4 w-4" /> เพิ่ม
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Comprehensive settings dialog */}
      <HospitalEditDialog
        hospital={editHospital}
        onClose={() => setEditHospital(null)}
        onSaved={async () => {
          // Refresh hospital list so the dialog sees updated fields on next open.
          const next = await mutate();
          const refreshed = next?.hospitals.find((h) => h.hcode === editHospital?.hcode);
          if (refreshed) setEditHospital(refreshed);
        }}
      />
    </div>
  );
}
