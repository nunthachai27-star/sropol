// WardLayoutViewFull — clinical-density variant of WardLayoutView. Same room-
// grouped layout but with wider tile slots, BedTileFull, and (for v1) no DnD
// since the dense card has heavier paint cost and the v2 view is intended for
// at-a-glance monitoring rather than active bed-move work. The lite ward
// layout (with DnD) stays the primary editing surface.
'use client';

import { BedTileFull } from './BedTileFull';
import type { BedSlot, BedOccupancyFull } from '@/types/maternity-ward';

export interface WardLayoutViewFullProps {
  beds: BedSlot[];
  occupancy: BedOccupancyFull[];
  /** Live "now" tick (ms since epoch) — drives hours-since-admit + severity.
   *  Required so BedTileFull stays render-pure (no internal Date.now()). */
  now: number;
  onBedClick?: (an: string) => void;
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
  for (const g of map.values()) {
    g.beds.sort((a, b) => {
      const ao = a.bed_order ?? Number.MAX_SAFE_INTEGER;
      const bo = b.bed_order ?? Number.MAX_SAFE_INTEGER;
      if (ao !== bo) return ao - bo;
      return a.bedno.localeCompare(b.bedno);
    });
  }
  return [...map.values()].sort((a, b) => {
    const ad = a.room_display_number ?? Number.MAX_SAFE_INTEGER;
    const bd = b.room_display_number ?? Number.MAX_SAFE_INTEGER;
    if (ad !== bd) return ad - bd;
    return a.roomno.localeCompare(b.roomno);
  });
}

export function WardLayoutViewFull({ beds, occupancy, now, onBedClick }: WardLayoutViewFullProps) {
  const rooms = groupByRoom(beds);
  const occupantByBedno = new Map(occupancy.map((o) => [o.bedno, o] as const));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
      {/* Heartbeat keyframes (FHR pulse dot in BedTileFull). Single declaration
          shared across all tiles in the layout. */}
      <style>{`
        @keyframes kk-heartbeat {
          0%, 100% { transform: scale(1); opacity: 1; }
          50% { transform: scale(1.7); opacity: 0.4; }
        }
      `}</style>

      {rooms.map((room) => {
        const occCount = room.beds.filter(
          (b) => b.bed_lock !== 'Y' && occupantByBedno.has(b.bedno),
        ).length;
        const lockedCount = room.beds.filter((b) => b.bed_lock === 'Y').length;
        const total = room.beds.length;
        const free = Math.max(0, total - occCount - lockedCount);
        return (
          <section key={room.roomno}>
            <header
              style={{
                display: 'grid',
                gridTemplateColumns: 'auto 1fr auto',
                gap: 18,
                alignItems: 'baseline',
                paddingBottom: 12,
                marginBottom: 20,
                borderBottom: '1px solid #E2E8F0',
              }}
            >
              <div
                style={{
                  fontFamily: "'IBM Plex Mono', 'SF Mono', Consolas, monospace",
                  fontSize: 11,
                  letterSpacing: '0.22em',
                  textTransform: 'uppercase',
                  color: '#1565C0',
                  fontWeight: 800,
                }}
              >
                <span
                  style={{
                    display: 'inline-block',
                    width: 8,
                    height: 8,
                    background: '#1565C0',
                    marginRight: 12,
                    verticalAlign: 1,
                    borderRadius: 1,
                  }}
                />
                {`Room ${room.roomno}`}
              </div>
              <div style={{ fontSize: 18, fontWeight: 700, letterSpacing: '-0.005em', color: '#0F172A' }}>
                {room.room_name ?? `ห้อง ${room.roomno}`}
              </div>
              <div
                style={{
                  fontFamily: "'IBM Plex Mono', 'SF Mono', Consolas, monospace",
                  fontSize: 11,
                  letterSpacing: '0.16em',
                  textTransform: 'uppercase',
                  color: '#64748B',
                  fontWeight: 700,
                }}
              >
                {`${String(total).padStart(2, '0')} BEDS · ${String(occCount).padStart(2, '0')} OCC · ${String(free).padStart(2, '0')} FREE${lockedCount > 0 ? ` · ${String(lockedCount).padStart(2, '0')} LOCKED` : ''}`}
              </div>
            </header>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))',
                gap: 20,
              }}
            >
              {room.beds.map((b) => (
                <BedTileFull
                  key={b.bedno}
                  bedno={b.bedno}
                  bedLock={b.bed_lock as 'Y' | 'N' | null}
                  occupant={occupantByBedno.get(b.bedno) ?? null}
                  now={now}
                  onClick={onBedClick}
                />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
