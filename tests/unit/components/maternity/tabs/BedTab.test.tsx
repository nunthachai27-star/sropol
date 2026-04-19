/* @vitest-environment jsdom */
/* @vitest-environment-options { "url": "http://localhost/" } */
// Task 38: BedTab read-only — TDD: write tests FIRST. BedTab takes the
// already-loaded BedOccupancy directly (no extra fetch needed).
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';

import { BedTab } from '@/components/maternity/tabs/BedTab';
import type { BedOccupancy } from '@/types/maternity-ward';

const baseOccupant: BedOccupancy = {
  an: 'AN1',
  hn: 'HN1',
  regdate: '2026-04-19',
  regtime: '10:00:00',
  ward: '03',
  bedno: '07',
  roomno: 'LR1',
  bedtype: 'Labor',
  roomname: 'ห้องคลอด 1',
  pname: null,
  fname: null,
  lname: null,
  birthday: null,
  gravida: null,
  ga: null,
  incharge_doctor_name: null,
  last_observation_at: null,
  last_cervix_cm: null,
};

describe('BedTab', () => {
  it('renders fields when occupant present', () => {
    render(<BedTab occupant={baseOccupant} />);
    expect(screen.getByText('07')).toBeInTheDocument();
    expect(screen.getByText(/LR1/)).toBeInTheDocument();
    expect(screen.getByText(/ห้องคลอด 1/)).toBeInTheDocument();
    expect(screen.getByText('Labor')).toBeInTheDocument();
    expect(screen.getByText(/2026-04-19/)).toBeInTheDocument();
  });

  it('shows ไม่พบข้อมูล when occupant is null', () => {
    render(<BedTab occupant={null} />);
    expect(screen.getByText(/ไม่พบข้อมูล/)).toBeInTheDocument();
  });

  it('handles null roomname gracefully (falls back to roomno only)', () => {
    render(<BedTab occupant={{ ...baseOccupant, roomname: null }} />);
    expect(screen.getByText('LR1')).toBeInTheDocument();
  });
});
