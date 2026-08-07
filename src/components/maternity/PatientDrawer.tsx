// PatientDrawer — side-anchored sheet with 10 tabs, each backed by a real tab
// component (Partograph … Discharge). The original stub-placeholder fallback is
// gone now that every PATIENT_DRAWER_TABS value has its own branch.
'use client';

import { useEffect } from 'react';
import { X } from 'lucide-react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { cn, calculateAge } from '@/lib/utils';
import { maskName } from '@/lib/pii-mask';
import type { BedOccupancy } from '@/types/maternity-ward';
import { PartographTab } from '@/components/maternity/tabs/PartographTab';
import { VitalsTab } from '@/components/maternity/tabs/VitalsTab';
import { PreLabourTab } from '@/components/maternity/tabs/PreLabourTab';
import { StageTab } from '@/components/maternity/tabs/StageTab';
import { MedicationsTab } from '@/components/maternity/tabs/MedicationsTab';
import { StageMedTab } from '@/components/maternity/tabs/StageMedTab';
import { ComplicationsTab } from '@/components/maternity/tabs/ComplicationsTab';
import { InfantTab } from '@/components/maternity/tabs/InfantTab';
import { BedTab } from '@/components/maternity/tabs/BedTab';
import { DischargeTab } from '@/components/maternity/tabs/DischargeTab';

export interface PatientDrawerProps {
  open: boolean;
  occupant: BedOccupancy | null;
  onClose: () => void;
}

export interface TabDefinition {
  value: string;
  label: string;
}

// Tab order is meaningful — DO NOT reorder. Tasks 30-39 fill them in.
export const PATIENT_DRAWER_TABS: TabDefinition[] = [
  { value: 'partograph', label: 'Partograph' },
  { value: 'vitals', label: 'Vital Signs' },
  { value: 'prelabour', label: 'Pre-labour' },
  { value: 'stage', label: 'Stage' },
  { value: 'medications', label: 'Medications' },
  { value: 'stage-med', label: 'DR Med' },
  { value: 'complications', label: 'Complications' },
  { value: 'infant', label: 'Infant' },
  { value: 'bed', label: 'Bed' },
  { value: 'discharge', label: 'Discharge' },
];

function safeAge(birthday: string | null): number | null {
  if (!birthday) return null;
  const parsed = new Date(birthday);
  if (Number.isNaN(parsed.getTime())) return null;
  return calculateAge(parsed);
}

function fullName(o: BedOccupancy): string {
  const raw = [o.pname, o.fname, o.lname].filter(Boolean).join(' ').trim();
  if (!raw) return 'ไม่ระบุชื่อ';
  return maskName(raw);
}

function hasValue<T>(value: T | null | undefined): value is T {
  return value !== null && value !== undefined && value !== '';
}

function compactDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const [datePart] = value.split('T');
  const [y, m, d] = datePart.split('-').map(Number);
  if (!y || !m || !d) return null;
  return `${d}/${m}/${y + 543}`;
}

function compactTime(value: string | null | undefined): string | null {
  if (!value) return null;
  const [hh, mm] = value.split(':');
  if (!hh || !mm) return null;
  return `${hh}:${mm}`;
}

function formatAdmit(occupant: BedOccupancy): string {
  const date = compactDate(occupant.regdate);
  const time = compactTime(occupant.regtime);
  return [date, time].filter(Boolean).join(' ') || '—';
}

function formatLatestObservation(occupant: BedOccupancy): string | null {
  if (occupant.last_assess_date) {
    return [compactDate(occupant.last_assess_date), compactTime(occupant.last_assess_time)]
      .filter(Boolean)
      .join(' ');
  }
  if (!occupant.last_observation_at) return null;
  const [datePart, timePart] = occupant.last_observation_at.split('T');
  return [compactDate(datePart), compactTime(timePart)].filter(Boolean).join(' ');
}

function formatNumber(value: number | null | undefined, fractionDigits = 0): string | null {
  if (value === null || value === undefined || Number.isNaN(value)) return null;
  return fractionDigits > 0
    ? value.toFixed(fractionDigits).replace(/\.0+$/, '')
    : String(Math.round(value));
}

function formatBp(sys: number | null | undefined, dia: number | null | undefined): string | null {
  return sys !== null && sys !== undefined && dia !== null && dia !== undefined
    ? `${Math.round(sys)}/${Math.round(dia)}`
    : null;
}

