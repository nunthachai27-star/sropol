// Bulk-add picker used from the ActiveProvince tab: lists every MOPH
// hospital in the currently-selected province that isn't already registered,
// each with a checkbox. A single OK click POSTs all checked rows into the
// operational `hospitals` table in parallel.
'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import useSWR from 'swr';
import { withBasePath } from '@/lib/base-path';
import { Plus, Check, Building2, AlertTriangle, Square, CheckSquare } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { LoadingState } from '@/components/shared/LoadingState';
import { HospitalLevel, HospitalServiceType } from '@/types/domain';

interface MophHospital {
  hcode: string;
  name: string;
  hospitalTypeId: number | null;
  bedCount: number | null;
  provinceCode: string | null;
  districtCode: string | null;
}

interface AdminHospital {
  hcode: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  /** 2-digit MOPH province code to pull MOPH candidates from. */
  provinceCode: string;
  /** Optional human name for the dialog title. */
  provinceName?: string;
  /** Called after at least one hospital is added successfully so the parent
   *  can revalidate its hospital list. */
  onAdded: () => Promise<void> | void;
}

// hospital_type_id → sensible default HospitalLevel guess per MOPH convention.
// Admin can fine-tune each hospital after bulk-add via the edit dialog.
function guessLevel(typeId: number | null): HospitalLevel {
  if (typeId === 5) return HospitalLevel.A_S;
  if (typeId === 6) return HospitalLevel.M1;
  if (typeId === 7) return HospitalLevel.F2;
  return HospitalLevel.F3;
}

// hospital_type_id 5 (A_S), 6 (M1), 7 (F2) are the tiers that typically have
// maternity wards and are the core of a provincial referral network. Pre-
// selected on dialog open so admins onboarding a new province only need to
// deselect outliers instead of checking 20+ rows.
const DEFAULT_PRESELECT_TYPE_IDS: ReadonlySet<number> = new Set([5, 6, 7]);

// hospital_type_id 5 (A_S / regional) → provincial hub. All others default
// to "has maternity ward" — operator can flip individual small F3 sites to
// DISTRICT_NO_MATERNITY from the edit dialog after.
function defaultServiceType(typeId: number | null): HospitalServiceType {
  if (typeId === 5) return HospitalServiceType.PROVINCIAL_HUB;
  return HospitalServiceType.DISTRICT_WITH_MATERNITY;
}

export function BulkAddHospitalsDialog(props: Props) {
  // Key the inner body on open+provinceCode so state (checkbox selection,
  // errors) resets when the dialog reopens or switches province — instead
  // of a setState-in-effect reset.
  return (
    <Dialog open={props.open} onOpenChange={(o) => !o && props.onClose()}>
      <DialogContent
        className="p-0"
        style={{ width: 'min(94vw, 1080px)', maxWidth: 'min(94vw, 1080px)' }}
      >
        <BulkAddBody key={`${props.open}-${props.provinceCode}`} {...props} />
      </DialogContent>
    </Dialog>
  );
}

