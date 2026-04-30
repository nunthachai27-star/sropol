/* @vitest-environment jsdom */
import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

import { BedTileFull } from '@/components/maternity/BedTileFull';
import type { BedOccupancyFull } from '@/types/maternity-ward';

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

    expect(screen.getByText(/นาง ทดสอบ ระบบ|ทดสอบ ระบบ/)).toBeInTheDocument();
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
});
