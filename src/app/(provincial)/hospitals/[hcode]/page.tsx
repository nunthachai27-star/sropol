// Hospital console — Mission Console + Detail layout. Redesigned 2026-04-30.
// Two registries (LABOR WARD currently admitted + ANC REGISTRY pregnant
// women followed at this hospital) share a single split-pane: tabbed list
// on the left, rich preview on the right. Top KPI strip mixes signals from
// both populations so concerns surface even from the inactive tab.
//
// Replaces the prior teal/rounded card-grid that didn't match the rest of
// the app's air-traffic-control aesthetic and only ever showed labor data.
'use client';

import { use, useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import useSWR from 'swr';
import { maskName } from '@/lib/pii-mask';
import {
  classifyPartographCoverage,
  needsPartographNudge,
  PARTOGRAPH_QUALITY,
  STALE_ADMISSION,
} from '@/config/hospital-network';
import { KpiTip } from '@/components/shared/KpiTip';
import { formatRelativeAge } from '@/lib/relative-time';
import { useSetBreadcrumbs } from '@/components/layout/BreadcrumbContext';
import { LoadingState } from '@/components/shared/LoadingState';
import { ErrorState } from '@/components/shared/ErrorState';
import { ConnectionStatus } from '@/components/shared/ConnectionStatus';
import { ANC_RISK_RULES } from '@/config/anc-risk-rules';
import { buildPatientId } from '@/lib/utils';
import { ConnectionStatus as ConnectionStatusEnum } from '@/types/domain';
import type {
  JourneyListResponse,
  JourneyListItem,
  JourneyDetailResponse,
  AncVisitEntry,
  AncRiskEntry,
} from '@/types/api';
import { ArrowLeft, ChevronRight, ExternalLink } from 'lucide-react';

// ─── Types ──────────────────────────────────────────────────────────────

interface LaborPatient {
  id: string;
  hn: string;
  an: string;
  name: string;
  age: number;
  gravida: number | null;
  ga_weeks: number | null;
  anc_count: number | null;
  admit_date: string;
  labor_status: string;
  cpd_score: number | null;
  cpd_risk_level: string | null;
  latest_vitals?: {
    maternal_hr: number | null;
    fetal_hr: string | null;
    sbp: number | null;
    dbp: number | null;
  } | null;
  latest_cervix_cm?: number | null;
  /** NULL until the first partograph observation syncs (then 0+). */
  partograph_alert_count?: number | null;
}

interface PartographAuditAdmission {
  an: string;
  name: string;
  admitDate: string;
  laborStatus: string;
  observationCount: number;
  lastObservedAt: string | null;
}

interface PartographAudit {
  windowDays: number;
  laborRecent: number;
  withPartograph: number;
  admissions: PartographAuditAdmission[];
}

interface HospitalInfo {
  name: string;
  level: string;
  connectionStatus: string;
  lastSyncAt: string | null;
}

interface LaborResponse {
  hospital?: HospitalInfo;
  patients: LaborPatient[];
  /** True COUNT(*) over the ward census — the rows above are a paged subset. */
  pagination?: { total: number };
  partographAudit?: PartographAudit | null;
}

type TabKey = 'labor' | 'anc';

// Response shape for /api/hospitals/[hcode]/incoming-pregnancies
interface IncomingTermPregnancyItem {
  id: string;
  hn: string;
  name: string;
  age: number;
  gravida: number;
  para: number;
  gaWeeks: number | null;
  efwG: number | null;
  edc: string | null;
  ancRiskLevel: string;
  ancVisitCount: number;
  fromHcode: string;
  fromHospitalName: string;
  daysToEdc: number | null;
  triggers: Array<'GA' | 'FW' | 'RISK'>;
}
interface IncomingPregnanciesResponse {
  hubHcode: string;
  minGaWeeks: number;
  count: number;
  byTrigger: { ga: number; fw: number; risk: number };
  items: IncomingTermPregnancyItem[];
}

// ─── Helpers ────────────────────────────────────────────────────────────

const RULE_BY_ID = new Map(ANC_RISK_RULES.map((r) => [r.id, r]));

function laborTier(level: string | null): 'high' | 'medium' | 'low' {
  if (level === 'HIGH') return 'high';
  if (level === 'MEDIUM') return 'medium';
  return 'low';
}

function ancTier(level: string | null): 'high' | 'medium' | 'low' {
  if (level === 'HR3') return 'high';
  if (level === 'HR2' || level === 'HR1') return 'medium';
  return 'low';
}

function tierColor(tier: 'high' | 'medium' | 'low'): string {
  return tier === 'high'
    ? 'var(--risk-high)'
    : tier === 'medium'
      ? 'var(--risk-medium)'
      : 'var(--risk-low)';
}

function gaTrimester(weeks: number | null): 'T3' | 'T2' | 'T1' | 'unknown' {
  if (weeks == null) return 'unknown';
  if (weeks >= 28) return 'T3';
  if (weeks >= 13) return 'T2';
  return 'T1';
}

function hoursSince(iso: string | null): number | null {
  if (!iso) return null;
  return (Date.now() - new Date(iso).getTime()) / 3600000;
}

function daysSince(iso: string | null): number | null {
  if (!iso) return null;
  return (Date.now() - new Date(iso).getTime()) / 86400000;
}

function formatEdc(
  edcIso: string | null,
  gaWeeks: number | null,
): { daysToEdc: number | null; edcText: string } {
  if (!edcIso) {
    return { daysToEdc: null, edcText: '—' };
  }
  const d = (new Date(edcIso).getTime() - Date.now()) / 86400000;
  const days = Math.round(d);
  if (days < 0) return { daysToEdc: days, edcText: `เลย ${Math.abs(days)} วัน` };
  if (days === 0) return { daysToEdc: 0, edcText: 'วันนี้' };
  return { daysToEdc: days, edcText: `${days} วัน` };
}

function laborConcerns(p: LaborPatient): Array<{ label: string; warn?: boolean }> {
  const out: Array<{ label: string; warn?: boolean }> = [];
  const v = p.latest_vitals;
  if (v?.sbp != null && v?.dbp != null) {
    if (v.sbp >= 160 || v.dbp >= 110) out.push({ label: 'BP↑↑' });
    else if (v.sbp >= 140 || v.dbp >= 90) out.push({ label: 'BP↑', warn: true });
  }
  if (v?.fetal_hr) {
    const fhr = parseInt(v.fetal_hr, 10);
    if (Number.isFinite(fhr)) {
      if (fhr > 160 || fhr < 110) out.push({ label: 'FHR↯' });
    }
  }
  const hrs = hoursSince(p.admit_date);
  if (hrs != null && hrs >= 12) out.push({ label: `${Math.floor(hrs)}h admit`, warn: true });
  if ((p.cpd_score ?? 0) >= 40) out.push({ label: 'CPD↑' });
  // Long-stay prompt — the usual cause is a skipped HOSxP discharge entry
  // (dchdate never filled in), so name that action instead of just the age.
  if (
    p.labor_status === 'ACTIVE' &&
    hrs != null &&
    hrs / 24 >= STALE_ADMISSION.checkDischargeAfterDays
  ) {
    out.push({ label: 'ตรวจสอบจำหน่าย', warn: true });
  }
  // Charting nudge — ACTIVE past the grace window with no partograph at all.
  // Absence used to read as "fine"; make it an explicit ward-level prompt.
  if (
    p.labor_status === 'ACTIVE' &&
    needsPartographNudge(p.admit_date, p.partograph_alert_count ?? null)
  ) {
    out.push({ label: 'NO PARTO', warn: true });
  }
  return out;
}

// ─── Partograph charting audit panel ────────────────────────────────────────
// The /hospitals board scores charting coverage; this panel names the actual
// uncharted admissions in the window so the provincial team can cite specific
// cases when following up with the ward.
const AUDIT_STATUS_TH: Record<string, string> = {
  ACTIVE: 'รอคลอด',
  DELIVERED: 'คลอดแล้ว',
  DISCHARGED: 'จำหน่าย',
  TRANSFERRED: 'ส่งต่อ',
};

function fmtAuditDate(iso: string): string {
  return new Date(iso).toLocaleDateString('th-TH', {
    timeZone: 'Asia/Bangkok',
    month: 'short',
    day: 'numeric',
  });
}

function PartographAuditPanel({ audit }: { audit: PartographAudit | null | undefined }) {
  if (!audit || audit.laborRecent === 0) return null;
  const cls = classifyPartographCoverage(audit.laborRecent, audit.withPartograph);
  const pct = Math.round((audit.withPartograph / audit.laborRecent) * 100);
  const color =
    cls === 'ok' ? 'var(--risk-low)' : cls === 'warn' ? 'var(--risk-medium)' : 'var(--risk-high)';
  const uncharted = audit.admissions.filter((a) => a.observationCount === 0);
  return (
    <div
      className="mt-4 border bg-white"
      data-testid="partograph-audit"
      style={{ borderColor: 'var(--rule-strong)', borderLeft: `3px solid ${color}` }}
    >
      <div
        className="flex flex-wrap items-baseline justify-between gap-2 px-3 py-2"
        style={{ borderBottom: '1px solid var(--rule-strong)' }}
      >
        <KpiTip
          title="คุณภาพการบันทึก Partograph"
          body={`ผู้คลอดที่รับใหม่ใน ${audit.windowDays} วันที่ผ่านมา และมีบันทึก partograph อย่างน้อย 1 จุด — รายชื่อด้านล่างคือรายที่ยังไม่มีบันทึกเลย ใช้ติดตามกับห้องคลอดได้เป็นรายกรณี`}
          trigger={
            <div className="cursor-help font-mono text-[12px] uppercase tracking-[0.14em] text-[var(--ink-navy-muted)]" />
          }
        >
          PARTOGRAPH QUALITY · {audit.windowDays}D
        </KpiTip>
        <span className="font-mono text-[14px] font-semibold tabular-nums" style={{ color }}>
          {pct}%{' '}
          <span className="font-normal text-[12px] text-[var(--ink-navy-muted)]">
            ({audit.withPartograph}/{audit.laborRecent} ราย)
          </span>
        </span>
      </div>
      {uncharted.length === 0 ? (
        <div className="px-3 py-2 font-mono text-[12px]" style={{ color: 'var(--risk-low)' }}>
          บันทึกครบทุกราย
        </div>
      ) : (
        <div className="max-h-56 overflow-y-auto">
          {uncharted.map((a) => (
            <div
              key={a.an}
              className="flex flex-wrap items-center gap-2 border-b px-3 py-1.5 text-[13px]"
              style={{ borderColor: 'var(--rule-hair)' }}
            >
              <span
                className="border px-1 py-px font-mono text-[11px] font-semibold"
                style={{ color: 'var(--risk-high)', borderColor: 'var(--risk-high)' }}
              >
                ไม่มีบันทึก
              </span>
              <span className="text-[var(--ink-navy)]">{maskName(a.name)}</span>
              <span className="font-mono text-[11px] text-[var(--ink-navy-muted)]">
                AN {a.an} · ADMIT {fmtAuditDate(a.admitDate)} ·{' '}
                {AUDIT_STATUS_TH[a.laborStatus] ?? a.laborStatus}
              </span>
            </div>
          ))}
          <div className="px-3 py-1.5 font-mono text-[11px] text-[var(--ink-navy-muted)]">
            บันทึกแล้ว {audit.withPartograph} ราย · ยังไม่บันทึก {uncharted.length} ราย
          </div>
        </div>
      )}
    </div>
  );
}

function ancConcerns(j: JourneyListItem): Array<{ label: string; warn?: boolean }> {
  const out: Array<{ label: string; warn?: boolean }> = [];
  if (j.ancRiskLevel === 'HR3') out.push({ label: 'HR3' });
  const last = daysSince(j.lastAncDate);
  if (last != null && last >= 14) out.push({ label: 'ขาดนัด' });
  const edc = j.edc ? Math.round((new Date(j.edc).getTime() - Date.now()) / 86400000) : null;
  if (edc != null && edc <= 7 && edc >= 0) out.push({ label: 'ใกล้คลอด', warn: true });
  if (edc != null && edc < 0) out.push({ label: 'หลัง EDC' });
  return out;
}

// ─── Small UI helpers ───────────────────────────────────────────────────

function ConcernChip({ label, warn }: { label: string; warn?: boolean }) {
  return (
    <span
      className="ml-1.5 inline-block rounded-sm px-1.5 py-0.5 align-middle font-mono text-[10px] tracking-[0.06em]"
      style={{
        background: warn ? '#fff5d8' : '#fde2dc',
        color: warn ? '#92660b' : '#9b2c1c',
        fontWeight: 700,
      }}
    >
      {label}
    </span>
  );
}

interface KpiProps {
  group: 'LABOR' | 'ANC' | 'REFER-IN';
  label: string;
  value: string;
  unit?: string;
  sub?: React.ReactNode;
  valueColor?: string;
  riskMix?: { low: number; medium: number; high: number };
}

function KpiCell({ group, label, value, unit, sub, valueColor, riskMix }: KpiProps) {
  return (
    <div className="relative px-5 py-3" style={{ borderRight: '1px solid var(--rule-strong)' }}>
      <div
        className="absolute right-3 top-1 font-mono text-[8px] tracking-[0.16em] opacity-50"
        style={{ color: 'var(--ink-navy-muted)' }}
      >
        {group}
      </div>
      <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--ink-navy-muted)]">
        {label}
      </div>
      <div
        className="mt-1 font-mono text-[26px] font-semibold leading-none tabular-nums"
        style={{ color: valueColor ?? 'var(--ink-navy)', letterSpacing: '-0.02em' }}
      >
        {value}
        {unit && (
          <span className="ml-1.5 text-[12px] font-normal text-[var(--ink-navy-muted)]">
            {unit}
          </span>
        )}
      </div>
      {sub && <div className="mt-1 font-mono text-[11px] text-[var(--ink-navy-dim)]">{sub}</div>}
      {riskMix && riskMix.low + riskMix.medium + riskMix.high > 0 && (
        <div
          className="mt-2 flex h-1 overflow-hidden rounded-sm"
          style={{ background: 'var(--rule-hair)' }}
        >
          <span style={{ background: 'var(--risk-low)', flex: riskMix.low }} />
          <span style={{ background: 'var(--risk-medium)', flex: riskMix.medium }} />
          <span style={{ background: 'var(--risk-high)', flex: riskMix.high }} />
        </div>
      )}
    </div>
  );
}

