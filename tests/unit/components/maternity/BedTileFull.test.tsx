/* @vitest-environment jsdom */
import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

import { BedTileFull } from '@/components/maternity/BedTileFull';
import type { BedOccupancyFull } from '@/types/maternity-ward';
import type { MaternalScreenSummaryItem } from '@/types/api';
import { assertNoGreenInTree } from '../../../helpers/assertNoGreen';

// Forbidden green tokens — mirrors tests/unit/components/MaternalScreenCell.test.tsx
// and tests/unit/config/maternal-screen-display.test.ts (GC-U1 regression lock);
// shared scan now lives in tests/helpers/assertNoGreen.ts (rgb()-aware, Phase 6 M1).

const now = new Date('2026-04-19T14:00:00').getTime();

const occupant: BedOccupancyFull = {
  an: 'AN1',
  hn: 'HN1',
  regdate: '2026-04-19',
  regtime: '10:00:00',
  ward: '03',
  bedno: '01',
  roomno: 'LR1',
  bedtype: null,
  roomname: 'LR1',
  pname: 'นาง',
  fname: 'ทดสอบ',
  lname: 'ระบบ',
  birthday: '1996-04-19',
  blood_grp: 'O',
  allergy_count: 1,
  pttype_name: 'ประกันสุขภาพถ้วนหน้า',
  prediag: 'เจ็บครรภ์คลอด',
  admit_bw_kg: 58,
  patient_height: 160,
  gravida: 2,
  ga: 38,
  incharge_doctor_name: 'ดร.X',
  last_observation_at: '2026-04-19T11:30:00',
  last_cervix_cm: 4,
  last_station: '-1',
  last_fhr: 142,
  last_contr_freq: 3,
  last_contr_duration: 45,
  last_contr_strength: 'moderate',
  last_oxytocin_uml: 4,
  last_oxytocin_drops: 12,
  last_iv_fluids: 'RLS',
  last_amniotic: 'clear',
  last_bp_sys: 120,
  last_bp_dia: 80,
  last_temp: 37.2,
  last_pulse: 88,
  last_rr: 20,
  last_spo2: 98,
  last_spo2_o2: 99,
  last_weight: 59,
  last_height: 161,
  last_bsa: 1.62,
  last_pain: 6,
  last_assess_date: '2026-04-19',
  last_assess_time: '11:30:00',
  last_assess_staff: 'nurse1',
};

describe('BedTileFull', () => {
  it('renders HOSxP admit context, latest vitals, and labour data on the ward bed card', () => {
    render(<BedTileFull bedno="01" bedLock="N" occupant={occupant} now={now} />);

    // Name is masked for PDPA display (maskName) → "นาง ทดสอบ ร.".
    expect(screen.getByText(/นาง ทดสอบ ร\./)).toBeInTheDocument();
    expect(screen.getByText('AN1')).toBeInTheDocument();
    expect(screen.getByText('HN1')).toBeInTheDocument();
    expect(screen.getByText('Allergy')).toBeInTheDocument();
    expect(screen.getByText('O')).toBeInTheDocument();
    expect(screen.getByText('ดร.X')).toBeInTheDocument();
    expect(screen.getByText('ประกันสุขภาพถ้วนหน้า')).toBeInTheDocument();
    expect(screen.getByText('BW 59 kg · Ht 161 cm · BSA 1.62')).toBeInTheDocument();
    expect(screen.getByText('เจ็บครรภ์คลอด')).toBeInTheDocument();
    expect(screen.getByText('120/80')).toBeInTheDocument();
    expect(screen.getByText('37.2')).toBeInTheDocument();
    expect(screen.getByText('98')).toBeInTheDocument();
    expect(screen.getByText('99')).toBeInTheDocument();
    expect(screen.getByText('142')).toBeInTheDocument();
  });

  it('fires onClick with AN when an occupied bed card is clicked', () => {
    const onClick = vi.fn();
    render(<BedTileFull bedno="01" bedLock="N" occupant={occupant} now={now} onClick={onClick} />);
    fireEvent.click(screen.getByTestId('bed-01'));
    expect(onClick).toHaveBeenCalledWith('AN1');
  });

  it('shows the patient-photo placeholder (no fetch) when rendered without a BMS session', () => {
    // config is omitted here (as in the ward page before a session is ready),
    // so PatientPhoto renders its neutral placeholder rather than fetching.
    render(<BedTileFull bedno="01" bedLock="N" occupant={occupant} now={now} />);
    expect(screen.getByTestId('patient-photo-placeholder')).toBeInTheDocument();
  });
});