function BulkAddBody({ open, onClose, provinceCode, provinceName, onAdded }: Props) {
  const { data: mophData, isLoading: mophLoading } = useSWR<{ hospitals: MophHospital[] }>(
    open ? `/api/admin/moph-hospitals?province=${provinceCode}` : null,
  );
  const { data: regData, isLoading: regLoading } = useSWR<{ hospitals: AdminHospital[] }>(
    open ? '/api/admin/hospitals' : null,
  );

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Array<{ hcode: string; error: string }>>([]);

  const available = useMemo(() => {
    const registered = new Set((regData?.hospitals ?? []).map((h) => h.hcode));
    return (mophData?.hospitals ?? []).filter((m) => !registered.has(m.hcode));
  }, [mophData, regData]);

  // Apply the A_S/M1/F2 preselect once per dialog open — the key-based
  // remount of BulkAddBody (see parent component) ensures this fires fresh
  // each time the dialog opens or the province changes. Ref-guarded so
  // later SWR revalidations don't clobber user edits.
  const presetAppliedRef = useRef(false);
  useEffect(() => {
    if (presetAppliedRef.current) return;
    if (!mophData || !regData) return;
    presetAppliedRef.current = true;
    const defaults = new Set<string>();
    for (const m of available) {
      if (m.hospitalTypeId !== null && DEFAULT_PRESELECT_TYPE_IDS.has(m.hospitalTypeId)) {
        defaults.add(m.hcode);
      }
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSelected(defaults);
  }, [mophData, regData, available]);

  const allSelected = available.length > 0 && selected.size === available.length;
  const toggle = (hcode: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(hcode)) next.delete(hcode);
      else next.add(hcode);
      return next;
    });
  };
  const toggleAll = () => {
    setSelected((prev) =>
      prev.size === available.length ? new Set() : new Set(available.map((m) => m.hcode)),
    );
  };

  const handleOk = async () => {
    if (selected.size === 0) return;
    setBusy(true);
    setErrors([]);

    const picks = available.filter((m) => selected.has(m.hcode));
    // Parallel POSTs — each hospital is independent and the admin API is
    // idempotent (duplicate hcode returns 409 which we capture per-row).
    const results = await Promise.all(
      picks.map(async (m) => {
        try {
          const res = await fetch(withBasePath('/api/admin/hospitals'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              hcode: m.hcode,
              name: m.name,
              level: guessLevel(m.hospitalTypeId),
              serviceType: defaultServiceType(m.hospitalTypeId),
              provinceCode: m.provinceCode,
              districtCode: m.districtCode,
              isActive: true,
            }),
          });
          if (!res.ok) {
            const err = (await res.json().catch(() => null)) as { error?: string } | null;
            return { hcode: m.hcode, error: err?.error ?? `HTTP ${res.status}` };
          }
          return null;
        } catch (e) {
          return { hcode: m.hcode, error: (e as Error).message };
        }
      }),
    );

    const failures = results.filter((r): r is { hcode: string; error: string } => r !== null);
    setErrors(failures);
    setBusy(false);

    // Refresh caller's list regardless — even on partial failure, successful
    // inserts should appear immediately.
    await onAdded();

    if (failures.length === 0) onClose();
  };

  const isLoading = mophLoading || regLoading;

  return (
    <>
      <DialogHeader className="border-b px-5 pt-4 pb-3"
        style={{ borderColor: 'var(--rule-strong)' }}
      >
        <DialogTitle className="flex flex-col gap-0.5">
          <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--ink-navy-muted)]">
            BULK ADD · จังหวัด {provinceCode}
          </div>
          <div className="text-[16px] font-semibold" style={{ color: 'var(--ink-navy)' }}>
            เพิ่มโรงพยาบาลในจังหวัด{provinceName ? ` ${provinceName}` : ''}
          </div>
        </DialogTitle>
      </DialogHeader>

        <div
          className="max-h-[65vh] overflow-y-auto px-5 py-4"
          style={{ background: 'var(--surface-cool)' }}
        >
          {isLoading ? (
            <LoadingState message="กำลังโหลดทะเบียน MOPH..." />
          ) : available.length === 0 ? (
            <div
              className="border bg-white px-4 py-6 text-center font-mono text-[12px] text-[var(--ink-navy-dim)]"
              style={{ borderColor: 'var(--rule-strong)' }}
            >
              ไม่มีโรงพยาบาลเหลืออยู่ในทะเบียน MOPH ของจังหวัดนี้ที่ยังไม่ถูกเพิ่ม
            </div>
          ) : (
            <>
              <div className="mb-2 flex items-center justify-between font-mono text-[11px]">
                <button
                  type="button"
                  onClick={toggleAll}
                  className="inline-flex items-center gap-1.5 border px-2 py-1 hover:bg-[var(--accent-navy-soft)]"
                  style={{
                    borderColor: 'var(--rule-strong)',
                    color: 'var(--ink-navy-dim)',
                  }}
                  disabled={busy}
                >
                  {allSelected ? (
                    <CheckSquare className="h-3.5 w-3.5" />
                  ) : (
                    <Square className="h-3.5 w-3.5" />
                  )}
                  {allSelected ? 'ยกเลิกเลือกทั้งหมด' : 'เลือกทั้งหมด'}
                </button>
                <span className="text-[var(--ink-navy-muted)]">
                  เลือกแล้ว {selected.size} / {available.length}
                </span>
              </div>

              <div className="border bg-white" style={{ borderColor: 'var(--rule-strong)' }}>
                <div
                  className="grid gap-2 border-b px-3 py-2 font-mono text-[10px] tracking-[0.1em] text-[var(--ink-navy-muted)]"
                  style={{
                    gridTemplateColumns: '40px 80px 1fr 60px 60px',
                    borderColor: 'var(--rule-strong)',
                  }}
                >
                  <span>✓</span>
                  <span>HCODE</span>
                  <span>NAME</span>
                  <span>LEVEL</span>
                  <span className="text-right">BEDS</span>
                </div>
                {available.map((m) => {
                  const isSel = selected.has(m.hcode);
                  const lvl = guessLevel(m.hospitalTypeId);
                  return (
                    <label
                      key={m.hcode}
                      className="grid cursor-pointer items-center gap-2 border-b px-3 py-2 text-[13px] hover:bg-[var(--accent-navy-soft)] last:border-b-0"
                      style={{
                        gridTemplateColumns: '40px 80px 1fr 60px 60px',
                        borderColor: 'var(--rule-hair)',
                        color: 'var(--ink-navy)',
                        background: isSel ? 'var(--accent-navy-soft)' : undefined,
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={isSel}
                        onChange={() => toggle(m.hcode)}
                        disabled={busy}
                        className="h-4 w-4"
                      />
                      <span className="font-mono text-[11px] text-[var(--ink-navy-dim)]">
                        {m.hcode}
                      </span>
                      <span className="flex items-center gap-1.5 truncate">
                        <Building2 className="h-3.5 w-3.5 text-[var(--ink-navy-muted)]" />
                        <span className="truncate">{m.name}</span>
                      </span>
                      <span className="font-mono text-[11px] text-[var(--ink-navy-dim)]">
                        {lvl}
                      </span>
                      <span className="text-right font-mono text-[11px] text-[var(--ink-navy-dim)]">
                        {m.bedCount ?? '—'}
                      </span>
                    </label>
                  );
                })}
              </div>

              <p className="mt-2 font-mono text-[10px] leading-snug text-[var(--ink-navy-muted)]">
                ระบบจะเลือก LEVEL จาก hospital_type_id และตั้ง service_type ให้ตามค่าเริ่มต้น —
                สามารถแก้ไขรายตัวได้ในแท็บ &ldquo;โรงพยาบาล&rdquo; หลังเพิ่ม
              </p>

              {errors.length > 0 ? (
                <div
                  className="mt-3 space-y-1 border px-3 py-2 font-mono text-[11px]"
                  style={{ borderColor: 'var(--risk-high)', color: 'var(--risk-high)' }}
                >
                  <div className="flex items-center gap-1.5 font-semibold">
                    <AlertTriangle className="h-3.5 w-3.5" />
                    เพิ่มไม่สำเร็จ {errors.length} รายการ
                  </div>
                  {errors.slice(0, 5).map((e) => (
                    <div key={e.hcode}>
                      · {e.hcode} — {e.error}
                    </div>
                  ))}
                  {errors.length > 5 ? <div>… และอีก {errors.length - 5} รายการ</div> : null}
                </div>
              ) : null}
            </>
          )}
        </div>

        <DialogFooter
          className="border-t px-5 py-3"
          style={{ borderColor: 'var(--rule-strong)' }}
        >
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            ยกเลิก
          </Button>
          <Button
            onClick={handleOk}
            disabled={busy || selected.size === 0 || available.length === 0}
            className="gap-1.5"
          >
            {busy ? <Plus className="h-4 w-4 animate-pulse" /> : <Check className="h-4 w-4" />}
            {busy ? `กำลังเพิ่ม ${selected.size}...` : `เพิ่ม ${selected.size} แห่ง`}
          </Button>
        </DialogFooter>
    </>
  );
}