interface SigProps {
  label: string;
  value: string;
  unit?: string;
  sub?: string;
  alarm?: boolean;
  warn?: boolean;
}

function Sig({ label, value, unit, sub, alarm, warn }: SigProps) {
  const color = alarm ? '#9b2c1c' : warn ? '#92660b' : 'var(--ink-navy)';
  return (
    <div className="border-r border-[var(--rule-strong)] px-3 py-2.5 last:border-r-0">
      <div className="font-mono text-[9px] uppercase tracking-[0.12em] text-[var(--ink-navy-muted)]">
        {label}
      </div>
      <div
        className="mt-0.5 font-mono text-[20px] font-semibold leading-tight tabular-nums"
        style={{ color, letterSpacing: '-0.02em' }}
      >
        {value}
        {unit && (
          <span className="ml-1 text-[10px] font-normal text-[var(--ink-navy-muted)]">{unit}</span>
        )}
      </div>
      {sub && (
        <div
          className="mt-0.5 font-mono text-[10px]"
          style={{ color: alarm ? '#9b2c1c' : 'var(--ink-navy-muted)' }}
        >
          {sub}
        </div>
      )}
    </div>
  );
}

// ─── Roster rows ────────────────────────────────────────────────────────

interface LaborRowProps {
  p: LaborPatient;
  isSelected: boolean;
  onSelect: () => void;
  onOpen: () => void;
}

