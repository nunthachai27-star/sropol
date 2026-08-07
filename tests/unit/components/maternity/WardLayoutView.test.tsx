/* @vitest-environment jsdom */
// Task 24: WardLayoutView component tests — TDD: write tests FIRST
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { WardLayoutView } from '@/components/maternity/WardLayoutView';
import type { BedSlot, BedOccupancy } from '@/types/maternity-ward';

const beds: BedSlot[] = [
  {
    bedno: '02',
    roomno: 'LR1',
    bed_order: 2,
    bed_lock: 'N',
    bed_status_type_id: 1,
    room_name: 'Labor Room 1',
    room_display_number: 1,
  },
  {
    bedno: '01',
    roomno: 'LR1',
    bed_order: 1,
    bed_lock: 'N',
    bed_status_type_id: 1,
    room_name: 'Labor Room 1',
    room_display_number: 1,
  },
  {
    bedno: '05',
    roomno: 'LR2',
    bed_order: 1,
    bed_lock: 'N',
    bed_status_type_id: 1,
    room_name: 'Labor Room 2',
    room_display_number: 2,
  },
];
const occupancy: BedOccupancy[] = [
  {
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
    gravida: 2,
    ga: 38,
    incharge_doctor_name: 'ดร.X',
    last_observation_at: null,
    last_cervix_cm: 4,
  },
];

describe('WardLayoutView', () => {
  it('renders one section per room with room name + bed count', () => {
    render(<WardLayoutView beds={beds} occupancy={occupancy} />);
    expect(screen.getByText('Labor Room 1')).toBeInTheDocument();
    expect(screen.getByText('Labor Room 2')).toBeInTheDocument();
    // Counts: LR1 has 2 beds, LR2 has 1
    expect(screen.getByText(/2 เตียง/)).toBeInTheDocument();
    expect(screen.getByText(/1 เตียง/)).toBeInTheDocument();
  });

  it('orders rooms by room_display_number asc', () => {
    render(<WardLayoutView beds={beds} occupancy={occupancy} />);
    const headers = screen.getAllByRole('heading', { level: 2 });
    expect(headers[0]).toHaveTextContent('Labor Room 1');
    expect(headers[1]).toHaveTextContent('Labor Room 2');
  });

  it('orders beds inside a room by bed_order asc', () => {
    render(<WardLayoutView beds={beds} occupancy={occupancy} />);
    const tiles = screen.getAllByText(/เตียง 0\d/);
    // First two are in LR1: 01 then 02; third is in LR2: 05
    expect(tiles[0]).toHaveTextContent('เตียง 01');
    expect(tiles[1]).toHaveTextContent('เตียง 02');
    expect(tiles[2]).toHaveTextContent('เตียง 05');
  });

  it('marries occupancy to the right bed by bedno', () => {
    render(<WardLayoutView beds={beds} occupancy={occupancy} />);
    // Occupant on bed 01 → name visible (masked for PDPA → "นาง ทดสอบ ร.")
    expect(screen.getByText(/นาง ทดสอบ ร\./)).toBeInTheDocument();
    // Bed 02 is empty
    const empties = screen.getAllByText('ว่าง');
    expect(empties.length).toBeGreaterThan(0);
  });

  it('falls back to "ห้อง {roomno}" when room_name is null', () => {
    const noName: BedSlot[] = [
      {
        bedno: '01',
        roomno: 'X1',
        bed_order: 1,
        bed_lock: 'N',
        bed_status_type_id: null,
        room_name: null,
        room_display_number: 1,
      },
    ];
    render(<WardLayoutView beds={noName} occupancy={[]} />);
    expect(screen.getByText('ห้อง X1')).toBeInTheDocument();
  });

  it('forwards onBedClick to BedTile', () => {
    const onBedClick = vi.fn();
    render(<WardLayoutView beds={beds} occupancy={occupancy} onBedClick={onBedClick} />);
    // Task 52: the DnD wrapper around an occupied tile also exposes role="button"
    // (via @dnd-kit's attributes), so we can no longer rely solely on getByRole.
    // Match the inner BedTile by its aria-label which only the real <button>
    // element carries.
    const button = screen.getByLabelText('เตียง 01');
    button.click();
    expect(onBedClick).toHaveBeenCalledWith('AN1');
  });
});