function formatRoom(occupant: BedOccupancy): string {
  return occupant.roomname || occupant.roomno || '—';
}

function display(value: string | number | null | undefined): string {
  return hasValue(value) ? String(value) : '—';
}

function InfoField({
  label,
  value,
  className,
}: {
  label: string;
  value: string | number | null | undefined;
  className?: string;
}) {
  return (
    <div className={cn('min-w-0', className)}>
      <div className="text-[9px] font-semibold uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-0.5 whitespace-normal break-words text-[12px] font-semibold leading-tight text-slate-900">
        {display(value)}
      </div>
    </div>
  );
}

function VitalCell({
  label,
  value,
  tone = 'default',
}: {
  label: string;
  value: string | number | null | undefined;
  tone?: 'default' | 'vital' | 'labour' | 'warning';
}) {
  return (
    <div
      className={cn(
        'min-h-[42px] rounded border bg-white px-2 py-1.5',
        tone === 'vital' && 'border-cyan-200',
        tone === 'labour' && 'border-indigo-200',
        tone === 'warning' && 'border-amber-200',
        tone === 'default' && 'border-slate-200',
      )}
    >
      <div
        className={cn(
          'text-[9px] font-bold uppercase tracking-wide',
          tone === 'vital' && 'text-cyan-700',
          tone === 'labour' && 'text-indigo-700',
          tone === 'warning' && 'text-amber-700',
          tone === 'default' && 'text-slate-500',
        )}
      >
        {label}
      </div>
      <div className="mt-0.5 whitespace-nowrap font-mono text-[12px] font-bold leading-none tabular-nums text-slate-950">
        {display(value)}
      </div>
    </div>
  );
}

