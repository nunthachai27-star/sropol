// Task 29: PatientDrawer shell — side-anchored sheet with 10 stub tabs.
// Tasks 30-39 will swap in real tab content where <TabPlaceholder/> sits.
'use client';

import { useEffect } from 'react';
import { X } from 'lucide-react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { cn, calculateAge } from '@/lib/utils';
import type { BedOccupancy } from '@/types/maternity-ward';
import { PartographTab } from '@/components/maternity/tabs/PartographTab';
import { VitalsTab } from '@/components/maternity/tabs/VitalsTab';
import { PreLabourTab } from '@/components/maternity/tabs/PreLabourTab';
import { StageTab } from '@/components/maternity/tabs/StageTab';
import { MedicationsTab } from '@/components/maternity/tabs/MedicationsTab';
import { StageMedTab } from '@/components/maternity/tabs/StageMedTab';
import { ComplicationsTab } from '@/components/maternity/tabs/ComplicationsTab';
import { InfantTab } from '@/components/maternity/tabs/InfantTab';

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

/** Stub content for each tab. Tasks 30-39 swap real content here. */
function TabPlaceholder({ name }: { name: string }) {
  return (
    <div className="p-4 text-sm text-slate-500">Tab: {name}</div>
  );
}

function safeAge(birthday: string | null): number | null {
  if (!birthday) return null;
  const parsed = new Date(birthday);
  if (Number.isNaN(parsed.getTime())) return null;
  return calculateAge(parsed);
}

function fullName(o: BedOccupancy): string {
  return [o.pname, o.fname, o.lname].filter(Boolean).join(' ').trim() || 'ไม่ระบุชื่อ';
}

function PatientHeader({ occupant }: { occupant: BedOccupancy }) {
  const age = safeAge(occupant.birthday);
  const name = fullName(occupant);
  const { an, gravida, ga, bedno } = occupant;

  return (
    <div className="flex flex-col gap-1 border-b border-slate-200 px-4 py-3">
      <div className="flex items-center gap-2 text-xs text-slate-500">
        <span className="font-mono font-medium text-slate-700">{an}</span>
        <span>·</span>
        <span>เตียง {bedno}</span>
      </div>
      <div className="text-base font-semibold text-slate-900">{name}</div>
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-600">
        {age !== null && <span>{age} ปี</span>}
        {gravida !== null && <span>G{gravida}</span>}
        {ga !== null && <span>GA{ga}</span>}
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
      {/* Sheet panel — slides in from right; full width on mobile, 60vw desktop. */}
      <div
        className={cn(
          'flex h-full w-full flex-col bg-white shadow-xl',
          'sm:w-[60vw] sm:max-w-[1100px]',
          'animate-in slide-in-from-right',
        )}
      >
        <div className="flex items-start justify-between">
          <div className="flex-1 min-w-0">
            {occupant ? (
              <PatientHeader occupant={occupant} />
            ) : (
              <div className="px-4 py-3 text-sm text-slate-500">
                กำลังโหลด… (Loading…)
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
          <div className="flex-1 overflow-hidden">
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
              <div className="flex-1 overflow-auto">
                {PATIENT_DRAWER_TABS.map((t) => (
                  <TabsContent key={t.value} value={t.value}>
                    {t.value === 'partograph' ? (
                      <PartographTab an={occupant.an} />
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
                    ) : (
                      <TabPlaceholder name={t.value} />
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
