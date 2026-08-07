// Journey detail page — behavior tests for the 2026-07-09 redesign:
// HOSxP sync freshness stamp, labor-admission cross-link, Thai risk-rule
// labels (instead of raw rule IDs), and the high-risk history panel.
import { describe, it, expect, vi } from 'vitest';
import { render, screen, within, act } from '@testing-library/react';
import { Suspense } from 'react';
import { SWRConfig } from 'swr';
import JourneyDetailPage from '@/app/(provincial)/pregnancies/[journeyId]/page';
import { ANC_RISK_RULES } from '@/config/anc-risk-rules';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({}),
}));
vi.mock('@/hooks/useSSE', () => ({ useSSE: vi.fn() }));

const HOURS = 3600_000;

const fixture = {
  journey: {
    id: 'j-detail-1',
    hn: 'HN001',
    name: 'นาง ใจดี ทดสอบ',
    age: 32,
    gravida: 2,
    para: 1,
    gaWeeks: 39,
    lmp: null,
    edc: new Date(Date.now() + 7 * 24 * HOURS).toISOString(),
    careStage: 'LABOR',
    ancRiskLevel: 'HR2',
    ancVisitCount: 6,
    lastAncDate: new Date(Date.now() - 10 * 24 * HOURS).toISOString(),
    hospitalName: 'รพ.พล',
    hcode: '10995',
    registeredAt: new Date(Date.now() - 200 * 24 * HOURS).toISOString(),
    currentHospitalName: 'รพ.ขอนแก่น',
    currentHcode: '10670',
    heightCm: 158,
    bloodGroup: 'O',
    rhFactor: 'POS',
    hbsagResult: 'NEG',
    vdrlResult: 'NEG',
    hivResult: 'NEG',
    ogttResult: null,
    termBirths: 1,
    pretermBirths: 0,
    abortions: 0,
    livingChildren: 1,
    pastMedicalHistory: null,
    mcvFl: null,
    dcipResult: null,
    hbEResult: null,
    thalassemiaType: null,
    cervicalScreenType: null,
    cervicalScreenResult: null,
    cervicalScreenDate: null,
    aneuploidyMethod: null,
    aneuploidyResult: null,
    gbsResult: null,
    gbsCollectedDate: null,
    anatomyScanDate: null,
    anatomyScanResult: null,
    efwG: null,
    datingMethod: null,
    proteinuria24hMg: 350,
    creatinineMgDl: null,
    priorPeDvt: true,
    severeLungDisease: null,
    alloimmunizationCde: null,
    bariatricSurgeryHx: null,
    teratogenExposure: null,
    congenitalInfection: null,
    gdmRiskFactors: ['obesity'],
    syncedAt: new Date(Date.now() - 10 * 60_000).toISOString(),
  },
  ancVisits: [],
  latestRisk: {
    riskLevel: 'HR2',
    triggeredRules: ['hr1_previous_lbw'],
    screenedAt: new Date(Date.now() - 30 * 24 * HOURS).toISOString(),
    recommendedFacility: null,
  },
  referrals: [],
  newborns: [],
  laborAdmission: {
    an: '69000123',
    hcode: '10670',
    laborStatus: 'ACTIVE',
    admitDate: new Date(Date.now() - 6 * HOURS).toISOString(),
  },
};

async function renderPage() {
  await act(async () => {
    render(
      <SWRConfig
        value={{
          fetcher: async (_url: string) => fixture,
          provider: () => new Map(),
          dedupingInterval: 0,
        }}
      >
        <Suspense fallback={null}>
          <JourneyDetailPage params={Promise.resolve({ journeyId: 'j-detail-1' })} />
        </Suspense>
      </SWRConfig>,
    );
  });
}

// WHO containment T1 — unknown-state observation severities. Missing
// clinical data must be a distinct "unknown" state: never the green OK
// badge, and a known abnormal finding (BP sys 200) must still flag red
// even when its sibling (diastolic) is missing.
const baseVisit = {
  hospitalName: 'รพ.พล',
  hcode: '10995',
  fundalHeightCm: null,
  weightKg: null,
  presentation: null,
  engagement: null,
  passQuality: null,
  urineProtein: null,
  urineGlucose: null,
  hctPct: null,
  ttDoseNo: null,
  ironFolicGiven: null,
  calciumGiven: null,
  dangerSigns: null,
};