function PatientHeader({ occupant }: { occupant: BedOccupancy }) {
  const age = safeAge(occupant.birthday);
  const name = fullName(occupant);
  const {
    an,
    hn,
    gravida,
    ga,
    bedno,
    ward,
    incharge_doctor_name: doctor,
    blood_grp,
    allergy_count,
    pttype_name,
    prediag,
    admit_bw_kg,
    patient_height,
    last_bp_sys,
    last_bp_dia,
    last_temp,
    last_pulse,
    last_rr,
    last_spo2,
    last_spo2_o2,
    last_weight,
    last_height,
    last_bsa,
    last_cervix_cm,
    last_pain,
  } = occupant;
  const latestObservation = formatLatestObservation(occupant);
  const bp = formatBp(last_bp_sys, last_bp_dia);
  const displayWeight = formatNumber(last_weight ?? admit_bw_kg, 1);
  const displayHeight = formatNumber(last_height ?? patient_height);
  const bodyMetrics =
    [
      displayWeight ? `${displayWeight} kg` : null,
      displayHeight ? `${displayHeight} cm` : null,
      last_bsa ? `BSA ${formatNumber(last_bsa, 2)}` : null,
    ]
      .filter(Boolean)
      .join(' · ') || '—';
  const demographics =
    [
      age !== null ? `${age} ปี` : null,
      gravida !== null ? `G${gravida}` : null,
      ga !== null ? `GA ${ga}` : null,
    ]
      .filter(Boolean)
      .join(' · ') || '—';

  return (
    <div className="border-b border-slate-200 bg-white px-4 py-2.5">
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start">
        <div className="min-w-0">
          <div className="grid gap-2 md:grid-cols-[minmax(0,1.15fr)_minmax(0,1.35fr)] md:items-start">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 font-mono text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                <span className="text-slate-900">AN {an}</span>
                <span>HN {hn}</span>
                <span>Ward {ward}</span>
              </div>
              <div className="mt-0.5 whitespace-normal break-words text-lg font-semibold leading-tight text-slate-950">
                {name}
              </div>
              <div className="mt-0.5 text-xs font-medium text-slate-700">{demographics}</div>
            </div>

            <div className="grid min-w-0 grid-cols-2 gap-x-4 gap-y-1.5 border-t border-slate-100 pt-2 md:border-l md:border-t-0 md:pl-3 md:pt-0">
              <InfoField label="Admit" value={formatAdmit(occupant)} />
              <InfoField label="Doctor" value={doctor} />
              <InfoField label="Coverage" value={pttype_name} />
              <InfoField label="Body" value={bodyMetrics} />
            </div>
          </div>

          <div className="mt-2 grid gap-1.5 border-t border-slate-100 pt-2 md:grid-cols-[minmax(0,1fr)_220px] md:items-center">
            <InfoField label="อาการแรกรับ / Prediag" value={prediag} />
            <InfoField label="Latest charted" value={latestObservation} />
          </div>
        </div>

        <div className="grid grid-cols-[auto_auto] gap-2 lg:justify-end">
          <div className="grid grid-cols-2 overflow-hidden rounded border border-slate-300 bg-slate-50 text-center">
            <div className="border-r border-slate-300 px-2.5 py-1.5">
              <div className="text-[9px] font-bold uppercase tracking-wide text-slate-500">Bed</div>
              <div className="font-mono text-base font-bold leading-none text-slate-950">
                {bedno}
              </div>
            </div>
            <div className="px-2.5 py-1.5">
              <div className="text-[9px] font-bold uppercase tracking-wide text-slate-500">
                Room
              </div>
              <div className="font-mono text-base font-bold leading-none text-slate-950">
                {formatRoom(occupant)}
              </div>
            </div>
          </div>

          <div className="flex min-w-[118px] flex-col gap-1">
            {(allergy_count ?? 0) > 0 ? (
              <span className="rounded border border-rose-700 bg-rose-700 px-2 py-1 text-center text-[10px] font-bold uppercase tracking-wide text-white">
                Allergy {allergy_count}
              </span>
            ) : (
              <span className="rounded border border-emerald-600 bg-emerald-50 px-2 py-1 text-center text-[10px] font-bold uppercase tracking-wide text-emerald-700">
                NKDA
              </span>
            )}
            <span className="rounded border border-rose-200 bg-rose-50 px-2 py-1 text-center text-[10px] font-bold uppercase tracking-wide text-rose-700">
              Blood {blood_grp || '—'}
            </span>
          </div>
        </div>
      </div>

      <div className="mt-2 rounded-md border border-slate-200 bg-slate-50 p-2">
        <div className="grid grid-cols-5 gap-1.5 lg:grid-cols-10">
          <VitalCell label="BP" value={bp} tone="vital" />
          <VitalCell
            label="Temp"
            value={last_temp != null ? `${formatNumber(last_temp, 1)} °C` : null}
            tone="vital"
          />
          <VitalCell
            label="Pulse"
            value={last_pulse != null ? `${Math.round(last_pulse)}/min` : null}
            tone="vital"
          />
          <VitalCell
            label="RR"
            value={last_rr != null ? `${Math.round(last_rr)}/min` : null}
            tone="vital"
          />
          <VitalCell
            label="SpO2 RA"
            value={last_spo2 != null ? `${Math.round(last_spo2)}%` : null}
            tone="vital"
          />
          <VitalCell
            label="O2"
            value={last_spo2_o2 != null ? `${Math.round(last_spo2_o2)}%` : null}
            tone="vital"
          />
          <VitalCell
            label="Cx"
            value={last_cervix_cm != null ? `${last_cervix_cm} cm` : null}
            tone="labour"
          />
          <VitalCell
            label="Pain"
            value={last_pain != null ? `${last_pain}/10` : null}
            tone="warning"
          />
          <VitalCell label="GA" value={ga != null ? `${ga} wk` : null} tone="labour" />
          <VitalCell label="G" value={gravida != null ? gravida : null} tone="labour" />
        </div>
      </div>
    </div>
  );
}

