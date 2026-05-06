'use client';

import { use, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { usePatient } from '@/hooks/usePatient';
import { usePartogram } from '@/hooks/usePartogram';
import { useSSE } from '@/hooks/useSSE';
import { useSetBreadcrumbs } from '@/components/layout/BreadcrumbContext';
import { PatientHeader } from '@/components/patient/PatientHeader';
import { ReferralBanner } from '@/components/patient/ReferralBanner';
import { StickyPatientHeader } from '@/components/patient/StickyPatientHeader';
import { QuickStatsBar } from '@/components/patient/QuickStatsBar';
import { CurrentVitalsPanel } from '@/components/patient/CurrentVitalsPanel';
import { LaborProgressCard } from '@/components/patient/LaborProgressCard';
import { CpdFactorBreakdown } from '@/components/patient/CpdFactorBreakdown';
import { ClinicalData } from '@/components/patient/ClinicalData';
import { ContractionTable } from '@/components/patient/ContractionTable';
import { PrintForm } from '@/components/patient/PrintForm';
import { HighRiskAlert } from '@/components/shared/HighRiskAlert';
import { LoadingState } from '@/components/shared/LoadingState';
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
  Waves,
} from 'lucide-react';
import Link from 'next/link';
import { RiskLevel } from '@/types/domain';
import { RISK_LEVELS } from '@/config/risk-levels';
import { SectionLabel } from '@/components/dashboard/shared';

type WorkspaceTab = 'summary' | 'partograph' | 'contractions';

