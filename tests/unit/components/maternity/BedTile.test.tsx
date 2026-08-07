/* @vitest-environment jsdom */
// Task 23: BedTile component tests — TDD: write tests FIRST
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { BedTile } from '@/components/maternity/BedTile';
import type { BedOccupancy } from '@/types/maternity-ward';

const occupant: BedOccupancy = {
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
  birthday: '1996-04-19', // 30 years old as of 2026-04-19
  gravida: 2,
  ga: 38,
  incharge_doctor_name: 'ดร.สมชาย',
  last_observation_at: '2026-04-19T08:00:00',
  last_cervix_cm: 4,
};

describe('BedTile', () => {
  it('renders empty state when no occupant', () => {
    render(<BedTile bedno="01" bedLock="N" />);
    expect(screen.getByText('ว่าง')).toBeInTheDocument();
    expect(screen.getByText('01')).toBeInTheDocument();
  });

  it('renders locked state with lock indicator', () => {
    render(<BedTile bedno="01" bedLock="Y" />);
    expect(screen.getByText(/ล็อก/)).toBeInTheDocument();
  });

  it('renders occupant details', () => {
    render(<BedTile bedno="01" bedLock="N" occupant={occupant} />);
    // Name is masked for PDPA display: lname collapses to first char + "."
    // (maskName) → "นาง ทดสอบ ร.".
    expect(screen.getByText(/นาง ทดสอบ ร\./)).toBeInTheDocument();
    expect(screen.getByText(/30/)).toBeInTheDocument(); // age
    expect(screen.getByText(/G2/)).toBeInTheDocument();
    expect(screen.getByText(/GA38/)).toBeInTheDocument();
    expect(screen.getByText(/4 ?ซม/)).toBeInTheDocument();
    expect(screen.getByText(/ดร\.สมชาย/)).toBeInTheDocument();
  });

  it('fires onClick(an) only when occupied', () => {
    const onClick = vi.fn();
    const { rerender } = render(
      <BedTile bedno="01" bedLock="N" occupant={occupant} onClick={onClick} />,
    );
    fireEvent.click(screen.getByRole('button', { name: /เตียง 01/i }));
    expect(onClick).toHaveBeenCalledWith('AN1');

    onClick.mockClear();
    rerender(<BedTile bedno="01" bedLock="N" onClick={onClick} />);
    // Empty bed should not have a clickable button (or click does nothing)
    const emptyBtn = screen.queryByRole('button', { name: /เตียง 01/i });
    if (emptyBtn) fireEvent.click(emptyBtn);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('does not fire onClick when locked', () => {
    const onClick = vi.fn();
    render(<BedTile bedno="01" bedLock="Y" onClick={onClick} />);
    const btn = screen.queryByRole('button');
    if (btn) fireEvent.click(btn);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('omits gravida/GA when null', () => {
    const noGA = { ...occupant, gravida: null, ga: null };
    render(<BedTile bedno="01" bedLock="N" occupant={noGA} />);
    expect(screen.queryByText(/^G\d/)).not.toBeInTheDocument();
    expect(screen.queryByText(/GA\d/)).not.toBeInTheDocument();
  });
});
