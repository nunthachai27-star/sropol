'use client';

import { use, useMemo, useRef, useState } from 'react';
import { debounceLeadingTrailing, SSE_REFRESH_DEBOUNCE_MS } from '@/lib/debounce';
import { useRouter } from 'next/navigation';
import { usePatient } from '@/hooks/usePatient';
import { usePartogram } from '@/hooks/usePartogram';
import { useMaternalScreenings } from '@/hooks/useMaternalScreenings';
import { useSSE } from '@/hooks/useSSE';
import { useSetBreadcrumbs } from '@/components/layout/BreadcrumbContext';
import { PatientHeader } from '@/components/patient/PatientHeader';
import { ReferralBanner } from '@/components/patient/ReferralBanner';
import { StickyPatientHeader } from '@/components/patient/StickyPatientHeader';
import { QuickStatsBar } from '@/components/patient/QuickStatsBar';
import { CurrentVitalsPanel } from '@/components/patient/CurrentVitalsPanel';
import { LaborProgressCard } from '@/components/patient/LaborProgressCard';
import { MaternalScreeningCard } from '@/components/patient/MaternalScreeningCard';
import { CpdFactorBreakdown } from '@/components/patient/CpdFactorBreakdown';
import { ClinicalData } from '@/components/patient/ClinicalData';
import { ContractionTable } from '@/components/patient/ContractionTable';
import { PrintForm } from '@/components/patient/PrintForm';
import { HighRiskAlert } from '@/components/shared/HighRiskAlert';
import { LoadingState } from '@/components/shared/LoadingState';
import { ErrorState } from '@/components/shared/ErrorState';
import { maskName } from '@/lib/pii-mask';
import { VitalTrendCharts } from '@/components/charts/VitalTrendCharts';
import { PartographForm } from '@/components/maternity/partograph/PartographForm';
import { AlertSummaryPanel } from '@/components/patient/AlertSummaryPanel';
import { countBySeverity } from '@/services/partogram';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTrigger } from '@/components/ui/dialog';
import {
  ArrowLeft,
  Printer,
  Baby,
  Activity,
  AlertTriangle,
  HeartPulse,
  LineChart,
  Send,
  Waves,
} from 'lucide-react';
import Link from 'next/link';
import { RiskLevel } from '@/types/domain';
import { RISK_LEVELS, isHighRisk } from '@/config/risk-levels';
import { SectionLabel } from '@/components/dashboard/shared';
import { KpiTip } from '@/components/shared/KpiTip';
import { FlagChip } from '@/components/shared/FlagChip';
import { Pill, STATUS_META, URGENCY_META } from '@/components/referrals/chips';
import { formatRelativeAge } from '@/lib/relative-time';
import { classifySyncHealth } from '@/config/hospital-network';
import { NEWBORN_THRESHOLDS } from '@/config/newborn';
import { sevBp, sevFhr } from '@/services/anc-clinical';

type WorkspaceTab = 'summary' | 'partograph' | 'contractions';

// Dot color per sync-health class — classes come from the shared
// hospital-network config so this page and /hospitals agree on "stale".
const SYNC_DOT: Record<string, string> = {
  ok: 'var(--risk-low)',
  stale: 'var(--risk-medium)',
  critical: 'var(--risk-high)',
  never: 'var(--risk-high)',
  blocked: 'var(--risk-high)',
};

const SEX_TH: Record<string, string> = { M: 'ชาย', F: 'หญิง' };

