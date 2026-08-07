// Journey detail page — full pregnancy journey for one woman.
// Redesigned 2026-04-21 (v2): air-traffic-control aesthetic; 2-column layout
// with sticky clinical-summary rail on the right, vital-trend sparklines,
// and a WHO 8-contact tracker with next-due recommendation.
'use client';

import { use, useMemo } from 'react';
import { debounceLeadingTrailing, SSE_REFRESH_DEBOUNCE_MS } from '@/lib/debounce';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import useSWR from 'swr';
import { useSSE } from '@/hooks/useSSE';
import { useSetBreadcrumbs } from '@/components/layout/BreadcrumbContext';
import { LoadingState } from '@/components/shared/LoadingState';
import { SectionLabel } from '@/components/dashboard/shared';
import { cn, formatRelativeTime } from '@/lib/utils';
import { maskName } from '@/lib/pii-mask';
import { ANC_RISK_COLOR, ANC_RISK_LABEL_TH } from '@/config/anc-risk-display';
import { ANC_RISK_RULES } from '@/config/anc-risk-rules';
import { classifySyncHealth } from '@/config/hospital-network';
import { NEWBORN_THRESHOLDS } from '@/config/newborn';
import { formatRelativeAge } from '@/lib/relative-time';
import { KpiTip } from '@/components/shared/KpiTip';
import { FlagChip } from '@/components/shared/FlagChip';
import { IncompleteAssessmentMarker } from '@/components/shared/IncompleteAssessmentMarker';
import { STATUS_META, URGENCY_META } from '@/components/referrals/chips';
import {
  BP_SYS_HIGH,
  BP_SYS_AMBER,
  BP_DIA_HIGH,
  BP_DIA_AMBER,
  FHR_LOW,
  FHR_HIGH,
  HB_LOW,
  PROTEINURIA_24H_HIGH_MG,
  CREATININE_HIGH_MG_DL,
  sevBp,
  sevFhr,
  sevHb,
  sevUrineProtein,
  sevFetalMovement,
  nextContactDue,
  prePregnancyBmi,
  isLateFirstContact,
  overdueInvestigations,
  WHO_CONTACT_WEEKS,
  WHO_CONTACT_WINDOW_W,
  type Severity,
} from '@/services/anc-clinical';
import {
  ArrowLeft,
  Baby,
  Calendar,
  Hospital,
  AlertTriangle,
  ArrowRightLeft,
  CheckCircle2,
  Clock,
  Droplets,
  Heart,
  HelpCircle,
  Activity,
  Ruler,
  MapPin,
  User,
  TrendingUp,
  Syringe,
  ShieldAlert,
} from 'lucide-react';

// Poll cadence for the detail feed. Single source for both the SWR
// refreshInterval and the footer "REFRESHING EVERY …s" caption so they can
// never drift apart. Live SSE updates arrive between polls (see useSSE below).
const REFRESH_INTERVAL_MS = 60_000;

// ─── Types (shape must match /api/journeys/[journeyId]) ───────────────────

interface AncVisit {
  visitDate: string;
  visitNumber: number;
  hospitalName: string | null;
  hcode: string | null;
  gaWeeks: number | null;
  fundalHeightCm: number | null;
  weightKg: number | null;
  bpSystolic: number | null;
  bpDiastolic: number | null;
  fetalHr: number | null;
  presentation: string | null;
  engagement: string | null;
  passQuality: boolean | null;
  urineProtein: string | null;
  urineGlucose: string | null;
  hbGDl: number | null;
  hctPct: number | null;
  ttDoseNo: number | null;
  ironFolicGiven: boolean | null;
  calciumGiven: boolean | null;
  dangerSigns: string[] | null;
  fetalMovementOk: boolean | null;
  vaccinesGiven?: VaccineRecord[] | null;
  nstResult?: string | null;
  bppScore?: number | null;
  umbilicalDopplerResult?: string | null;
}

interface LatestRisk {
  riskLevel: string;
  triggeredRules: string[];
  screenedAt: string;
  recommendedFacility: string | null;
}

// WHO containment T6 — completeness of the latest ANC risk screening. Null
// when there is no screening row, it's unparseable, or it's a legacy/
// webhook-sourced row (see src/types/api.ts AncAssessmentCompleteness).
interface AncAssessment {
  incomplete: boolean;
  missingRequired: string[];
}

interface Referral {
  id: string;
  fromHospital: string;
  toHospital: string;
  status: string;
  reason: string | null;
  urgencyLevel: string | null;
  initiatedAt: string;
  arrivedAt: string | null;
}

interface Newborn {
  infantNumber: number;
  sex: string | null;
  birthWeightG: number | null;
  apgar1min: number | null;
  apgar5min: number | null;
  bornAt: string | null;
}

interface Journey {
  id: string;
  hn: string;
  name: string;
  age: number;
  gravida: number | null;
  para: number | null;
  gaWeeks: number | null;
  lmp: string | null;
  edc: string | null;
  careStage: string;
  ancRiskLevel: string | null;
  ancVisitCount: number;
  lastAncDate: string | null;
  hospitalName: string;
  hcode: string;
  registeredAt: string;
  currentHospitalName: string | null;
  currentHcode: string | null;
  heightCm: number | null;
  bloodGroup: string | null;
  rhFactor: string | null;
  hbsagResult: string | null;
  vdrlResult: string | null;
  hivResult: string | null;
  ogttResult: string | null;
  termBirths: number | null;
  pretermBirths: number | null;
  abortions: number | null;
  livingChildren: number | null;
  pastMedicalHistory: string | null;
  // RTCOG OB 66-029 (2566) additions.
  mcvFl?: number | null;
  dcipResult?: string | null;
  hbEResult?: string | null;
  thalassemiaType?: string | null;
  cervicalScreenType?: string | null;
  cervicalScreenResult?: string | null;
  cervicalScreenDate?: string | null;
  aneuploidyMethod?: string | null;
  aneuploidyResult?: string | null;
  gbsResult?: string | null;
  gbsCollectedDate?: string | null;
  anatomyScanDate?: string | null;
  anatomyScanResult?: string | null;
  efwG?: number | null;
  datingMethod?: string | null;
  proteinuria24hMg?: number | null;
  creatinineMgDl?: number | null;
  priorPeDvt?: boolean | null;
  severeLungDisease?: boolean | null;
  alloimmunizationCde?: boolean | null;
  bariatricSurgeryHx?: boolean | null;
  teratogenExposure?: boolean | null;
  congenitalInfection?: boolean | null;
  gdmRiskFactors?: string[] | null;
  /** When this journey row was last written by the HOSxP sync/webhook. */
  syncedAt?: string | null;
}

interface VaccineRecord {
  type: 'TT' | 'DT' | 'TDAP' | 'INFLUENZA' | 'COVID';
  dose?: number | null;
  givenAtGa?: number | null;
}

interface JourneyDetailResponse {
  journey: Journey;
  ancVisits: AncVisit[];
  latestRisk: LatestRisk | null;
  /** WHO containment T6 — see AncAssessment above. */
  ancAssessment?: AncAssessment | null;
  referrals: Referral[];
  newborns: Newborn[];
  /** Latest linked labor admission — cross-link to /patients/[hcode]-[an]. */
  laborAdmission?: {
    an: string;
    hcode: string;
    laborStatus: string;
    admitDate: string;
  } | null;
}

// ─── Labels + thresholds ──────────────────────────────────────────────────

// Shared ANC risk display tokens — see src/config/anc-risk-display.ts.
const STAGE_LABEL_TH: Record<string, string> = {
  PREGNANCY: 'ฝากครรภ์',
  LABOR: 'ระหว่างคลอด',
  DELIVERED: 'คลอดแล้ว',
  POSTPARTUM: 'หลังคลอด',
};
const STAGE_COLOR: Record<string, string> = {
  PREGNANCY: 'var(--accent-navy)',
  LABOR: 'var(--risk-medium)',
  DELIVERED: 'var(--risk-low)',
  POSTPARTUM: 'var(--ink-navy-muted)',
};
// Referral status/urgency labels come from the shared chips module
// (components/referrals/chips) so this rail can never disagree with the
// /referrals board.

// Thai labels for triggered ANC-risk rule IDs — from the rules config, so
// clinicians read "เคยคลอดน้ำหนัก <2500g" instead of "hr1_previous_lbw".
const RULE_LABEL_TH: Record<string, string> = Object.fromEntries(
  ANC_RISK_RULES.map((r) => [r.id, r.labelTh]),
);

// Dot color per sync-health class — same classifier the hospitals board and
// the labor detail page use.
const SYNC_DOT: Record<string, string> = {
  ok: 'var(--risk-low)',
  stale: 'var(--risk-medium)',
  critical: 'var(--risk-high)',
  never: 'var(--risk-high)',
  blocked: 'var(--risk-high)',
};

const LABOR_STATUS_TH: Record<string, string> = {
  ACTIVE: 'อยู่ห้องคลอด',
  DELIVERED: 'คลอดแล้ว',
  DISCHARGED: 'จำหน่ายแล้ว',
};
const SEX_LABEL_TH: Record<string, string> = { M: 'ชาย', F: 'หญิง' };

// Vital-sign severity bands, the WHO 8-contact schedule, BMI, and the RTCOG
// investigation-timing rules live in src/services/anc-clinical.ts (imported
// above) so this page and any future ANC surface share one source of truth.
// sevColor/sevBg below are pure presentation (severity → CSS var) and stay here.
function sevColor(s: Severity): string {
  return s === 'abnormal'
    ? 'var(--risk-high)'
    : s === 'borderline'
      ? 'var(--risk-medium)'
      : s === 'unknown'
        ? 'var(--ink-navy-muted)' // "not recorded" — neutral, never green
        : 'var(--ink-navy)';
}
function sevBg(s: Severity): string {
  return s === 'abnormal'
    ? 'rgba(239, 68, 68, 0.10)'
    : s === 'borderline'
      ? 'rgba(234, 179, 8, 0.10)'
      : s === 'unknown'
        ? 'rgba(234, 179, 8, 0.05)' // faint amber "not recorded" tint
        : 'transparent';
}

// Short labels for baby_position / baby_lead. HOSxP values are inconsistent
// across sites, so we recognize common codes and fall back to the raw value.
function presentationLabel(code: string | null): string {
  if (!code) return '—';
  const c = code.trim().toUpperCase();
  if (/V|C|CEPH|HEAD|ศีรษะ/.test(c)) return 'CEPHALIC';
  if (/BR|B|BREECH|ก้น/.test(c)) return 'BREECH';
  if (/TR|OBL|T|ขวาง/.test(c)) return 'TRANSVERSE';
  return code.slice(0, 10);
}
function engagementLabel(code: string | null): string {
  if (!code) return '—';
  const c = code.trim().toUpperCase();
  if (/ENG|E|เข้า|FIXED/.test(c)) return 'ENGAGED';
  if (/F|FL|ลอย|BALLOTABLE/.test(c)) return 'FLOATING';
  return code.slice(0, 10);
}

// Lab-flag extraction — map triggered ANC-risk rule IDs to icons & labels.
// These rule IDs come from src/config/anc-risk-rules.ts.
interface LabFlag {
  key: string;
  label: string;
  color: string;
}
const LAB_FLAGS_FROM_RULES: Record<string, LabFlag> = {
  hr2_rh_negative: { key: 'rh', label: 'Rh−', color: 'var(--risk-medium)' },
  hr2_hbsag: { key: 'hbsag', label: 'HBsAg+', color: 'var(--risk-medium)' },
  hr2_syphilis: { key: 'vdrl', label: 'SYPHILIS+', color: 'var(--risk-high)' },
  hr2_hiv: { key: 'hiv', label: 'HIV+', color: 'var(--risk-high)' },
  hr2_thalassemia: { key: 'thal', label: 'THAL DISEASE', color: 'var(--risk-medium)' },
  hr3_nipt: { key: 'nipt', label: 'NIPT HIGH', color: 'var(--risk-high)' },
  hr3_anemia: { key: 'anem', label: 'SEVERE ANEMIA', color: 'var(--risk-high)' },
};

