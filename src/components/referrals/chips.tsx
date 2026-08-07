// Shared referral display chips — status/urgency pills, ANC risk chip, and
// the SLA aging chip. Used by the referrals board page and the detail dialog.
'use client';

import { formatRelativeAge } from '@/lib/relative-time';
import type { ReferralAgeClass } from '@/config/referral-sla';

// Risk chip moved to shared — re-exported so existing imports keep working.
export { AncRiskChip as RiskChip } from '@/components/shared/AncRiskChip';

export interface StatusMeta {
  color: string;
  label: string;
}

export const STATUS_META: Record<string, StatusMeta> = {
  INITIATED: { color: 'var(--ink-navy-dim)', label: 'รอดำเนินการ' },
  ACCEPTED: { color: 'var(--risk-low)', label: 'ตอบรับ' },
  IN_TRANSIT: { color: 'var(--risk-medium)', label: 'กำลังเดินทาง' },
  ARRIVED: { color: 'var(--accent-navy)', label: 'ถึงแล้ว' },
  REJECTED: { color: 'var(--risk-high)', label: 'ปฏิเสธ' },
  EXPIRED: { color: 'var(--ink-navy-muted)', label: 'หมดอายุ' },
};

export const URGENCY_META: Record<string, StatusMeta> = {
  ROUTINE: { color: 'var(--ink-navy-muted)', label: 'ปกติ' },
  URGENT: { color: 'var(--risk-medium)', label: 'เร่งด่วน' },
  EMERGENCY: { color: 'var(--risk-high)', label: 'ฉุกเฉิน' },
};

export const AGE_META: Record<Exclude<ReferralAgeClass, 'fresh'>, StatusMeta> = {
  overdue: { color: 'var(--risk-medium)', label: 'ค้าง' },
  critical: { color: 'var(--risk-high)', label: 'ค้าง' },
};

export function Pill({ meta, fallback }: { meta: StatusMeta | undefined; fallback: string }) {
  const m = meta ?? { color: 'var(--ink-navy-muted)', label: fallback };
  return (
    <span
      className="inline-block border px-1.5 py-0.5 text-center font-mono text-[12px] font-semibold tracking-[0.06em]"
      style={{ color: m.color, borderColor: m.color, background: 'transparent' }}
    >
      {m.label}
    </span>
  );
}

/** Aging chip for INITIATED rows past SLA — "ค้าง 3 วัน" in amber/red. */
export function AgeChip({ age, initiatedAt }: { age: ReferralAgeClass; initiatedAt: string }) {
  if (age === 'fresh') return null;
  const m = AGE_META[age];
  return (
    <span
      className="inline-block border px-1 py-px font-mono text-[12px] font-semibold tracking-[0.04em]"
      style={{ color: m.color, borderColor: m.color }}
    >
      {m.label} {formatRelativeAge(initiatedAt, 'th')}
    </span>
  );
}