const visitAllNull = {
  ...baseVisit,
  visitDate: new Date(Date.now() - 30 * 24 * HOURS).toISOString(),
  visitNumber: 1,
  gaWeeks: 12,
  bpSystolic: null,
  bpDiastolic: null,
  fetalHr: null,
  hbGDl: null,
  fetalMovementOk: null,
};

const visitBpAbnormalPartial = {
  ...baseVisit,
  visitDate: new Date(Date.now() - 10 * 24 * HOURS).toISOString(),
  visitNumber: 2,
  gaWeeks: 20,
  bpSystolic: 200,
  bpDiastolic: null,
  fetalHr: 140,
  hbGDl: 12,
  fetalMovementOk: true,
};

const fixtureWithVisits = {
  ...fixture,
  ancVisits: [visitAllNull, visitBpAbnormalPartial],
};

async function renderPageWithVisits() {
  await act(async () => {
    render(
      <SWRConfig
        value={{
          fetcher: async (_url: string) => fixtureWithVisits,
          provider: () => new Map(),
          dedupingInterval: 0,
        }}
      >
        <Suspense fallback={null}>
          <JourneyDetailPage params={Promise.resolve({ journeyId: 'j-detail-1' })} />
        </Suspense>
      </SWRConfig>,
    );
  });
}

describe('JourneyDetailPage — redesign', () => {
  it('shows the HOSxP sync freshness stamp', async () => {
    await renderPage();
    expect(await screen.findByTestId('sync-stamp')).toBeInTheDocument();
    expect(screen.getByText(/ข้อมูลจาก HOSxP/)).toBeInTheDocument();
  });

  it('cross-links to the labor admission when one exists', async () => {
    await renderPage();
    const link = await screen.findByTestId('labor-admission-link');
    expect(link.getAttribute('href')).toBe('/patients/10670-69000123');
  });

  it('renders triggered risk rules as Thai labels, not raw rule IDs', async () => {
    await renderPage();
    const rule = ANC_RISK_RULES.find((r) => r.id === 'hr1_previous_lbw')!;
    expect((await screen.findAllByText(rule.labelTh)).length).toBeGreaterThan(0);
    expect(screen.queryByText('hr1_previous_lbw')).toBeNull();
  });

  it('surfaces the high-risk history panel (PE/DVT, proteinuria, GDM factors)', async () => {
    await renderPage();
    const panel = await screen.findByTestId('high-risk-history');
    expect(within(panel).getByText(/PE\/DVT/)).toBeInTheDocument();
    expect(within(panel).getByText(/350/)).toBeInTheDocument();
    expect(within(panel).getByText(/obesity/)).toBeInTheDocument();
  });
});

describe('JourneyDetailPage — unknown-state observation severities (WHO containment T1)', () => {
  it('never shows the green OK badge for a visit whose clinical fields are all missing, and shows the not-fully-recorded badge instead', async () => {
    await renderPageWithVisits();
    // "OK" only ever appears as the fully-known-good visit badge on this
    // page; asserting its total absence proves the all-null visit did not
    // fall through to the green check.
    expect(screen.queryByText('OK')).toBeNull();
    expect(await screen.findByText('ไม่ได้บันทึกครบ')).toBeInTheDocument();
  });

  it('still fires the red BP-high flag when systolic is abnormal even though diastolic is missing', async () => {
    await renderPageWithVisits();
    expect(await screen.findByText('BP HIGH')).toBeInTheDocument();
  });
});

// WHO containment T2 — unknown-GA schedule semantics. `nextContactDue`
// previously returned `null` for both "GA unknown" and "genuinely complete"
// (all 8 WHO contacts attended), so the page rendered the same green "8
// contacts complete" copy for both — hiding the fact that a patient with no
// recorded GA cannot have their schedule evaluated at all.
const contactVisit = (gaWeeks: number, visitNumber: number) => ({
  ...baseVisit,
  visitDate: new Date(Date.now() - (400 - gaWeeks) * 24 * HOURS).toISOString(),
  visitNumber,
  gaWeeks,
  bpSystolic: 110,
  bpDiastolic: 70,
  fetalHr: 140,
  hbGDl: 12,
  fetalMovementOk: true,
});

// All 8 WHO_CONTACT_WEEKS attended — same visit history used for both the
// "GA unknown" and "GA known" fixtures below, so the only variable is
// journey.gaWeeks (the *current* GA the schedule is evaluated against).
const allEightContactsVisits = [12, 20, 26, 30, 34, 36, 38, 40].map((w, i) =>
  contactVisit(w, i + 1),
);