function formatThai(dateStr: string | null): string {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleDateString('th-TH', {
    timeZone: 'Asia/Bangkok',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}
function formatThaiShort(dateStr: string | null): string {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleDateString('th-TH', {
    timeZone: 'Asia/Bangkok',
    month: 'short',
    day: 'numeric',
  });
}
function formatThaiDateTime(dateStr: string | null): string {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  return (
    d.toLocaleDateString('th-TH', {
      timeZone: 'Asia/Bangkok',
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    }) +
    ' ' +
    d.toLocaleTimeString('th-TH', {
      timeZone: 'Asia/Bangkok',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    })
  );
}

// Days between two ISO timestamps (floor).
function daysBetween(fromIso: string, toIso: string): number {
  return Math.floor((new Date(toIso).getTime() - new Date(fromIso).getTime()) / 86400_000);
}

// ─── Small pieces ─────────────────────────────────────────────────────────

function Pill({
  label,
  color,
  bg,
  borderColor,
}: {
  label: string;
  color: string;
  bg?: string;
  borderColor?: string;
}) {
  return (
    <span
      className="inline-flex items-center gap-1 border px-2 py-0.5 font-mono text-[11px] font-semibold tracking-[0.06em]"
      style={{
        color,
        borderColor: borderColor ?? color,
        background: bg ?? 'transparent',
      }}
    >
      {label}
    </span>
  );
}

function VisitChip({
  label,
  color,
  icon,
}: {
  label: string;
  color: string;
  icon?: React.ReactNode;
}) {
  return (
    <span
      className="inline-flex items-center gap-1 rounded-sm border px-1.5 py-0.5 font-mono text-[10px] font-semibold tracking-[0.04em]"
      style={{ color, borderColor: color }}
    >
      {icon}
      {label}
    </span>
  );
}

// Compact lab result — "BLOOD B", "Rh POS", etc. Abnormal values render in red.
function LabResult({
  label,
  value,
  abnormalIf,
}: {
  label: string;
  value: string | null;
  abnormalIf?: (v: string) => boolean;
}) {
  const v = value ?? null;
  const abn = v ? (abnormalIf ? abnormalIf(v) : false) : false;
  return (
    <span className="inline-flex items-center gap-1 font-mono text-[11px]">
      <span className="text-[var(--ink-navy-muted)]">{label}</span>
      <span
        className="font-semibold tabular-nums"
        style={{
          color: v == null ? 'var(--ink-navy-muted)' : abn ? 'var(--risk-high)' : 'var(--ink-navy)',
        }}
      >
        {v ?? '—'}
      </span>
    </span>
  );
}

// Serology tile for the labs panel — wider click-target with a clear
// normal/abnormal color-coded status line. Abnormal tiles use a saturated
// red background + white-on-red value with a warning icon so they pop out
// of a row of otherwise-normal serology.
function LabTile({
  label,
  value,
  status,
}: {
  label: string;
  value: string | null;
  status: 'normal' | 'abnormal' | 'missing';
}) {
  if (status === 'abnormal') {
    return (
      <div
        className="flex flex-col gap-0.5 border px-2.5 py-1.5"
        style={{
          borderColor: 'var(--risk-high)',
          background: 'rgba(239, 68, 68, 0.14)',
          boxShadow: 'inset 3px 0 0 var(--risk-high)',
        }}
      >
        <div
          className="inline-flex items-center gap-1 font-mono text-[9px] font-bold uppercase tracking-[0.12em]"
          style={{ color: 'var(--risk-high)' }}
        >
          <AlertTriangle className="h-2.5 w-2.5" />
          {label}
        </div>
        <div
          className="inline-flex w-fit items-center rounded-sm px-1.5 py-0.5 font-mono text-[12px] font-bold tabular-nums text-white"
          style={{ background: 'var(--risk-high)' }}
        >
          {value ?? '—'}
        </div>
      </div>
    );
  }
  const palette =
    status === 'normal'
      ? {
          fg: 'var(--ink-navy)',
          accent: 'var(--risk-low)',
          bg: 'rgba(34, 197, 94, 0.06)',
        }
      : {
          fg: 'var(--ink-navy-muted)',
          accent: 'var(--ink-navy-muted)',
          bg: 'white',
        };
  return (
    <div
      className="flex flex-col gap-0.5 border px-2.5 py-1.5"
      style={{
        borderColor: 'var(--rule-strong)',
        borderLeftColor: palette.accent,
        borderLeftWidth: 3,
        background: palette.bg,
      }}
    >
      <div className="font-mono text-[9px] uppercase tracking-[0.12em] text-[var(--ink-navy-muted)]">
        {label}
      </div>
      <div className="font-mono text-[13px] font-bold tabular-nums" style={{ color: palette.fg }}>
        {value ?? '—'}
      </div>
    </div>
  );
}

const DANGER_LABEL_TH: Record<string, string> = {
  severe_headache: 'ปวดศีรษะรุนแรง',
  blurred_vision: 'ตาพร่ามัว',
  epigastric_pain: 'ปวดลิ้นปี่',
  vaginal_bleeding: 'เลือดออกทางช่องคลอด',
  reduced_fm: 'ลูกดิ้นน้อยลง',
  fever: 'ไข้',
  rom: 'น้ำเดิน',
  convulsion: 'ชัก',
};
function dangerLabel(code: string): string {
  return DANGER_LABEL_TH[code] ?? code;
}

// Immunization tile — shows whether a vaccine has been given in this
// pregnancy. Tdap gets the strongest treatment (RTCOG requires Tdap 27-36w
// each pregnancy); other vaccines just show yes/no with GA timestamp.
function VaccineTile({
  label,
  subLabel,
  records,
  requiredThisPregnancy,
  currentGa,
  windowStart,
  windowEnd,
}: {
  label: string;
  subLabel?: string;
  records: VaccineRecord[];
  requiredThisPregnancy?: boolean;
  currentGa?: number | null;
  windowStart?: number;
  windowEnd?: number;
}) {
  const given = records.length > 0;
  const latest = records[records.length - 1];
  // Overdue logic — only for required-this-pregnancy vaccines (Tdap).
  const overdue =
    requiredThisPregnancy &&
    !given &&
    windowEnd != null &&
    currentGa != null &&
    currentGa > windowEnd;
  const fg = given ? 'var(--risk-low)' : overdue ? 'var(--risk-high)' : 'var(--ink-navy-muted)';
  const bg = given ? 'rgba(34, 197, 94, 0.06)' : overdue ? 'rgba(239, 68, 68, 0.08)' : 'white';
  const accent = given ? 'var(--risk-low)' : overdue ? 'var(--risk-high)' : 'var(--ink-navy-muted)';
  return (
    <div
      className="flex flex-col gap-1 px-3 py-2"
      style={{
        background: bg,
        borderLeft: `3px solid ${accent}`,
      }}
    >
      <div className="flex items-baseline gap-1.5">
        <Syringe className="h-3 w-3" style={{ color: accent }} />
        <span
          className="font-mono text-[10px] font-bold uppercase tracking-[0.1em]"
          style={{ color: fg }}
        >
          {label}
        </span>
        {subLabel && (
          <span className="font-mono text-[9px] text-[var(--ink-navy-muted)]">{subLabel}</span>
        )}
      </div>
      {given ? (
        <div
          className="flex items-center gap-1 font-mono text-[12px] font-bold tabular-nums"
          style={{ color: fg }}
        >
          <CheckCircle2 className="h-3 w-3" />
          GIVEN
          {latest?.givenAtGa != null && (
            <span className="font-normal text-[10px] text-[var(--ink-navy-muted)]">
              @ {latest.givenAtGa}w
            </span>
          )}
          {latest?.dose != null && (
            <span className="font-normal text-[10px] text-[var(--ink-navy-muted)]">
              dose {latest.dose}
            </span>
          )}
        </div>
      ) : (
        <div
          className="flex items-center gap-1 font-mono text-[12px] font-bold tabular-nums"
          style={{ color: fg }}
        >
          {overdue ? <AlertTriangle className="h-3 w-3" /> : null}
          {overdue ? 'OVERDUE' : 'NOT GIVEN'}
        </div>
      )}
    </div>
  );
}

// Summary-strip tile — big number, tiny label. The top edge carries an
// accent band in the tile's color, and the icon sits in a matching tinted
// badge so each metric reads as its own visual "lane" rather than a row of
// identical grey rectangles.
function MetricTile({
  label,
  value,
  sub,
  color,
  icon,
  tone = 'light',
}: {
  label: string;
  value: string | number;
  sub?: string;
  color?: string;
  icon?: React.ReactNode;
  /** 'light' (default): soft tint + dark text. 'bold': deeper tint for
   *  emphasis (e.g. right-rail big number). */
  tone?: 'light' | 'bold';
}) {
  const c = color ?? 'var(--accent-navy)';
  const bgTint =
    tone === 'bold' ? `color-mix(in srgb, ${c} 14%, white)` : `color-mix(in srgb, ${c} 6%, white)`;
  const badgeTint = `color-mix(in srgb, ${c} 18%, white)`;
  return (
    <div
      className="relative flex flex-col gap-1 px-4 py-3"
      style={{ background: bgTint, borderTop: `3px solid ${c}` }}
    >
      <div className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--ink-navy-muted)]">
        {icon && (
          <span
            className="inline-flex h-5 w-5 items-center justify-center rounded-sm"
            style={{ background: badgeTint, color: c }}
          >
            {icon}
          </span>
        )}
        {label}
      </div>
      <div className="flex items-baseline gap-2">
        <div
          className="font-mono text-[22px] font-semibold leading-none tabular-nums"
          style={{ color: 'var(--ink-navy)', letterSpacing: '-0.01em' }}
        >
          {value}
        </div>
        {sub && <div className="font-mono text-[10px] text-[var(--ink-navy-muted)]">{sub}</div>}
      </div>
    </div>
  );
}

// ─── Inline sparkline (no external chart lib for tiny trends) ─────────────
//
// Renders a polyline + dots for a small time-series of numbers. Values that
// fall outside [lowBand, highBand] render the dot red so a clinician can
// spot an abnormal point at a glance without reading exact numbers.
function Sparkline({
  values,
  width = 140,
  height = 34,
  lowBand,
  highBand,
  color = 'var(--accent-navy)',
}: {
  values: Array<number | null>;
  width?: number;
  height?: number;
  lowBand?: number;
  highBand?: number;
  color?: string;
}) {
  const pts = values.filter((v): v is number => v != null);
  if (pts.length < 1) {
    return <span className="font-mono text-[10px] text-[var(--ink-navy-muted)]">—</span>;
  }
  const min = Math.min(...pts, lowBand ?? Infinity);
  const max = Math.max(...pts, highBand ?? -Infinity);
  const span = max - min || 1;
  const pad = 4;
  const w = width - pad * 2;
  const h = height - pad * 2;
  const x = (i: number) => pad + (values.length === 1 ? w / 2 : (i / (values.length - 1)) * w);
  const y = (v: number) => pad + h - ((v - min) / span) * h;
  const polyPts = values
    .map((v, i) => (v == null ? null : `${x(i)},${y(v)}`))
    .filter(Boolean)
    .join(' ');
  // Normal band shading when both lowBand and highBand are provided.
  const bandY0 = highBand != null ? y(highBand) : null;
  const bandY1 = lowBand != null ? y(lowBand) : null;
  return (
    <svg width={width} height={height} className="block" role="img" aria-label="trend">
      {bandY0 != null && bandY1 != null && (
        <rect
          x={0}
          y={Math.min(bandY0, bandY1)}
          width={width}
          height={Math.abs(bandY1 - bandY0)}
          fill="var(--risk-low)"
          opacity={0.08}
        />
      )}
      <polyline
        points={polyPts}
        fill="none"
        stroke={color}
        strokeWidth={1.4}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      {values.map((v, i) => {
        if (v == null) return null;
        const abnormal = (lowBand != null && v < lowBand) || (highBand != null && v > highBand);
        return (
          <circle
            key={i}
            cx={x(i)}
            cy={y(v)}
            r={abnormal ? 2.4 : 1.8}
            fill={abnormal ? 'var(--risk-high)' : color}
          />
        );
      })}
    </svg>
  );
}

// Row in the Vital trends panel — label, current value with colored abnormal
// flag, delta vs previous, and a sparkline. Each metric gets its own
// tinted label badge so scanning down the table you can find (say) BP
// without reading labels. `severity` is a function of the current value so
// we can flash it amber (borderline) or red (abnormal) in place.
function TrendRow({
  label,
  values,
  unit,
  lowBand,
  highBand,
  format = (v) => String(v),
  color,
  severity,
}: {
  label: string;
  values: Array<number | null>;
  unit?: string;
  lowBand?: number;
  highBand?: number;
  format?: (v: number) => string;
  color?: string;
  /** Per-value severity. Defaults to a binary check against lowBand/highBand. */
  severity?: (v: number) => Severity;
}) {
  const real = values.filter((v): v is number => v != null);
  const current = real[real.length - 1] ?? null;
  const prev = real[real.length - 2] ?? null;
  const delta = current != null && prev != null ? current - prev : null;
  const sev: Severity =
    current == null
      ? 'unknown' // no reading this pregnancy — neutral, not the same as a normal value
      : severity
        ? severity(current)
        : (lowBand != null && current < lowBand) || (highBand != null && current > highBand)
          ? 'abnormal'
          : 'normal';
  const c = color ?? 'var(--accent-navy)';
  const labelBg = `color-mix(in srgb, ${c} 10%, white)`;
  const deltaColor =
    delta == null || delta === 0
      ? 'var(--ink-navy-muted)'
      : delta > 0
        ? 'var(--risk-medium)'
        : 'var(--primary-teal)';
  const valueBg = sevBg(sev);
  const valueColor = current == null ? 'var(--ink-navy-muted)' : sevColor(sev);
  const valueBorder = sev === 'normal' ? 'transparent' : sevColor(sev);
  return (
    <div
      className="grid items-center gap-2 border-b px-3 py-1.5"
      style={{
        gridTemplateColumns: '96px 92px 54px 1fr',
        borderColor: 'var(--rule-hair)',
        background: sev === 'abnormal' ? 'rgba(239, 68, 68, 0.03)' : undefined,
      }}
    >
      <div
        className="inline-flex items-center justify-start rounded-sm px-2 py-0.5 font-mono text-[11px] font-bold uppercase tracking-[0.08em]"
        style={{ background: labelBg, color: c }}
      >
        {label}
      </div>
      <div
        className="inline-flex items-baseline gap-0.5 rounded-sm border px-1.5 py-0.5 font-mono text-[13px] font-bold tabular-nums"
        style={{
          background: valueBg,
          color: valueColor,
          borderColor: valueBorder,
        }}
      >
        {current != null ? format(current) : '—'}
        {current != null && unit && (
          <span className="text-[10px] font-normal" style={{ color: 'var(--ink-navy-muted)' }}>
            {unit}
          </span>
        )}
        {sev === 'abnormal' && (
          <AlertTriangle className="ml-0.5 h-3 w-3" style={{ color: 'var(--risk-high)' }} />
        )}
      </div>
      <div
        className="font-mono text-[10px] font-semibold tabular-nums"
        style={{ color: deltaColor }}
      >
        {delta != null && delta !== 0
          ? `${delta > 0 ? '+' : ''}${format(Math.round(delta * 10) / 10)}`
          : '—'}
      </div>
      <div>
        <Sparkline values={values} lowBand={lowBand} highBand={highBand} color={c} />
      </div>
    </div>
  );
}

