// ReferralDetailDialog — fetches one referral and shows lifecycle milestones,
// masked patient identity, and rejection context.
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SWRConfig } from 'swr';
import type { ReferralDetail, ReferralDetailResponse } from '@/types/api';
import { ReferralDetailDialog } from '@/components/referrals/ReferralDetailDialog';

const HOURS = 3600_000;

function iso(msAgo: number): string {
  return new Date(Date.now() - msAgo).toISOString();
}

function makeDetail(overrides: Partial<ReferralDetail> = {}): ReferralDetail {
  return {
    id: 'ref-1',
    journeyId: 'journey-9',
    referNumber: 'REF-2569-042',
    fromHospital: 'รพ.พล',
    toHospital: 'รพ.ขอนแก่น',
    status: 'IN_TRANSIT',
    reason: 'ตกเลือดหลังคลอด',
    diagnosisCode: 'O72.1',
    urgencyLevel: 'EMERGENCY',
    initiatedAt: iso(6 * HOURS),
    arrivedAt: null,
    patientName: 'นาง สายฝน อุ่นเรือน',
    hn: 'HN777001',
    gaWeeks: 38,
    ancRiskLevel: 'HR3',
    rejectionReason: null,
    transportMode: 'AMBULANCE',
    acceptedAt: iso(5 * HOURS),
    departedAt: iso(4 * HOURS),
    rejectedAt: null,
    suggestedAlternativeHospital: null,
    ...overrides,
  };
}

function renderDialog(detail: ReferralDetail) {
  const response: ReferralDetailResponse = { referral: detail };
  const fetcher = vi.fn(async () => response);
  return render(
    <SWRConfig value={{ fetcher, provider: () => new Map(), dedupingInterval: 0 }}>
      <ReferralDetailDialog referralId={detail.id} onClose={() => {}} />
    </SWRConfig>,
  );
}

describe('ReferralDetailDialog', () => {
  it('shows masked patient identity, refer number, and a link to the journey', async () => {
    renderDialog(makeDetail());

    expect(await screen.findByText('REF-2569-042')).toBeInTheDocument();
    expect(screen.getByText(/นาง สายฝน อ\./)).toBeInTheDocument();
    // Full last name must never reach the DOM (PDPA display masking).
    expect(screen.queryByText(/อุ่นเรือน/)).toBeNull();
    expect(screen.getByText(/HN777001/)).toBeInTheDocument();
    expect(screen.getByText(/GA 38/)).toBeInTheDocument();

    const journeyLink = screen.getByRole('link', { name: /ดูประวัติผู้ป่วย/ });
    expect(journeyLink.getAttribute('href')).toBe('/pregnancies/journey-9');
  });

  it('shows completed milestones with timestamps and pending ones as dashes', async () => {
    renderDialog(makeDetail());

    const initiated = await screen.findByTestId('milestone-initiated');
    expect(initiated.getAttribute('data-state')).toBe('done');
    expect(screen.getByTestId('milestone-accepted').getAttribute('data-state')).toBe('done');
    const departed = screen.getByTestId('milestone-departed');
    expect(departed.getAttribute('data-state')).toBe('done');
    // Transport mode is labeled on the departed milestone.
    expect(screen.getByText(/รถพยาบาล/)).toBeInTheDocument();
    expect(screen.getByTestId('milestone-arrived').getAttribute('data-state')).toBe('pending');
  });

  it('shows rejection reason and suggested alternative for rejected referrals', async () => {
    renderDialog(
      makeDetail({
        status: 'REJECTED',
        acceptedAt: null,
        departedAt: null,
        transportMode: null,
        rejectedAt: iso(3 * HOURS),
        rejectionReason: 'ICU เต็ม',
        suggestedAlternativeHospital: 'รพ.สิรินธร จังหวัดขอนแก่น',
      }),
    );

    const rejected = await screen.findByTestId('milestone-rejected');
    expect(rejected.getAttribute('data-state')).toBe('done');
    expect(screen.getByText(/ICU เต็ม/)).toBeInTheDocument();
    expect(screen.getByText(/รพ.สิรินธร จังหวัดขอนแก่น/)).toBeInTheDocument();
  });
});
