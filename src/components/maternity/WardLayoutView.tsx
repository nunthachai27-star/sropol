// Task 24: WardLayoutView — room-grouped grid of BedTiles for the hospital
// maternity ward.
// Task 52: now wraps in @dnd-kit DndContext and exposes a drag-end handler.
// Each occupied tile becomes draggable; every unlocked tile is droppable.
// On a successful drop the parent receives an `onBedMove` callback with the
// {an, oldBedno, newBedno, newRoomno} payload — the page wires that to the
// `movePatientBed` service. Decision logic lives in the pure
// `decideBedMoveAction` helper so it remains unit-testable in jsdom (where
// @dnd-kit's pointer events don't fire reliably).
'use client';

import {
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import { useState } from 'react';

import { BedTile } from './BedTile';
import {
  decideBedMoveAction,
  type BedMoveDecision,
} from './decideBedMoveAction';
import type { BedSlot, BedOccupancy } from '@/types/maternity-ward';

export interface BedMovePayload {
  an: string;
  oldBedno: string;
  oldRoomno: string;
  newBedno: string;
  newRoomno: string;
  reason: string;
}

export interface WardLayoutViewProps {
  beds: BedSlot[];
  occupancy: BedOccupancy[];
  onBedClick?: (an: string) => void;
  /** Live-tick "now" (ms since epoch). Forwarded to every BedTile so all
   *  hours-in-labor / relative-time displays share one cadence. */
  now?: number;
  /**
   * Called once the user has confirmed a bed move via the reason modal. The
   * caller (the page) is responsible for invoking the movePatientBed service
   * and revalidating SWR caches.
   */
  onBedMove?: (payload: BedMovePayload) => void;
  /**
   * Resolved list of move-reason strings (from getBedMoveReasons). Passed in by
   * the page so this component stays presentational. Empty array disables the
   * Confirm button on the reason modal.
   */
  reasons?: string[];
  /**
   * Called when a drag-end is rejected (locked/occupied/no-op) so the page can
   * surface a Thai-language toast. Defaults to console.warn when unset, since
   * the project does not yet have a shared toast library.
   */
  onMoveRejected?: (reason: 'locked' | 'occupied' | 'no-op') => void;
}

interface RoomGroup {
  roomno: string;
  room_name: string | null;
  room_display_number: number | null;
  beds: BedSlot[];
}

function groupByRoom(beds: BedSlot[]): RoomGroup[] {
  const map = new Map<string, RoomGroup>();
  for (const b of beds) {
    let g = map.get(b.roomno);
    if (!g) {
      g = {
        roomno: b.roomno,
        room_name: b.room_name,
        room_display_number: b.room_display_number,
        beds: [],
      };
      map.set(b.roomno, g);
    }
    g.beds.push(b);
  }
  // Sort beds within each room by bed_order asc, then bedno lexical
  for (const g of map.values()) {
    g.beds.sort((a, b) => {
      const ao = a.bed_order ?? Number.MAX_SAFE_INTEGER;
      const bo = b.bed_order ?? Number.MAX_SAFE_INTEGER;
      if (ao !== bo) return ao - bo;
      return a.bedno.localeCompare(b.bedno);
    });
  }
  // Sort rooms by room_display_number asc, then roomno lexical
  return [...map.values()].sort((a, b) => {
    const ad = a.room_display_number ?? Number.MAX_SAFE_INTEGER;
    const bd = b.room_display_number ?? Number.MAX_SAFE_INTEGER;
    if (ad !== bd) return ad - bd;
    return a.roomno.localeCompare(b.roomno);
  });
}

// Drag-id encoding: we use the bedno alone since bednos are unique per ward in
// HOSxP (the bedno PK in `bedno` table is UNIQUE without scoping by roomno).
function dragId(bed: BedSlot): string {
  return `bed:${bed.bedno}`;
}

interface DraggableBedTileProps {
  bed: BedSlot;
  occupant: BedOccupancy | null;
  onBedClick?: (an: string) => void;
  now?: number;
}

// Per-bed wrapper that enrols the tile as both droppable (always) and
// draggable (only when occupied). Empty/locked tiles still need to be
// droppable so a patient can be dropped onto them; locked drops are rejected
// in the dispatcher.
function DraggableBedTile({ bed, occupant, onBedClick, now }: DraggableBedTileProps) {
  const id = dragId(bed);
  const { setNodeRef: setDropRef, isOver } = useDroppable({ id });
  const draggable = useDraggable({
    id,
    disabled: occupant === null,
  });
  // Compose drop ref + drag ref onto the same wrapper so the entire tile is
  // both a drag handle (when occupied) and a drop zone (always).
  const composedRef = (node: HTMLDivElement | null) => {
    setDropRef(node);
    draggable.setNodeRef(node);
  };
  const style: React.CSSProperties | undefined = draggable.transform
    ? {
        transform: `translate3d(${draggable.transform.x}px, ${draggable.transform.y}px, 0)`,
      }
    : undefined;
  return (
    <div
      ref={composedRef}
      style={style}
      data-testid={`bed-${bed.bedno}`}
      data-over={isOver ? 'true' : undefined}
      className={isOver ? 'rounded-lg ring-2 ring-emerald-500 ring-offset-1' : undefined}
      {...(occupant ? draggable.listeners : {})}
      {...draggable.attributes}
    >
      <BedTile
        bedno={bed.bedno}
        bedLock={bed.bed_lock as 'Y' | 'N' | null}
        occupant={occupant}
        onClick={onBedClick}
        now={now}
      />
    </div>
  );
}

export function WardLayoutView({
  beds,
  occupancy,
  onBedClick,
  now,
  onBedMove,
  reasons = [],
  onMoveRejected,
}: WardLayoutViewProps) {
  const rooms = groupByRoom(beds);
  const occupantByBedno = new Map(occupancy.map((o) => [o.bedno, o] as const));
  const bedByBedno = new Map(beds.map((b) => [b.bedno, b] as const));

  const [pending, setPending] = useState<{
    decision: Extract<BedMoveDecision, { action: 'show-modal' }>;
    sourceBed: BedSlot;
    targetBed: BedSlot;
  } | null>(null);

  // Pointer sensor with a small distance threshold so a click on the BedTile
  // button still opens the drawer (instead of being interpreted as a drag).
  // Keyboard sensor (Task 56): Tab to focus a draggable, Space/Enter to pick
  // up, arrow keys to navigate to a target, Space/Enter again to drop. The
  // sortableKeyboardCoordinates getter from @dnd-kit/sortable does the
  // coordinate math for arrow-key motion across the room-grouped grid.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleDragEnd = (event: DragEndEvent) => {
    if (!event.over) return;
    const sourceBedno = String(event.active.id).replace(/^bed:/, '');
    const targetBedno = String(event.over.id).replace(/^bed:/, '');
    const sourceBed = bedByBedno.get(sourceBedno);
    const targetBed = bedByBedno.get(targetBedno);
    if (!sourceBed || !targetBed) return;
    const sourceOccupant = occupantByBedno.get(sourceBedno);
    const targetOccupant = occupantByBedno.get(targetBedno) ?? null;
    if (!sourceOccupant) return;
    const decision = decideBedMoveAction({
      sourceBed,
      sourceOccupant,
      targetBed,
      targetOccupant,
    });
    if (decision.action === 'rejected') {
      if (onMoveRejected) {
        onMoveRejected(decision.reason);
      } else {
        // TODO: replace with a shared toast when the project ships one.
        console.warn(`[bed-move] rejected: ${decision.reason}`);
      }
      return;
    }
    setPending({ decision, sourceBed, targetBed });
  };

  const handleConfirm = (reason: string) => {
    if (!pending) return;
    onBedMove?.({
      an: pending.decision.an,
      oldBedno: pending.sourceBed.bedno,
      oldRoomno: pending.sourceBed.roomno,
      newBedno: pending.targetBed.bedno,
      newRoomno: pending.targetBed.roomno,
      reason,
    });
    setPending(null);
  };

  return (
    <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
      <div className="space-y-4">
        {rooms.map((room) => {
          const occ = room.beds.filter(
            (b) => b.bed_lock !== 'Y' && occupantByBedno.has(b.bedno),
          ).length;
          const total = room.beds.length;
          const occPct = total > 0 ? (occ / total) * 100 : 0;
          return (
            <section
              key={room.roomno}
              className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm"
            >
              <header className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-slate-100 bg-slate-50/60 px-5 py-3">
                <h2 className="text-base font-semibold text-slate-900">
                  {room.room_name ?? `ห้อง ${room.roomno}`}
                </h2>
                <span className="inline-flex items-center rounded-md bg-white px-2 py-0.5 text-xs font-medium tabular-nums text-slate-600 ring-1 ring-slate-200">
                  {`${total} เตียง · ใช้งาน ${occ}`}
                </span>
                <div
                  className="ml-auto hidden h-1.5 w-40 overflow-hidden rounded-full bg-slate-200/70 md:block"
                  aria-hidden
                >
                  <div
                    className="h-full rounded-full bg-emerald-500 transition-[width] duration-300 ease-out motion-reduce:transition-none"
                    style={{ width: `${occPct}%` }}
                  />
                </div>
              </header>
              <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-3 p-4">
                {room.beds.map((b) => (
                  <DraggableBedTile
                    key={b.bedno}
                    bed={b}
                    occupant={occupantByBedno.get(b.bedno) ?? null}
                    onBedClick={onBedClick}
                    now={now}
                  />
                ))}
              </div>
            </section>
          );
        })}
      </div>
      {pending && (
        <BedMoveReasonModalLazy
          reasons={reasons}
          fromBedno={pending.sourceBed.bedno}
          toBedno={pending.targetBed.bedno}
          onConfirm={handleConfirm}
          onCancel={() => setPending(null)}
        />
      )}
    </DndContext>
  );
}

// Lazy-import the modal indirection keeps the WardLayoutView render path light
// for the common no-drag case while still using a normal eager import for
// testability (jsdom doesn't tolerate dynamic import in synchronous render).
import { BedMoveReasonModal } from './BedMoveReasonModal';
function BedMoveReasonModalLazy(props: {
  reasons: string[];
  fromBedno: string;
  toBedno: string;
  onConfirm: (r: string) => void;
  onCancel: () => void;
}) {
  return <BedMoveReasonModal open {...props} />;
}