const fixtureUnknownGaAllAttended = {
  ...fixture,
  journey: { ...fixture.journey, gaWeeks: null },
  ancVisits: allEightContactsVisits,
};

const fixtureKnownGaAllAttended = {
  ...fixture,
  journey: { ...fixture.journey, gaWeeks: 41 },
  ancVisits: allEightContactsVisits,
};

async function renderPageWithFixture<T>(f: T) {
  await act(async () => {
    render(
      <SWRConfig
        value={{
          fetcher: async (_url: string) => f,
          provider: () => new Map(),
          dedupingInterval: 0,
        }}
      >
        <Suspense fallback={null}>
          <JourneyDetailPage params={Promise.resolve({ journeyId: 'j-detail-1' })} />
        </Suspense>
      </SWRConfig>,
    );
  });
}

describe('JourneyDetailPage — unknown-GA schedule semantics (WHO containment T2)', () => {
  it('never renders "8 contacts complete" when current GA is unknown, and shows the unknown-GA caveat instead', async () => {
    await renderPageWithFixture(fixtureUnknownGaAllAttended);
    expect((await screen.findAllByText(/ไม่ทราบอายุครรภ์/)).length).toBeGreaterThan(0);
    expect(screen.queryByText('ครบ 8 contact')).toBeNull();
    expect(screen.queryByText('ครบทั้ง 8 contact แล้ว')).toBeNull();
  });

  it('still renders the green "8 contacts complete" copy when GA is known and the schedule is genuinely complete', async () => {
    await renderPageWithFixture(fixtureKnownGaAllAttended);
    expect(await screen.findByText('ครบทั้ง 8 contact แล้ว')).toBeInTheDocument();
    expect(screen.getByText('ครบ 8 contact')).toBeInTheDocument();
    expect(screen.queryByText(/ไม่ทราบอายุครรภ์/)).toBeNull();
  });
});

// WHO containment T6 — spec containment item 5: an incomplete LOW assessment
// must never display as a bare confirmed-LOW chip. T3 persists
// {missingRequired, assessmentIncomplete} into cached_anc_risks.risk_factors
// on the polling path; the journey-detail API surfaces it as
// journey.ancAssessment, and this page must render an amber marker beside
// the risk chip whenever ancAssessment.incomplete is true.
describe('JourneyDetailPage — assessment-completeness marker (WHO containment T6)', () => {
  const incompleteMarkerText = /การประเมินความเสี่ยงไม่สมบูรณ์ \(ขาดข้อมูล 2 รายการ\)/;

  const fixtureIncomplete = {
    ...fixture,
    journey: { ...fixture.journey, ancRiskLevel: 'LOW' },
    latestRisk: { ...fixture.latestRisk, riskLevel: 'LOW' },
    ancAssessment: { incomplete: true, missingRequired: ['bpSystolic', 'hb'] },
  };

  const fixtureComplete = {
    ...fixture,
    journey: { ...fixture.journey, ancRiskLevel: 'LOW' },
    latestRisk: { ...fixture.latestRisk, riskLevel: 'LOW' },
    ancAssessment: { incomplete: false, missingRequired: [] },
  };

  const fixtureNullAssessment = {
    ...fixture,
    journey: { ...fixture.journey, ancRiskLevel: 'LOW' },
    latestRisk: { ...fixture.latestRisk, riskLevel: 'LOW' },
    ancAssessment: null,
  };

  it('renders the amber incomplete marker beside the risk chip when ancAssessment.incomplete is true', async () => {
    await renderPageWithFixture(fixtureIncomplete);
    expect((await screen.findAllByText(incompleteMarkerText)).length).toBeGreaterThan(0);
  });

  it('never renders the marker when ancAssessment.incomplete is false', async () => {
    await renderPageWithFixture(fixtureComplete);
    // Wait for the page to finish rendering before asserting absence.
    await screen.findByText('LOW');
    expect(screen.queryByText(/การประเมินความเสี่ยงไม่สมบูรณ์/)).toBeNull();
  });

  it('never renders the marker when ancAssessment is null (e.g. webhook-sourced screening)', async () => {
    await renderPageWithFixture(fixtureNullAssessment);
    await screen.findByText('LOW');
    expect(screen.queryByText(/การประเมินความเสี่ยงไม่สมบูรณ์/)).toBeNull();
  });
});
