'use client';

import { use, useRef } from 'react';
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
import { VitalTrendCharts } from '@/components/charts/VitalTrendCharts';
import { PartogramChart } from '@/components/charts/PartogramChart';
import { AlertSummaryPanel } from '@/components/patient/AlertSummaryPanel';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTrigger } from '@/components/ui/dialog';
import { ArrowLeft, Printer } from 'lucide-react';
import { RiskLevel } from '@/types/domain';
import { RISK_LEVELS } from '@/config/risk-levels';

export default function PatientDetailPage({
  params,
}: {
  params: Promise<{ an: string }>;
}) {
  const { an: patientId } = use(params);
  const router = useRouter();
  const mainHeaderRef = useRef<HTMLDivElement>(null);

  const { patient, cpdScore, vitals, contractions, isLoading, mutate } = usePatient(patientId);
  const { partogram } = usePartogram(patientId);

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

  if (!patient) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="text-center">
          <p className="text-lg text-slate-400">ไม่พบข้อมูลผู้คลอด</p>
          <button onClick={() => router.back()} className="mt-2 text-sm text-teal-600 underline">
            กลับ
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
    <div className="space-y-5">
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

      {/* Back navigation */}
      <button
        onClick={() => router.back()}
        className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-teal-600 print:hidden"
      >
        <ArrowLeft size={16} /> กลับ
      </button>

      {/* Section 1: Patient Header */}
      <div ref={mainHeaderRef}>
        <div className="rounded-xl bg-white p-5 shadow-sm">
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
      </div>

      {/* Section 2: Referral Recommendation Banner */}
      {cpdScore && cpdScore.riskLevel !== RiskLevel.LOW && (
        <ReferralBanner
          score={cpdScore.score}
          riskLevel={cpdScore.riskLevel as RiskLevel}
          recommendation={cpdScore.recommendation ?? RISK_LEVELS[cpdScore.riskLevel as RiskLevel].action}
        />
      )}

      {/* Section 3: Quick Stats Bar — key metrics at a glance */}
      <QuickStatsBar
        age={patient.age}
        gravida={patient.gravida}
        gaWeeks={patient.gaWeeks}
        ancCount={patient.ancCount}
        admitDate={patient.admitDate}
        laborStatus={patient.laborStatus}
        currentDilationCm={currentDilationCm}
        latestVitalAt={latestVitalAt}
      />

      {/* Section 4: Two-column layout — Vitals & Labor Progress | CPD Analysis & Clinical Data */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Left column: Current vitals + Labor progress */}
        <div className="space-y-5">
          <CurrentVitalsPanel vitals={vitals} />
          <LaborProgressCard
            admitDate={patient.admitDate}
            laborStatus={patient.laborStatus}
            partogramEntries={partogram?.entries ?? null}
            contractions={contractions}
          />
        </div>

        {/* Right column: CPD Analysis + Clinical Data */}
        <div className="space-y-5">
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
            gaWeeks={patient.gaWeeks}
            ancCount={patient.ancCount}
            heightCm={patient.heightCm}
            weightKg={patient.weightKg}
            weightDiffKg={patient.weightDiffKg}
            fundalHeightCm={patient.fundalHeightCm}
            usWeightG={patient.usWeightG}
            hematocritPct={patient.hematocritPct}
          />
        </div>
      </div>

      {/* Section 5: Vital Sign Trend Charts */}
      {vitals.length > 0 && (
        <div>
          <h3 className="mb-3 text-base font-medium text-slate-700">แนวโน้มสัญญาณชีพ</h3>
          <VitalTrendCharts vitals={vitals} />
        </div>
      )}

      {/* Section 6: Partogram CDSS Alerts + 4-panel Chart */}
      {partogram && (
        <>
          {partogram.alerts.length > 0 && (
            <AlertSummaryPanel
              alerts={partogram.alerts}
              observations={partogram.observations}
            />
          )}
          <div className="rounded-xl bg-white p-5 shadow-sm">
            <PartogramChart
              observations={partogram.observations}
              alerts={partogram.alerts}
              startTime={partogram.startTime}
            />
          </div>
        </>
      )}

      {/* Section 7: Contraction Table */}
      <div className="rounded-xl bg-white p-5 shadow-sm">
        <ContractionTable contractions={contractions} />
      </div>

      {/* Section 8: Print */}
      <div className="flex justify-end print:hidden">
        <Dialog>
          <DialogTrigger render={
            <Button variant="outline" className="border-teal-200 text-teal-700 hover:bg-teal-50" />
          }>
            <Printer size={16} className="mr-2" />
            พิมพ์บันทึกการคลอด
          </DialogTrigger>
          <DialogContent className="max-w-4xl">
            <PrintForm patient={patient} hospitalName={patient.hospital.name} vitals={vitals} />
            <div className="flex justify-end gap-2">
              <Button onClick={() => window.print()}>พิมพ์</Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}