export default function PatientDetailPage({
  params,
}: {
  params: Promise<{ an: string }>;
}) {
  const { an: patientId } = use(params);
  const router = useRouter();
  const mainHeaderRef = useRef<HTMLDivElement>(null);

  // Frozen render-time anchor — react-hooks/purity forbids bare Date.now()
  // in render code. SWR's 30s refresh re-derives "X days since last ANC"
  // from new data anyway, so a per-mount snapshot is fine.
  const [now] = useState<number>(() => Date.now());

  const { patient, cpdScore, journeyContext, vitals, contractions, isLoading, error, mutate } =
    usePatient(patientId);
  const { partogram } = usePartogram(patientId);
  const [activeTab, setActiveTab] = useState<WorkspaceTab>('summary');

  useSetBreadcrumbs([
    { label: 'แดชบอร์ด', href: '/' },
    { label: `AN ${patientId}` },
  ]);

  useSSE({
    onPatientUpdate: () => mutate(),
    onSyncComplete: () => mutate(),
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
    const apiMessage =
      error instanceof Error ? error.message : 'ไม่พบข้อมูลผู้คลอด';
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
          <p className="font-mono text-[13px] font-semibold text-[var(--ink-navy)]">
            {heading}
          </p>
          {error && (
            <p className="mt-2 font-mono text-[11px] text-red-600">
              {apiMessage}
            </p>
          )}
          {status === 400 && (
            <p className="mt-2 font-mono text-[11px] text-[var(--ink-navy-dim)]">
              URL ต้องอยู่ในรูปแบบ <code className="rounded bg-[var(--rule-hair)] px-1">/patients/&lt;hcode&gt;-&lt;an&gt;</code>
              <br />
              เช่น <code className="rounded bg-[var(--rule-hair)] px-1">/patients/10670-69000123</code>
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
        (a, b) => new Date(b.measuredAt).getTime() - new Date(a.measuredAt).getTime()
      )[0].dilationCm
    : null;

  // Latest vital timestamp for quick stats
  const latestVitalAt = vitals.length > 0 ? vitals[vitals.length - 1].measuredAt : null;

  return (
    <div
      style={{
        color: 'var(--ink-navy)',
        background: 'var(--surface-cool)',
        zoom: 1.15,
      }}
    >
      {/* High Risk Alert Modal */}
      {cpdScore && cpdScore.score >= 10 && (
        <HighRiskAlert score={cpdScore.score} an={patient.an} />
      )}

      {/* Sticky header on scroll */}
      <StickyPatientHeader
        name={patient.name}
        hn={patient.hn}
        an={patient.an}
        laborStatus={patient.laborStatus}
        hospitalName={patient.hospital.name}
        cpdScore={cpdScore ? { score: cpdScore.score, riskLevel: cpdScore.riskLevel as RiskLevel } : null}
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
      </div>

      {/* Section 1: Patient Header — full-bleed navy gradient identity band.
          PatientHeader renders its own inner gradient canvas + padding, so the
          wrapper here is zero-padding / zero-background. */}
      <div
        ref={mainHeaderRef}
        style={{ borderBottom: '1px solid var(--rule-strong)' }}
      >
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
          cpdScore={cpdScore ? { score: cpdScore.score, riskLevel: cpdScore.riskLevel as RiskLevel } : null}
        />
      </div>

      {/* Section 2: Referral Recommendation Banner */}
      {cpdScore && cpdScore.riskLevel !== RiskLevel.LOW && (
        <div
          className="bg-white"
          style={{ borderBottom: '1px solid var(--rule-strong)' }}
        >
          <ReferralBanner
            score={cpdScore.score}
            riskLevel={cpdScore.riskLevel as RiskLevel}
            recommendation={cpdScore.recommendation ?? RISK_LEVELS[cpdScore.riskLevel as RiskLevel].action}
          />
        </div>
      )}

      {/* Section 3: Quick Stats Bar — flush white strip */}
      <div
        className="bg-white"
        style={{ borderBottom: '1px solid var(--rule-strong)' }}
      >
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
      {journeyContext && (() => {
        const riskKey = journeyContext.ancRiskLevel;
        const riskMeta =
          riskKey === 'HR3'
            ? { color: 'var(--risk-high)',   bg: 'color-mix(in srgb, #ef4444 10%, white)', label: 'ความเสี่ยงสูง ระดับ 3' }
            : riskKey === 'HR2'
              ? { color: 'var(--risk-medium)', bg: 'color-mix(in srgb, #eab308 10%, white)', label: 'ความเสี่ยง ระดับ 2' }
              : riskKey === 'HR1'
                ? { color: 'var(--risk-medium)', bg: 'color-mix(in srgb, #eab308 8%, white)', label: 'ความเสี่ยง ระดับ 1' }
                : { color: 'var(--risk-low)', bg: 'color-mix(in srgb, #22c55e 6%, white)', label: 'ความเสี่ยงต่ำ' };
        const fmt = (iso: string | null): string => {
          if (!iso) return '—';
          return new Date(iso).toLocaleDateString('th-TH', {
            timeZone: 'Asia/Bangkok',
            year: 'numeric', month: 'short', day: 'numeric',
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
                      <span className="ml-1 text-[11px] font-normal text-[var(--ink-navy-muted)]">/ 8</span>
                    </>
                  ),
                  color: ancBelowMin
                    ? 'var(--risk-high)'
                    : ancBelowTarget
                      ? 'var(--risk-medium)'
                      : 'var(--risk-low)',
                  note: ancBelowMin ? 'ต่ำกว่ามาตรฐาน' : ancBelowTarget ? 'ยังไม่ครบ' : 'ครบตามเกณฑ์',
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
                  style={{ borderColor: 'var(--rule-strong)', borderLeft: `3px solid ${t.color}` }}
                >
                  <div className="font-mono text-[9px] font-semibold uppercase tracking-[0.12em]"
                       style={{ color: t.color }}>
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
                    {t.note && <span className="ml-1 text-[var(--ink-navy-muted)]">· {t.note}</span>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

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
                  <PrintForm patient={patient} hospitalName={patient.hospital.name} vitals={vitals} />
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
                <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                  <div className="space-y-3">
                    <CurrentVitalsPanel vitals={vitals} />
                    <LaborProgressCard
                      admitDate={patient.admitDate}
                      laborStatus={patient.laborStatus}
                      partogramEntries={partogram?.entries ?? null}
                      contractions={contractions}
                    />
                  </div>
                  <div className="space-y-3">
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
              )}

              {activeTab === 'partograph' && (
                partographState ? (
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
                                  <td className="px-3 py-2">{o.fetalHeartRate ?? '-'}</td>
                                  <td className="px-3 py-2">{o.cervicalDilationCm ?? '-'}</td>
                                  <td className="px-3 py-2">{o.contractionPer10Min ?? '-'}</td>
                                  <td className="px-3 py-2">
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
                ) : (
                  <div
                    className="border p-6 text-center font-mono text-[12px] text-[var(--ink-navy-muted)]"
                    style={{ borderColor: 'var(--rule-strong)' }}
                  >
                    ยังไม่มีข้อมูล Partograph สำหรับผู้คลอดรายนี้
                  </div>
                )
              )}

              {activeTab === 'contractions' && (
                <ContractionTable contractions={contractions} />
              )}
            </div>
          </>
        );
      })()}
    </div>
  );
}