/** GA progress bar with WHO 8-contact schedule overlay. */
function GaProgressBar({
  gaWeeks,
  attendedWeeks,
}: {
  gaWeeks: number | null;
  attendedWeeks: number[];
}) {
  // WHO containment T2: an unknown GA must never be coerced to 0 — that
  // made an unknown-GA patient look like an early (T1, on-track) pregnancy
  // with nothing missed. When GA is unknown we can still show which WHO
  // contacts were attended (that's a fact from the visit history) but we
  // cannot say anything about position on the 40-week timeline or which
  // targets are "missed"/"due" — those all require knowing "now".
  const gaUnknown = gaWeeks == null;
  const ga = gaWeeks ?? 0;
  const pct = Math.min(100, Math.max(0, (ga / 40) * 100));
  const color =
    ga >= 41
      ? 'var(--risk-high)'
      : ga >= 37
        ? 'var(--risk-low)'
        : ga >= 28
          ? 'var(--accent-navy)'
          : ga > 0
            ? 'var(--risk-medium)'
            : 'var(--ink-navy-muted)';
  const trimester =
    ga < 14 ? 'T1' : ga < 28 ? 'T2' : ga < 37 ? 'T3' : ga < 41 ? 'TERM' : 'POST-TERM';
  const attendedSet = new Set(attendedWeeks);
  const attendedCount = WHO_CONTACT_WEEKS.filter((w) =>
    attendedWeeks.some((v) => Math.abs(v - w) <= WHO_CONTACT_WINDOW_W),
  ).length;
  return (
    <div>
      <div className="flex items-baseline justify-between font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--ink-navy-muted)]">
        <span>WHO 8-CONTACT SCHEDULE · GA PROGRESS</span>
        <span>
          {gaWeeks != null ? (
            <>
              {gaWeeks}
              <span className="text-[9px]">w</span> · {trimester}
            </>
          ) : (
            <span
              className="inline-flex items-center gap-1"
              style={{ color: 'var(--risk-medium)' }}
            >
              <AlertTriangle className="h-3 w-3" />— · ไม่ทราบอายุครรภ์
            </span>
          )}
          <span className="ml-3">
            ATTENDED{' '}
            <span
              className="font-semibold tabular-nums"
              style={{
                color: gaUnknown
                  ? 'var(--ink-navy-dim)'
                  : attendedCount >= 6
                    ? 'var(--risk-low)'
                    : attendedCount >= 3
                      ? 'var(--accent-navy)'
                      : 'var(--risk-medium)',
              }}
            >
              {attendedCount}
            </span>
            /8
          </span>
        </span>
      </div>
      <div
        className="relative mt-2 h-2 w-full overflow-visible"
        style={{ background: 'var(--surface-sunken)' }}
      >
        {/* GA position/"due" marker — only meaningful once GA is known. */}
        {!gaUnknown && <div style={{ width: `${pct}%`, height: '100%', background: color }} />}
        {WHO_CONTACT_WEEKS.map((week, i) => {
          const hit = attendedWeeks.some((v) => Math.abs(v - week) <= WHO_CONTACT_WINDOW_W);
          // Unknown GA: we cannot know whether "now" has passed a target
          // week, so never render the red "missed" state — only attended
          // (green) vs not-yet-known (white) dots.
          const passed = !gaUnknown && ga >= week;
          const missed = passed && !hit;
          const fill = hit ? 'var(--risk-low)' : missed ? 'var(--risk-high)' : '#ffffff';
          const border = hit
            ? 'var(--risk-low)'
            : missed
              ? 'var(--risk-high)'
              : 'var(--rule-strong)';
          return (
            <span
              key={week}
              className="absolute -translate-x-1/2 -translate-y-1/2 rounded-full border"
              style={{
                left: `${(week / 40) * 100}%`,
                top: '50%',
                width: 10,
                height: 10,
                background: fill,
                borderColor: border,
                borderWidth: 1.5,
              }}
              title={`Contact ${i + 1} · ${week}w${hit ? ' · attended' : missed ? ' · missed' : ''}`}
            />
          );
        })}
      </div>
      <div className="mt-2 flex justify-between font-mono text-[9px] text-[var(--ink-navy-muted)]">
        {WHO_CONTACT_WEEKS.map((week, i) => (
          <span
            key={week}
            className="tabular-nums"
            style={{
              color: attendedSet.has(week) ? 'var(--risk-low)' : undefined,
            }}
          >
            C{i + 1}·{week}w
          </span>
        ))}
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────

export default function JourneyDetailPage({ params }: { params: Promise<{ journeyId: string }> }) {
  const { journeyId } = use(params);
  const router = useRouter();

  // Use the global SWRProvider fetcher (src/app/swr-provider.tsx) which
  // throws FetchError on non-2xx so `error` actually populates. The page
  // previously defined a local fetcher that swallowed errors, causing every
  // 404/500 to render the generic "ไม่พบข้อมูลการฝากครรภ์" empty state.
  const { data, error, isLoading, mutate } = useSWR<JourneyDetailResponse>(
    `/api/journeys/${journeyId}`,
    { refreshInterval: REFRESH_INTERVAL_MS },
  );

  // Live updates: a webhook/sync touching this patient refreshes the page
  // (leading edge fires immediately; bursts coalesce — 2026-07-17 incident).
  const refresh = useMemo(
    () => debounceLeadingTrailing(() => void mutate(), SSE_REFRESH_DEBOUNCE_MS),
    [mutate],
  );
  useSSE({ onPatientUpdate: refresh, onSyncComplete: refresh });

  const journeyName = data?.journey?.name ?? 'Journey';
  useSetBreadcrumbs([
    { label: 'แดชบอร์ด', href: '/' },
    { label: 'ฝากครรภ์', href: '/pregnancies' },
    { label: journeyName },
  ]);

  // React Compiler memoizes this automatically — no manual useMemo needed.
  const derived = (() => {
    if (!data?.journey) return null;
    const j = data.journey;
    const nowIso = new Date().toISOString();
    const daysSinceRegistered = daysBetween(j.registeredAt, nowIso);
    const daysSinceLastAnc = j.lastAncDate ? daysBetween(j.lastAncDate, nowIso) : null;
    const daysToEdc = j.edc ? daysBetween(nowIso, j.edc) : null;

    // Visits sorted chronologically — the timeline + trend sparklines expect
    // oldest-first so the x-axis reads left-to-right like a clinical chart.
    // Secondary sort by visit_number mirrors the API: when two visits share
    // a date (common in HOSxP — date column has no time component), tied
    // entries previously appeared in undefined order so clinicians saw the
    // table flicker between renders.
    const visitsChrono = [...(data.ancVisits ?? [])].sort((a, b) => {
      const d = new Date(a.visitDate).getTime() - new Date(b.visitDate).getTime();
      if (d !== 0) return d;
      return (a.visitNumber ?? 0) - (b.visitNumber ?? 0);
    });

    const attendedWeeks = Array.from(
      new Set(
        visitsChrono
          .map((v) => (v.gaWeeks != null ? Math.round(v.gaWeeks) : null))
          .filter((w): w is number => w != null),
      ),
    ).sort((a, b) => a - b);

    const firstVisitGa = visitsChrono.find((v) => v.gaWeeks != null)?.gaWeeks ?? null;
    // RTCOG OB 66-029 (2566) recommends first ANC contact < 10w. Tightened
    // from 12w (WHO threshold) because Thai guideline is stricter.
    const lateFirstContact = isLateFirstContact(firstVisitGa);

    // Pre-pregnancy BMI — from labor-record height and the earliest visit weight.
    const heightCm = j.heightCm;
    const firstWeight = visitsChrono.find((v) => v.weightKg != null)?.weightKg ?? null;
    const bmi = prePregnancyBmi(heightCm, firstWeight);

    // Lab flags present in the latest risk screen.
    const ruleIds = data.latestRisk?.triggeredRules ?? [];
    const labFlags: LabFlag[] = ruleIds
      .map((id) => LAB_FLAGS_FROM_RULES[id])
      .filter((f): f is LabFlag => !!f);

    // Trend series — null-gaps preserved so the sparkline can skip missing
    // points instead of forging a value. Coerce through Number() because
    // PGlite returns NUMERIC columns as strings.
    const toNum = (v: unknown): number | null => {
      if (v == null) return null;
      const n = typeof v === 'number' ? v : Number(v);
      return Number.isFinite(n) ? n : null;
    };
    const bpSys = visitsChrono.map((v) => toNum(v.bpSystolic));
    const bpDia = visitsChrono.map((v) => toNum(v.bpDiastolic));
    const weight = visitsChrono.map((v) => toNum(v.weightKg));
    const hb = visitsChrono.map((v) => toNum(v.hbGDl));
    const fh = visitsChrono.map((v) => toNum(v.fundalHeightCm));
    const fhr = visitsChrono.map((v) => toNum(v.fetalHr));

    const next = nextContactDue(j.gaWeeks, attendedWeeks);

    // Tdap this pregnancy — scan all visits' vaccinesGiven.
    const tdapGiven = visitsChrono.some((v) =>
      (v.vaccinesGiven ?? []).some((vx) => vx.type === 'TDAP'),
    );
    // RTCOG OB 66-029 (2566) — investigation-overdue checks (centralized in
    // src/services/anc-clinical.ts).
    const overdue = overdueInvestigations({
      gaWeeks: j.gaWeeks,
      anatomyScanDate: j.anatomyScanDate,
      ogttResult: j.ogttResult,
      gbsResult: j.gbsResult,
      tdapGiven,
      mcvFl: j.mcvFl,
      dcipResult: j.dcipResult,
      hbEResult: j.hbEResult,
    });

    // Iron contraindication — RTCOG: Hb H / β-thal major / β-thal-HbE should
    // NOT receive iron supplementation (iron-overload risk).
    const ironContra =
      j.thalassemiaType === 'HB_H'
        ? 'Hb H disease'
        : j.thalassemiaType === 'BETA_THAL_MAJOR'
          ? 'β-thalassemia major'
          : j.thalassemiaType === 'BETA_THAL_HB_E'
            ? 'β-thalassemia / Hb E'
            : null;

    // Immunization flags — most recent status per type, across all visits.
    const immunization = {
      tdap: visitsChrono.flatMap((v) => (v.vaccinesGiven ?? []).filter((x) => x.type === 'TDAP')),
      influenza: visitsChrono.flatMap((v) =>
        (v.vaccinesGiven ?? []).filter((x) => x.type === 'INFLUENZA'),
      ),
      covid: visitsChrono.flatMap((v) => (v.vaccinesGiven ?? []).filter((x) => x.type === 'COVID')),
      ttDoseNo:
        visitsChrono
          .map((v) => v.ttDoseNo)
          .filter((n): n is number => n != null)
          .pop() ?? null,
    };

    return {
      daysSinceRegistered,
      daysSinceLastAnc,
      daysToEdc,
      visitsChrono,
      attendedWeeks,
      firstVisitGa,
      lateFirstContact,
      bmi,
      heightCm,
      labFlags,
      bpSys,
      bpDia,
      weight,
      hb,
      fh,
      fhr,
      next,
      overdue,
      ironContra,
      immunization,
    };
  })();

  if (isLoading) {
    return <LoadingState message="กำลังโหลดข้อมูลการฝากครรภ์..." />;
  }

  if (error || !data?.journey) {
    // Surface the API's actual reason — 404 NOT_FOUND vs 500 INTERNAL_ERROR
    // look identical to the user otherwise. The FetchError carries the
    // server-side message ("ไม่พบข้อมูลการตั้งครรภ์", or a column-missing
    // diagnostic) so admins can act on it instead of guessing.
    const status =
      error && typeof error === 'object' && 'status' in error
        ? (error as { status: number }).status
        : null;
    const apiMessage = error instanceof Error ? error.message : 'ไม่พบข้อมูลการฝากครรภ์';
    const heading = status === 404 ? 'ไม่พบข้อมูลการฝากครรภ์' : 'เกิดข้อผิดพลาด';
    const Icon = status === 404 ? Baby : AlertTriangle;
    return (
      <div
        className="flex flex-col items-center justify-center gap-3 py-24 px-6"
        style={{ background: 'var(--surface-cool)', minHeight: '100%' }}
      >
        <Icon className="h-10 w-10 text-[var(--ink-navy-muted)] opacity-50" />
        <p className="font-mono text-[12px] text-[var(--ink-navy-muted)]">{heading}</p>
        {error ? (
          <p className="max-w-md text-center font-mono text-[11px] text-red-600">{apiMessage}</p>
        ) : null}
        <button
          onClick={() => router.back()}
          className="inline-flex items-center gap-1.5 rounded-sm border bg-white px-3 py-1.5 font-mono text-[11px] text-[var(--ink-navy-dim)] hover:bg-[var(--accent-navy-soft)]"
          style={{ borderColor: 'var(--rule-strong)' }}
        >
          <ArrowLeft className="h-3.5 w-3.5" /> กลับ
        </button>
      </div>
    );
  }

  const { journey, ancVisits, latestRisk, ancAssessment, referrals, newborns } = data;
  const riskColor = ANC_RISK_COLOR[journey.ancRiskLevel ?? ''] ?? 'var(--ink-navy-muted)';
  const riskLabel = journey.ancRiskLevel
    ? (ANC_RISK_LABEL_TH[journey.ancRiskLevel] ?? journey.ancRiskLevel)
    : null;
  const stageColor = STAGE_COLOR[journey.careStage] ?? 'var(--ink-navy-muted)';
  const stageLabel = STAGE_LABEL_TH[journey.careStage] ?? journey.careStage;
  const isReferred = !!journey.currentHcode && journey.currentHcode !== journey.hcode;
  const highRisk = journey.ancRiskLevel === 'HR2' || journey.ancRiskLevel === 'HR3';
  // WHO containment T2 — WhoContactSchedule is a 3-way discriminated union
  // (UNKNOWN_GA / COMPLETE / NEXT). Shared by the NEXT DUE tile and the
  // next-action rail below so both sites stay in sync.
  const nextSchedule = derived?.next;

  return (
    <div
      style={{
        color: 'var(--ink-navy)',
        background: 'var(--surface-cool)',
        zoom: 1.15,
      }}
    >
      {/* ─── Control strip ─── */}
      <div
        className="flex items-center justify-between gap-3 bg-white px-5 py-2"
        style={{ borderBottom: '1px solid var(--rule-strong)' }}
      >
        <button
          onClick={() => router.back()}
          className="inline-flex items-center gap-1 font-mono text-[11px] tracking-[0.1em] text-[var(--ink-navy-muted)] hover:text-[var(--accent-navy)]"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> BACK
        </button>
        <KpiTip
          title="ความสดของข้อมูล"
          body={`เวลาที่ระบบเขียนข้อมูลการฝากครรภ์รายนี้จาก HOSxP/webhook ครั้งล่าสุด — เกิน 60 นาทีจุดเป็นสีเหลือง เกิน 24 ชั่วโมงเป็นสีแดง`}
          trigger={
            <div
              data-testid="sync-stamp"
              className="flex cursor-default items-center gap-1.5 font-mono text-[11px] text-[var(--ink-navy-muted)]"
            />
          }
        >
          <span
            className="inline-block h-2 w-2 rounded-full"
            style={{
              background: SYNC_DOT[classifySyncHealth('OK', journey.syncedAt ?? null, new Date())],
            }}
          />
          ข้อมูลจาก HOSxP · อัปเดต {formatRelativeAge(journey.syncedAt ?? null)}ที่แล้ว
        </KpiTip>
        <div className="flex items-center gap-2">
          {journey.ancRiskLevel && (
            <Pill
              label={`${journey.ancRiskLevel}${riskLabel ? ` · ${riskLabel}` : ''}`}
              color={riskColor}
            />
          )}
          {ancAssessment?.incomplete && (
            <IncompleteAssessmentMarker missingCount={ancAssessment.missingRequired.length} />
          )}
          <Pill label={stageLabel.toUpperCase()} color={stageColor} />
        </div>
      </div>

      {/* ─── Identity header ─── */}
      <div
        className="px-5 py-3"
        style={{
          borderBottom: '1px solid var(--rule-strong)',
          background: 'linear-gradient(90deg, var(--accent-navy-soft) 0%, #f4f6fb 70%, white 100%)',
        }}
      >
        <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--accent-navy)]">
          PROVINCIAL REGISTRY · JOURNEY DETAIL
        </div>
        <div className="mt-1 flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <h1
            className="text-[26px] font-bold leading-tight"
            style={{ color: 'var(--ink-navy)', letterSpacing: '-0.01em' }}
          >
            {maskName(journey.name)}
          </h1>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[12px] text-[var(--ink-navy-dim)]">
            <span className="inline-flex items-center gap-1">
              <User className="h-3 w-3 text-[var(--ink-navy-muted)]" />
              HN <span className="font-semibold text-[var(--ink-navy)]">{journey.hn}</span>
            </span>
            <span>
              อายุ{' '}
              <span className="font-semibold text-[var(--ink-navy)] tabular-nums">
                {journey.age}
              </span>{' '}
              ปี
            </span>
            {journey.gravida != null && (
              <span className="font-mono tracking-[0.05em]">
                G<span className="font-semibold text-[var(--ink-navy)]">{journey.gravida}</span>
                {journey.termBirths != null && (
                  <>
                    ·T
                    <span className="font-semibold text-[var(--ink-navy)]">
                      {journey.termBirths}
                    </span>
                  </>
                )}
                {journey.pretermBirths != null && (
                  <>
                    ·P
                    <span className="font-semibold text-[var(--ink-navy)]">
                      {journey.pretermBirths}
                    </span>
                  </>
                )}
                {journey.abortions != null && (
                  <>
                    ·A
                    <span className="font-semibold text-[var(--ink-navy)]">
                      {journey.abortions}
                    </span>
                  </>
                )}
                {journey.livingChildren != null && (
                  <>
                    ·L
                    <span className="font-semibold text-[var(--ink-navy)]">
                      {journey.livingChildren}
                    </span>
                  </>
                )}
                {journey.termBirths == null && journey.pretermBirths == null && (
                  <>
                    ·P
                    <span className="font-semibold text-[var(--ink-navy)]">
                      {journey.para ?? '?'}
                    </span>
                  </>
                )}
              </span>
            )}
            {journey.bloodGroup && (
              <span className="inline-flex items-center gap-1">
                <Droplets className="h-3 w-3 text-[var(--ink-navy-muted)]" />
                BLOOD{' '}
                <span className="font-semibold text-[var(--ink-navy)]">
                  {journey.bloodGroup}
                  {journey.rhFactor === 'NEG' ? (
                    <span className="ml-0.5 text-[var(--risk-medium)]">Rh−</span>
                  ) : journey.rhFactor === 'POS' ? (
                    <span className="ml-0.5 text-[var(--ink-navy-muted)]">Rh+</span>
                  ) : null}
                </span>
              </span>
            )}
            {derived?.heightCm != null && (
              <span className="inline-flex items-center gap-1">
                <Ruler className="h-3 w-3 text-[var(--ink-navy-muted)]" />
                HT{' '}
                <span className="font-semibold text-[var(--ink-navy)] tabular-nums">
                  {derived.heightCm}
                </span>
                <span className="text-[10px] text-[var(--ink-navy-muted)]">cm</span>
              </span>
            )}
            {derived?.bmi != null && (
              <span>
                BMI{' '}
                <span
                  className="font-semibold tabular-nums"
                  style={{
                    color:
                      derived.bmi < 18.5
                        ? 'var(--risk-medium)'
                        : derived.bmi >= 30
                          ? 'var(--risk-high)'
                          : derived.bmi >= 23
                            ? 'var(--risk-medium)'
                            : 'var(--risk-low)',
                  }}
                >
                  {derived.bmi}
                </span>
              </span>
            )}
          </div>
        </div>
      </div>

      {/* ─── Labor cross-link — once admitted, jump straight to the labor
          detail (partograph, vitals) the ward is charting right now. ─── */}
      {data.laborAdmission &&
        (() => {
          const la = data.laborAdmission!;
          const delivered = la.laborStatus === 'DELIVERED' || la.laborStatus === 'DISCHARGED';
          const accent = delivered ? 'var(--risk-low)' : 'var(--risk-medium)';
          return (
            <div
              className="flex flex-wrap items-center justify-between gap-2 px-5 py-2"
              style={{
                borderBottom: '1px solid var(--rule-strong)',
                borderLeft: `3px solid ${accent}`,
                background: `color-mix(in srgb, ${accent} 7%, white)`,
              }}
            >
              <div className="flex flex-wrap items-center gap-2 font-mono text-[11px] text-[var(--ink-navy-dim)]">
                <Activity className="h-3.5 w-3.5" style={{ color: accent }} />
                <span className="font-bold uppercase tracking-[0.1em]" style={{ color: accent }}>
                  LABOR RECORD
                </span>
                <span>
                  AN <span className="font-semibold text-[var(--ink-navy)]">{la.an}</span>
                </span>
                <span>
                  ADMIT{' '}
                  <span className="font-semibold text-[var(--ink-navy)]">
                    {formatThaiDateTime(la.admitDate)}
                  </span>
                </span>
                <Pill label={LABOR_STATUS_TH[la.laborStatus] ?? la.laborStatus} color={accent} />
              </div>
              <Link
                data-testid="labor-admission-link"
                href={`/patients/${la.hcode}-${la.an}`}
                className="inline-flex items-center gap-1 rounded-sm px-2 py-1 font-mono text-[11px] font-bold tracking-[0.06em] text-white transition-colors hover:opacity-90"
                style={{ background: 'var(--accent-navy)' }}
              >
                เปิดข้อมูลห้องคลอด / Partograph →
              </Link>
            </div>
          );
        })()}

      {/* ─── Pregnancy summary strip (6 tiles) ─── */}
      <div
        className="grid bg-white"
        style={{
          gridTemplateColumns: 'repeat(6, minmax(0, 1fr))',
          borderBottom: '1px solid var(--rule-strong)',
        }}
      >
        <KpiTip
          title="อายุครรภ์ (GA)"
          body="อายุครรภ์เป็นสัปดาห์จาก HOSxP (หรือคำนวณย้อนจาก EDC เมื่อไม่มีค่า) — ครบกำหนดที่ 37 สัปดาห์, เกิน 41 สัปดาห์แสดงสีแดง (post-term)"
          trigger={<div className="cursor-default" />}
        >
          <MetricTile
            label="GA"
            value={journey.gaWeeks != null ? `${journey.gaWeeks}w` : '—'}
            sub={
              journey.gaWeeks != null
                ? journey.gaWeeks >= 37
                  ? 'Term'
                  : journey.gaWeeks >= 28
                    ? 'Third tri'
                    : journey.gaWeeks >= 14
                      ? 'Second tri'
                      : 'First tri'
                : undefined
            }
            color={
              journey.gaWeeks != null && journey.gaWeeks >= 41
                ? 'var(--risk-high)'
                : 'var(--accent-navy)'
            }
            icon={<Clock className="h-3 w-3" />}
            tone="bold"
          />
        </KpiTip>
        <KpiTip
          title="วันกำหนดคลอด (EDC)"
          body="นับถอยหลังถึงวันกำหนดคลอด — เลยกำหนดแล้วแสดงสีแดง ควรประเมินการชักนำคลอด/ติดตามใกล้ชิด"
          trigger={<div className="cursor-default" />}
        >
          <MetricTile
            label="EDC"
            value={formatThaiShort(journey.edc)}
            sub={
              derived?.daysToEdc != null
                ? derived.daysToEdc > 0
                  ? `อีก ${derived.daysToEdc} วัน`
                  : `เลย ${Math.abs(derived.daysToEdc)} วัน`
                : 'วันกำหนดคลอด'
            }
            color={
              derived?.daysToEdc != null && derived.daysToEdc < 0
                ? 'var(--risk-high)'
                : 'var(--primary-teal)'
            }
            icon={<Calendar className="h-3 w-3" />}
          />
        </KpiTip>
        <KpiTip
          title="ประจำเดือนครั้งสุดท้าย (LMP)"
          body="วันแรกของประจำเดือนครั้งสุดท้าย — ฐานการคำนวณ GA/EDC เมื่อไม่มีอัลตราซาวด์กำหนดอายุครรภ์"
          trigger={<div className="cursor-default" />}
        >
          <MetricTile
            label="LMP"
            value={formatThaiShort(journey.lmp)}
            sub="ประจำเดือนครั้งสุดท้าย"
            color="var(--ink-navy-muted)"
            icon={<Calendar className="h-3 w-3" />}
          />
        </KpiTip>
        <KpiTip
          title="จำนวนครั้งฝากครรภ์"
          body="จำนวนครั้ง ANC ทั้งหมดของครรภ์นี้ (ทุกโรงพยาบาล) — สีแดงเมื่อห่างจากครั้งล่าสุดเกิน 28 วัน"
          trigger={<div className="cursor-default" />}
        >
          <MetricTile
            label="ANC VISITS"
            value={journey.ancVisitCount}
            sub={
              derived?.daysSinceLastAnc != null
                ? `ครั้งล่าสุด ${derived.daysSinceLastAnc}d ago`
                : 'ยังไม่มีนัด'
            }
            color={
              derived?.daysSinceLastAnc != null && derived.daysSinceLastAnc > 28
                ? 'var(--risk-high)'
                : 'var(--accent-navy)'
            }
            icon={<Activity className="h-3 w-3" />}
          />
        </KpiTip>
        <KpiTip
          title="ฝากครรภ์ครั้งแรก"
          body="GA ของการฝากครรภ์ครั้งแรก — RTCOG OB 66-029 แนะนำให้ฝากครรภ์ครั้งแรกก่อน 10 สัปดาห์ (เข้มกว่าเกณฑ์ WHO 12 สัปดาห์)"
          trigger={<div className="cursor-default" />}
        >
          <MetricTile
            label="1ST CONTACT"
            value={derived?.firstVisitGa != null ? `${derived.firstVisitGa}w` : '—'}
            sub={
              derived?.lateFirstContact
                ? 'LATE — RTCOG < 10w'
                : derived?.firstVisitGa != null
                  ? 'RTCOG on-time'
                  : undefined
            }
            color={
              derived?.firstVisitGa == null
                ? 'var(--ink-navy-muted)'
                : derived.lateFirstContact
                  ? 'var(--risk-high)'
                  : 'var(--risk-low)'
            }
            icon={<TrendingUp className="h-3 w-3" />}
          />
        </KpiTip>
        <KpiTip
          title="นัดถัดไป (WHO 8-contact)"
          body="WHO contact ครั้งถัดไปตามตารางนัด 8 ครั้ง เทียบกับ GA ปัจจุบันและครั้งที่มาแล้ว — เลยกำหนดแสดงสีแดง ควรติดตามตัว ไม่ทราบอายุครรภ์จะประเมินตารางนัดไม่ได้"
          trigger={<div className="cursor-default" />}
        >
          <MetricTile
            label="NEXT DUE"
            value={
              nextSchedule?.status === 'NEXT'
                ? `${nextSchedule.ga}w`
                : nextSchedule?.status === 'UNKNOWN_GA'
                  ? '—'
                  : 'ครบกำหนด'
            }
            sub={
              nextSchedule?.status === 'NEXT'
                ? nextSchedule.dueStatus === 'overdue'
                  ? `เลย ${Math.abs(nextSchedule.weeksAway)}w`
                  : nextSchedule.dueStatus === 'due-now'
                    ? 'นัดครั้งถัดไป'
                    : `อีก ${nextSchedule.weeksAway}w`
                : nextSchedule?.status === 'UNKNOWN_GA'
                  ? 'ไม่ทราบอายุครรภ์ — ประเมินตารางนัดไม่ได้'
                  : 'ครบ 8 contact'
            }
            color={
              nextSchedule?.status === 'NEXT'
                ? nextSchedule.dueStatus === 'overdue'
                  ? 'var(--risk-high)'
                  : nextSchedule.dueStatus === 'due-now'
                    ? 'var(--risk-medium)'
                    : 'var(--risk-low)'
                : nextSchedule?.status === 'UNKNOWN_GA'
                  ? 'var(--risk-medium)'
                  : 'var(--risk-low)'
            }
            icon={<AlertTriangle className="h-3 w-3" />}
            tone="bold"
          />
        </KpiTip>
      </div>

      {/* ─── WHO 8-contact progress ─── */}
      <div className="bg-white px-5 py-3" style={{ borderBottom: '1px solid var(--rule-strong)' }}>
        <GaProgressBar gaWeeks={journey.gaWeeks} attendedWeeks={derived?.attendedWeeks ?? []} />
      </div>

      {/* ═══ 2-col main ═══ */}
      <div
        className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_400px]"
        style={{ alignItems: 'start' }}
      >
        {/* ─── LEFT: timeline + trends + labs ─── */}
        <div className="min-w-0 border-r border-[var(--rule-strong)] bg-white p-5 space-y-6">
          {/* 01 — Vital trends (new) */}
          <section>
            <SectionLabel
              idx={1}
              right={<span>{derived?.visitsChrono.length ?? 0} VISITS · L→R OLDEST→NEWEST</span>}
            >
              Vital trends
            </SectionLabel>
            <div className="mt-2 border bg-white" style={{ borderColor: 'var(--rule-strong)' }}>
              {(derived?.visitsChrono.length ?? 0) === 0 ? (
                <div className="px-4 py-8 text-center font-mono text-[11px] text-[var(--ink-navy-muted)]">
                  ยังไม่มีข้อมูลเพียงพอสำหรับแสดงแนวโน้ม
                </div>
              ) : (
                <>
                  <div
                    className="grid items-center gap-2 border-b px-3 py-2 font-mono text-[9px] font-bold uppercase tracking-[0.12em]"
                    style={{
                      gridTemplateColumns: '96px 80px 54px 1fr',
                      borderColor: 'var(--accent-navy)',
                      background: 'var(--accent-navy)',
                      color: 'white',
                    }}
                  >
                    <div>METRIC</div>
                    <div>LATEST</div>
                    <div>Δ</div>
                    <div>TREND</div>
                  </div>
                  <TrendRow
                    label="BP SYS"
                    values={derived!.bpSys}
                    unit="mmHg"
                    highBand={BP_SYS_HIGH}
                    color="var(--risk-medium)"
                    severity={(v) =>
                      v >= BP_SYS_HIGH ? 'abnormal' : v >= BP_SYS_AMBER ? 'borderline' : 'normal'
                    }
                  />
                  <TrendRow
                    label="BP DIA"
                    values={derived!.bpDia}
                    unit="mmHg"
                    highBand={BP_DIA_HIGH}
                    color="var(--risk-medium)"
                    severity={(v) =>
                      v >= BP_DIA_HIGH ? 'abnormal' : v >= BP_DIA_AMBER ? 'borderline' : 'normal'
                    }
                  />
                  <TrendRow
                    label="WEIGHT"
                    values={derived!.weight}
                    unit="kg"
                    format={(v) => v.toFixed(1)}
                    color="var(--accent-navy)"
                  />
                  <TrendRow
                    label="Hb"
                    values={derived!.hb}
                    unit="g/dL"
                    lowBand={HB_LOW}
                    format={(v) => v.toFixed(1)}
                    color="var(--risk-medium)"
                    severity={(v) => sevHb(v)}
                  />
                  <TrendRow
                    label="FUNDAL HT"
                    values={derived!.fh}
                    unit="cm"
                    format={(v) => v.toFixed(1)}
                    color="var(--accent-navy)"
                  />
                  <TrendRow
                    label="FHR"
                    values={derived!.fhr}
                    unit="bpm"
                    lowBand={FHR_LOW}
                    highBand={FHR_HIGH}
                    color="var(--risk-medium)"
                    severity={(v) => sevFhr(v)}
                  />
                </>
              )}
            </div>
          </section>

          {/* 02 — ANC timeline */}
          <section>
            <SectionLabel
              idx={2}
              right={
                <span>
                  {ancVisits.length} VISIT{ancVisits.length === 1 ? '' : 'S'}
                </span>
              }
            >
              ANC visit timeline
            </SectionLabel>
            <div
              className="mt-2 border bg-white overflow-x-auto"
              style={{ borderColor: 'var(--rule-strong)' }}
            >
              {(derived?.visitsChrono.length ?? 0) === 0 ? (
                <div className="px-4 py-8 text-center">
                  <Calendar className="mx-auto mb-2 h-6 w-6 text-[var(--ink-navy-muted)] opacity-50" />
                  <p className="font-mono text-[11px] text-[var(--ink-navy-muted)]">
                    ยังไม่มีประวัติการฝากครรภ์
                  </p>
                </div>
              ) : (
                <>
                  <div
                    className="grid gap-2 border-b px-3 py-2 font-mono text-[10px] font-bold tracking-[0.1em]"
                    style={{
                      gridTemplateColumns:
                        '32px 100px 120px 42px 50px 54px 56px 76px 54px 74px 62px 1fr',
                      borderColor: 'var(--accent-navy)',
                      background: 'var(--accent-navy)',
                      color: 'white',
                      minWidth: 940,
                    }}
                  >
                    <div>#</div>
                    <div>DATE</div>
                    <div>HOSPITAL</div>
                    <div>GAP</div>
                    <div>GA</div>
                    <div>FH</div>
                    <div>WT</div>
                    <div>BP</div>
                    <div>FHR</div>
                    <div>PRES.</div>
                    <div>LIE</div>
                    <div>FLAGS</div>
                  </div>
                  {derived!.visitsChrono.map((v, idx, arr) => {
                    const prev = idx > 0 ? arr[idx - 1] : null;
                    const gap = prev ? daysBetween(prev.visitDate, v.visitDate) : null;
                    const bpSev = sevBp(v.bpSystolic, v.bpDiastolic);
                    const fhrSev = sevFhr(v.fetalHr);
                    const hbSev = sevHb(v.hbGDl);
                    const urineProteinSev = sevUrineProtein(v.urineProtein);
                    const fetalMovementSev = sevFetalMovement(v.fetalMovementOk);
                    const bpHigh = bpSev === 'abnormal';
                    const proteinuria = urineProteinSev === 'abnormal';
                    const glucosuria = v.urineGlucose != null && /\+/.test(v.urineGlucose);
                    const anemia = hbSev === 'borderline' || hbSev === 'abnormal';
                    const severeAnemia = hbSev === 'abnormal';
                    const preeclampsiaSuspect = bpHigh && proteinuria;
                    const reducedFm = fetalMovementSev === 'abnormal';
                    const dangers = v.dangerSigns ?? [];
                    // 'unknown' (missing data) must never widen this — only a
                    // known abnormal/borderline finding raises a flag.
                    const anyFlag =
                      bpSev === 'abnormal' ||
                      bpSev === 'borderline' ||
                      fhrSev === 'abnormal' ||
                      proteinuria ||
                      glucosuria ||
                      anemia ||
                      preeclampsiaSuspect ||
                      reducedFm ||
                      dangers.length > 0;
                    // No known flag fired, but at least one of the five core
                    // checks couldn't be evaluated — this visit is not fully
                    // recorded, which is distinct from "checked and normal".
                    const anyUnknown =
                      bpSev === 'unknown' ||
                      fhrSev === 'unknown' ||
                      hbSev === 'unknown' ||
                      urineProteinSev === 'unknown' ||
                      fetalMovementSev === 'unknown';
                    return (
                      <div
                        // Composite key: HOSxP can store duplicate visit_number
                        // (re-sync, transfer, or two visits on the same day),
                        // so visitNumber alone is not unique within a journey.
                        key={`${v.visitDate}-${v.visitNumber}-${idx}`}
                        className="grid items-center gap-2 border-b px-3 text-[12px] transition-colors hover:bg-[var(--accent-navy-soft)]"
                        style={{
                          gridTemplateColumns:
                            '32px 100px 120px 42px 50px 54px 56px 76px 54px 74px 62px 1fr',
                          borderColor: 'var(--rule-hair)',
                          height: 40,
                          minWidth: 940,
                          background: idx % 2 === 1 ? 'rgba(231,234,245,0.35)' : 'white',
                        }}
                      >
                        <div
                          className="inline-flex h-6 w-7 items-center justify-center rounded-sm font-mono text-[11px] font-bold tabular-nums"
                          style={{
                            background: 'var(--accent-navy)',
                            color: 'white',
                          }}
                        >
                          {v.visitNumber}
                        </div>
                        <div className="font-mono text-[11px] tabular-nums">
                          {formatThai(v.visitDate)}
                        </div>
                        <div
                          className="truncate text-[11px]"
                          style={{ color: 'var(--ink-navy-dim)' }}
                          title={v.hospitalName ?? '—'}
                        >
                          {v.hospitalName ?? (
                            <span className="text-[var(--ink-navy-muted)]">—</span>
                          )}
                        </div>
                        <div className="font-mono text-[11px] tabular-nums text-[var(--ink-navy-muted)]">
                          {gap != null ? `${gap}d` : '—'}
                        </div>
                        <div className="font-mono tabular-nums">
                          {v.gaWeeks ?? '—'}
                          {v.gaWeeks != null && (
                            <span className="text-[10px] text-[var(--ink-navy-muted)]">w</span>
                          )}
                        </div>
                        <div className="font-mono tabular-nums">{v.fundalHeightCm ?? '—'}</div>
                        <div className="font-mono tabular-nums">{v.weightKg ?? '—'}</div>
                        <div
                          className={cn(
                            'inline-flex items-center justify-start rounded-sm px-1.5 font-mono tabular-nums',
                            (bpSev === 'abnormal' || bpSev === 'borderline') && 'font-bold',
                          )}
                          style={{
                            color: sevColor(bpSev),
                            background: sevBg(bpSev),
                          }}
                        >
                          {v.bpSystolic != null && v.bpDiastolic != null
                            ? `${v.bpSystolic}/${v.bpDiastolic}`
                            : '—'}
                        </div>
                        <div
                          className={cn(
                            'inline-flex items-center justify-start rounded-sm px-1.5 font-mono tabular-nums',
                            fhrSev === 'abnormal' && 'font-bold',
                          )}
                          style={{
                            color: sevColor(fhrSev),
                            background: sevBg(fhrSev),
                          }}
                        >
                          {v.fetalHr ?? '—'}
                        </div>
                        <div
                          className="font-mono text-[11px] tracking-[0.04em]"
                          style={{
                            color:
                              v.presentation &&
                              /BR|B|BREECH|ก้น|TR|T|OBL|ขวาง/i.test(v.presentation)
                                ? 'var(--risk-medium)'
                                : undefined,
                          }}
                        >
                          {presentationLabel(v.presentation)}
                        </div>
                        <div className="font-mono text-[11px] tracking-[0.04em] text-[var(--ink-navy-dim)]">
                          {engagementLabel(v.engagement)}
                        </div>
                        <div className="flex flex-wrap gap-1">
                          {preeclampsiaSuspect && (
                            <VisitChip label="PRE-ECL SUSPECT" color="var(--risk-high)" />
                          )}
                          {bpHigh && !preeclampsiaSuspect && (
                            <VisitChip
                              label="BP HIGH"
                              color="var(--risk-high)"
                              icon={<Droplets className="h-2.5 w-2.5" />}
                            />
                          )}
                          {fhrSev === 'abnormal' && (
                            <VisitChip
                              label="FHR"
                              color="var(--risk-high)"
                              icon={<Heart className="h-2.5 w-2.5" />}
                            />
                          )}
                          {bpSev === 'borderline' && (
                            <VisitChip
                              label="BP AMBER"
                              color="var(--risk-medium)"
                              icon={<Droplets className="h-2.5 w-2.5" />}
                            />
                          )}
                          {severeAnemia && (
                            <VisitChip label={`Hb ${v.hbGDl}`} color="var(--risk-high)" />
                          )}
                          {anemia && !severeAnemia && (
                            <VisitChip label={`Hb ${v.hbGDl}`} color="var(--risk-medium)" />
                          )}
                          {proteinuria && (
                            <VisitChip label={`PROT ${v.urineProtein}`} color="var(--risk-high)" />
                          )}
                          {glucosuria && (
                            <VisitChip
                              label={`GLUC ${v.urineGlucose}`}
                              color="var(--risk-medium)"
                            />
                          )}
                          {reducedFm && <VisitChip label="FM↓" color="var(--risk-high)" />}
                          {dangers.map((d) => (
                            <VisitChip key={d} label={dangerLabel(d)} color="var(--risk-high)" />
                          ))}
                          {v.ttDoseNo != null && v.ttDoseNo > 0 && (
                            <VisitChip label={`TT${v.ttDoseNo}`} color="var(--accent-navy)" />
                          )}
                          {v.ironFolicGiven && (
                            <VisitChip label="Fe+FA" color="var(--ink-navy-muted)" />
                          )}
                          {v.calciumGiven && <VisitChip label="Ca" color="var(--ink-navy-muted)" />}
                          {!anyFlag && !anyUnknown && (
                            <span className="inline-flex items-center gap-1 font-mono text-[10px] text-[var(--risk-low)]">
                              <CheckCircle2 className="h-2.5 w-2.5" /> OK
                            </span>
                          )}
                          {!anyFlag && anyUnknown && (
                            <span className="inline-flex items-center gap-1 font-mono text-[10px] text-[var(--risk-medium)]">
                              <HelpCircle className="h-2.5 w-2.5" /> ไม่ได้บันทึกครบ
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </>
              )}
            </div>
          </section>

          {/* 03 — Labs + screening + PMH (RTCOG OB 66-029 booking panel) */}
          <section>
            <SectionLabel
              idx={3}
              right={
                (derived?.labFlags.length ?? 0) > 0 ? (
                  <span className="flex flex-wrap items-center gap-1">
                    {derived!.labFlags.map((f) => (
                      <span
                        key={f.key}
                        className="inline-flex items-center border px-1.5 py-0.5 font-mono text-[10px] font-semibold tracking-[0.06em]"
                        style={{ color: f.color, borderColor: f.color }}
                      >
                        {f.label}
                      </span>
                    ))}
                  </span>
                ) : (
                  <span>ALL CLEAR</span>
                )
              }
            >
              Labs · screening · PMH
            </SectionLabel>

            {/* Iron contraindication banner — RTCOG: no iron in Hb H / β-thal */}
            {derived?.ironContra && (
              <div
                className="mt-2 flex items-start gap-2 border-l-4 px-3 py-2"
                style={{
                  borderLeftColor: 'var(--risk-high)',
                  background: 'rgba(239, 68, 68, 0.08)',
                }}
              >
                <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-[var(--risk-high)]" />
                <div>
                  <div className="font-mono text-[11px] font-bold uppercase tracking-[0.12em] text-[var(--risk-high)]">
                    ห้ามให้ iron supplement
                  </div>
                  <div className="text-[12px] leading-snug text-[var(--ink-navy-dim)]">
                    ผู้ป่วยมี <b>{derived.ironContra}</b> — ต้องงดธาตุเหล็ก (RTCOG OB 66-029
                    เนื่องจากภาวะ iron overload)
                  </div>
                </div>
              </div>
            )}

            {/* Sub-group 3a — Serology (infectious + blood type) */}
            <div className="mt-2">
              <div className="font-mono text-[9px] uppercase tracking-[0.12em] text-[var(--ink-navy-muted)]">
                SEROLOGY · BLOOD TYPE
              </div>
              <div
                className="mt-1 grid grid-cols-6 gap-0 border bg-white"
                style={{ borderColor: 'var(--rule-strong)' }}
              >
                <LabTile
                  label="BLOOD"
                  value={journey.bloodGroup}
                  status={journey.bloodGroup ? 'normal' : 'missing'}
                />
                <LabTile
                  label="Rh"
                  value={journey.rhFactor}
                  status={
                    !journey.rhFactor
                      ? 'missing'
                      : journey.rhFactor === 'NEG'
                        ? 'abnormal'
                        : 'normal'
                  }
                />
                <LabTile
                  label="HBsAg"
                  value={journey.hbsagResult}
                  status={
                    !journey.hbsagResult
                      ? 'missing'
                      : journey.hbsagResult === 'POS'
                        ? 'abnormal'
                        : 'normal'
                  }
                />
                <LabTile
                  label="VDRL"
                  value={journey.vdrlResult}
                  status={
                    !journey.vdrlResult
                      ? 'missing'
                      : journey.vdrlResult === 'POS'
                        ? 'abnormal'
                        : 'normal'
                  }
                />
                <LabTile
                  label="HIV"
                  value={journey.hivResult}
                  status={
                    !journey.hivResult
                      ? 'missing'
                      : journey.hivResult === 'POS'
                        ? 'abnormal'
                        : 'normal'
                  }
                />
                <LabTile
                  label="OGTT"
                  value={journey.ogttResult}
                  status={
                    !journey.ogttResult
                      ? 'missing'
                      : journey.ogttResult === 'ABNORMAL'
                        ? 'abnormal'
                        : 'normal'
                  }
                />
              </div>
            </div>

            {/* Sub-group 3b — Thalassemia screening (RTCOG 1st-visit) */}
            <div className="mt-3">
              <div className="font-mono text-[9px] uppercase tracking-[0.12em] text-[var(--ink-navy-muted)]">
                THALASSEMIA · MCV / DCIP / Hb E
              </div>
              <div
                className="mt-1 grid grid-cols-4 gap-0 border bg-white"
                style={{ borderColor: 'var(--rule-strong)' }}
              >
                <LabTile
                  label="MCV (fL)"
                  value={journey.mcvFl != null ? String(journey.mcvFl) : null}
                  status={
                    journey.mcvFl == null ? 'missing' : journey.mcvFl < 80 ? 'abnormal' : 'normal'
                  }
                />
                <LabTile
                  label="DCIP"
                  value={journey.dcipResult ?? null}
                  status={
                    !journey.dcipResult
                      ? 'missing'
                      : journey.dcipResult === 'POS'
                        ? 'abnormal'
                        : 'normal'
                  }
                />
                <LabTile
                  label="Hb E"
                  value={journey.hbEResult ?? null}
                  status={
                    !journey.hbEResult
                      ? 'missing'
                      : journey.hbEResult === 'POS'
                        ? 'abnormal'
                        : 'normal'
                  }
                />
                <LabTile
                  label="THAL TYPE"
                  value={
                    journey.thalassemiaType ? journey.thalassemiaType.replace(/_/g, ' ') : null
                  }
                  status={
                    !journey.thalassemiaType
                      ? 'missing'
                      : journey.thalassemiaType === 'NORMAL' || journey.thalassemiaType === 'TRAIT'
                        ? 'normal'
                        : 'abnormal'
                  }
                />
              </div>
            </div>

            {/* Sub-group 3c — Cervical / Aneuploidy / GBS screening */}
            <div className="mt-3">
              <div className="font-mono text-[9px] uppercase tracking-[0.12em] text-[var(--ink-navy-muted)]">
                SCREENING · CERVICAL · ANEUPLOIDY · GBS
              </div>
              <div
                className="mt-1 grid grid-cols-3 gap-0 border bg-white"
                style={{ borderColor: 'var(--rule-strong)' }}
              >
                <LabTile
                  label="CERVICAL"
                  value={
                    journey.cervicalScreenResult
                      ? `${journey.cervicalScreenType ?? ''} ${journey.cervicalScreenResult}`.trim()
                      : null
                  }
                  status={
                    !journey.cervicalScreenResult
                      ? 'missing'
                      : journey.cervicalScreenResult === 'ABNORMAL'
                        ? 'abnormal'
                        : 'normal'
                  }
                />
                <LabTile
                  label="ANEUPLOIDY"
                  value={
                    journey.aneuploidyResult
                      ? `${journey.aneuploidyMethod ?? ''} ${journey.aneuploidyResult}`.trim()
                      : null
                  }
                  status={
                    !journey.aneuploidyResult
                      ? 'missing'
                      : journey.aneuploidyResult === 'HIGH_RISK'
                        ? 'abnormal'
                        : 'normal'
                  }
                />
                <LabTile
                  label="GBS (35-37w)"
                  value={journey.gbsResult ?? null}
                  status={
                    !journey.gbsResult
                      ? 'missing'
                      : journey.gbsResult === 'POS'
                        ? 'abnormal'
                        : 'normal'
                  }
                />
              </div>
            </div>

            {journey.pastMedicalHistory && (
              <div
                className="mt-3 border bg-white px-4 py-3"
                style={{ borderColor: 'var(--rule-strong)' }}
              >
                <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--ink-navy-muted)]">
                  PMH · โรคประจำตัว / ประวัติการรักษา
                </div>
                <div className="mt-1 text-[13px] leading-relaxed text-[var(--ink-navy-dim)]">
                  {journey.pastMedicalHistory}
                </div>
              </div>
            )}

            {/* Sub-group 3d — High-risk history (RTCOG OB 66-029 booking
                flags). Only renders when at least one flag/value is present. */}
            {(() => {
              const hxFlags: Array<{ key: string; label: string; color: string }> = [];
              if (journey.priorPeDvt)
                hxFlags.push({ key: 'pe', label: 'เคยมี PE/DVT', color: 'var(--risk-high)' });
              if (journey.severeLungDisease)
                hxFlags.push({ key: 'lung', label: 'โรคปอดรุนแรง', color: 'var(--risk-high)' });
              if (journey.alloimmunizationCde)
                hxFlags.push({
                  key: 'allo',
                  label: 'Alloimmunization (CDE)',
                  color: 'var(--risk-high)',
                });
              if (journey.bariatricSurgeryHx)
                hxFlags.push({
                  key: 'bariatric',
                  label: 'เคยผ่าตัดลดขนาดกระเพาะ',
                  color: 'var(--risk-medium)',
                });
              if (journey.teratogenExposure)
                hxFlags.push({
                  key: 'teratogen',
                  label: 'สัมผัสสารก่อวิรูป (teratogen)',
                  color: 'var(--risk-medium)',
                });
              if (journey.congenitalInfection)
                hxFlags.push({
                  key: 'congenital',
                  label: 'ติดเชื้อก่อวิรูปแต่กำเนิด',
                  color: 'var(--risk-medium)',
                });
              const hasValues =
                journey.proteinuria24hMg != null ||
                journey.creatinineMgDl != null ||
                (journey.gdmRiskFactors?.length ?? 0) > 0;
              if (hxFlags.length === 0 && !hasValues) return null;
              return (
                <div
                  data-testid="high-risk-history"
                  className="mt-3 border bg-white px-4 py-3"
                  style={{
                    borderColor: 'var(--rule-strong)',
                    borderLeft: '3px solid var(--risk-medium)',
                  }}
                >
                  <KpiTip
                    title="ประวัติเสี่ยงสูง"
                    body="ปัจจัยเสี่ยงระดับประวัติจากระเบียนฝากครรภ์ (RTCOG OB 66-029) — แสดงเฉพาะข้อที่มีข้อมูล; โปรตีนปัสสาวะ 24 ชม. แดงเมื่อเข้าเกณฑ์ครรภ์เป็นพิษ"
                    trigger={
                      <div className="cursor-default font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--ink-navy-muted)]" />
                    }
                  >
                    HIGH-RISK HISTORY · ประวัติเสี่ยงสูง
                  </KpiTip>
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    {hxFlags.map((f) => (
                      <FlagChip key={f.key} color={f.color}>
                        {f.label}
                      </FlagChip>
                    ))}
                    {journey.proteinuria24hMg != null && (
                      <FlagChip
                        color={
                          journey.proteinuria24hMg >= PROTEINURIA_24H_HIGH_MG
                            ? 'var(--risk-high)'
                            : 'var(--ink-navy-muted)'
                        }
                      >
                        โปรตีนปัสสาวะ 24 ชม. {journey.proteinuria24hMg} mg
                      </FlagChip>
                    )}
                    {journey.creatinineMgDl != null && (
                      <FlagChip
                        color={
                          journey.creatinineMgDl > CREATININE_HIGH_MG_DL
                            ? 'var(--risk-high)'
                            : 'var(--ink-navy-muted)'
                        }
                      >
                        Creatinine {journey.creatinineMgDl} mg/dL
                      </FlagChip>
                    )}
                    {(journey.gdmRiskFactors ?? []).map((g) => (
                      <FlagChip key={g} color="var(--risk-medium)">
                        GDM: {g}
                      </FlagChip>
                    ))}
                  </div>
                </div>
              );
            })()}
          </section>

          {/* 04 — Immunization (RTCOG: Tdap every pregnancy 27-36w) */}
          <section>
            <SectionLabel
              idx={4}
              right={
                <span>
                  {derived?.immunization.tdap.length ?? 0} TDAP ·{' '}
                  {derived?.immunization.influenza.length ?? 0} FLU
                </span>
              }
            >
              Immunization
            </SectionLabel>
            <div
              className="mt-2 grid grid-cols-4 gap-0 border bg-white"
              style={{ borderColor: 'var(--rule-strong)' }}
            >
              <VaccineTile
                label="TDAP"
                subLabel="27-36w"
                records={derived?.immunization.tdap ?? []}
                requiredThisPregnancy
                currentGa={journey.gaWeeks}
                windowStart={27}
                windowEnd={36}
              />
              <VaccineTile
                label="INFLUENZA"
                subLabel="any tri"
                records={derived?.immunization.influenza ?? []}
              />
              <VaccineTile
                label="COVID-19"
                subLabel="per OB 63-022"
                records={derived?.immunization.covid ?? []}
              />
              <VaccineTile
                label={`TT dose ${derived?.immunization.ttDoseNo ?? '?'}`}
                subLabel="legacy"
                records={
                  derived?.immunization.ttDoseNo
                    ? [{ type: 'TT', dose: derived.immunization.ttDoseNo }]
                    : []
                }
              />
            </div>
          </section>

          {/* 05 — Ultrasound timeline (T1 dating, T2 anatomy, T3 wellbeing) */}
          <section>
            <SectionLabel idx={5} right={<span>T1 DATING · T2 ANATOMY · T3 WELLBEING</span>}>
              Ultrasound &amp; fetal wellbeing
            </SectionLabel>
            <div
              className="mt-2 grid grid-cols-1 gap-0 border bg-white md:grid-cols-3"
              style={{ borderColor: 'var(--rule-strong)' }}
            >
              {/* T1 dating */}
              <div
                className="flex flex-col gap-1 px-3 py-2"
                style={{ borderRight: '1px solid var(--rule-hair)' }}
              >
                <div className="font-mono text-[9px] uppercase tracking-[0.12em] text-[var(--ink-navy-muted)]">
                  T1 · DATING
                </div>
                <div className="text-[12px] text-[var(--ink-navy)]">
                  {journey.datingMethod ? (
                    <span className="font-semibold">{journey.datingMethod}</span>
                  ) : (
                    <span className="text-[var(--ink-navy-muted)]">— ไม่ระบุวิธี —</span>
                  )}
                </div>
                <div className="font-mono text-[10px] text-[var(--ink-navy-muted)]">
                  LMP {formatThaiShort(journey.lmp)} · EDC {formatThaiShort(journey.edc)}
                </div>
              </div>

              {/* T2 anatomy */}
              <div
                className="flex flex-col gap-1 px-3 py-2"
                style={{ borderRight: '1px solid var(--rule-hair)' }}
              >
                <div className="font-mono text-[9px] uppercase tracking-[0.12em] text-[var(--ink-navy-muted)]">
                  T2 · ANATOMY (18-22w)
                </div>
                {journey.anatomyScanDate ? (
                  <>
                    <div
                      className="font-semibold text-[12px]"
                      style={{
                        color:
                          journey.anatomyScanResult === 'ABNORMAL'
                            ? 'var(--risk-high)'
                            : 'var(--ink-navy)',
                      }}
                    >
                      {journey.anatomyScanResult ?? 'PENDING'}
                    </div>
                    <div className="font-mono text-[10px] text-[var(--ink-navy-muted)]">
                      {formatThaiShort(journey.anatomyScanDate)}
                      {journey.efwG != null && ` · EFW ${journey.efwG} g`}
                    </div>
                  </>
                ) : (
                  <div
                    className="text-[12px]"
                    style={{
                      color:
                        (journey.gaWeeks ?? 0) > 22 ? 'var(--risk-high)' : 'var(--ink-navy-muted)',
                    }}
                  >
                    {(journey.gaWeeks ?? 0) > 22 ? 'OVERDUE — ยังไม่มีผล' : 'ยังไม่ถึงกำหนด'}
                  </div>
                )}
              </div>

              {/* T3 wellbeing */}
              <div className="flex flex-col gap-1 px-3 py-2">
                <div className="font-mono text-[9px] uppercase tracking-[0.12em] text-[var(--ink-navy-muted)]">
                  T3 · WELLBEING (≥28w)
                </div>
                {(() => {
                  const latestT3 = [...(derived?.visitsChrono ?? [])]
                    .reverse()
                    .find(
                      (v) =>
                        v.nstResult != null ||
                        v.bppScore != null ||
                        v.umbilicalDopplerResult != null,
                    );
                  if (!latestT3) {
                    return (
                      <div className="text-[12px] text-[var(--ink-navy-muted)]">
                        {(journey.gaWeeks ?? 0) < 28
                          ? 'ยังไม่ถึง 28 สัปดาห์'
                          : '— ยังไม่มีข้อมูล —'}
                      </div>
                    );
                  }
                  return (
                    <div className="flex flex-wrap gap-2 text-[12px]">
                      {latestT3.nstResult && (
                        <span
                          className="font-mono"
                          style={{
                            color:
                              latestT3.nstResult === 'NON_REACTIVE'
                                ? 'var(--risk-high)'
                                : 'var(--ink-navy)',
                          }}
                        >
                          NST: <b>{latestT3.nstResult}</b>
                        </span>
                      )}
                      {latestT3.bppScore != null && (
                        <span
                          className="font-mono"
                          style={{
                            color: latestT3.bppScore < 8 ? 'var(--risk-high)' : 'var(--ink-navy)',
                          }}
                        >
                          BPP: <b>{latestT3.bppScore}/10</b>
                        </span>
                      )}
                      {latestT3.umbilicalDopplerResult && (
                        <span
                          className="font-mono"
                          style={{
                            color:
                              latestT3.umbilicalDopplerResult === 'ABNORMAL'
                                ? 'var(--risk-high)'
                                : 'var(--ink-navy)',
                          }}
                        >
                          DOPPLER: <b>{latestT3.umbilicalDopplerResult}</b>
                        </span>
                      )}
                    </div>
                  );
                })()}
              </div>
            </div>
          </section>

          {/* 04 — Newborn outcomes (only if present) */}
          {newborns.length > 0 && (
            <section>
              <SectionLabel
                idx={4}
                right={
                  <span>
                    {newborns.length} INFANT{newborns.length === 1 ? '' : 'S'}
                  </span>
                }
              >
                Newborn outcomes
              </SectionLabel>
              <div className="mt-2 grid gap-3 sm:grid-cols-2">
                {newborns.map((nb) => {
                  const lbw =
                    nb.birthWeightG != null && nb.birthWeightG < NEWBORN_THRESHOLDS.lbwGrams;
                  // Same <7 cutoff applies at 1 and 5 minutes.
                  const lowApgar1 =
                    nb.apgar1min != null && nb.apgar1min < NEWBORN_THRESHOLDS.apgarLowAt5min;
                  const lowApgar5 =
                    nb.apgar5min != null && nb.apgar5min < NEWBORN_THRESHOLDS.apgarLowAt5min;
                  return (
                    <div
                      key={nb.infantNumber}
                      className="border bg-white p-4"
                      style={{ borderColor: 'var(--rule-strong)' }}
                    >
                      <div className="flex items-baseline justify-between">
                        <div
                          className="font-semibold text-[15px]"
                          style={{ color: 'var(--ink-navy)' }}
                        >
                          <Baby className="mr-1 inline h-4 w-4 text-[var(--accent-navy)]" />
                          ทารกคนที่ {nb.infantNumber}
                          {nb.sex && (
                            <span className="ml-2 font-mono text-[11px] font-normal text-[var(--ink-navy-muted)]">
                              {SEX_LABEL_TH[nb.sex] ?? nb.sex}
                            </span>
                          )}
                        </div>
                        <span className="font-mono text-[10px] tracking-[0.1em] text-[var(--ink-navy-muted)]">
                          {formatThaiDateTime(nb.bornAt)}
                        </span>
                      </div>
                      <div className="mt-3 grid grid-cols-3 gap-2">
                        <MetricTile
                          label="BW"
                          value={nb.birthWeightG != null ? `${nb.birthWeightG}g` : '—'}
                          sub={lbw ? 'LBW!' : 'แรกเกิด'}
                          color={lbw ? 'var(--risk-high)' : 'var(--risk-low)'}
                          icon={<Ruler className="h-3 w-3" />}
                        />
                        <MetricTile
                          label="APGAR 1"
                          value={nb.apgar1min ?? '—'}
                          sub={lowApgar1 ? 'LOW!' : '1 นาที'}
                          color={lowApgar1 ? 'var(--risk-high)' : 'var(--risk-low)'}
                        />
                        <MetricTile
                          label="APGAR 5"
                          value={nb.apgar5min ?? '—'}
                          sub={lowApgar5 ? 'LOW!' : '5 นาที'}
                          color={lowApgar5 ? 'var(--risk-high)' : 'var(--risk-low)'}
                        />
                      </div>
                      {(lbw || lowApgar1 || lowApgar5) && (
                        <div
                          className="mt-3 flex flex-wrap items-center gap-1.5 border-t pt-2"
                          style={{ borderColor: 'var(--rule-hair)' }}
                        >
                          <AlertTriangle className="h-3 w-3 text-[var(--risk-high)]" />
                          <span className="font-mono text-[10px] tracking-[0.1em] text-[var(--risk-high)]">
                            ADVERSE OUTCOME — flagged for follow-up
                          </span>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          )}
        </div>

        {/* ─── RIGHT: sticky clinical summary rail ─── */}
        <aside className="hidden lg:block bg-white" style={{ alignSelf: 'stretch' }}>
          <div
            className="flex flex-col space-y-0"
            style={{
              position: 'sticky',
              top: 0,
              maxHeight: 'calc((100vh - 60px) / 1.15)',
              overflowY: 'auto',
            }}
          >
            {/* Risk assessment — always shown; extra emphasis when HR2+ */}
            <div
              className="px-4 py-3"
              style={{
                borderBottom: '1px solid var(--rule-strong)',
                borderLeft: `3px solid ${highRisk ? 'var(--risk-high)' : 'var(--accent-navy)'}`,
                background: highRisk ? 'rgba(239, 68, 68, 0.06)' : 'var(--accent-navy-soft)',
              }}
            >
              <div className="flex items-baseline gap-2">
                <span
                  className="inline-flex h-5 min-w-[22px] items-center justify-center rounded-sm px-1.5 font-mono text-[10px] font-bold tracking-[0.08em] text-white"
                  style={{ background: highRisk ? 'var(--risk-high)' : 'var(--accent-navy)' }}
                >
                  01
                </span>
                <span
                  className="font-mono text-[12px] font-semibold uppercase tracking-[0.1em]"
                  style={{ color: highRisk ? 'var(--risk-high)' : 'var(--accent-navy-strong)' }}
                >
                  Risk assessment
                </span>
              </div>
              {latestRisk ? (
                <>
                  <div className="mt-2 flex items-center gap-2">
                    <Pill
                      label={latestRisk.riskLevel}
                      color={ANC_RISK_COLOR[latestRisk.riskLevel] ?? 'var(--ink-navy-muted)'}
                    />
                    <span className="text-[12px] text-[var(--ink-navy-dim)]">
                      {ANC_RISK_LABEL_TH[latestRisk.riskLevel] ?? latestRisk.riskLevel}
                    </span>
                  </div>
                  {ancAssessment?.incomplete && (
                    <div className="mt-1.5">
                      <IncompleteAssessmentMarker
                        missingCount={ancAssessment.missingRequired.length}
                      />
                    </div>
                  )}
                  <div className="mt-1 font-mono text-[10px] tracking-[0.1em] text-[var(--ink-navy-muted)]">
                    SCREENED {formatThai(latestRisk.screenedAt)}
                  </div>
                  {latestRisk.recommendedFacility && (
                    <div
                      className="mt-2 rounded-sm border p-2 text-[12px]"
                      style={{
                        borderColor: 'var(--rule-strong)',
                        background: 'var(--surface-sunken)',
                      }}
                    >
                      <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-[var(--ink-navy-muted)]">
                        แนะนำส่งต่อ ·{' '}
                      </span>
                      <span className="font-semibold text-[var(--ink-navy)]">
                        {latestRisk.recommendedFacility}
                      </span>
                    </div>
                  )}
                  {latestRisk.triggeredRules.length > 0 ? (
                    <div className="mt-3">
                      <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--ink-navy-muted)]">
                        ปัจจัยเสี่ยง · {latestRisk.triggeredRules.length} ข้อ
                      </div>
                      <ul className="mt-1.5 space-y-1">
                        {latestRisk.triggeredRules.map((rule) => (
                          <li
                            key={rule}
                            className="flex items-start gap-1.5 text-[12px] leading-snug"
                            style={{ color: 'var(--ink-navy-dim)' }}
                          >
                            <AlertTriangle
                              className="mt-0.5 h-3 w-3 shrink-0"
                              style={{ color: 'var(--risk-medium)' }}
                            />
                            <span className="text-[11px]">{RULE_LABEL_TH[rule] ?? rule}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : (
                    <div className="mt-2 font-mono text-[11px] text-[var(--ink-navy-muted)]">
                      ไม่มีปัจจัยเสี่ยง
                    </div>
                  )}
                </>
              ) : (
                <div className="mt-2 font-mono text-[11px] text-[var(--ink-navy-muted)]">
                  ยังไม่มีการประเมินความเสี่ยง
                </div>
              )}
            </div>

            {/* Next action */}
            <div
              className="px-4 py-3"
              style={{
                borderBottom: '1px solid var(--rule-strong)',
                borderLeft: `3px solid ${
                  nextSchedule?.status === 'NEXT' && nextSchedule.dueStatus === 'overdue'
                    ? 'var(--risk-high)'
                    : (nextSchedule?.status === 'NEXT' && nextSchedule.dueStatus === 'due-now') ||
                        nextSchedule?.status === 'UNKNOWN_GA'
                      ? 'var(--risk-medium)'
                      : 'var(--primary-teal)'
                }`,
                background:
                  nextSchedule?.status === 'NEXT' && nextSchedule.dueStatus === 'overdue'
                    ? 'rgba(239, 68, 68, 0.05)'
                    : (nextSchedule?.status === 'NEXT' && nextSchedule.dueStatus === 'due-now') ||
                        nextSchedule?.status === 'UNKNOWN_GA'
                      ? 'rgba(234, 179, 8, 0.05)'
                      : 'rgba(13, 148, 136, 0.05)',
              }}
            >
              <div className="flex items-baseline gap-2">
                <span
                  className="inline-flex h-5 min-w-[22px] items-center justify-center rounded-sm px-1.5 font-mono text-[10px] font-bold tracking-[0.08em] text-white"
                  style={{
                    background:
                      nextSchedule?.status === 'NEXT' && nextSchedule.dueStatus === 'overdue'
                        ? 'var(--risk-high)'
                        : (nextSchedule?.status === 'NEXT' &&
                              nextSchedule.dueStatus === 'due-now') ||
                            nextSchedule?.status === 'UNKNOWN_GA'
                          ? 'var(--risk-medium)'
                          : 'var(--primary-teal)',
                  }}
                >
                  02
                </span>
                <span
                  className="font-mono text-[12px] font-semibold uppercase tracking-[0.1em]"
                  style={{ color: 'var(--ink-navy)' }}
                >
                  Next action
                </span>
              </div>
              {nextSchedule?.status === 'NEXT' ? (
                <div className="mt-2">
                  <div className="flex items-baseline gap-2">
                    <span
                      className="font-mono text-[22px] font-semibold tabular-nums leading-none"
                      style={{
                        color:
                          nextSchedule.dueStatus === 'overdue'
                            ? 'var(--risk-high)'
                            : nextSchedule.dueStatus === 'due-now'
                              ? 'var(--risk-medium)'
                              : 'var(--accent-navy)',
                      }}
                    >
                      {nextSchedule.ga}w
                    </span>
                    <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--ink-navy-muted)]">
                      WHO CONTACT
                    </span>
                  </div>
                  <div
                    className="mt-1 text-[12px]"
                    style={{
                      color:
                        nextSchedule.dueStatus === 'overdue'
                          ? 'var(--risk-high)'
                          : 'var(--ink-navy-dim)',
                    }}
                  >
                    {nextSchedule.dueStatus === 'overdue'
                      ? `เลยกำหนด ${Math.abs(nextSchedule.weeksAway)} สัปดาห์ — ควรติดตามด่วน`
                      : nextSchedule.dueStatus === 'due-now'
                        ? 'ถึงกำหนดนัดครั้งถัดไป'
                        : `อีก ${nextSchedule.weeksAway} สัปดาห์`}
                  </div>
                  {derived?.daysSinceLastAnc != null && derived.daysSinceLastAnc > 28 && (
                    <div className="mt-2 flex items-center gap-1 font-mono text-[11px] text-[var(--risk-high)]">
                      <AlertTriangle className="h-3 w-3" />
                      NO ANC FOR {derived.daysSinceLastAnc}d
                    </div>
                  )}
                </div>
              ) : nextSchedule?.status === 'UNKNOWN_GA' ? (
                <div
                  className="mt-2 flex items-start gap-1.5 text-[12px]"
                  style={{ color: 'var(--risk-medium)' }}
                >
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  ไม่ทราบอายุครรภ์ — ประเมินตารางนัดไม่ได้
                </div>
              ) : (
                <div className="mt-2 text-[12px] text-[var(--risk-low)]">
                  ครบทั้ง 8 contact แล้ว
                </div>
              )}
              {/* RTCOG overdue-investigation list. GA unknown → the service
                  can't determine due-ness at all (overdueInvestigations
                  coerces to GA 0 and returns []), so show one amber caveat
                  instead of silently rendering an empty section. */}
              {journey.gaWeeks == null ? (
                <div className="mt-3 border-t pt-2" style={{ borderColor: 'var(--rule-hair)' }}>
                  <div className="font-mono text-[9px] uppercase tracking-[0.12em] text-[var(--ink-navy-muted)]">
                    RTCOG · การตรวจที่เลยกำหนด
                  </div>
                  <div
                    className="mt-1.5 flex items-start gap-1.5 text-[11px]"
                    style={{ color: 'var(--risk-medium)' }}
                  >
                    <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                    ไม่ทราบอายุครรภ์ — ตรวจสอบรายการค้างไม่ได้
                  </div>
                </div>
              ) : (
                (derived?.overdue.length ?? 0) > 0 && (
                  <div className="mt-3 border-t pt-2" style={{ borderColor: 'var(--rule-hair)' }}>
                    <div className="font-mono text-[9px] uppercase tracking-[0.12em] text-[var(--ink-navy-muted)]">
                      RTCOG · การตรวจที่เลยกำหนด
                    </div>
                    <ul className="mt-1.5 space-y-1">
                      {derived!.overdue.map((o) => (
                        <li
                          key={o.key}
                          className="flex items-start gap-1.5 text-[11px]"
                          style={{
                            color:
                              o.severity === 'high' ? 'var(--risk-high)' : 'var(--risk-medium)',
                          }}
                        >
                          <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                          <span>
                            {o.labelTh}
                            <span className="ml-1 font-mono text-[9px] opacity-70">
                              DUE ≤ {o.dueBy}
                            </span>
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )
              )}
            </div>

            {/* Hospital */}
            <div
              className="px-4 py-3"
              style={{
                borderBottom: '1px solid var(--rule-strong)',
                borderLeft: `3px solid ${isReferred ? 'var(--risk-medium)' : 'var(--accent-navy)'}`,
                background: isReferred ? 'rgba(234, 179, 8, 0.04)' : 'white',
              }}
            >
              <div className="flex items-baseline gap-2">
                <span
                  className="inline-flex h-5 min-w-[22px] items-center justify-center rounded-sm px-1.5 font-mono text-[10px] font-bold tracking-[0.08em] text-white"
                  style={{
                    background: isReferred ? 'var(--risk-medium)' : 'var(--accent-navy)',
                  }}
                >
                  03
                </span>
                <span
                  className="font-mono text-[12px] font-semibold uppercase tracking-[0.1em]"
                  style={{ color: 'var(--ink-navy)' }}
                >
                  Hospital
                </span>
              </div>
              <div className="mt-2 space-y-1.5 text-[12px]">
                <div className="flex items-center gap-1.5">
                  <Hospital className="h-3.5 w-3.5 text-[var(--ink-navy-muted)]" />
                  <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-[var(--ink-navy-muted)]">
                    REGISTERED AT
                  </span>
                </div>
                <Link
                  href={`/hospitals/${journey.hcode}`}
                  className="block font-semibold text-[var(--ink-navy)] hover:text-[var(--accent-navy)] hover:underline"
                >
                  {journey.hospitalName}
                </Link>
                <div className="font-mono text-[10px] text-[var(--ink-navy-muted)]">
                  HCODE {journey.hcode} · REG {formatThai(journey.registeredAt)}
                  {derived?.daysSinceRegistered != null && ` · ${derived.daysSinceRegistered}d ago`}
                </div>
                {isReferred && journey.currentHospitalName && (
                  <>
                    <div className="mt-2 flex items-center gap-1.5">
                      <ArrowRightLeft className="h-3.5 w-3.5 text-[var(--risk-medium)]" />
                      <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-[var(--risk-medium)]">
                        CURRENT
                      </span>
                    </div>
                    <Link
                      href={`/hospitals/${journey.currentHcode}`}
                      className="block font-semibold text-[var(--risk-medium)] hover:underline"
                    >
                      {journey.currentHospitalName}
                    </Link>
                    <div className="font-mono text-[10px] text-[var(--ink-navy-muted)]">
                      HCODE {journey.currentHcode}
                    </div>
                  </>
                )}
              </div>
            </div>

            {/* Referrals */}
            <div
              className="px-4 py-3"
              style={{
                borderBottom: '1px solid var(--rule-strong)',
                borderLeft: `3px solid ${referrals.length > 0 ? 'var(--accent-navy)' : 'var(--rule-strong)'}`,
              }}
            >
              <div className="flex items-baseline justify-between">
                <div className="flex items-baseline gap-2">
                  <span
                    className="inline-flex h-5 min-w-[22px] items-center justify-center rounded-sm px-1.5 font-mono text-[10px] font-bold tracking-[0.08em] text-white"
                    style={{
                      background:
                        referrals.length > 0 ? 'var(--accent-navy)' : 'var(--ink-navy-muted)',
                    }}
                  >
                    04
                  </span>
                  <span
                    className="font-mono text-[12px] font-semibold uppercase tracking-[0.1em]"
                    style={{ color: 'var(--ink-navy)' }}
                  >
                    Referral history
                  </span>
                </div>
                <span
                  className="inline-flex h-5 min-w-[20px] items-center justify-center rounded-full px-1.5 font-mono text-[10px] font-bold tabular-nums"
                  style={{
                    background:
                      referrals.length > 0 ? 'var(--accent-navy-soft)' : 'var(--surface-sunken)',
                    color: 'var(--ink-navy)',
                  }}
                >
                  {referrals.length}
                </span>
              </div>
              {referrals.length === 0 ? (
                <div className="mt-2 font-mono text-[11px] text-[var(--ink-navy-muted)]">
                  ยังไม่มีประวัติการส่งต่อ
                </div>
              ) : (
                <div className="mt-2 flex flex-col gap-2">
                  {referrals.map((ref) => {
                    const statusLabel = STATUS_META[ref.status]?.label ?? ref.status;
                    const isArrived = ref.status === 'ARRIVED' || !!ref.arrivedAt;
                    const isUrgent =
                      ref.urgencyLevel === 'URGENT' || ref.urgencyLevel === 'EMERGENCY';
                    return (
                      <div
                        key={ref.id}
                        className="border px-2.5 py-2"
                        style={{ borderColor: 'var(--rule-hair)' }}
                      >
                        <div className="flex flex-wrap items-center gap-1.5">
                          <Pill
                            label={statusLabel}
                            color={
                              isArrived
                                ? 'var(--risk-low)'
                                : isUrgent
                                  ? 'var(--risk-high)'
                                  : 'var(--accent-navy)'
                            }
                          />
                          {ref.urgencyLevel && (
                            <Pill
                              label={URGENCY_META[ref.urgencyLevel]?.label ?? ref.urgencyLevel}
                              color={isUrgent ? 'var(--risk-high)' : 'var(--ink-navy-muted)'}
                            />
                          )}
                        </div>
                        <div className="mt-1.5 flex flex-wrap items-center gap-1 text-[12px]">
                          <span className="text-[var(--ink-navy-dim)]">{ref.fromHospital}</span>
                          <ArrowRightLeft className="h-3 w-3 text-[var(--ink-navy-muted)]" />
                          <span className="font-semibold text-[var(--ink-navy)]">
                            {ref.toHospital}
                          </span>
                        </div>
                        {ref.reason && (
                          <div className="mt-1 text-[11px] leading-snug text-[var(--ink-navy-dim)]">
                            {ref.reason}
                          </div>
                        )}
                        <div className="mt-1 font-mono text-[10px] tracking-[0.08em] text-[var(--ink-navy-muted)]">
                          {formatRelativeTime(ref.initiatedAt)}
                          {ref.arrivedAt && (
                            <>
                              {' · '}
                              <span className="text-[var(--risk-low)]">
                                <CheckCircle2 className="inline h-2.5 w-2.5" /> ARRIVED
                              </span>
                            </>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Tiny id footer */}
            <div className="px-4 py-2 font-mono text-[10px] tracking-[0.08em] text-[var(--ink-navy-muted)]">
              JOURNEY ID{' '}
              <span className="font-semibold text-[var(--ink-navy)]">{journey.id.slice(0, 8)}</span>
            </div>
          </div>
        </aside>

        {/* Mobile fallback — same panels, no sticky */}
        <div className="bg-white p-5 space-y-4 lg:hidden border-t border-[var(--rule-strong)]">
          {latestRisk && (
            <section>
              <div className="flex items-baseline gap-2 mb-1">
                <span className="font-mono text-[10px] font-bold tracking-[0.18em] text-[var(--accent-navy)]">
                  01
                </span>
                <span className="font-mono text-[12px] font-semibold uppercase tracking-[0.1em]">
                  Risk · {latestRisk.riskLevel}
                </span>
              </div>
              {latestRisk.triggeredRules.length > 0 && (
                <ul className="text-[12px] space-y-1">
                  {latestRisk.triggeredRules.map((r) => (
                    <li key={r} className="text-[11px] text-[var(--ink-navy-dim)]">
                      · {RULE_LABEL_TH[r] ?? r}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}
          <section>
            <div className="flex items-baseline gap-2 mb-1">
              <MapPin className="h-3 w-3 text-[var(--ink-navy-muted)]" />
              <span className="font-mono text-[12px] font-semibold uppercase tracking-[0.1em]">
                {journey.hospitalName}
              </span>
            </div>
            {isReferred && journey.currentHospitalName && (
              <div className="font-mono text-[11px] text-[var(--risk-medium)]">
                → {journey.currentHospitalName}
              </div>
            )}
          </section>
        </div>
      </div>

      {/* ─── Footer ─── */}
      <div
        className="flex justify-between bg-white px-5 py-2 font-mono text-[10px] tracking-[0.1em] text-[var(--ink-navy-muted)]"
        style={{ borderTop: '1px solid var(--rule-strong)' }}
      >
        <span>
          JOURNEY ID{' '}
          <span className="font-semibold text-[var(--ink-navy)]">{journey.id.slice(0, 8)}</span>
        </span>
        <span>REFRESHING EVERY {REFRESH_INTERVAL_MS / 1000}s</span>
      </div>
    </div>
  );
}