function LaborRow({ p, isSelected, onSelect, onOpen }: LaborRowProps) {
  const tier = laborTier(p.cpd_risk_level);
  const concerns = laborConcerns(p);
  const cervix = p.latest_cervix_cm;
  const admitH = hoursSince(p.admit_date);
  return (
    <button
      type="button"
      onMouseEnter={onSelect}
      onClick={onOpen}
      className="grid w-full items-center text-left transition-colors"
      style={{
        gridTemplateColumns: '4px 1fr 60px 90px 70px 14px',
        gap: 10,
        padding: '8px 12px 8px 0',
        border: '1px solid var(--rule-strong)',
        borderTop: 'none',
        height: 56,
        background: isSelected ? 'var(--accent-navy-soft)' : 'white',
        borderLeft: isSelected ? '3px solid var(--accent-navy)' : undefined,
        cursor: 'pointer',
      }}
    >
      <div style={{ height: '100%', alignSelf: 'stretch', background: tierColor(tier) }} />
      <div>
        <div className="text-[13px] font-medium text-[var(--ink-navy)] leading-tight">
          {maskName(p.name)}
          {concerns.slice(0, 2).map((c) => (
            <ConcernChip key={c.label} label={c.label} warn={c.warn} />
          ))}
        </div>
        <div className="mt-0.5 font-mono text-[11px] text-[var(--ink-navy-muted)]">
          {p.age}y · G{p.gravida ?? '-'} · AN {p.an}
        </div>
      </div>
      <div className="text-center font-mono text-[11px] text-[var(--ink-navy-dim)]">
        {p.ga_weeks != null ? `${p.ga_weeks}w` : '—'}
      </div>
      <div className="flex flex-col">
        <span className="font-mono text-[9px] uppercase tracking-[0.1em] text-[var(--ink-navy-muted)]">
          CERVIX
        </span>
        <span className="font-mono text-[12px] font-semibold text-[var(--ink-navy)]">
          {cervix != null ? `${cervix} cm` : '—'}
        </span>
      </div>
      <div
        className="text-right font-mono text-[12px] font-semibold tabular-nums"
        style={{ color: tierColor(tier) }}
      >
        {p.cpd_score != null ? `${p.cpd_score}%` : '—'}
        {admitH != null && (
          <div className="font-mono text-[9px] font-normal text-[var(--ink-navy-muted)]">
            {Math.floor(admitH)}h
          </div>
        )}
      </div>
      <ChevronRight className="h-3.5 w-3.5" style={{ color: 'var(--ink-navy-muted)' }} />
    </button>
  );
}

interface AncRowProps {
  j: JourneyListItem;
  isSelected: boolean;
  onSelect: () => void;
  onOpen: () => void;
}

function AncRow({ j, isSelected, onSelect, onOpen }: AncRowProps) {
  const tier = ancTier(j.ancRiskLevel);
  const concerns = ancConcerns(j);
  const lastDays = daysSince(j.lastAncDate);
  const lastOverdue = lastDays != null && lastDays >= 14;
  return (
    <button
      type="button"
      onMouseEnter={onSelect}
      onClick={onOpen}
      className="grid w-full items-center text-left transition-colors"
      style={{
        gridTemplateColumns: '4px 1fr 60px 80px 80px 14px',
        gap: 10,
        padding: '8px 12px 8px 0',
        border: '1px solid var(--rule-strong)',
        borderTop: 'none',
        height: 60,
        background: isSelected ? 'var(--accent-navy-soft)' : 'white',
        borderLeft: isSelected ? '3px solid var(--accent-navy)' : undefined,
        cursor: 'pointer',
      }}
    >
      <div style={{ height: '100%', alignSelf: 'stretch', background: tierColor(tier) }} />
      <div>
        <div className="text-[13px] font-medium text-[var(--ink-navy)] leading-tight">
          {maskName(j.name)}
          {concerns.slice(0, 2).map((c) => (
            <ConcernChip key={c.label} label={c.label} warn={c.warn} />
          ))}
        </div>
        <div className="mt-0.5 font-mono text-[11px] text-[var(--ink-navy-muted)]">
          {j.age}y · G{j.gravida ?? '-'}P{j.para ?? 0} · HN {j.hn}
        </div>
      </div>
      <div className="text-center font-mono text-[11px] text-[var(--ink-navy-dim)]">
        <span className="text-[14px] font-semibold text-[var(--ink-navy)]">{j.gaWeeks ?? '—'}</span>
        <span className="opacity-60">w</span>
      </div>
      <div className="flex flex-col">
        <span className="font-mono text-[9px] uppercase tracking-[0.1em] text-[var(--ink-navy-muted)]">
          VISITS
        </span>
        <span className="font-mono text-[12px] font-semibold text-[var(--ink-navy)]">
          {j.ancVisitCount}/8
        </span>
      </div>
      <div className="flex flex-col">
        <span className="font-mono text-[9px] uppercase tracking-[0.1em] text-[var(--ink-navy-muted)]">
          LAST ANC
        </span>
        <span
          className="font-mono text-[11px]"
          style={{
            color: lastOverdue ? '#9b2c1c' : 'var(--ink-navy-dim)',
            fontWeight: lastOverdue ? 700 : 400,
          }}
        >
          {formatRelativeAge(j.lastAncDate)}
        </span>
      </div>
      <ChevronRight className="h-3.5 w-3.5" style={{ color: 'var(--ink-navy-muted)' }} />
    </button>
  );
}

// ─── Section headers (trimester / stage groupings) ──────────────────────

function GroupHeader({
  title,
  sub,
  count,
  hr,
}: {
  title: string;
  sub?: string;
  count: number;
  hr?: number;
}) {
  return (
    <div
      className="flex items-center justify-between px-3 py-1.5"
      style={{
        background: 'var(--accent-navy-soft)',
        border: '1px solid var(--rule-strong)',
        borderBottom: 'none',
      }}
    >
      <div>
        <span className="font-mono text-[11px] uppercase tracking-[0.14em] font-semibold text-[var(--accent-navy)]">
          {title}
        </span>
        {sub && (
          <span className="ml-2 font-mono text-[10px] text-[var(--ink-navy-muted)]">{sub}</span>
        )}
      </div>
      <div className="font-mono text-[11px] font-semibold text-[var(--accent-navy)] tabular-nums">
        {count}
        {hr != null && hr > 0 && <span className="ml-2 text-[var(--risk-high)]">· HR3 {hr}</span>}
      </div>
    </div>
  );
}

// ─── Empty preview state ────────────────────────────────────────────────

function EmptyPreview({ message }: { message: string }) {
  return (
    <div
      className="flex h-full flex-col items-center justify-center p-10 text-center"
      style={{ minHeight: 480 }}
    >
      <div className="font-mono text-[11px] uppercase tracking-[0.14em] text-[var(--ink-navy-muted)]">
        SELECT A PATIENT
      </div>
      <p className="mt-2 max-w-sm text-[12px] text-[var(--ink-navy-dim)]">{message}</p>
    </div>
  );
}

// ─── Labor preview pane ─────────────────────────────────────────────────

