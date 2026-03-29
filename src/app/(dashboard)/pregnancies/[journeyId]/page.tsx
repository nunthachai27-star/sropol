// Journey Detail Page — full pregnancy journey for one woman
'use client';

import { use } from 'react';
import { useRouter } from 'next/navigation';
import useSWR from 'swr';
import { useSetBreadcrumbs } from '@/components/layout/BreadcrumbContext';
import { LoadingState } from '@/components/shared/LoadingState';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { ArrowLeft, Baby, Calendar, Hospital, AlertTriangle } from 'lucide-react';

// ─── Types ───────────────────────────────────────────────────────────────────

interface AncVisit {
  visitDate: string;
  visitNumber: number;
  gaWeeks: number | null;
  fundalHeightCm: number | null;
  weightKg: number | null;
  bpSystolic: number | null;
  bpDiastolic: number | null;
  fetalHr: number | null;
}

interface LatestRisk {
  riskLevel: string;
  triggeredRules: string[];
  screenedAt: string;
  recommendedFacility: string | null;
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
}

interface JourneyDetailResponse {
  journey: Journey;
  ancVisits: AncVisit[];
  latestRisk: LatestRisk | null;
  referrals: Referral[];
  newborns: Newborn[];
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const fetcher = (url: string) => fetch(url).then((r) => r.json());

const ANC_RISK_COLORS: Record<string, string> = {
  LOW:  'bg-green-100 text-green-700 border-green-200',
  HR1:  'bg-yellow-100 text-yellow-700 border-yellow-200',
  HR2:  'bg-orange-100 text-orange-700 border-orange-200',
  HR3:  'bg-red-100 text-red-700 border-red-200',
};

const ANC_RISK_LABELS: Record<string, string> = {
  LOW:  'เสี่ยงต่ำ',
  HR1:  'เสี่ยงสูง ระดับ 1',
  HR2:  'เสี่ยงสูง ระดับ 2',
  HR3:  'เสี่ยงสูง ระดับ 3',
};

const CARE_STAGE_COLORS: Record<string, string> = {
  PREGNANCY:  'bg-purple-100 text-purple-700 border-purple-200',
  LABOR:      'bg-blue-100 text-blue-700 border-blue-200',
  DELIVERED:  'bg-emerald-100 text-emerald-700 border-emerald-200',
  POSTPARTUM: 'bg-gray-100 text-gray-700 border-gray-200',
};

const CARE_STAGE_LABELS: Record<string, string> = {
  PREGNANCY:  'ฝากครรภ์',
  LABOR:      'ระหว่างคลอด',
  DELIVERED:  'คลอดแล้ว',
  POSTPARTUM: 'หลังคลอด',
};

const REFERRAL_STATUS_LABELS: Record<string, string> = {
  PENDING:   'รอดำเนินการ',
  ACCEPTED:  'รับแล้ว',
  ARRIVED:   'ถึงแล้ว',
  CANCELLED: 'ยกเลิก',
};

const SEX_LABELS: Record<string, string> = {
  M: 'ชาย',
  F: 'หญิง',
};

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '-';
  return new Date(dateStr).toLocaleDateString('th-TH', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function JourneyDetailPage({
  params,
}: {
  params: Promise<{ journeyId: string }>;
}) {
  const { journeyId } = use(params);
  const router = useRouter();

  const { data, isLoading } = useSWR<JourneyDetailResponse>(
    `/api/journeys/${journeyId}`,
    fetcher,
    { refreshInterval: 60000 },
  );

  const journeyName = data?.journey?.name ?? `Journey ${journeyId}`;
  useSetBreadcrumbs([
    { label: 'แดชบอร์ด', href: '/' },
    { label: 'ฝากครรภ์', href: '#' },
    { label: journeyName },
  ]);

  if (isLoading) {
    return <LoadingState message="กำลังโหลดข้อมูลการฝากครรภ์..." />;
  }

  if (!data?.journey) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="text-center">
          <p className="text-lg text-slate-400">ไม่พบข้อมูลการฝากครรภ์</p>
          <button
            onClick={() => router.back()}
            className="mt-2 text-sm text-teal-600 underline"
          >
            กลับ
          </button>
        </div>
      </div>
    );
  }

