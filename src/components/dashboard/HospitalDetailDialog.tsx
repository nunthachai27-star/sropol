// HospitalDetailDialog — opens when the user clicks a hospital on the map
// or a row in the HospitalTable. Shows an informative snapshot without
// navigating away from the dashboard: counts, HIGH/MED patients at that
// hospital, sync state, plus a deep link to the full hospital page.
'use client';

import Link from 'next/link';
import { Building2, ExternalLink, Radio, WifiOff, CircleHelp } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { HighRiskPatientList, type HighRiskPatient } from './HighRiskPatientList';
import { RiskBar, StatCell } from './shared';
import { Badge } from '@/components/ui/badge';
import { ConnectionStatus as ConnectionStatusEnum } from '@/types/domain';
import { HOSPITAL_CAPABILITIES } from '@/config/hospital-capabilities';
import { HOSPITAL_COORDS } from '@/data/kk-hospital-coords';
import type { DashboardHospital } from '@/types/api';
import { formatRelativeTime } from '@/lib/utils';
import { cn } from '@/lib/utils';

interface HospitalDetailDialogProps {
  hcode: string | null;
  hospital?: DashboardHospital;
  allHighRiskPatients: HighRiskPatient[];
  open: boolean;
  onClose: () => void;
}

function ConnectionPill({ status }: { status: ConnectionStatusEnum | string }) {
  if (status === ConnectionStatusEnum.ONLINE) {
    return (
      <span className="inline-flex items-center gap-1 rounded-sm bg-emerald-50 px-2 py-0.5 font-mono text-[12px] font-semibold tracking-[0.08em] text-emerald-700">
        <Radio className="h-3 w-3" /> ONLINE
      </span>
    );
  }
  if (status === ConnectionStatusEnum.OFFLINE) {
    return (
      <span className="inline-flex items-center gap-1 rounded-sm bg-red-50 px-2 py-0.5 font-mono text-[12px] font-semibold tracking-[0.08em] text-red-700">
        <WifiOff className="h-3 w-3" /> OFFLINE
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-sm bg-slate-100 px-2 py-0.5 font-mono text-[12px] font-semibold tracking-[0.08em] text-slate-600">
      <CircleHelp className="h-3 w-3" /> UNKNOWN
    </span>
  );
}

export function HospitalDetailDialog({
  hcode,
  hospital,
  allHighRiskPatients,
  open,
  onClose,
}: HospitalDetailDialogProps) {
  const capability = hcode ? HOSPITAL_CAPABILITIES.find((c) => c.hcode === hcode) : undefined;
  const coord = hcode ? HOSPITAL_COORDS[hcode] : undefined;
  const patients = hcode ? allHighRiskPatients.filter((p) => p.hcode === hcode) : [];

  const counts = hospital?.counts ?? { low: 0, medium: 0, high: 0, total: 0 };
  const referTo = capability?.referTo;
  const referToHospital = referTo ? HOSPITAL_CAPABILITIES.find((c) => c.hcode === referTo) : null;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent
        className="!max-w-[880px] w-[95vw] max-h-[90vh] gap-0 overflow-hidden p-0 sm:max-w-[880px]"
        style={{ background: 'var(--surface-cool)' }}
      >
        <DialogHeader
          className="flex flex-row items-start justify-between gap-4 border-b px-5 py-3"
          style={{ borderColor: 'var(--rule-strong)', background: 'var(--accent-navy)' }}
        >
          <div className="min-w-0">
            <DialogTitle className="flex items-center gap-2 text-[18px] font-semibold text-white">
              <Building2 className="h-5 w-5" />
              <span className="truncate">{hospital?.name ?? capability?.name ?? hcode ?? '—'}</span>
            </DialogTitle>
            <DialogDescription className="mt-1 flex flex-wrap items-center gap-2 font-mono text-[13px] tracking-[0.08em] text-white/80">
              <span>{hcode ?? ''}</span>
              {hospital?.level && (
                <Badge variant="outline" className="bg-white/10 text-white border-white/30">
                  {hospital.level}
                </Badge>
              )}
              {hospital && <ConnectionPill status={hospital.connectionStatus} />}
              {coord && (
                <span>
                  {coord.lat.toFixed(4)}°N · {coord.lon.toFixed(4)}°E
                  <span className="ml-1 opacity-60">
                    ({coord.source === 'osm' ? 'OSM' : 'district centroid'})
                  </span>
                </span>
              )}
            </DialogDescription>
          </div>
          {hcode && (
            <Link
              href={`/hospitals/${hcode}`}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-sm bg-white px-3 py-1.5 font-mono text-[13px] font-semibold tracking-[0.08em] text-[var(--accent-navy-strong)] hover:bg-white/90"
              onClick={onClose}
            >
              <ExternalLink className="h-3.5 w-3.5" /> Full page
            </Link>
          )}
        </DialogHeader>

        <div className="overflow-y-auto" style={{ maxHeight: 'calc(90vh - 72px)' }}>
          {/* 01 — Active labor vitals */}
          <section className="grid bg-white" style={{ gridTemplateColumns: '1.3fr 1fr 1fr 1fr' }}>
            <div
              className="border-b border-r px-5 py-4"
              style={{ borderColor: 'var(--rule-strong)' }}
            >
              <div className="font-mono text-[12px] uppercase tracking-[0.14em] text-[var(--ink-navy-muted)]">
                ACTIVE LABOR · AT THIS HOSPITAL
              </div>
              <div className="mt-1.5 flex items-baseline gap-2.5">
                <div
                  className="font-mono text-[40px] font-semibold leading-none text-[var(--ink-navy)] tabular-nums"
                  style={{ letterSpacing: '-0.02em' }}
                >
                  {counts.total}
                </div>
                <div className="font-mono text-[13px] text-[var(--ink-navy-dim)]">เคส</div>
              </div>
              <div className="mt-2.5">
                <RiskBar
                  low={counts.low}
                  medium={counts.medium}
                  high={counts.high}
                  height={6}
                  showNums
                />
              </div>
            </div>
            <StatCell
              label="HIGH"
              value={counts.high}
              color="var(--risk-high)"
              className="border-b border-[var(--rule-strong)]"
            />
            <StatCell
              label="MEDIUM"
              value={counts.medium}
              color="var(--risk-medium)"
              className="border-b border-[var(--rule-strong)]"
            />
            <StatCell
              label="LOW"
              value={counts.low}
              color="var(--risk-low)"
              className="border-b border-[var(--rule-strong)]"
            />
          </section>

          {/* 02 — Capability metadata */}
          <section
            className="border-b bg-white px-5 py-3"
            style={{ borderColor: 'var(--rule-strong)' }}
          >
            <div className="grid grid-cols-4 gap-4 text-[14px]">
              <div>
                <div className="font-mono text-[12px] uppercase tracking-[0.12em] text-[var(--ink-navy-muted)]">
                  GA threshold
                </div>
                <div className="mt-0.5 font-semibold text-[var(--ink-navy)]">
                  {capability ? `≥ ${capability.minGaWeeks} wks` : '—'}
                </div>
              </div>
              <div>
                <div className="font-mono text-[12px] uppercase tracking-[0.12em] text-[var(--ink-navy-muted)]">
                  FW threshold
                </div>
                <div className="mt-0.5 font-semibold text-[var(--ink-navy)]">
                  {capability ? `≥ ${capability.minFetalWeightG} g` : '—'}
                </div>
              </div>
              <div>
                <div className="font-mono text-[12px] uppercase tracking-[0.12em] text-[var(--ink-navy-muted)]">
                  Max risk accepted
                </div>
                <div className="mt-0.5 font-semibold text-[var(--ink-navy)]">
                  {capability?.maxRiskLevel ?? '—'}
                </div>
              </div>
              <div>
                <div className="font-mono text-[12px] uppercase tracking-[0.12em] text-[var(--ink-navy-muted)]">
                  Refers to
                </div>
                <div className="mt-0.5 font-semibold text-[var(--ink-navy)]">
                  {referTo ? (
                    <Link
                      href={`/hospitals/${referTo}`}
                      className="hover:underline"
                      onClick={onClose}
                    >
                      {referToHospital?.name ?? referTo}
                    </Link>
                  ) : (
                    <span className="text-[var(--ink-navy-muted)]">
                      terminal (no onward referral)
                    </span>
                  )}
                </div>
              </div>
            </div>
          </section>

          {/* 03 — Sync info */}
          <section
            className="border-b bg-white px-5 py-3"
            style={{ borderColor: 'var(--rule-strong)' }}
          >
            <div className="flex items-center justify-between font-mono text-[13px] text-[var(--ink-navy-dim)]">
              <span>
                Last sync:{' '}
                <span
                  className={cn(
                    'font-semibold',
                    hospital?.lastSyncAt
                      ? 'text-[var(--ink-navy)]'
                      : 'text-[var(--ink-navy-muted)]',
                  )}
                >
                  {hospital?.lastSyncAt ? formatRelativeTime(hospital.lastSyncAt) : 'never'}
                </span>
              </span>
              <span>
                {hospital?.lastSyncAt
                  ? new Date(hospital.lastSyncAt).toLocaleString('th-TH', {
                      timeZone: 'Asia/Bangkok',
                    })
                  : ''}
              </span>
            </div>
          </section>

          {/* 04 — HIGH/MED patients at this hospital */}
          <section className="bg-white px-5 py-4">
            {patients.length === 0 ? (
              <div className="py-6 text-center font-mono text-[13px] text-[var(--ink-navy-muted)]">
                ไม่มีผู้ป่วยที่ต้องเฝ้าระวังที่โรงพยาบาลนี้
              </div>
            ) : (
              <HighRiskPatientList
                patients={patients}
                totalActive={counts.total}
                totalHigh={counts.high}
              />
            )}
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
}
