// Referral detail dialog — full lifecycle timeline + patient context for one
// referral, fetched from /api/dashboard/referrals/[id]. Opened by clicking a
// row on the referrals board.
'use client';

import useSWR from 'swr';
import Link from 'next/link';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { LoadingState } from '@/components/shared/LoadingState';
import { ErrorState } from '@/components/shared/ErrorState';
import { formatThaiDate, formatThaiTime } from '@/lib/utils';
import { maskName } from '@/lib/pii-mask';
import { Pill, RiskChip, STATUS_META, URGENCY_META } from '@/components/referrals/chips';
import { ExternalLink } from 'lucide-react';
import type { ReferralDetail, ReferralDetailResponse } from '@/types/api';

const TRANSPORT_LABEL_TH: Record<string, string> = {
  AMBULANCE: 'รถพยาบาล',
  HELICOPTER: 'เฮลิคอปเตอร์',
  PRIVATE_CAR: 'รถส่วนตัว',
};

interface Milestone {
  key: string;
  label: string;
  at: string | null;
  detail?: string | null;
}

/** The lifecycle path depends on the outcome: rejected referrals show
 *  initiated → rejected; everything else shows the full transfer chain. */
function buildMilestones(r: ReferralDetail): Milestone[] {
  if (r.status === 'REJECTED') {
    return [
      { key: 'initiated', label: 'ส่งคำขอ', at: r.initiatedAt },
      { key: 'rejected', label: 'ปฏิเสธ', at: r.rejectedAt, detail: r.rejectionReason },
    ];
  }
  return [
    { key: 'initiated', label: 'ส่งคำขอ', at: r.initiatedAt },
    { key: 'accepted', label: 'ตอบรับ', at: r.acceptedAt },
    {
      key: 'departed',
      label: 'ออกเดินทาง',
      at: r.departedAt,
      detail: r.transportMode ? (TRANSPORT_LABEL_TH[r.transportMode] ?? r.transportMode) : null,
    },
    { key: 'arrived', label: 'ถึงปลายทาง', at: r.arrivedAt },
  ];
}

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <div className="font-mono text-[12px] uppercase tracking-[0.14em] text-[var(--ink-navy-muted)]">
      {children}
    </div>
  );
}

export function ReferralDetailDialog({
  referralId,
  onClose,
}: {
  referralId: string | null;
  onClose: () => void;
}) {
  const { data, error, isLoading, mutate } = useSWR<ReferralDetailResponse>(
    referralId ? `/api/dashboard/referrals/${referralId}` : null,
  );
  const referral = data?.referral;

  return (
    <Dialog open={referralId !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg" style={{ color: 'var(--ink-navy)' }}>
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2 text-[17px]">
            รายละเอียดการส่งต่อ
            {referral?.referNumber && (
              <span className="font-mono text-[14px] font-normal text-[var(--ink-navy-dim)]">
                {referral.referNumber}
              </span>
            )}
          </DialogTitle>
        </DialogHeader>

        {isLoading && <LoadingState message="กำลังโหลดรายละเอียด..." />}

        {error && !referral && (
          <ErrorState
            message="โหลดรายละเอียดไม่สำเร็จ กรุณาลองใหม่"
            detail={error instanceof Error ? error.message : String(error)}
            onRetry={() => mutate()}
          />
        )}

        {referral && (
          <div className="space-y-4">
            <div className="flex items-center gap-1.5">
              <Pill meta={STATUS_META[referral.status]} fallback={referral.status} />
              <Pill meta={URGENCY_META[referral.urgencyLevel]} fallback={referral.urgencyLevel} />
            </div>

            {/* Patient */}
            <div>
              <SectionHeading>PATIENT</SectionHeading>
              <div className="mt-1 flex items-center gap-1.5">
                <span className="text-[16px] font-medium">{maskName(referral.patientName)}</span>
                <RiskChip level={referral.ancRiskLevel} />
              </div>
              <div className="font-mono text-[13px] text-[var(--ink-navy-muted)]">
                HN {referral.hn || '—'}
                {referral.gaWeeks != null && <> · GA {referral.gaWeeks}</>}
              </div>
              <Link
                href={`/pregnancies/${referral.journeyId}`}
                className="mt-1 inline-flex items-center gap-1 font-mono text-[13px] text-[var(--accent-navy)] hover:underline"
              >
                <ExternalLink className="h-3 w-3" />
                ดูประวัติผู้ป่วย
              </Link>
            </div>

            {/* Route */}
            <div>
              <SectionHeading>ROUTE</SectionHeading>
              <div className="mt-1 text-[15px]">
                {referral.fromHospital}
                <span className="mx-1.5 text-[var(--ink-navy-muted)]">→</span>
                <span className="font-medium">{referral.toHospital}</span>
              </div>
              {referral.suggestedAlternativeHospital && (
                <div className="mt-0.5 text-[14px] text-[var(--ink-navy-dim)]">
                  แนะนำส่งต่อ: {referral.suggestedAlternativeHospital}
                </div>
              )}
            </div>

            {/* Clinical */}
            <div>
              <SectionHeading>REASON / DX</SectionHeading>
              <div className="mt-1 text-[15px]">{referral.reason || '—'}</div>
              {referral.diagnosisCode && (
                <div className="font-mono text-[13px] text-[var(--ink-navy-dim)]">
                  ICD-10: {referral.diagnosisCode}
                </div>
              )}
            </div>

            {/* Timeline */}
            <div>
              <SectionHeading>TIMELINE</SectionHeading>
              <div className="mt-2 space-y-0">
                {buildMilestones(referral).map((m, i, all) => {
                  const done = m.at !== null;
                  return (
                    <div
                      key={m.key}
                      data-testid={`milestone-${m.key}`}
                      data-state={done ? 'done' : 'pending'}
                      className="relative flex gap-3 pb-3 last:pb-0"
                    >
                      {/* Rail */}
                      {i < all.length - 1 && (
                        <span
                          aria-hidden
                          className="absolute left-[5px] top-3 h-full w-px"
                          style={{ background: 'var(--rule-strong)' }}
                        />
                      )}
                      <span
                        aria-hidden
                        className="relative mt-1 inline-block h-[11px] w-[11px] shrink-0 rounded-full border-2"
                        style={{
                          borderColor: done ? 'var(--accent-navy)' : 'var(--rule-strong)',
                          background: done ? 'var(--accent-navy)' : 'white',
                        }}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline justify-between gap-2">
                          <span
                            className={
                              done
                                ? 'text-[15px] font-medium'
                                : 'text-[15px] text-[var(--ink-navy-muted)]'
                            }
                          >
                            {m.label}
                          </span>
                          <span className="font-mono text-[13px] tabular-nums text-[var(--ink-navy-dim)]">
                            {m.at ? `${formatThaiDate(m.at)} ${formatThaiTime(m.at)}` : '—'}
                          </span>
                        </div>
                        {m.detail && (
                          <div className="text-[14px] text-[var(--ink-navy-dim)]">{m.detail}</div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