export function PatientDrawer({ open, occupant, onClose }: PatientDrawerProps) {
  // Escape key handling — only when open, listener attached on document.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // Lock the page scroll while the drawer is open. Without this the bed-card
  // grid behind the backdrop receives mouse-wheel events when the drawer's
  // own scroll container reaches its top/bottom (scroll chaining). The inner
  // <div className="...overflow-auto overscroll-contain"> below also pins
  // wheel events to the drawer, but body lock is the belt to that suspenders.
  useEffect(() => {
    if (!open) return;
    if (typeof document === 'undefined') return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="ข้อมูลผู้ป่วย"
      className="fixed inset-0 z-50 flex"
    >
      {/* Backdrop — click outside to close. Not a button so screen readers don't
          announce a duplicate close affordance; the X button handles that. */}
      <div
        data-testid="patient-drawer-backdrop"
        aria-hidden="true"
        onClick={onClose}
        className="flex-1 cursor-default bg-black/30"
      />
      {/* Sheet panel — slides in from right; full width on mobile, 60vw desktop.
          min-h-0 + h-full pin the panel to the dialog's 100vh: without min-h-0,
          a tall tab (Discharge has 4 sections + chips) lets the panel grow
          past 100vh because flex items default to min-height:auto = content
          height. That growth defeats every overflow constraint downstream —
          the inner Tabs scroll wrapper never gets a finite size to scroll
          inside, and the bottom of the active tab falls below the dialog. */}
      <div
        className={cn(
          'flex h-full max-h-screen min-h-0 w-full flex-col bg-white shadow-xl',
          'sm:w-[60vw] sm:max-w-[1100px]',
          'animate-in slide-in-from-right',
        )}
      >
        <div className="flex items-start justify-between">
          <div className="flex-1 min-w-0">
            {occupant ? (
              <PatientHeader occupant={occupant} />
            ) : (
              <div
                className="flex flex-col gap-2 border-b border-slate-200 px-4 py-3"
                aria-busy="true"
              >
                {/* 3 skeleton rows mimic the AN/name/details lines while data
                    arrives. The visually-hidden text keeps the existing
                    "กำลังโหลด" / "Loading" assertion happy. */}
                <div
                  className="h-3 w-32 animate-pulse rounded bg-slate-200/70"
                  aria-hidden="true"
                />
                <div
                  className="h-4 w-48 animate-pulse rounded bg-slate-200/70"
                  aria-hidden="true"
                />
                <div
                  className="h-3 w-24 animate-pulse rounded bg-slate-200/70"
                  aria-hidden="true"
                />
                <span className="sr-only">กำลังโหลด… (Loading…)</span>
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="ปิด"
            className={cn(
              'm-2 inline-flex h-8 w-8 items-center justify-center rounded-md',
              'text-slate-500 hover:bg-slate-100 hover:text-slate-700',
              'focus:outline-none focus:ring-2 focus:ring-emerald-500',
            )}
          >
            <X className="h-4 w-4" aria-hidden />
            <span className="sr-only">ปิด</span>
          </button>
        </div>

        {occupant && (
          // min-h-0 here for the same flexbox-shrink reason as on the panel:
          // without it, the wrapper expands to fit the active Tabs's content
          // and the inner scroller never receives a bounded height.
          <div className="min-h-0 flex-1 overflow-hidden">
            <Tabs
              defaultValue={PATIENT_DRAWER_TABS[0].value}
              className="flex h-full min-h-0 flex-col gap-2 px-4 py-3"
            >
              <TabsList variant="line" className="h-auto flex-wrap justify-start gap-1">
                {PATIENT_DRAWER_TABS.map((t) => (
                  <TabsTrigger key={t.value} value={t.value}>
                    {t.label}
                  </TabsTrigger>
                ))}
              </TabsList>
              {/* min-h-0 is the critical bit: without it, the flex child
                  grows to fit its tallest tab's content rather than capping
                  at the parent's height, so overflow-auto has nothing to
                  scroll. The Discharge tab (4 sections) was the first to
                  surface this since other tabs fit within ~80vh. */}
              <div className="min-h-0 flex-1 overflow-auto overscroll-contain">
                {PATIENT_DRAWER_TABS.map((t) => (
                  <TabsContent key={t.value} value={t.value}>
                    {t.value === 'partograph' ? (
                      <PartographTab an={occupant.an} occupant={occupant} />
                    ) : t.value === 'vitals' ? (
                      <VitalsTab an={occupant.an} />
                    ) : t.value === 'prelabour' ? (
                      <PreLabourTab an={occupant.an} />
                    ) : t.value === 'stage' ? (
                      <StageTab an={occupant.an} />
                    ) : t.value === 'medications' ? (
                      <MedicationsTab an={occupant.an} />
                    ) : t.value === 'stage-med' ? (
                      <StageMedTab an={occupant.an} />
                    ) : t.value === 'complications' ? (
                      <ComplicationsTab an={occupant.an} />
                    ) : t.value === 'infant' ? (
                      <InfantTab an={occupant.an} />
                    ) : t.value === 'bed' ? (
                      <BedTab occupant={occupant} />
                    ) : (
                      // Terminal branch — the only remaining tab is 'discharge'.
                      // Every PATIENT_DRAWER_TABS value now has a real branch, so
                      // there is no placeholder fallback to render.
                      <DischargeTab occupant={occupant} />
                    )}
                  </TabsContent>
                ))}
              </div>
            </Tabs>
          </div>
        )}
      </div>
    </div>
  );
}
