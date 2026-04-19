/* @vitest-environment jsdom */
// Task 56: Keyboard accessibility for drag-drop. @dnd-kit's KeyboardSensor
// makes each draggable focusable + activatable via Space/Enter, with arrow
// keys to move. We verify two signals that prove the sensor is wired:
//   1. The draggable carries the ARIA attributes dnd-kit injects on every
//      draggable (role="button", aria-roledescription="draggable",
//      tabindex="0") — sanity that useDraggable is mounted.
//   2. KeyboardSensor + sortableKeyboardCoordinates is registered in the
//      DndContext. We spy on `useSensors` to confirm both PointerSensor and
//      KeyboardSensor show up — full keyboard simulation is too brittle in
//      jsdom (its synthetic keyboard events don't propagate the way @dnd-kit
//      expects when navigating between collision-detected drop zones).
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { KeyboardSensor, PointerSensor, useSensors } from '@dnd-kit/core';
import { WardLayoutView } from '@/components/maternity/WardLayoutView';
import type { BedSlot, BedOccupancy } from '@/types/maternity-ward';

vi.mock('@dnd-kit/core', async () => {
  const actual =
    await vi.importActual<typeof import('@dnd-kit/core')>('@dnd-kit/core');
  return {
    ...actual,
    useSensors: vi.fn(actual.useSensors),
  };
});

const beds: BedSlot[] = [
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
    bedno: '02',
    roomno: 'LR1',
    bed_order: 2,
    bed_lock: 'N',
    bed_status_type_id: 1,
    room_name: 'Labor Room 1',
    room_display_number: 1,
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

describe('WardLayoutView keyboard accessibility', () => {
  it('exposes dnd-kit ARIA attributes on the occupied draggable tile', () => {
    render(<WardLayoutView beds={beds} occupancy={occupancy} />);
    // Bed 01 is occupied → its DraggableBedTile wrapper carries dnd-kit's
    // synthetic role="button" + aria-roledescription="draggable" + tabindex.
    const tile = screen.getByTestId('bed-01');
    expect(tile.getAttribute('role')).toBe('button');
    expect(tile.getAttribute('aria-roledescription')).toBe('draggable');
    expect(tile.getAttribute('tabindex')).toBe('0');
  });

  it('registers KeyboardSensor (with sortableKeyboardCoordinates) on DndContext', () => {
    const useSensorsMock = vi.mocked(useSensors);
    useSensorsMock.mockClear();
    render(<WardLayoutView beds={beds} occupancy={occupancy} />);
    expect(useSensorsMock).toHaveBeenCalled();
    // useSensors receives an array of SensorDescriptor objects; each has a
    // .sensor field pointing at the actual sensor class. We assert both
    // PointerSensor (mouse/touch) AND KeyboardSensor (Space + arrows) are
    // registered, and that KeyboardSensor was given a coordinateGetter so
    // arrow keys translate into directional bed-to-bed navigation.
    // useSensors is varargs: useSensors(d1, d2, ...). The mock records the
    // full positional arg list per call, not as a single array.
    const descriptors = useSensorsMock.mock.calls[0] as unknown as Array<{
      sensor: unknown;
      options: { coordinateGetter?: unknown };
    }>;
    const sensorClasses = descriptors.map((d) => d.sensor);
    expect(sensorClasses).toContain(PointerSensor);
    expect(sensorClasses).toContain(KeyboardSensor);
    const keyboardDescriptor = descriptors.find(
      (d) => d.sensor === KeyboardSensor,
    );
    expect(keyboardDescriptor?.options?.coordinateGetter).toBeTypeOf('function');
  });
});