function LaborPreview({ patient, hcode }: { patient: LaborPatient; hcode: string }) {
  const router = useRouter();
  const tier = laborTier(patient.cpd_risk_level);
  const concerns = laborConcerns(patient);
  const v = patient.latest_vitals;
  const fhr = v?.fetal_hr ? parseInt(v.fetal_hr, 10) : null;
  const fhrAlarm = fhr != null && (fhr > 160 || fhr < 110);
  const sbpAlarm = v?.sbp != null && v.sbp >= 160;
  const sbpWarn = !sbpAlarm && v?.sbp != null && v.sbp >= 140;
  const dbpAlarm = v?.dbp != null && v.dbp >= 110;
  const dbpWarn = !dbpAlarm && v?.dbp != null && v.dbp >= 90;
  const bpAlarm = sbpAlarm || dbpAlarm;
  const bpWarn = !bpAlarm && (sbpWarn || dbpWarn);
  const admitH = hoursSince(patient.admit_date);
  return (
    <div className="space-y-4">
      <div
        className="bg-white p-4 pb-3"
        style={{
          border: '1px solid var(--rule-strong)',
          borderLeft: `4px solid ${tierColor(tier)}`,
        }}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[18px] font-bold leading-tight text-[var(--ink-navy)]">
              {maskName(patient.name)}
            </div>
            <div className="mt-1 font-mono text-[12px] text-[var(--ink-navy-muted)]">
              {patient.age}y · G{patient.gravida ?? '-'} · HN {patient.hn} · AN {patient.an}
            </div>
            {concerns.length > 0 && (
              <div className="mt-1.5 flex flex-wrap gap-1">
                {concerns.map((c) => (
                  <ConcernChip key={c.label} label={c.label} warn={c.warn} />
                ))}
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={() => router.push(`/patients/${buildPatientId(hcode, patient.an)}`)}
            className="inline-flex items-center gap-1 border bg-white px-2.5 py-1 font-mono text-[11px] uppercase tracking-[0.06em]"
            style={{ borderColor: 'var(--accent-navy)', color: 'var(--accent-navy)' }}
          >
            เปิดรายละเอียด <ExternalLink className="h-3 w-3" />
          </button>
        </div>
        <div
          className="mt-3 grid"
          style={{
            gridTemplateColumns: 'repeat(4, 1fr)',
            border: '1px solid var(--rule-strong)',
          }}
        >
          <Sig
            label="BP"
            value={v?.sbp != null && v?.dbp != null ? `${v.sbp}/${v.dbp}` : '—'}
            alarm={bpAlarm}
            warn={bpWarn}
            sub={bpAlarm ? '↑↑ severe-PE' : bpWarn ? '↑ borderline' : 'normal'}
          />
          <Sig
            label="MHR"
            value={v?.maternal_hr != null ? String(v.maternal_hr) : '—'}
            unit="bpm"
          />
          <Sig
            label="FHR"
            value={v?.fetal_hr ?? '—'}
            unit="bpm"
            alarm={fhrAlarm}
            sub={fhrAlarm ? (fhr! > 160 ? '↑ tachy' : '↓ brady') : 'normal'}
          />
          <Sig
            label="CPD"
            value={patient.cpd_score != null ? `${patient.cpd_score}%` : '—'}
            sub={patient.cpd_risk_level ?? '—'}
            alarm={tier === 'high'}
            warn={tier === 'medium'}
          />
        </div>
      </div>

      <div>
        <div
          className="mb-2 flex items-baseline justify-between border-b pb-1"
          style={{ borderColor: 'var(--rule-strong)' }}
        >
          <div className="font-mono text-[11px] font-semibold tracking-[0.1em] text-[var(--ink-navy)]">
            <span className="text-[var(--ink-navy-muted)] mr-1.5">02</span>STAGE / PROGRESS
          </div>
          <div className="font-mono text-[10px] tracking-[0.08em] text-[var(--ink-navy-muted)]">
            {patient.labor_status}
          </div>
        </div>
        <div
          className="grid bg-white"
          style={{
            gridTemplateColumns: 'repeat(4, 1fr)',
            border: '1px solid var(--rule-strong)',
          }}
        >
          <Sig
            label="GA"
            value={patient.ga_weeks != null ? String(patient.ga_weeks) : '—'}
            unit="w"
          />
          <Sig
            label="ANC"
            value={patient.anc_count != null ? String(patient.anc_count) : '—'}
            unit="/8"
            warn={(patient.anc_count ?? 0) < 5}
          />
          <Sig
            label="CERVIX"
            value={patient.latest_cervix_cm != null ? String(patient.latest_cervix_cm) : '—'}
            unit="cm"
          />
          <Sig
            label="ADMIT"
            value={admitH != null ? `${Math.floor(admitH)}` : '—'}
            unit="ชม."
            warn={admitH != null && admitH >= 12}
            alarm={admitH != null && admitH >= 24}
          />
        </div>
      </div>
    </div>
  );
}

// ─── ANC preview pane ───────────────────────────────────────────────────

function AncPreview({ journeyId, hcode }: { journeyId: string; hcode: string }) {
  const router = useRouter();
  const { data, error, isLoading } = useSWR<JourneyDetailResponse>(
    journeyId ? `/api/journeys/${journeyId}` : null,
    { refreshInterval: 60000 },
  );

  // Hooks must run unconditionally — sort visits before any early return.
  // SWR returns the same `data.ancVisits` reference across re-renders until a
  // new fetch lands, so depending on it directly is referentially stable.
  const visitsChrono = useMemo(() => {
    const v = data?.ancVisits ?? [];
    return [...v].sort((a, b) => new Date(a.visitDate).getTime() - new Date(b.visitDate).getTime());
  }, [data?.ancVisits]);

  if (isLoading) {
    return <EmptyPreview message="กำลังโหลดข้อมูลฝากครรภ์…" />;
  }
  if (error || !data?.journey) {
    return (
      <EmptyPreview message={error instanceof Error ? error.message : 'ไม่พบข้อมูลฝากครรภ์'} />
    );
  }

  const journey = data.journey;
  const risk = data.latestRisk;
  const tier = ancTier(journey.ancRiskLevel);
  const { daysToEdc, edcText } = formatEdc(journey.edc, journey.gaWeeks);
  const lastAncRel = formatRelativeAge(journey.lastAncDate);
  const lastDays = daysSince(journey.lastAncDate);
  const overdue = lastDays != null && lastDays >= 14;

  // Build a rough EDC progress percentage. 40 weeks total; we cap at 99
  // so the marker doesn't disappear at exactly term.
  const edcPct =
    journey.gaWeeks != null ? Math.min(99, Math.max(0, (journey.gaWeeks / 40) * 100)) : 0;
  const sbpVals = visitsChrono.map((v) => v.bpSystolic).filter((x): x is number => x != null);
  const dbpVals = visitsChrono.map((v) => v.bpDiastolic).filter((x): x is number => x != null);

  return (
    <div className="space-y-4">
      {/* Identity card */}
      <div
        className="bg-white p-4 pb-3"
        style={{
          border: '1px solid var(--rule-strong)',
          borderLeft: `4px solid ${tierColor(tier)}`,
        }}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[18px] font-bold leading-tight text-[var(--ink-navy)]">
              {maskName(journey.name)}
            </div>
            <div className="mt-1 font-mono text-[12px] text-[var(--ink-navy-muted)]">
              {journey.age}y · G{journey.gravida ?? '-'}P{journey.para ?? 0} · HN {journey.hn}
            </div>
            {(risk?.triggeredRules?.length ?? 0) > 0 && (
              <div className="mt-1.5 flex flex-wrap gap-1">
                {(risk?.triggeredRules ?? []).slice(0, 4).map((rid) => {
                  const r = RULE_BY_ID.get(rid);
                  if (!r) return null;
                  return (
                    <ConcernChip
                      key={rid}
                      label={r.level}
                      warn={r.level === 'HR1' || r.level === 'HR2'}
                    />
                  );
                })}
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={() => router.push(`/pregnancies/${journey.id}`)}
            className="inline-flex items-center gap-1 whitespace-nowrap border bg-white px-2.5 py-1 font-mono text-[11px] uppercase tracking-[0.06em]"
            style={{ borderColor: 'var(--accent-navy)', color: 'var(--accent-navy)' }}
          >
            เปิดรายละเอียด <ExternalLink className="h-3 w-3" />
          </button>
        </div>

        <div
          className="mt-3 grid"
          style={{
            gridTemplateColumns: 'repeat(4, 1fr)',
            border: '1px solid var(--rule-strong)',
          }}
        >
          <Sig
            label="RISK"
            value={journey.ancRiskLevel ?? 'LOW'}
            alarm={tier === 'high'}
            warn={tier === 'medium'}
            sub={`${risk?.triggeredRules?.length ?? 0} rules`}
          />
          <Sig
            label="GA"
            value={journey.gaWeeks != null ? String(journey.gaWeeks) : '—'}
            unit="w"
          />
          <Sig label="VISITS" value={`${journey.ancVisitCount}`} unit="/8" />
          <Sig
            label="LAST"
            value={lastAncRel}
            alarm={overdue}
            sub={overdue ? 'ขาดนัด' : 'on track'}
          />
        </div>
      </div>

      {/* Pregnancy timeline bar */}
      <div>
        <div
          className="mb-2 flex items-baseline justify-between border-b pb-1"
          style={{ borderColor: 'var(--rule-strong)' }}
        >
          <div className="font-mono text-[11px] font-semibold tracking-[0.1em] text-[var(--ink-navy)]">
            <span className="text-[var(--ink-navy-muted)] mr-1.5">02</span>PREGNANCY TIMELINE
          </div>
          <div className="font-mono text-[10px] tracking-[0.08em] text-[var(--ink-navy-muted)]">
            {journey.lmp ? `LMP ${journey.lmp.slice(0, 10)}` : 'LMP —'}
            {journey.edc ? ` · EDC ${journey.edc.slice(0, 10)}` : ''}
          </div>
        </div>
        <div className="bg-white p-3" style={{ border: '1px solid var(--rule-strong)' }}>
          <div className="mb-2 flex justify-between font-mono text-[11px] text-[var(--ink-navy-muted)]">
            <span>
              GA:{' '}
              <span className="font-semibold text-[var(--ink-navy)]">
                {journey.gaWeeks != null ? `${journey.gaWeeks}w` : '—'}
              </span>
            </span>
            <span>
              EDC ใน{' '}
              <span
                className="font-semibold"
                style={{
                  color: daysToEdc != null && daysToEdc <= 7 ? '#92660b' : 'var(--ink-navy)',
                }}
              >
                {edcText}
              </span>
            </span>
          </div>
          <div
            className="relative h-2 overflow-hidden rounded-sm"
            style={{ background: 'var(--rule-hair)' }}
          >
            <span
              className="block h-full"
              style={{ width: `${edcPct}%`, background: 'var(--accent-navy)' }}
            />
          </div>
          <div className="mt-1 flex justify-between font-mono text-[9px] uppercase tracking-[0.08em] text-[var(--ink-navy-muted)]">
            <span>LMP</span>
            <span>T1 12w</span>
            <span>T2 27w</span>
            <span>T3 36w</span>
            <span>EDC 40w</span>
          </div>
        </div>
      </div>

      {/* Risk rules triggered */}
      {risk && risk.triggeredRules.length > 0 && (
        <div>
          <div
            className="mb-2 flex items-baseline justify-between border-b pb-1"
            style={{ borderColor: 'var(--rule-strong)' }}
          >
            <div className="font-mono text-[11px] font-semibold tracking-[0.1em] text-[var(--ink-navy)]">
              <span className="text-[var(--ink-navy-muted)] mr-1.5">03</span>
              RISK RULES TRIGGERED
            </div>
            <div className="font-mono text-[10px] tracking-[0.08em] text-[var(--ink-navy-muted)]">
              screened {risk.screenedAt.slice(0, 10)}
            </div>
          </div>
          <div className="bg-white" style={{ border: '1px solid var(--rule-strong)' }}>
            {risk.triggeredRules.map((rid) => {
              const r = RULE_BY_ID.get(rid);
              if (!r) {
                return (
                  <div
                    key={rid}
                    className="flex items-center gap-2 px-3 py-1.5 text-[12px]"
                    style={{ borderBottom: '1px solid var(--rule-hair)' }}
                  >
                    <span className="font-mono text-[10px] text-[var(--ink-navy-muted)]">
                      {rid}
                    </span>
                  </div>
                );
              }
              const isHr3 = r.level === 'HR3';
              const isHr2 = r.level === 'HR2';
              const bg = isHr3 ? '#fde2dc' : isHr2 ? '#fff5d8' : 'rgba(234,179,8,0.18)';
              const ink = isHr3 ? '#9b2c1c' : '#92660b';
              return (
                <div
                  key={rid}
                  className="grid items-center gap-2 px-3 py-1.5 text-[12px]"
                  style={{
                    gridTemplateColumns: '60px 1fr auto',
                    borderBottom: '1px solid var(--rule-hair)',
                  }}
                >
                  <span
                    className="text-center font-mono text-[10px] font-bold"
                    style={{ background: bg, color: ink, padding: '2px 0' }}
                  >
                    {r.level}
                  </span>
                  <span className="text-[var(--ink-navy)]">{r.labelTh}</span>
                  <span className="font-mono text-[10px] text-[var(--ink-navy-muted)]">
                    {r.source.replace(/_/g, ' ')}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* BP sparkline across ANC visits */}
      {visitsChrono.length >= 2 && (sbpVals.length >= 2 || dbpVals.length >= 2) && (
        <div>
          <div
            className="mb-2 flex items-baseline justify-between border-b pb-1"
            style={{ borderColor: 'var(--rule-strong)' }}
          >
            <div className="font-mono text-[11px] font-semibold tracking-[0.1em] text-[var(--ink-navy)]">
              <span className="text-[var(--ink-navy-muted)] mr-1.5">04</span>
              ANC VISIT TIMELINE · BP
            </div>
            <div className="font-mono text-[10px] tracking-[0.08em] text-[var(--ink-navy-muted)]">
              {visitsChrono.length} visits · {journey.ancVisitCount} expected
            </div>
          </div>
          <div
            className="relative bg-white"
            style={{ border: '1px solid var(--rule-strong)', height: 110, padding: 8 }}
          >
            <BpSparkline visits={visitsChrono} />
          </div>
        </div>
      )}

      {/* Lab snapshot */}
      <div>
        <div
          className="mb-2 flex items-baseline justify-between border-b pb-1"
          style={{ borderColor: 'var(--rule-strong)' }}
        >
          <div className="font-mono text-[11px] font-semibold tracking-[0.1em] text-[var(--ink-navy)]">
            <span className="text-[var(--ink-navy-muted)] mr-1.5">05</span>
            LAB SNAPSHOT
          </div>
          <div className="font-mono text-[10px] tracking-[0.08em] text-[var(--ink-navy-muted)]">
            booking + latest
          </div>
        </div>
        <div
          className="grid bg-white"
          style={{
            gridTemplateColumns: 'repeat(4, 1fr)',
            border: '1px solid var(--rule-strong)',
          }}
        >
          <LabCell
            label="GROUP"
            value={
              journey.bloodGroup
                ? `${journey.bloodGroup} ${journey.rhFactor === 'NEG' ? 'Rh-' : journey.rhFactor === 'POS' ? 'Rh+' : ''}`.trim()
                : null
            }
          />
          <LabCell label="HBSAG" value={journey.hbsagResult} />
          <LabCell label="VDRL" value={journey.vdrlResult} />
          <LabCell label="HIV" value={journey.hivResult} />
          <LabCell label="OGTT" value={journey.ogttResult} alarmIfMatches={['ABNORMAL', 'POS']} />
          <LabCell label="DCIP" value={journey.dcipResult} alarmIfMatches={['POS']} />
          <LabCell label="HbE" value={journey.hbEResult} alarmIfMatches={['POS']} />
          <LabCell label="GBS" value={journey.gbsResult} alarmIfMatches={['POS']} />
        </div>
      </div>
    </div>
  );
}

function LabCell({
  label,
  value,
  alarmIfMatches,
}: {
  label: string;
  value: string | null | undefined;
  alarmIfMatches?: string[];
}) {
  const isAlarm = !!value && (alarmIfMatches ?? []).includes(value);
  const isPending = value === 'PENDING';
  const display = value ?? '—';
  return (
    <div
      className="px-3 py-2"
      style={{
        borderRight: '1px solid var(--rule-hair)',
        borderBottom: '1px solid var(--rule-hair)',
      }}
    >
      <div className="font-mono text-[9px] uppercase tracking-[0.12em] text-[var(--ink-navy-muted)]">
        {label}
      </div>
      <div
        className="mt-0.5 font-mono text-[12px] font-semibold"
        style={{
          color: isAlarm ? '#9b2c1c' : isPending ? 'var(--ink-navy-muted)' : 'var(--ink-navy)',
          fontWeight: isAlarm ? 700 : isPending ? 400 : 600,
        }}
      >
        {display}
      </div>
    </div>
  );
}

function BpSparkline({ visits }: { visits: AncVisitEntry[] }) {
  // Visit BP plot. We map 50→160 mmHg vertically. SBP solid navy, DBP dashed
  // dim. Latest dot risk-colored by SBP threshold.
  const W = 580;
  const H = 90;
  const vMin = 50;
  const vMax = 170;
  const xStep = visits.length > 1 ? W / (visits.length - 1) : W;
  const yFor = (mmhg: number) => H - ((mmhg - vMin) / (vMax - vMin)) * H;

  const sbpPts = visits
    .map((v, i) => (v.bpSystolic != null ? `${i * xStep},${yFor(v.bpSystolic)}` : null))
    .filter((s): s is string => !!s)
    .join(' ');
  const dbpPts = visits
    .map((v, i) => (v.bpDiastolic != null ? `${i * xStep},${yFor(v.bpDiastolic)}` : null))
    .filter((s): s is string => !!s)
    .join(' ');

  return (
    <svg width="100%" height="100%" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
      <line
        x1="0"
        y1={yFor(140)}
        x2={W}
        y2={yFor(140)}
        stroke="var(--rule-hair)"
        strokeDasharray="3 2"
      />
      <line
        x1="0"
        y1={yFor(90)}
        x2={W}
        y2={yFor(90)}
        stroke="var(--rule-hair)"
        strokeDasharray="3 2"
      />
      {sbpPts && (
        <polyline points={sbpPts} fill="none" stroke="var(--accent-navy)" strokeWidth="1.8" />
      )}
      {dbpPts && (
        <polyline
          points={dbpPts}
          fill="none"
          stroke="var(--ink-navy-muted)"
          strokeWidth="1.4"
          strokeDasharray="3 2"
        />
      )}
      {visits.map((v, i) => {
        if (v.bpSystolic == null) return null;
        const isLast = i === visits.length - 1;
        const alarm = v.bpSystolic >= 140;
        const fill = isLast
          ? alarm
            ? 'var(--risk-high)'
            : 'var(--accent-navy)'
          : alarm
            ? 'var(--risk-medium)'
            : 'var(--risk-low)';
        return (
          <circle key={i} cx={i * xStep} cy={yFor(v.bpSystolic)} r={isLast ? 4 : 3} fill={fill} />
        );
      })}
    </svg>
  );
}

// ─── Main page ──────────────────────────────────────────────────────────

export default function HospitalConsolePage({ params }: { params: Promise<{ hcode: string }> }) {
  const { hcode } = use(params);
  const router = useRouter();
  const [tab, setTab] = useState<TabKey>('labor');
  const [selectedLabor, setSelectedLabor] = useState<string | null>(null);
  const [selectedAnc, setSelectedAnc] = useState<string | null>(null);
  // Frozen render-time anchor — react-hooks/purity forbids bare Date.now()
  // in render code. SWR's 60s refresh re-derives KPIs from new data anyway,
  // so a per-mount snapshot is fine; we don't need a continuously ticking
  // now for "EDC in N days"–style copy.
  const [now] = useState<number>(() => Date.now());

  const {
    data: laborData,
    isLoading: laborLoading,
    error: laborError,
    mutate: laborMutate,
    // Without per_page the route defaults to 20 rows — below the historical
    // ward-census peak (34–39), so the floor roster silently dropped the
    // oldest admissions and every KPI undercounted. 500 covers any real
    // census; the registered-KPI itself reads pagination.total regardless.
  } = useSWR<LaborResponse>(`/api/hospitals/${hcode}/patients?per_page=500`, {
    refreshInterval: 30000,
  });
  const {
    data: ancData,
    isLoading: ancLoading,
    error: ancError,
    mutate: ancMutate,
    // per_page must exceed the largest hospital registry (435 today) or the
    // roster silently drops women — KPIs no longer depend on it (they read the
    // server's DB-wide counts), but the visible list should still be complete.
  } = useSWR<JourneyListResponse>(
    `/api/hospitals/${hcode}/journeys?stage=PREGNANCY&per_page=1000`,
    {
      refreshInterval: 60000,
    },
  );
  // Pregnancies elsewhere whose capability rules say they'll be referred
  // here for delivery. Only meaningful for hub hospitals (spokes return 0).
  const { data: incomingData } = useSWR<IncomingPregnanciesResponse>(
    `/api/hospitals/${hcode}/incoming-pregnancies?min_ga=34`,
    { refreshInterval: 60000 },
  );
  const incomingCount = incomingData?.count ?? 0;
  const incomingItems = useMemo(() => incomingData?.items ?? [], [incomingData?.items]);

  const hospital = laborData?.hospital;
  const hospitalName = hospital?.name ?? `รหัส ${hcode}`;
  useSetBreadcrumbs([
    { label: 'แดชบอร์ด', href: '/' },
    { label: 'โรงพยาบาล', href: '/hospitals' },
    { label: hospitalName },
  ]);

  const labor = useMemo(() => {
    const list = laborData?.patients ?? [];
    const order: Record<string, number> = { HIGH: 0, MEDIUM: 1, LOW: 2 };
    return [...list].sort(
      (a, b) => (order[a.cpd_risk_level ?? 'LOW'] ?? 3) - (order[b.cpd_risk_level ?? 'LOW'] ?? 3),
    );
  }, [laborData]);
  // True ward census from the server COUNT — same contract as ancTotal below.
  const laborTotal = laborData?.pagination?.total ?? labor.length;

  // Stable reference for downstream memos — `ancData?.journeys ?? []` would
  // otherwise create a new array on every render.
  const journeys = useMemo(() => ancData?.journeys ?? [], [ancData]);

  // Effective selection — derived (not synchronized via effect, which React
  // 19 flags as cascading-render). If the user-clicked id still exists in
  // the latest data, keep it; otherwise fall back to a sensible default
  // (first-by-risk for labor, highest-risk for ANC).
  const effectiveLabor = useMemo(() => {
    if (selectedLabor && labor.some((p) => p.an === selectedLabor)) return selectedLabor;
    return labor[0]?.an ?? null;
  }, [selectedLabor, labor]);
  const effectiveAnc = useMemo(() => {
    if (selectedAnc && journeys.some((j) => j.id === selectedAnc)) return selectedAnc;
    if (journeys.length === 0) return null;
    const o: Record<string, number> = { HR3: 0, HR2: 1, HR1: 2, LOW: 3 };
    const sorted = [...journeys].sort(
      (a, b) => (o[a.ancRiskLevel] ?? 4) - (o[b.ancRiskLevel] ?? 4),
    );
    return sorted[0].id;
  }, [selectedAnc, journeys]);

  // Group ANC by trimester for the list view
  const ancByTrimester = useMemo(() => {
    const groups: Record<'T3' | 'T2' | 'T1' | 'unknown', JourneyListItem[]> = {
      T3: [],
      T2: [],
      T1: [],
      unknown: [],
    };
    for (const j of journeys) groups[gaTrimester(j.gaWeeks)].push(j);
    const o: Record<string, number> = { HR3: 0, HR2: 1, HR1: 2, LOW: 3 };
    for (const k of Object.keys(groups) as Array<keyof typeof groups>) {
      groups[k].sort((a, b) => (o[a.ancRiskLevel] ?? 4) - (o[b.ancRiskLevel] ?? 4));
    }
    return groups;
  }, [journeys]);

  // KPI computation. All `Date.now`-using counters are wrapped in useMemo —
  // React 19's purity rule flags impure calls in render code, and bundling
  // them into a memo is also faster (recomputes only when data changes).
  const laborAlarmCount = useMemo(
    () => labor.filter((p) => laborConcerns(p).some((c) => !c.warn)).length,
    [labor],
  );
  const laborSecondStage = useMemo(
    () => labor.filter((p) => (p.latest_cervix_cm ?? 0) >= 8 && p.labor_status === 'ACTIVE').length,
    [labor],
  );
  const laborMix = useMemo(() => {
    const m = { low: 0, medium: 0, high: 0 };
    for (const p of labor) {
      const t = laborTier(p.cpd_risk_level);
      if (t === 'high') m.high++;
      else if (t === 'medium') m.medium++;
      else m.low++;
    }
    return m;
  }, [labor]);

  // True registry size + risk mix come from the server's DB-wide aggregates
  // (pagination.total / counts) — deriving them from the fetched rows showed
  // the fetch cap as the registry size (e.g. "200" for 435 pregnancies).
  // Row-derived values remain only as a fallback for a cached response from
  // a build without `counts`.
  const ancTotal = ancData?.pagination.total ?? journeys.length;
  const ancMix = useMemo(() => {
    const c = ancData?.counts;
    if (c) return { low: c.low, medium: c.hr1 + c.hr2, high: c.hr3 };
    const m = { low: 0, medium: 0, high: 0 };
    for (const j of journeys) {
      const t = ancTier(j.ancRiskLevel);
      if (t === 'high') m.high++;
      else if (t === 'medium') m.medium++;
      else m.low++;
    }
    return m;
  }, [ancData?.counts, journeys]);
  const ancHr3 = ancMix.high;
  const ancOverdue = useMemo(
    () =>
      journeys.filter((j) => {
        const d = daysSince(j.lastAncDate);
        return d != null && d >= 14;
      }).length,
    [journeys],
  );
  const ancDueWeek = useMemo(
    () =>
      journeys.filter((j) => {
        if (!j.edc) return false;
        const d = (new Date(j.edc).getTime() - now) / 86400000;
        return d >= 0 && d <= 7;
      }).length,
    [journeys, now],
  );

  // Wait for BOTH primary feeds before painting — `&&` let the page render a
  // half-empty console the moment the faster feed resolved, so the labor tab
  // could flash "no patients" while its own fetch was still in flight.
  if (laborLoading || ancLoading) {
    return <LoadingState message="กำลังโหลดข้อมูลโรงพยาบาล…" />;
  }

  // Both primary feeds failed with nothing cached — there is no console to
  // show, so surface the failure with a retry that revalidates both.
  if (laborError && ancError && !laborData && !ancData) {
    return (
      <ErrorState
        message="ไม่สามารถโหลดข้อมูลโรงพยาบาลได้"
        detail={laborError instanceof Error ? laborError.message : String(laborError ?? ancError)}
        onRetry={() => {
          laborMutate();
          ancMutate();
        }}
      />
    );
  }

  return (
    <div
      style={{
        color: 'var(--ink-navy)',
        background: 'var(--surface-cool)',
        // 1.15 matches sister detail pages (/pregnancies/[id], /patients/[an]).
        // The parent /hospitals uses 1.3 because its layout is sparser; this
        // detail page has KPI strip + tabs + split list/preview, so 1.3
        // over-scaled the cell numbers (KPI 26px → 34px effective, Sig
        // 20px → 26px) and felt cramped.
        zoom: 1.15,
      }}
    >
      {/* Header */}
      <div
        className="flex flex-wrap items-center gap-3 bg-white px-5 py-2.5"
        style={{ borderBottom: '1px solid var(--rule-strong)' }}
      >
        <button
          onClick={() => router.push('/hospitals')}
          className="inline-flex items-center gap-1 border bg-white px-2.5 py-1 font-mono text-[11px] uppercase tracking-[0.06em] text-[var(--ink-navy-muted)]"
          style={{ borderColor: 'var(--rule-strong)' }}
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Back
        </button>
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--ink-navy-muted)]">
            PROVINCIAL REGISTRY · HOSPITAL · MISSION CONSOLE
          </div>
          <h1 className="mt-0.5 text-[24px] font-bold leading-tight tracking-tight text-[var(--ink-navy)]">
            {hospitalName}
          </h1>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {hospital?.level && (
            <span
              className="border px-2 py-0.5 font-mono text-[11px] tracking-[0.06em] text-[var(--ink-navy-dim)]"
              style={{ borderColor: 'var(--rule-strong)' }}
            >
              {hospital.level}
            </span>
          )}
          <span
            className="border px-2 py-0.5 font-mono text-[11px] tracking-[0.06em] text-[var(--ink-navy-dim)]"
            style={{ borderColor: 'var(--rule-strong)' }}
          >
            {hcode}
          </span>
          {hospital?.connectionStatus && (
            <ConnectionStatus
              status={hospital.connectionStatus as ConnectionStatusEnum}
              lastSyncAt={hospital.lastSyncAt ?? null}
              className="text-[11px]"
            />
          )}
        </div>
      </div>

      {/* Per-feed staleness banners — one feed can fail while the other keeps
          serving cached data, so name which registry went stale rather than
          replacing the whole console. */}
      {laborError && (
        <ErrorState
          variant="banner"
          message="โหลดข้อมูลห้องคลอดไม่สำเร็จ — แสดงข้อมูลเดิมจากแคช"
          onRetry={() => laborMutate()}
        />
      )}
      {ancError && (
        <ErrorState
          variant="banner"
          message="โหลดข้อมูลฝากครรภ์ไม่สำเร็จ — แสดงข้อมูลเดิมจากแคช"
          onRetry={() => ancMutate()}
        />
      )}

      {/* KPI strip — 7 cells: 3 LABOR + 3 ANC + 1 REFER-IN (hub-only signal) */}
      <div
        className="grid bg-white"
        style={{
          gridTemplateColumns: 'repeat(7, 1fr)',
          borderBottom: '1px solid var(--rule-strong)',
        }}
      >
        <KpiCell
          group="LABOR"
          label="ON FLOOR"
          value={String(laborTotal)}
          unit="ราย"
          riskMix={laborMix}
        />
        <KpiCell
          group="LABOR"
          label="ALARMS"
          value={String(laborAlarmCount)}
          unit="vitals"
          valueColor={laborAlarmCount > 0 ? 'var(--risk-high)' : undefined}
          sub={laborAlarmCount > 0 ? 'ตรวจสอบทันที' : 'ไม่มีสัญญาณเตือน'}
        />
        <KpiCell
          group="LABOR"
          label="2ND STAGE"
          value={String(laborSecondStage)}
          unit="ราย"
          sub={laborSecondStage > 0 ? 'cervix ≥ 8 cm · active' : '—'}
        />
        <KpiCell
          group="ANC"
          label="ANC ลงทะเบียน"
          value={String(ancTotal)}
          unit="ราย"
          riskMix={ancMix}
        />
        <KpiCell
          group="ANC"
          label="HIGH-RISK · HR3"
          value={String(ancHr3)}
          unit="ราย"
          valueColor={ancHr3 > 0 ? 'var(--risk-high)' : undefined}
          sub={ancTotal > 0 ? `${((ancHr3 / ancTotal) * 100).toFixed(1)}% ของลงทะเบียน` : '—'}
        />
        <KpiCell
          group="ANC"
          label="OVERDUE / DUE 7d"
          value={`${ancOverdue}/${ancDueWeek}`}
          valueColor={ancOverdue > 0 ? '#92660b' : undefined}
          sub={`ขาดนัด ${ancOverdue} · ครบกำหนด 7 วัน ${ancDueWeek}`}
        />
        <KpiCell
          group="REFER-IN"
          label="GA ≥ 34w · จะส่งต่อมา"
          value={String(incomingCount)}
          unit="ราย"
          valueColor={incomingCount > 0 ? 'var(--accent-navy)' : undefined}
          sub={
            incomingCount > 0
              ? `GA ${incomingData?.byTrigger.ga ?? 0} · FW ${incomingData?.byTrigger.fw ?? 0} · risk ${incomingData?.byTrigger.risk ?? 0}`
              : 'ไม่มีรายชื่อในขณะนี้'
          }
        />
      </div>

      {/* REFER-IN PIPELINE — pregnancies at spokes that will be sent here.
          Hidden on spoke hospitals (count === 0). Compact table; full drill
          on click → patient detail. */}
      {incomingCount > 0 && (
        <div className="bg-white" style={{ borderBottom: '1px solid var(--rule-strong)' }}>
          <div
            className="flex items-baseline justify-between border-b px-5 py-2"
            style={{ borderColor: 'var(--accent-navy)' }}
          >
            <div className="font-mono text-[12px] tracking-[0.1em] text-[var(--ink-navy)]">
              <span className="mr-1.5 text-[var(--ink-navy-muted)]">02</span>
              ผู้คลอดที่จะส่งต่อมา · GA ≥ {incomingData?.minGaWeeks ?? 34} สัปดาห์
            </div>
            <div className="font-mono text-[10px] tracking-[0.08em] text-[var(--ink-navy-muted)]">
              {incomingCount} ราย ·{' '}
              {incomingItems.length === incomingCount ? 'ทั้งหมด' : `แสดง ${incomingItems.length}`}
            </div>
          </div>
          <div className="overflow-x-auto" style={{ maxHeight: 320 }}>
            <table className="w-full border-collapse text-[13px]">
              <thead className="sticky top-0 bg-[var(--surface-cool)] text-[var(--ink-navy-muted)]">
                <tr>
                  <th className="px-5 py-1.5 text-left font-mono text-[10px] uppercase tracking-[0.1em]">
                    HN
                  </th>
                  <th className="px-3 py-1.5 text-left font-mono text-[10px] uppercase tracking-[0.1em]">
                    ชื่อ
                  </th>
                  <th className="px-3 py-1.5 text-right font-mono text-[10px] uppercase tracking-[0.1em]">
                    อายุ
                  </th>
                  <th className="px-3 py-1.5 text-right font-mono text-[10px] uppercase tracking-[0.1em]">
                    G/P
                  </th>
                  <th className="px-3 py-1.5 text-right font-mono text-[10px] uppercase tracking-[0.1em]">
                    GA
                  </th>
                  <th className="px-3 py-1.5 text-right font-mono text-[10px] uppercase tracking-[0.1em]">
                    EFW
                  </th>
                  <th className="px-3 py-1.5 text-right font-mono text-[10px] uppercase tracking-[0.1em]">
                    EDC / วันที่เหลือ
                  </th>
                  <th className="px-3 py-1.5 text-center font-mono text-[10px] uppercase tracking-[0.1em]">
                    ANC
                  </th>
                  <th className="px-3 py-1.5 text-center font-mono text-[10px] uppercase tracking-[0.1em]">
                    เหตุผล
                  </th>
                  <th className="px-5 py-1.5 text-left font-mono text-[10px] uppercase tracking-[0.1em]">
                    จาก
                  </th>
                </tr>
              </thead>
              <tbody>
                {incomingItems.map((p) => {
                  const edcTone =
                    p.daysToEdc != null && p.daysToEdc < 0
                      ? 'var(--risk-high)'
                      : p.daysToEdc != null && p.daysToEdc <= 7
                        ? '#92660b'
                        : 'var(--ink-navy)';
                  const riskTier = ancTier(p.ancRiskLevel);
                  return (
                    <tr
                      key={p.id}
                      className="cursor-pointer border-t hover:bg-[var(--surface-cool)]"
                      style={{ borderColor: 'var(--rule-hair)' }}
                      onClick={() => router.push(`/pregnancies/${p.id}`)}
                    >
                      <td className="px-5 py-1.5 font-mono text-[12px] tabular-nums text-[var(--ink-navy)]">
                        {p.hn}
                      </td>
                      <td className="px-3 py-1.5 text-[var(--ink-navy)]">{maskName(p.name)}</td>
                      <td className="px-3 py-1.5 text-right font-mono tabular-nums">{p.age}</td>
                      <td className="px-3 py-1.5 text-right font-mono tabular-nums">
                        {p.gravida}/{p.para}
                      </td>
                      <td className="px-3 py-1.5 text-right font-mono tabular-nums">
                        {p.gaWeeks != null ? `${p.gaWeeks}w` : '—'}
                      </td>
                      <td className="px-3 py-1.5 text-right font-mono tabular-nums text-[var(--ink-navy-dim)]">
                        {p.efwG != null ? `${p.efwG}g` : '—'}
                      </td>
                      <td
                        className="px-3 py-1.5 text-right font-mono tabular-nums"
                        style={{ color: edcTone }}
                      >
                        {p.edc ? p.edc.slice(0, 10) : '—'}
                        {p.daysToEdc != null && (
                          <span className="ml-1.5 text-[10px] text-[var(--ink-navy-muted)]">
                            ({p.daysToEdc < 0 ? `เลย ${Math.abs(p.daysToEdc)}` : `${p.daysToEdc}`}d)
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-1.5 text-center">
                        <span
                          className="inline-block border px-1.5 py-0.5 font-mono text-[10px]"
                          style={{
                            color: tierColor(riskTier),
                            borderColor: tierColor(riskTier),
                          }}
                        >
                          {p.ancRiskLevel}
                        </span>
                      </td>
                      <td className="px-3 py-1.5 text-center font-mono text-[10px] text-[var(--ink-navy-dim)]">
                        {p.triggers.join('+') || '—'}
                      </td>
                      <td className="px-5 py-1.5 text-[12px] text-[var(--ink-navy-dim)]">
                        <span className="font-mono text-[10px] text-[var(--ink-navy-muted)]">
                          [{p.fromHcode}]
                        </span>{' '}
                        {p.fromHospitalName}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div
        className="flex items-stretch bg-white px-5"
        style={{ borderBottom: '1px solid var(--rule-strong)' }}
      >
        <button
          onClick={() => setTab('labor')}
          className="-mb-px flex items-center gap-2 px-5 py-2.5 text-[14px]"
          style={{
            color: tab === 'labor' ? 'var(--ink-navy)' : 'var(--ink-navy-muted)',
            fontWeight: tab === 'labor' ? 700 : 500,
            borderBottom:
              tab === 'labor' ? '2px solid var(--accent-navy)' : '2px solid transparent',
          }}
        >
          LABOR WARD
          <span
            className="rounded-full px-2 py-0.5 font-mono text-[10px] tabular-nums"
            style={{
              background: tab === 'labor' ? 'var(--accent-navy-soft)' : 'var(--rule-hair)',
              color: tab === 'labor' ? 'var(--accent-navy)' : 'var(--ink-navy-muted)',
            }}
          >
            {laborTotal}
          </span>
          {laborAlarmCount > 0 && (
            <span
              className="rounded-sm px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase tracking-[0.08em]"
              style={{ background: '#fde2dc', color: '#9b2c1c' }}
            >
              {laborAlarmCount} ALARM
            </span>
          )}
        </button>
        <button
          onClick={() => setTab('anc')}
          className="-mb-px flex items-center gap-2 px-5 py-2.5 text-[14px]"
          style={{
            color: tab === 'anc' ? 'var(--ink-navy)' : 'var(--ink-navy-muted)',
            fontWeight: tab === 'anc' ? 700 : 500,
            borderBottom: tab === 'anc' ? '2px solid var(--accent-navy)' : '2px solid transparent',
          }}
        >
          ANC REGISTRY
          <span
            className="rounded-full px-2 py-0.5 font-mono text-[10px] tabular-nums"
            style={{
              background: tab === 'anc' ? 'var(--accent-navy-soft)' : 'var(--rule-hair)',
              color: tab === 'anc' ? 'var(--accent-navy)' : 'var(--ink-navy-muted)',
            }}
          >
            {ancTotal}
          </span>
          {ancHr3 > 0 && (
            <span
              className="inline-block h-1.5 w-1.5 rounded-full"
              style={{ background: 'var(--risk-high)' }}
            />
          )}
        </button>
      </div>

      {/* Body split */}
      <div
        className="grid"
        style={{
          gridTemplateColumns: '1.05fr 1fr',
          minHeight: 'calc(100vh - 280px)',
        }}
      >
        {/* List */}
        <div
          className="overflow-y-auto bg-white px-5 py-4"
          style={{
            borderRight: '1px solid var(--rule-strong)',
            maxHeight: 'calc(100vh - 280px)',
          }}
        >
          <div
            className="mb-2 flex items-baseline justify-between border-b pb-1"
            style={{ borderColor: 'var(--accent-navy)' }}
          >
            <div className="font-mono text-[12px] tracking-[0.1em] text-[var(--ink-navy)]">
              <span className="text-[var(--ink-navy-muted)] mr-1.5">01</span>
              {tab === 'labor'
                ? 'LABOR FLOOR · เรียงตามความเสี่ยง'
                : 'ANC LIST · เรียงตามไตรมาส / ความเสี่ยง'}
            </div>
            <div className="font-mono text-[10px] tracking-[0.08em] text-[var(--ink-navy-muted)]">
              {tab === 'labor'
                ? labor.length < laborTotal
                  ? `แสดง ${labor.length} จาก ${laborTotal} PATIENTS`
                  : `${laborTotal} PATIENTS`
                : journeys.length < ancTotal
                  ? `แสดง ${journeys.length} จาก ${ancTotal} PATIENTS`
                  : `${ancTotal} PATIENTS`}{' '}
              · LIVE
            </div>
          </div>

          {tab === 'labor' ? (
            <>
              {labor.length === 0 ? (
                <div
                  className="border bg-white py-10 text-center"
                  style={{ borderColor: 'var(--rule-strong)' }}
                >
                  <p className="font-mono text-[11px] text-[var(--ink-navy-muted)]">
                    ไม่มีผู้คลอดในขณะนี้
                  </p>
                </div>
              ) : (
                <div>
                  <GroupHeader title="ALL PATIENTS" sub="sorted by CPD risk" count={labor.length} />
                  <div>
                    {labor.map((p) => (
                      <LaborRow
                        key={p.an}
                        p={p}
                        isSelected={effectiveLabor === p.an}
                        onSelect={() => setSelectedLabor(p.an)}
                        onOpen={() => router.push(`/patients/${buildPatientId(hcode, p.an)}`)}
                      />
                    ))}
                  </div>
                </div>
              )}
              <PartographAuditPanel audit={laborData?.partographAudit} />
            </>
          ) : journeys.length === 0 ? (
            <div
              className="border bg-white py-10 text-center"
              style={{ borderColor: 'var(--rule-strong)' }}
            >
              <p className="font-mono text-[11px] text-[var(--ink-navy-muted)]">
                ยังไม่มีหญิงตั้งครรภ์ลงทะเบียนกับโรงพยาบาลนี้
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {(['T3', 'T2', 'T1', 'unknown'] as const).map((tri) => {
                const list = ancByTrimester[tri];
                if (list.length === 0) return null;
                const hr = list.filter((j) => j.ancRiskLevel === 'HR3').length;
                const title =
                  tri === 'T3'
                    ? '3RD TRIMESTER'
                    : tri === 'T2'
                      ? '2ND TRIMESTER'
                      : tri === 'T1'
                        ? '1ST TRIMESTER'
                        : 'GA UNKNOWN';
                const sub =
                  tri === 'T3' ? '28w+' : tri === 'T2' ? '13–27w' : tri === 'T1' ? '0–12w' : '—';
                return (
                  <div key={tri}>
                    <GroupHeader title={title} sub={sub} count={list.length} hr={hr} />
                    <div>
                      {list.map((j) => (
                        <AncRow
                          key={j.id}
                          j={j}
                          isSelected={effectiveAnc === j.id}
                          onSelect={() => setSelectedAnc(j.id)}
                          onOpen={() => router.push(`/pregnancies/${j.id}`)}
                        />
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Detail preview */}
        <div
          className="overflow-y-auto bg-[var(--surface-cool)] px-5 py-4"
          style={{ maxHeight: 'calc(100vh - 280px)' }}
        >
          {tab === 'labor' ? (
            (() => {
              const p = labor.find((x) => x.an === effectiveLabor);
              if (!p) return <EmptyPreview message="เลือกผู้คลอดในรายการเพื่อดูข้อมูลสรุป" />;
              return <LaborPreview patient={p} hcode={hcode} />;
            })()
          ) : effectiveAnc ? (
            <AncPreview journeyId={effectiveAnc} hcode={hcode} />
          ) : (
            <EmptyPreview message="เลือกหญิงตั้งครรภ์ในรายการเพื่อดูประวัติ ANC" />
          )}
        </div>
      </div>
    </div>
  );
}