// Phase 6 Task H4 — cross-source maternal-screen pills
// (docs/superpowers/plans/2026-07-17-maternal-screening-hosxp.md GC-H3/GC-H4).
describe('BedTileFull — maternal-screen pills (Task H4)', () => {
  const severeSummary: MaternalScreenSummaryItem = {
    an: 'AN1',
    localTier: 'LOCAL_SEVERE',
    emergencyAcuity: 'EMERGENCY',
    isComplete: true,
    assessedAt: '2026-04-19T13:30:00',
  };

  it('renders both pills with the correct testid + inline light-token colors for a severe summary', () => {
    render(
      <BedTileFull
        bedno="01"
        bedLock="N"
        occupant={occupant}
        now={now}
        maternalScreenSummary={severeSummary}
      />,
    );
    const wrap = screen.getByTestId('bed-maternal-screen');
    expect(wrap).toBeInTheDocument();
    expect(wrap.getAttribute('title')).toBe('การคัดกรองท้องถิ่น (โหมดเงา — ยังไม่ได้รับการรับรอง)');
    // Thai short labels from the display-config Records.
    expect(screen.getByText('ระดับรุนแรง (ท้องถิ่น)')).toBeInTheDocument();
    expect(screen.getByText('ฉุกเฉิน')).toBeInTheDocument();
    // Both pills use the light `var(--risk-high)` token (LOCAL_SEVERE / EMERGENCY).
    const pills = wrap.querySelectorAll('span[style]');
    const styles = Array.from(pills).map((p) => p.getAttribute('style') ?? '');
    expect(styles.filter((s) => s.includes('var(--risk-high)')).length).toBeGreaterThanOrEqual(2);
  });

  it('renders zero DOM for the maternal-screen slot when no summary is supplied — rest of the tile unchanged', () => {
    render(<BedTileFull bedno="01" bedLock="N" occupant={occupant} now={now} />);
    expect(screen.queryByTestId('bed-maternal-screen')).not.toBeInTheDocument();
    // Existing identity-row pills (Allergy/blood group) and core fields still render.
    expect(screen.getByText('Allergy')).toBeInTheDocument();
    expect(screen.getByText('O')).toBeInTheDocument();
    expect(screen.getByText('AN1')).toBeInTheDocument();
    expect(screen.getByTestId('bed-01')).toBeInTheDocument();
  });

  it('renders zero DOM for the maternal-screen slot when the summary has both axes null', () => {
    render(
      <BedTileFull
        bedno="01"
        bedLock="N"
        occupant={occupant}
        now={now}
        maternalScreenSummary={{
          an: 'AN1',
          localTier: null,
          emergencyAcuity: null,
          isComplete: null,
          assessedAt: null,
        }}
      />,
    );
    expect(screen.queryByTestId('bed-maternal-screen')).not.toBeInTheDocument();
  });

  it('renders only the tier pill when acuity is null', () => {
    render(
      <BedTileFull
        bedno="01"
        bedLock="N"
        occupant={occupant}
        now={now}
        maternalScreenSummary={{
          an: 'AN1',
          localTier: 'LOCAL_MILD',
          emergencyAcuity: null,
          isComplete: null,
          assessedAt: null,
        }}
      />,
    );
    expect(screen.getByText('ระดับเฝ้าระวัง (ท้องถิ่น)')).toBeInTheDocument();
    expect(screen.queryByText('คงที่ (โหมดเงา)')).not.toBeInTheDocument();
  });

  it('no-green scan: STABLE/NO_LOCAL_MATCH renders muted tokens, never green, anywhere in the tile', () => {
    const { container } = render(
      <BedTileFull
        bedno="01"
        bedLock="N"
        occupant={occupant}
        now={now}
        maternalScreenSummary={{
          an: 'AN1',
          localTier: 'NO_LOCAL_MATCH',
          emergencyAcuity: 'STABLE',
          isComplete: true,
          assessedAt: null,
        }}
      />,
    );
    const wrap = screen.getByTestId('bed-maternal-screen');
    const pills = wrap.querySelectorAll('span[style]');
    const styles = Array.from(pills).map((p) => p.getAttribute('style') ?? '');
    expect(styles.some((s) => s.includes('var(--ink-navy-muted)'))).toBe(true);
    assertNoGreenInTree(container);
  });

  it('an EMERGENCY summary on a non-crit occupant does NOT alter the tile-level border/shadow (GC-H3 red is reserved for the crit alarm)', () => {
    render(
      <BedTileFull
        bedno="01"
        bedLock="N"
        occupant={occupant}
        now={now}
        maternalScreenSummary={severeSummary}
      />,
    );
    const article = screen.getByTestId('bed-01');
    // Non-crit article border/shadow, exactly as classify() would produce
    // with no maternalScreenSummary at all (occupant is Stage I Active, not crit).
    // jsdom normalizes hex to rgb() when serializing the style attribute.
    expect(article.style.border).toBe('1.5px solid rgb(203, 213, 225)');
    expect(article.style.boxShadow).toBe('0 1px 3px rgba(15, 23, 42, 0.06)');
  });
});