  const { journey, ancVisits, latestRisk, referrals, newborns } = data;
  const riskColor   = ANC_RISK_COLORS[journey.ancRiskLevel ?? ''] ?? 'bg-slate-100 text-slate-700 border-slate-200';
  const riskLabel   = ANC_RISK_LABELS[journey.ancRiskLevel ?? ''] ?? journey.ancRiskLevel ?? '-';
  const stageColor  = CARE_STAGE_COLORS[journey.careStage] ?? 'bg-slate-100 text-slate-700 border-slate-200';
  const stageLabel  = CARE_STAGE_LABELS[journey.careStage] ?? journey.careStage;
  const isReferred  = journey.currentHcode && journey.currentHcode !== journey.hcode;

  return (
    <div className="space-y-5">
      {/* Back button */}
      <button
        onClick={() => router.back()}
        className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-teal-600"
      >
        <ArrowLeft size={16} /> กลับ
      </button>

      {/* ── Header card ──────────────────────────────────────────────────── */}
      <div className="rounded-xl bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-start gap-3">
          <div className="flex-1 min-w-0">
            <h1 className="text-xl font-bold text-slate-800 truncate">{journey.name}</h1>
            <p className="mt-0.5 text-sm text-slate-500">
              HN: <span className="font-mono">{journey.hn}</span>
              &ensp;·&ensp;อายุ {journey.age} ปี
              {journey.gravida != null && (
                <>&ensp;·&ensp;G{journey.gravida}P{journey.para ?? '?'}</>
              )}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <span className={`rounded-full border px-3 py-0.5 text-xs font-medium ${stageColor}`}>
              {stageLabel}
            </span>
            {journey.ancRiskLevel && (
              <span className={`rounded-full border px-3 py-0.5 text-xs font-medium ${riskColor}`}>
                {riskLabel}
              </span>
            )}
          </div>
        </div>

        {/* Info grid */}
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <InfoCard label="LMP (วันแรกประจำเดือน)" value={formatDate(journey.lmp)} />
          <InfoCard label="EDC (วันกำหนดคลอด)" value={formatDate(journey.edc)} />
          <InfoCard
            label="อายุครรภ์ (GA)"
            value={journey.gaWeeks != null ? `${journey.gaWeeks} สัปดาห์` : '-'}
          />
          <InfoCard label="จำนวนครั้ง ANC" value={`${journey.ancVisitCount} ครั้ง`} />
        </div>

        {/* Hospital info */}
        <div className="mt-3 flex flex-wrap gap-3 text-sm text-slate-600">
          <span className="flex items-center gap-1">
            <Hospital size={14} className="text-slate-400" />
            โรงพยาบาลที่ฝากครรภ์: <strong className="ml-1">{journey.hospitalName}</strong>
          </span>
          {isReferred && journey.currentHospitalName && (
            <span className="flex items-center gap-1 text-orange-600">
              <AlertTriangle size={14} />
              ปัจจุบันอยู่ที่: <strong className="ml-1">{journey.currentHospitalName}</strong>
            </span>
          )}
        </div>
      </div>

      {/* ── ANC Visit Timeline ───────────────────────────────────────────── */}
      <Section title="ประวัติการฝากครรภ์" icon={<Calendar size={16} />}>
        {ancVisits.length === 0 ? (
          <EmptyState message="ยังไม่มีประวัติการฝากครรภ์" />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>ครั้งที่</TableHead>
                  <TableHead>วันที่</TableHead>
                  <TableHead>GA (สัปดาห์)</TableHead>
                  <TableHead>ยอดมดลูก (ซม.)</TableHead>
                  <TableHead>น้ำหนัก (กก.)</TableHead>
                  <TableHead>BP (mmHg)</TableHead>
                  <TableHead>FHR (bpm)</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {ancVisits.map((v) => (
                  <TableRow key={v.visitNumber}>
                    <TableCell className="font-medium">{v.visitNumber}</TableCell>
                    <TableCell>{formatDate(v.visitDate)}</TableCell>
                    <TableCell>{v.gaWeeks ?? '-'}</TableCell>
                    <TableCell>{v.fundalHeightCm ?? '-'}</TableCell>
                    <TableCell>{v.weightKg ?? '-'}</TableCell>
                    <TableCell>
                      {v.bpSystolic != null && v.bpDiastolic != null
                        ? `${v.bpSystolic}/${v.bpDiastolic}`
                        : '-'}
                    </TableCell>
                    <TableCell>{v.fetalHr ?? '-'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </Section>

      {/* ── Risk Assessment ──────────────────────────────────────────────── */}
      {latestRisk && (
        <Section title="การประเมินความเสี่ยง" icon={<AlertTriangle size={16} />}>
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-3">
              <span
                className={`rounded-full border px-3 py-0.5 text-sm font-medium ${ANC_RISK_COLORS[latestRisk.riskLevel] ?? 'bg-slate-100 text-slate-700 border-slate-200'}`}
              >
                {ANC_RISK_LABELS[latestRisk.riskLevel] ?? latestRisk.riskLevel}
              </span>
              <span className="text-xs text-slate-400">
                ประเมิน: {formatDate(latestRisk.screenedAt)}
              </span>
              {latestRisk.recommendedFacility && (
                <span className="text-xs text-slate-500">
                  แนะนำส่งต่อ: <strong>{latestRisk.recommendedFacility}</strong>
                </span>
              )}
            </div>
            {latestRisk.triggeredRules.length > 0 && (
              <div>
                <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">
                  ปัจจัยเสี่ยงที่พบ
                </p>
                <ul className="space-y-1">
                  {latestRisk.triggeredRules.map((rule) => (
                    <li key={rule} className="flex items-center gap-2 text-sm text-slate-700">
                      <span className="inline-block h-1.5 w-1.5 flex-shrink-0 rounded-full bg-orange-400" />
                      {rule}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </Section>
      )}

      {/* ── Referral History ─────────────────────────────────────────────── */}
      {referrals.length > 0 && (
        <Section title="ประวัติการส่งต่อ" icon={<Hospital size={16} />}>
          <div className="space-y-3">
            {referrals.map((ref) => (
              <div
                key={ref.id}
                className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline">
                    {REFERRAL_STATUS_LABELS[ref.status] ?? ref.status}
                  </Badge>
                  {ref.urgencyLevel && (
                    <Badge variant="destructive" className="text-xs">
                      {ref.urgencyLevel}
                    </Badge>
                  )}
                  <span className="text-slate-400 text-xs">{formatDate(ref.initiatedAt)}</span>
                </div>
                <p className="mt-2 text-slate-700">
                  {ref.fromHospital} → <strong>{ref.toHospital}</strong>
                </p>
                {ref.reason && (
                  <p className="mt-1 text-slate-500">เหตุผล: {ref.reason}</p>
                )}
                {ref.arrivedAt && (
                  <p className="mt-1 text-xs text-emerald-600">
                    ถึงปลายทาง: {formatDate(ref.arrivedAt)}
                  </p>
                )}
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* ── Newborn Outcomes ─────────────────────────────────────────────── */}
      {newborns.length > 0 && (
        <Section title="ผลลัพธ์ทารกแรกเกิด" icon={<Baby size={16} />}>
          <div className="grid gap-3 sm:grid-cols-2">
            {newborns.map((nb) => (
              <div
                key={nb.infantNumber}
                className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm"
              >
                <p className="font-semibold text-emerald-800">
                  ทารกคนที่ {nb.infantNumber}
                  {nb.sex && ` — ${SEX_LABELS[nb.sex] ?? nb.sex}`}
                </p>
                <div className="mt-2 grid grid-cols-2 gap-2 text-slate-700">
                  <InfoCard
                    label="น้ำหนักแรกเกิด"
                    value={nb.birthWeightG != null ? `${nb.birthWeightG} กรัม` : '-'}
                    compact
                  />
                  <InfoCard
                    label="Apgar 1 นาที"
                    value={nb.apgar1min != null ? String(nb.apgar1min) : '-'}
                    compact
                  />
                  <InfoCard
                    label="Apgar 5 นาที"
                    value={nb.apgar5min != null ? String(nb.apgar5min) : '-'}
                    compact
                  />
                  <InfoCard label="เวลาเกิด" value={formatDate(nb.bornAt)} compact />
                </div>
              </div>
            ))}
          </div>
        </Section>
      )}
    </div>
  );
}

// ─── Sub-components ────────────────────────────────────────────────────────

function Section({
  title,
  icon,
  children,
}: {
  title: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl bg-white p-5 shadow-sm">
      <h2 className="mb-4 flex items-center gap-2 text-base font-semibold text-slate-800">
        {icon && <span className="text-slate-400">{icon}</span>}
        {title}
      </h2>
      {children}
    </div>
  );
}

function InfoCard({
  label,
  value,
  compact = false,
}: {
  label: string;
  value: string;
  compact?: boolean;
}) {
  return (
    <div className={compact ? '' : 'rounded-lg bg-slate-50 px-3 py-2'}>
      <p className="text-xs text-slate-400">{label}</p>
      <p className={`font-medium text-slate-800 ${compact ? 'text-sm' : 'text-sm mt-0.5'}`}>
        {value}
      </p>
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <p className="py-4 text-center text-sm text-slate-400">{message}</p>
  );
}