function fmtDateTimeTh(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('th-TH', {
    timeZone: 'Asia/Bangkok',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// Clinical tinting for the observations table — severity bands (and their
// null-handling) live once in the ANC clinical service, never restated
// here. 'borderline'/'unknown' render with the default ink (undefined) —
// only a proven-abnormal reading gets the alarm tint.
function fhrTint(v: number | null): string | undefined {
  return sevFhr(v) === 'abnormal' ? 'var(--risk-high)' : undefined;
}

function bpTint(sys: number | null, dia: number | null): string | undefined {
  return sevBp(sys, dia) === 'abnormal' ? 'var(--risk-high)' : undefined;
}

export default function PatientDetailPage({ params }: { params: Promise<{ an: string }> }) {
  const { an: patientId } = use(params);
  const router = useRouter();
  const mainHeaderRef = useRef<HTMLDivElement>(null);

  // Frozen render-time anchor — react-hooks/purity forbids bare Date.now()
  // in render code. SWR's 30s refresh re-derives "X days since last ANC"
  // from new data anyway, so a per-mount snapshot is fine.
  const [now] = useState<number>(() => Date.now());

  const {
    patient,
    cpdScore,
    journeyContext,
    vitals,
    contractions,
    isLoading,
    error,
    vitalsError,
    contractionsError,
    mutate,
    mutateVitals,
    mutateContractions,
  } = usePatient(patientId);
  const { partogram, error: partogramError, mutate: mutatePartogram } = usePartogram(patientId);
  // SEPARATE hook, not folded into usePatient's composite isLoading (GC-U4 /
  // plan Task U3) — this provisional, flag-gated feed must never block first
  // paint of the rest of the page.
  const screenings = useMaternalScreenings(patientId);
  const [activeTab, setActiveTab] = useState<WorkspaceTab>('summary');

  useSetBreadcrumbs([{ label: 'แดชบอร์ด', href: '/' }, { label: `AN ${patientId}` }]);

  // Debounced SSE reaction (2026-07-17 incident: refetch-per-event across
  // continuous sync cycles). Stable across renders via the SWR mutates.
  const screeningsMutate = screenings.mutate;
  const debouncedSseRefresh = useMemo(
    () =>
      debounceLeadingTrailing(() => {
        mutate();
        screeningsMutate();
      }, SSE_REFRESH_DEBOUNCE_MS),
    [mutate, screeningsMutate],
  );
  useSSE({
    onPatientUpdate: debouncedSseRefresh,
    onSyncComplete: debouncedSseRefresh,
  });

  if (isLoading) {
    return <LoadingState message="กำลังโหลดข้อมูลผู้คลอด..." />;
  }

  if (error || !patient) {
    // Surface the underlying API reason. The /api/patients/[an] route returns
    // structured 400 (Invalid patient ID format) / 404 (Patient not found) /
    // 500 (Internal server error). Without showing the actual message the
    // page just rendered "ไม่พบข้อมูลผู้คลอด" for every failure mode — most
    // commonly a malformed URL like /patients/<bare-an> instead of the
    // composite /patients/<hcode>-<an> that the route requires.
    const status =
      error && typeof error === 'object' && 'status' in error
        ? (error as { status: number }).status
        : null;
    const apiMessage = error instanceof Error ? error.message : 'ไม่พบข้อมูลผู้คลอด';
    const heading =
      status === 400
        ? 'รูปแบบรหัสผู้คลอดไม่ถูกต้อง'
        : status === 404
          ? 'ไม่พบข้อมูลผู้คลอด'
          : 'เกิดข้อผิดพลาด';
    return (
      <div
        className="flex h-64 items-center justify-center"
        style={{ color: 'var(--ink-navy-muted)' }}
      >
        <div className="max-w-md text-center">
          <p className="font-mono text-[13px] font-semibold text-[var(--ink-navy)]">{heading}</p>
          {error && <p className="mt-2 font-mono text-[11px] text-red-600">{apiMessage}</p>}
          {status === 400 && (
            <p className="mt-2 font-mono text-[11px] text-[var(--ink-navy-dim)]">
              URL ต้องอยู่ในรูปแบบ{' '}
              <code className="rounded bg-[var(--rule-hair)] px-1">
                /patients/&lt;hcode&gt;-&lt;an&gt;
              </code>
              <br />
              เช่น{' '}
              <code className="rounded bg-[var(--rule-hair)] px-1">/patients/10670-69000123</code>
            </p>
          )}
          <button
            onClick={() => router.back()}
            className="mt-3 font-mono text-[11px] underline"
            style={{ color: 'var(--accent-navy)' }}
          >
            BACK
          </button>
        </div>
      </div>
    );
  }

  // Derive current cervix dilation from partogram
  const currentDilationCm = partogram?.entries?.length
    ? [...partogram.entries].sort(
        (a, b) => new Date(b.measuredAt).getTime() - new Date(a.measuredAt).getTime(),
      )[0].dilationCm
    : null;

  // Latest vital timestamp for quick stats
  const latestVitalAt = vitals.length > 0 ? vitals[vitals.length - 1].measuredAt : null;

  // Per-patient data freshness — same classifier the hospitals board uses
  // (stale > 60 min amber, > 24 h red), applied to this row's synced_at.
  const syncHealth = classifySyncHealth('OK', patient.syncedAt, new Date(now));

  // Secondary feeds (vitals / contractions / partograph) load independently of
  // the main patient detail. When one fails we keep the detail on screen and
  // surface a non-blocking banner naming the failed feed(s); onRetry revalidates
  // only those feeds. The partograph tab additionally distinguishes its own
  // error state (below) from the "no data yet" empty state.
  // Maternal-screening fetch failures only join the shared banner when the
  // feature is actually visible (uiEnabled) — flag-on failures surface via
  // the banner; flag-off failures stay silent in the UI by design (GC-U3 —
  // the route logs server-side; the enabling operator verifies the section
  // during rollout per spec §17.2 step 4).
  const screeningsFailed = Boolean(screenings.error) && screenings.uiEnabled;

  const failedFeeds: Array<{ label: string; retry: () => void }> = [
    { failed: Boolean(vitalsError), label: 'สัญญาณชีพ', retry: mutateVitals },
    { failed: Boolean(contractionsError), label: 'การหดรัดตัว', retry: mutateContractions },
    { failed: Boolean(partogramError), label: 'Partograph', retry: mutatePartogram },
    { failed: screeningsFailed, label: 'การคัดกรองความเสี่ยงมารดา', retry: screenings.mutate },
  ]
    .filter((f) => f.failed)
    .map(({ label, retry }) => ({ label, retry: () => void retry() }));

  return (
    <div
      style={{
        color: 'var(--ink-navy)',
        background: 'var(--surface-cool)',
        zoom: 1.15,
      }}
    >
      {/* High Risk Alert Modal — threshold derived from risk-levels config,
          not a bare literal, so the HIGH boundary lives in one place. */}
      {cpdScore && isHighRisk(cpdScore.score) && (
        <HighRiskAlert score={cpdScore.score} an={patient.an} />
      )}

      {/* Sticky header on scroll */}
      <StickyPatientHeader
        name={patient.name}
        hn={patient.hn}
        an={patient.an}
        laborStatus={patient.laborStatus}
        hospitalName={patient.hospital.name}
        cpdScore={
          cpdScore ? { score: cpdScore.score, riskLevel: cpdScore.riskLevel as RiskLevel } : null
        }
        mainHeaderRef={mainHeaderRef}
      />

      {/* Back strip — flush white under the navbar */}
      <div
        className="flex items-center justify-between gap-3 bg-white px-6 py-2 print:hidden"
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
          body={`เวลาที่ระบบดึงข้อมูลผู้คลอดรายนี้จาก HOSxP ${patient.hospital.name} ครั้งล่าสุด (รอบซิงก์ ~30 วินาที/รพ.) — เกิน 60 นาทีจุดเป็นสีเหลือง เกิน 24 ชั่วโมงเป็นสีแดง`}
          trigger={
            <div
              data-testid="sync-stamp"
              className="flex cursor-default items-center gap-1.5 font-mono text-[11px] text-[var(--ink-navy-muted)]"
            />
          }
        >
          <span
            className="inline-block h-2 w-2 rounded-full"
            style={{ background: SYNC_DOT[syncHealth] }}
          />
          ข้อมูลจาก HOSxP · อัปเดต {formatRelativeAge(patient.syncedAt)}ที่แล้ว
        </KpiTip>
      </div>

      {/* Section 1: Patient Header — full-bleed navy gradient identity band.
          PatientHeader renders its own inner gradient canvas + padding, so the
          wrapper here is zero-padding / zero-background. */}
      <div ref={mainHeaderRef} style={{ borderBottom: '1px solid var(--rule-strong)' }}>
        <PatientHeader
          hn={patient.hn}
          an={patient.an}
          name={patient.name}
          age={patient.age}
          admitDate={patient.admitDate}
          laborStatus={patient.laborStatus}
          weightKg={patient.weightKg}
          weightDiffKg={patient.weightDiffKg}
          hospital={patient.hospital}
          cpdScore={
            cpdScore ? { score: cpdScore.score, riskLevel: cpdScore.riskLevel as RiskLevel } : null
          }
        />
      </div>

      {/* Section 2: Referral Recommendation Banner */}
      {cpdScore && cpdScore.riskLevel !== RiskLevel.LOW && (
        <div className="bg-white" style={{ borderBottom: '1px solid var(--rule-strong)' }}>
          <ReferralBanner
            score={cpdScore.score}
            riskLevel={cpdScore.riskLevel as RiskLevel}
            recommendation={
              cpdScore.recommendation ?? RISK_LEVELS[cpdScore.riskLevel as RiskLevel].action
            }
          />
        </div>
      )}

      {/* Section 3: Quick Stats Bar — flush white strip */}
      <div className="bg-white" style={{ borderBottom: '1px solid var(--rule-strong)' }}>
        <QuickStatsBar
          age={patient.age}
          gravida={patient.gravida}
          para={patient.para}
          abortion={patient.abortion}
          livingChildren={patient.livingChildren}
          gaWeeks={patient.gaWeeks}
          gaDay={patient.gaDay}
          ancCount={patient.ancCount}
          admitDate={patient.admitDate}
          laborStatus={patient.laborStatus}
          currentDilationCm={currentDilationCm}
          latestVitalAt={latestVitalAt}
        />
      </div>

      {/* Section 3.5: ANC summary — shown only when this labor admission is
         linked to a maternal journey (woman had prior ANC registration,
         possibly at a different hospital). Compact 4-tile rail with a risk
         ribbon on the left; full ANC visit timeline + labs on /pregnancies. */}
      {journeyContext &&
        (() => {
          const riskKey = journeyContext.ancRiskLevel;
          const riskMeta =
            riskKey === 'HR3'
              ? {
                  color: 'var(--risk-high)',
                  bg: 'color-mix(in srgb, #ef4444 10%, white)',
                  label: 'ความเสี่ยงสูง ระดับ 3',
                }
              : riskKey === 'HR2'
                ? {
                    color: 'var(--risk-medium)',
                    bg: 'color-mix(in srgb, #eab308 10%, white)',
                    label: 'ความเสี่ยง ระดับ 2',
                  }
                : riskKey === 'HR1'
                  ? {
                      color: 'var(--risk-medium)',
                      bg: 'color-mix(in srgb, #eab308 8%, white)',
                      label: 'ความเสี่ยง ระดับ 1',
                    }
                  : {
                      color: 'var(--risk-low)',
                      bg: 'color-mix(in srgb, #22c55e 6%, white)',
                      label: 'ความเสี่ยงต่ำ',
                    };
          const fmt = (iso: string | null): string => {
            if (!iso) return '—';
            return new Date(iso).toLocaleDateString('th-TH', {
              timeZone: 'Asia/Bangkok',
              year: 'numeric',
              month: 'short',
              day: 'numeric',
            });
          };
          const daysSinceLastAnc = journeyContext.lastAncDate
            ? Math.floor((now - new Date(journeyContext.lastAncDate).getTime()) / 86400_000)
            : null;
          const ancBelowMin = journeyContext.ancVisitCount < 4;
          const ancBelowTarget = journeyContext.ancVisitCount < 8 && !ancBelowMin;
          return (
            <div
              className="px-6 py-3"
              style={{ background: riskMeta.bg, borderBottom: '1px solid var(--rule-strong)' }}
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <Baby className="h-4 w-4" style={{ color: riskMeta.color }} />
                  <h3 className="text-[14px] font-bold" style={{ color: 'var(--ink-navy)' }}>
                    ข้อมูลฝากครรภ์ (ANC)
                  </h3>
                  <span
                    className="inline-flex items-center gap-1 rounded-sm px-1.5 py-0.5 font-mono text-[10px] font-bold tracking-[0.08em] text-white"
                    style={{ background: riskMeta.color }}
                  >
                    {riskKey === 'HR3' && <AlertTriangle className="h-3 w-3" />}
                    {riskKey ?? 'LOW'} · {riskMeta.label}
                  </span>
                  <span
                    className="inline-flex items-center gap-1 rounded-sm border px-1.5 py-0.5 font-mono text-[10px] tracking-[0.08em]"
                    style={{
                      borderColor: 'var(--rule-strong)',
                      color: 'var(--ink-navy-dim)',
                      background: 'white',
                    }}
                  >
                    <Activity className="h-3 w-3" style={{ color: 'var(--accent-navy)' }} />
                    {journeyContext.careStage}
                  </span>
                </div>
                <Link
                  href={`/pregnancies/${journeyContext.journeyId}`}
                  className="inline-flex items-center gap-1 rounded-sm px-2 py-1 font-mono text-[11px] font-bold tracking-[0.06em] text-white transition-colors hover:opacity-90"
                  style={{ background: 'var(--accent-navy)' }}
                >
                  ดูรายละเอียดการฝากครรภ์ →
                </Link>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                {[
                  {
                    label: 'จำนวนครั้ง ANC',
                    labelEn: 'ANC VISITS',
                    value: (
                      <>
                        {journeyContext.ancVisitCount}
                        <span className="ml-1 text-[11px] font-normal text-[var(--ink-navy-muted)]">
                          / 8
                        </span>
                      </>
                    ),
                    color: ancBelowMin
                      ? 'var(--risk-high)'
                      : ancBelowTarget
                        ? 'var(--risk-medium)'
                        : 'var(--risk-low)',
                    note: ancBelowMin
                      ? 'ต่ำกว่ามาตรฐาน'
                      : ancBelowTarget
                        ? 'ยังไม่ครบ'
                        : 'ครบตามเกณฑ์',
                  },
                  {
                    label: 'ANC ครั้งสุดท้าย',
                    labelEn: 'LAST VISIT',
                    value: fmt(journeyContext.lastAncDate),
                    color:
                      daysSinceLastAnc != null && daysSinceLastAnc > 28
                        ? 'var(--risk-high)'
                        : 'var(--accent-navy)',
                    note: daysSinceLastAnc != null ? `${daysSinceLastAnc} วันที่แล้ว` : undefined,
                    textSize: 13 as const,
                  },
                  {
                    label: 'วันแรกของประจำเดือนครั้งสุดท้าย',
                    labelEn: 'LMP',
                    value: fmt(journeyContext.lmp),
                    color: 'var(--accent-navy)',
                    textSize: 13 as const,
                  },
                  {
                    label: 'กำหนดคลอด',
                    labelEn: 'EDC',
                    value: fmt(journeyContext.edc),
                    color: 'var(--accent-navy)',
                    textSize: 13 as const,
                  },
                ].map((t) => (
                  <div
                    key={t.labelEn}
                    className="rounded-sm border bg-white px-2.5 py-2"
                    style={{
                      borderColor: 'var(--rule-strong)',
                      borderLeft: `3px solid ${t.color}`,
                    }}
                  >
                    <div
                      className="font-mono text-[9px] font-semibold uppercase tracking-[0.12em]"
                      style={{ color: t.color }}
                    >
                      {t.labelEn}
                    </div>
                    <div
                      className="mt-0.5 font-mono font-bold leading-tight tabular-nums"
                      style={{
                        color: t.color,
                        fontSize: t.textSize ? `${t.textSize}px` : '22px',
                        letterSpacing: '-0.01em',
                      }}
                    >
                      {t.value}
                    </div>
                    <div className="mt-0.5 font-mono text-[10px] text-[var(--ink-navy-dim)]">
                      {t.label}
                      {t.note && (
                        <span className="ml-1 text-[var(--ink-navy-muted)]">· {t.note}</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })()}

      {/* Section 3.6: Referral history — the same journey rows the /referrals
          board tracks, so staff see how (and how urgently) this woman was
          referred without leaving the patient view. */}
      {journeyContext && journeyContext.referrals.length > 0 && (
        <div
          data-testid="patient-referrals"
          className="bg-white px-6 py-3"
          style={{ borderBottom: '1px solid var(--rule-strong)' }}
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <KpiTip
              title="การส่งต่อของครรภ์นี้"
              body="ประวัติใบส่งตัวทั้งหมดที่ผูกกับการตั้งครรภ์นี้จากทุกโรงพยาบาลในเครือข่าย — สถานะ ความเร่งด่วน และเวลาตรงกับกระดานส่งต่อ /referrals"
              trigger={<div className="flex cursor-default items-center gap-2" />}
            >
              <Send className="h-4 w-4" style={{ color: 'var(--accent-navy)' }} />
              <h3 className="text-[14px] font-bold" style={{ color: 'var(--ink-navy)' }}>
                การส่งต่อ (REFERRAL)
              </h3>
              <span className="font-mono text-[10px] text-[var(--ink-navy-muted)]">
                {journeyContext.referrals.length} รายการ
              </span>
            </KpiTip>
            <Link
              href="/referrals"
              className="font-mono text-[11px] font-bold tracking-[0.06em] text-[var(--accent-navy)] hover:underline"
            >
              ดูกระดานส่งต่อ →
            </Link>
          </div>
          <div className="mt-2 space-y-1.5">
            {journeyContext.referrals.map((ref) => (
              <div
                key={ref.id}
                className="flex flex-wrap items-center gap-2 border px-2.5 py-1.5"
                style={{ borderColor: 'var(--rule-strong)' }}
              >
                <Pill meta={STATUS_META[ref.status]} fallback={ref.status} />
                <Pill meta={URGENCY_META[ref.urgencyLevel]} fallback={ref.urgencyLevel} />
                <span className="font-mono text-[11px] font-semibold text-[var(--ink-navy)]">
                  {ref.referNumber ?? '—'}
                </span>
                <span className="font-mono text-[11px] text-[var(--ink-navy-dim)]">
                  {ref.fromHospital} → {ref.toHospital}
                </span>
                {ref.diagnosisCode && (
                  <FlagChip color="var(--accent-navy)">{ref.diagnosisCode}</FlagChip>
                )}
                {ref.reason && (
                  <span className="max-w-[24rem] truncate text-[12px] text-[var(--ink-navy-dim)]">
                    {ref.reason}
                  </span>
                )}
                <span className="ml-auto font-mono text-[10px] text-[var(--ink-navy-muted)]">
                  ส่งเมื่อ {fmtDateTimeTh(ref.initiatedAt)}
                  {ref.arrivedAt ? ` · ถึงเมื่อ ${fmtDateTimeTh(ref.arrivedAt)}` : ''}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Section 3.7: Maternal labor-triage screening (Phase 4, shadow mode).
          Flag-gated per GC-U3: the API always computes `uiEnabled`
          server-side from MATERNAL_SCREEN_UI_ENABLED (default ON since the
          2026-07-16 operator decision; explicit 'false' opts out) — when
          disabled this block renders nothing and the page is byte-identical
          to before this feature existed. Placed as its own
          section here (not inside a workspace tab) so the card stays visible
          regardless of which tab (Summary/Partograph/Contractions) is active
          — it is independent of partogram/CPD data, same reasoning as the
          ANC-summary/referral sections above. Its SectionLabel starts its own
          local "01" counter: idx is a per-list visual ordinal (the tabs below
          already reuse 1/2/3 independently per tab), not a page-wide one. */}
      {screenings.uiEnabled && (
        <div
          data-testid="patient-maternal-screening"
          className="bg-white px-6 py-3"
          style={{ borderBottom: '1px solid var(--rule-strong)' }}
        >
          <SectionLabel idx={1} right={<span>MATERNAL SCREENING — SHADOW</span>}>
            การคัดกรองความเสี่ยงมารดา (รอคลอด)
          </SectionLabel>
          <div className="mt-2">
            <MaternalScreeningCard
              data={{
                latest: screenings.latest,
                history: screenings.history,
                nextCursor: screenings.nextCursor,
                uiEnabled: screenings.uiEnabled,
              }}
              isLoading={screenings.isLoading}
              error={screenings.error}
              onRetry={() => screenings.mutate()}
            />
          </div>
        </div>
      )}

      {/* Secondary-feed failure banner — main detail is on screen (we passed
          the error/!patient guard above), but one or more supporting feeds
          failed to load. Name them and offer a retry that revalidates only the
          failed feeds. */}
      {failedFeeds.length > 0 && (
        <ErrorState
          variant="banner"
          message={`โหลดข้อมูลบางส่วนไม่สำเร็จ: ${failedFeeds.map((f) => f.label).join(' / ')}`}
          onRetry={() => failedFeeds.forEach((f) => f.retry())}
        />
      )}

      {/* ─── Tabbed workspace ─────────────────────────────────────────────
          The three-column deep-dive used to stack in one giant scroll which
          forced the user to page past the partograph to reach contractions.
          Splitting by domain (สรุป / Partograph / Contractions) keeps each
          view focused and fits the workspace on a single viewport. */}
      {(() => {
        // Partograph is only computed on the partograph tab, but the CDSS
        // badge (critical/alert/warn) needs to be shown on the tab header
        // regardless of which tab is active — it's a "there's something to
        // see" hint.
        const partographState = partogram
          ? (() => {
              const observations = partogram.observations;
              const alerts = partogram.alerts;
              const cdssCounts = {
                critical: countBySeverity(alerts, 'CRITICAL'),
                alert: countBySeverity(alerts, 'ALERT'),
                warn: countBySeverity(alerts, 'WARN'),
              };
              const badge =
                cdssCounts.critical > 0
                  ? { label: `วิกฤต ${cdssCounts.critical}`, color: 'var(--risk-high)' }
                  : cdssCounts.alert > 0
                    ? { label: `เตือน ${cdssCounts.alert}`, color: 'var(--risk-medium)' }
                    : cdssCounts.warn > 0
                      ? { label: `ระวัง ${cdssCounts.warn}`, color: 'var(--accent-navy)' }
                      : null;
              const gpalParts: string[] = [];
              if (patient.gravida != null) gpalParts.push(`G${patient.gravida}`);
              if (patient.gaWeeks != null) gpalParts.push(`GA${patient.gaWeeks}`);
              const header = {
                an: patient.an,
                hn: patient.hn,
                patientName: maskName(patient.name),
                gpal: gpalParts.length > 0 ? gpalParts.join(' ') : undefined,
                age: patient.age != null ? String(patient.age) : undefined,
                admitAt: patient.admitDate,
              };
              return { observations, alerts, badge, header };
            })()
          : null;

        const tabs: Array<{ k: WorkspaceTab; label: string; icon: typeof HeartPulse }> = [
          { k: 'summary', label: 'สรุป', icon: HeartPulse },
          { k: 'partograph', label: 'Partograph', icon: LineChart },
          { k: 'contractions', label: 'Contractions', icon: Waves },
        ];

        return (
          <>
            {/* Tab bar — flush white strip with inline tabs + readonly badge
                + print action on the right. */}
            <div
              className="flex flex-wrap items-center gap-3 bg-white px-6 py-2"
              style={{ borderBottom: '1px solid var(--rule-strong)' }}
            >
              <div
                className="inline-flex items-center border bg-white"
                style={{ borderColor: 'var(--rule-strong)' }}
              >
                {tabs.map((t, i) => {
                  const active = activeTab === t.k;
                  const Icon = t.icon;
                  const showBadge = t.k === 'partograph' && partographState?.badge;
                  return (
                    <button
                      key={t.k}
                      onClick={() => setActiveTab(t.k)}
                      className={cn(
                        'inline-flex items-center gap-1.5 px-3 py-1.5 font-mono text-[11px] tracking-[0.06em] transition-colors',
                        active ? 'font-semibold' : 'font-normal hover:bg-[var(--accent-navy-soft)]',
                      )}
                      style={{
                        background: active ? 'var(--accent-navy-soft)' : 'white',
                        color: active ? 'var(--accent-navy)' : 'var(--ink-navy-dim)',
                        borderLeft: i > 0 ? '1px solid var(--rule-strong)' : undefined,
                      }}
                    >
                      <Icon className="h-3.5 w-3.5" />
                      {t.label}
                      {showBadge && partographState?.badge && (
                        <span
                          className="border px-1 py-0 font-mono text-[9px] font-semibold tracking-[0.06em]"
                          style={{
                            color: partographState.badge.color,
                            borderColor: partographState.badge.color,
                          }}
                        >
                          {partographState.badge.label}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>

              <span className="ml-auto font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--ink-navy-muted)]">
                READ-ONLY · PROVINCIAL VIEW
              </span>

              {/* Print dialog — accessible from every tab */}
              <Dialog>
                <DialogTrigger
                  render={
                    <Button
                      variant="outline"
                      className="h-7 border-[var(--rule-strong)] px-2.5 text-[11px] text-[var(--accent-navy)] hover:bg-[var(--accent-navy-soft)] print:hidden"
                    />
                  }
                >
                  <Printer size={14} className="mr-1.5" />
                  พิมพ์
                </DialogTrigger>
                <DialogContent className="max-w-4xl">
                  <PrintForm
                    patient={patient}
                    hospitalName={patient.hospital.name}
                    vitals={vitals}
                  />
                  <div className="flex justify-end gap-2">
                    <Button
                      onClick={() => window.print()}
                      style={{ background: 'var(--accent-navy)' }}
                    >
                      พิมพ์
                    </Button>
                  </div>
                </DialogContent>
              </Dialog>
            </div>

            {/* Tab content — flush white surface with generous horizontal padding. */}
            <div className="bg-white px-6 py-4">
              {activeTab === 'summary' && (
                <>
                  {journeyContext && journeyContext.newborns.length > 0 && (
                    <div data-testid="patient-newborns" className="mb-4">
                      <SectionLabel
                        idx={1}
                        right={<span>{journeyContext.newborns.length} INFANT(S)</span>}
                      >
                        <KpiTip
                          title="ทารกแรกเกิด"
                          body={`ผลลัพธ์การคลอดจากระบบซิงก์ทารกแรกเกิด — LBW = น้ำหนักแรกเกิดต่ำกว่า ${NEWBORN_THRESHOLDS.lbwGrams.toLocaleString('th-TH')} กรัม และ Apgar นาทีที่ 5 ต่ำกว่า ${NEWBORN_THRESHOLDS.apgarLowAt5min} ควรติดตามภาวะแทรกซ้อน (นิยามเดียวกับหน้าผลลัพธ์ทารก)`}
                          trigger={<span className="cursor-default" />}
                        >
                          ทารกแรกเกิด (NEWBORN OUTCOMES)
                        </KpiTip>
                      </SectionLabel>
                      <div className="space-y-1.5">
                        {journeyContext.newborns.map((nb) => {
                          const lbw =
                            nb.birthWeightG != null &&
                            nb.birthWeightG < NEWBORN_THRESHOLDS.lbwGrams;
                          const lowApgar =
                            nb.apgar5min != null &&
                            nb.apgar5min < NEWBORN_THRESHOLDS.apgarLowAt5min;
                          const flagged = lbw || lowApgar;
                          return (
                            <div
                              key={nb.infantNumber}
                              className="flex flex-wrap items-center gap-3 border px-3 py-2"
                              style={{
                                borderColor: 'var(--rule-strong)',
                                borderLeft: `3px solid ${flagged ? 'var(--risk-high)' : 'var(--risk-low)'}`,
                              }}
                            >
                              <Baby className="h-4 w-4" style={{ color: 'var(--accent-navy)' }} />
                              <span className="font-mono text-[12px] font-bold text-[var(--ink-navy)]">
                                #{nb.infantNumber}
                              </span>
                              <span className="text-[13px] text-[var(--ink-navy-dim)]">
                                เพศ{SEX_TH[nb.sex ?? ''] ?? 'ไม่ระบุ'}
                              </span>
                              <span
                                className="font-mono text-[13px] font-semibold tabular-nums"
                                style={{ color: lbw ? 'var(--risk-high)' : 'var(--ink-navy)' }}
                              >
                                {nb.birthWeightG != null
                                  ? `${nb.birthWeightG.toLocaleString('th-TH')} กรัม`
                                  : 'น้ำหนัก —'}
                              </span>
                              {lbw && <FlagChip color="var(--risk-high)">LBW</FlagChip>}
                              <span
                                data-testid={`newborn-apgar-${nb.infantNumber}`}
                                data-low={lowApgar ? 'true' : 'false'}
                                className="font-mono text-[12px] tabular-nums"
                                style={{
                                  color: lowApgar ? 'var(--risk-high)' : 'var(--ink-navy-dim)',
                                  fontWeight: lowApgar ? 700 : 400,
                                }}
                              >
                                Apgar {nb.apgar1min ?? '—'} / {nb.apgar5min ?? '—'}
                              </span>
                              {lowApgar && <FlagChip color="var(--risk-high)">APGAR&lt;7</FlagChip>}
                              <span className="ml-auto font-mono text-[10px] text-[var(--ink-navy-muted)]">
                                เกิดเมื่อ {fmtDateTimeTh(nb.bornAt)}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                  <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                    <div className="space-y-3">
                      <SectionLabel idx={2} right={<span>LIVE MONITORING</span>}>
                        สัญญาณชีพและความก้าวหน้า
                      </SectionLabel>
                      <CurrentVitalsPanel vitals={vitals} />
                      <LaborProgressCard
                        admitDate={patient.admitDate}
                        laborStatus={patient.laborStatus}
                        partogramEntries={partogram?.entries ?? null}
                        contractions={contractions}
                      />
                    </div>
                    <div className="space-y-3">
                      <SectionLabel idx={3} right={<span>ADMISSION RECORD</span>}>
                        ข้อมูลคลินิก
                      </SectionLabel>
                      {cpdScore && (
                        <CpdFactorBreakdown
                          score={cpdScore.score}
                          riskLevel={cpdScore.riskLevel}
                          factors={cpdScore.factors}
                          missingFactors={cpdScore.missingFactors}
                          calculatedAt={cpdScore.calculatedAt}
                        />
                      )}
                      <ClinicalData
                        gravida={patient.gravida}
                        para={patient.para}
                        abortion={patient.abortion}
                        livingChildren={patient.livingChildren}
                        pregNo={patient.pregNo}
                        gaWeeks={patient.gaWeeks}
                        gaDay={patient.gaDay}
                        ancCount={patient.ancCount}
                        heightCm={patient.heightCm}
                        weightKg={patient.weightKg}
                        weightDiffKg={patient.weightDiffKg}
                        prePregnancyWeightKg={patient.prePregnancyWeightKg}
                        fundalHeightCm={patient.fundalHeightCm}
                        usWeightG={patient.usWeightG}
                        hematocritPct={patient.hematocritPct}
                        bpSystolicAdmit={patient.bpSystolicAdmit}
                        bpDiastolicAdmit={patient.bpDiastolicAdmit}
                        pulseAdmit={patient.pulseAdmit}
                        rrAdmit={patient.rrAdmit}
                        temperatureAdmit={patient.temperatureAdmit}
                        cervicalOpenCmAdmit={patient.cervicalOpenCmAdmit}
                        effacementPctAdmit={patient.effacementPctAdmit}
                        stationAdmit={patient.stationAdmit}
                      />
                    </div>
                  </div>
                </>
              )}

              {activeTab === 'partograph' &&
                (partographState ? (
                  <div className="space-y-4">
                    {partographState.alerts.length > 0 && (
                      <AlertSummaryPanel
                        alerts={partographState.alerts}
                        observations={partographState.observations}
                      />
                    )}

                    {/* Two-column layout: partograph (wide, scrollable) next
                        to the 4-panel vital-sign trend charts. The partograph
                        takes the larger share because its 24h grid needs the
                        horizontal real estate; the trends stack vertically in
                        the narrower right column. */}
                    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.7fr_1fr]">
                      {/* Partograph chart — designed for print, so shrink to
                          fit the provincial detail view. */}
                      <div className="min-w-0">
                        <SectionLabel idx={1} right={<span>WHO LABOUR PROGRESS</span>}>
                          Partograph chart
                        </SectionLabel>
                        <div
                          className="mt-2 overflow-auto border"
                          style={{
                            borderColor: 'var(--rule-strong)',
                            zoom: 0.7,
                          }}
                        >
                          <PartographForm
                            header={partographState.header}
                            observations={partographState.observations}
                            alerts={partographState.alerts}
                          />
                        </div>
                      </div>

                      {/* Vital trend charts — maternal HR / fetal HR / BP / PPH */}
                      <div className="min-w-0">
                        <SectionLabel idx={2} right={<span>24H HISTORY</span>}>
                          แนวโน้มสัญญาณชีพ
                        </SectionLabel>
                        {vitals.length > 0 ? (
                          <div className="mt-2">
                            <VitalTrendCharts vitals={vitals} />
                          </div>
                        ) : (
                          <div
                            className="mt-2 border p-4 text-center font-mono text-[11px] text-[var(--ink-navy-muted)]"
                            style={{ borderColor: 'var(--rule-strong)' }}
                          >
                            ยังไม่มีข้อมูลสัญญาณชีพ
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Observations table — full width below the 2-col grid */}
                    <div>
                      <SectionLabel
                        idx={3}
                        right={<span>{partographState.observations.length} ROWS</span>}
                      >
                        Observations
                      </SectionLabel>
                      {partographState.observations.length === 0 ? (
                        <div
                          className="mt-2 border p-4 font-mono text-[12px] text-[var(--ink-navy-muted)]"
                          style={{ borderColor: 'var(--rule-strong)' }}
                        >
                          ไม่พบข้อมูล
                        </div>
                      ) : (
                        <div
                          className="mt-2 overflow-x-auto border"
                          style={{ borderColor: 'var(--rule-strong)' }}
                        >
                          <table className="w-full text-[12px]">
                            <thead>
                              <tr
                                className="border-b text-left font-mono text-[10px] uppercase tracking-[0.1em] text-[var(--ink-navy-muted)]"
                                style={{ borderColor: 'var(--rule-strong)' }}
                              >
                                <th className="px-3 py-2">เวลา</th>
                                <th className="px-3 py-2">ชั่วโมง</th>
                                <th className="px-3 py-2">FHR</th>
                                <th className="px-3 py-2">ปากมดลูก (ซม)</th>
                                <th className="px-3 py-2">การหด / 10m</th>
                                <th className="px-3 py-2">BP</th>
                                <th className="px-3 py-2">Pulse</th>
                                <th className="px-3 py-2">Temp</th>
                              </tr>
                            </thead>
                            <tbody>
                              {partographState.observations.map((o) => (
                                <tr
                                  key={o.id}
                                  className="border-b tabular-nums text-[var(--ink-navy-dim)]"
                                  style={{ borderColor: 'var(--rule-hair)' }}
                                >
                                  <td className="px-3 py-2 font-mono text-[11px]">
                                    {o.observeDatetime?.replace('T', ' ').slice(0, 16) ?? '-'}
                                  </td>
                                  <td className="px-3 py-2">{o.hourNo ?? '-'}</td>
                                  <td
                                    className="px-3 py-2"
                                    style={{
                                      color: fhrTint(o.fetalHeartRate),
                                      fontWeight: fhrTint(o.fetalHeartRate) ? 600 : undefined,
                                    }}
                                  >
                                    {o.fetalHeartRate ?? '-'}
                                  </td>
                                  <td className="px-3 py-2">{o.cervicalDilationCm ?? '-'}</td>
                                  <td className="px-3 py-2">{o.contractionPer10Min ?? '-'}</td>
                                  <td
                                    className="px-3 py-2"
                                    style={{
                                      color: bpTint(o.bpSystolic, o.bpDiastolic),
                                      fontWeight: bpTint(o.bpSystolic, o.bpDiastolic)
                                        ? 600
                                        : undefined,
                                    }}
                                  >
                                    {o.bpSystolic ?? '-'}/{o.bpDiastolic ?? '-'}
                                  </td>
                                  <td className="px-3 py-2">{o.pulse ?? '-'}</td>
                                  <td className="px-3 py-2">{o.temperature ?? '-'}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  </div>
                ) : partogramError ? (
                  <ErrorState
                    variant="page"
                    message="ไม่สามารถโหลดข้อมูล Partograph ได้"
                    detail={partogramError instanceof Error ? partogramError.message : undefined}
                    onRetry={() => void mutatePartogram()}
                  />
                ) : (
                  <div
                    className="border p-6 text-center font-mono text-[12px] text-[var(--ink-navy-muted)]"
                    style={{ borderColor: 'var(--rule-strong)' }}
                  >
                    ยังไม่มีข้อมูล Partograph สำหรับผู้คลอดรายนี้
                  </div>
                ))}

              {activeTab === 'contractions' && <ContractionTable contractions={contractions} />}
            </div>
          </>
        );
      })()}
    </div>
  );
}
