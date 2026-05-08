// Real-map implementation of the Province overview — uses Leaflet + OSM tiles
// so surrounding provinces are visible while Khon Kaen is highlighted in the
// middle. Hospital pins are placed at real OSM-verified coordinates where
// available, with district-centroid fallback for hospitals OSM didn't have.
//
// This file MUST NOT be imported at the module level from a server component
// because Leaflet accesses `window` on import. `ProvinceMap.tsx` dynamically
// imports this with `ssr: false` to satisfy Next.js SSR boundaries.
'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import useSWR from 'swr';
import {
  MapContainer,
  TileLayer,
  GeoJSON,
  Marker,
  Tooltip,
  ZoomControl,
  useMap,
} from 'react-leaflet';
import L, { type LatLngExpression, type LatLngBoundsExpression, type DivIcon } from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { FeatureCollection } from 'geojson';
import type { DashboardHospital } from '@/types/api';
import { ConnectionStatus as ConnectionStatusEnum, HospitalLevel } from '@/types/domain';
import { HOSPITAL_COORDS } from '@/data/kk-hospital-coords';
import { KK_GEOJSON } from '@/data/kk-province-geojson';
import {
  loadProvinceShapes,
  computeBounds,
  districtCentroids,
  type ProvinceShapes,
} from '@/lib/thai-geo-shapes';

interface ProvinceMapLeafletProps {
  hospitals: DashboardHospital[];
  selected?: string | null;
  onSelect?: (hcode: string | null) => void;
  mode?: 'light' | 'kiosk';
  size?: 'mini' | 'full';
}

interface WeightPreset {
  amphoeWeight: number;
  boundaryWeight: number;
  /** Multiplier applied to the level+activity base radius to derive pin pixels. */
  pinMult: number;
  /** Minimum pin pixel size (floor). */
  pinMinPx: number;
  /** Maximum pin pixel size (cap so A_S with peak load doesn't dwarf the viewport). */
  pinMaxPx: number;
}

const WEIGHTS: Record<'mini' | 'full', WeightPreset> = {
  mini: {
    amphoeWeight: 0.5,
    boundaryWeight: 1.2,
    pinMult: 1.2,
    pinMinPx: 11,
    pinMaxPx: 20,
  },
  full: {
    amphoeWeight: 1,
    boundaryWeight: 2.5,
    pinMult: 2.2,
    pinMinPx: 20,
    pinMaxPx: 42,
  },
};

// ─── Hospital pin divIcon ───────────────────────────────────────────────
// Renders a real "hospital sign" marker: rounded square, colored by risk
// tier, with a medical cross glyph. Pulse halo + offline cross are driven
// by CSS classes in globals.css (`.kk-pin--*`).

const HOSPITAL_CROSS_SVG =
  '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">' +
  '<path d="M10 4h4v6h6v4h-6v6h-4v-6H4v-4h6z" fill="currentColor"/>' +
  '</svg>';

function buildHospitalIcon(params: {
  color: string;
  sizePx: number;
  isHigh: boolean;
  isSelected: boolean;
  connectionStatus: 'ONLINE' | 'OFFLINE' | 'UNKNOWN';
  syncStatus: 'OK' | 'BLOCKED' | 'NEVER_SYNCED';
  syncBlockedReason: string | null;
}): DivIcon {
  const { color, sizePx, isHigh, isSelected, connectionStatus, syncStatus, syncBlockedReason } = params;
  const isOffline = connectionStatus === 'OFFLINE';
  const classes = [
    'kk-pin',
    isHigh ? 'kk-pin--high' : '',
    isSelected ? 'kk-pin--selected' : '',
    isOffline ? 'kk-pin--offline' : '',
  ]
    .filter(Boolean)
    .join(' ');
  // Corner status dot priority:
  //   BLOCKED  → amber (sync suspended; tunnel may still be ONLINE)
  //   OFFLINE  → red   (tunnel unreachable)
  //   ONLINE   → green
  //   UNKNOWN / NEVER_SYNCED → gray
  // Amber (not orange) for BLOCKED so it stays distinguishable from the
  // red OFFLINE dot at 6–9 px — orange-vs-red at that size was confusing.
  // BLOCKED takes priority over ONLINE so the operator doesn't read a
  // healthy tunnel as a healthy sync. NEVER_SYNCED falls under UNKNOWN
  // visually since it's a similar "no data flowing" message.
  const isBlocked = syncStatus === 'BLOCKED';
  const statusClass = isBlocked
    ? 'kk-pin__status--blocked'
    : connectionStatus === 'ONLINE' && syncStatus !== 'NEVER_SYNCED'
      ? 'kk-pin__status--online'
      : connectionStatus === 'OFFLINE'
        ? 'kk-pin__status--offline'
        : 'kk-pin__status--unknown';
  const statusTitle = isBlocked
    ? `Sync ถูกระงับ — ${syncBlockedReason ?? 'unknown'}`
    : syncStatus === 'NEVER_SYNCED'
      ? 'ยังไม่เคยมีการเชื่อมต่อ Sync'
      : connectionStatus === 'ONLINE'
        ? 'Online'
        : connectionStatus === 'OFFLINE'
          ? 'Offline'
          : 'Unknown';
  const html =
    `<div class="${classes}" style="--kk-pin-color:${color};--kk-pin-size:${sizePx}px">` +
    '<div class="kk-pin__halo"></div>' +
    `<div class="kk-pin__body">${HOSPITAL_CROSS_SVG}</div>` +
    `<div class="kk-pin__status ${statusClass}" title="${statusTitle}" aria-label="${statusTitle}"></div>` +
    '</div>';
  // Oversize the icon bounds so the halo animation isn't clipped.
  const bound = sizePx * 2;
  return L.divIcon({
    html,
    className: '',
    iconSize: [bound, bound],
    iconAnchor: [bound / 2, bound / 2],
  });
}

// Khon Kaen province roughly spans 15.6–17.1 °N × 101.75–103.2 °E.
// Fit-bounds ensures the province fills the viewport regardless of aspect.
const KK_BOUNDS: LatLngBoundsExpression = [
  [15.55, 101.65],
  [17.15, 103.25],
];
const KK_CENTER: LatLngExpression = [16.35, 102.45];

// Pin radius by SAP/legacy tier. Larger pins for higher-tier referral
// receivers so the operator can spot the hub at province-level zoom.
// Falls through to DEFAULT_RADIUS for any tier not in the map.
const LEVEL_BASE_RADIUS: Partial<Record<HospitalLevel, number>> = {
  // SAP framework (อ.ก.พ. 3/2568)
  [HospitalLevel.P_PLUS]: 13,
  [HospitalLevel.P]: 12,
  [HospitalLevel.A_PLUS]: 11,
  [HospitalLevel.A]: 10,
  [HospitalLevel.S_PLUS]: 9,
  [HospitalLevel.S]: 8,
  [HospitalLevel.S_C]: 7,
  [HospitalLevel.M]: 8,
  [HospitalLevel.F]: 7,
  // Legacy
  [HospitalLevel.A_S]: 11,
  [HospitalLevel.M1]: 9,
  [HospitalLevel.M2]: 8,
  [HospitalLevel.F1]: 8,
  [HospitalLevel.F2]: 7,
  [HospitalLevel.F3]: 6,
};
const DEFAULT_RADIUS = 7;

function activeCountRadiusBoost(total: number): number {
  if (total === 0) return 0;
  if (total < 3) return 1;
  if (total < 6) return 3;
  return 5;
}

function riskColor(
  live: DashboardHospital | undefined,
  palette: ReturnType<typeof buildPalette>,
): string {
  if (!live) return palette.idle;
  if (live.counts.high > 0) return palette.high;
  if (live.counts.medium > 0) return palette.med;
  if (live.counts.low > 0) return palette.low;
  return palette.idle;
}

function buildPalette(mode: 'light' | 'kiosk') {
  if (mode === 'kiosk') {
    return {
      boundaryStroke: '#6ba7e5',
      boundaryFill: 'rgba(107, 167, 229, 0.08)',
      amphoeStroke: 'rgba(107, 167, 229, 0.18)',
      high: '#e05c5c',
      med: '#e0a03a',
      low: '#4fb58a',
      idle: '#7f8fad',
      pinStroke: '#06121f',
      tooltipBg: '#0b1b2e',
      tooltipInk: '#e6ecf5',
    };
  }
  return {
    boundaryStroke: '#2b3a8c',
    boundaryFill: 'rgba(43, 58, 140, 0.06)',
    amphoeStroke: 'rgba(43, 58, 140, 0.18)',
    high: '#ef4444',
    med: '#eab308',
    low: '#22c55e',
    idle: '#94a3b8',
    pinStroke: '#ffffff',
    tooltipBg: '#ffffff',
    tooltipInk: '#0c1530',
  };
}

interface PinEntry {
  hcode: string;
  name: string;
  coord: { lat: number; lon: number };
  level: HospitalLevel;
  live: DashboardHospital | undefined;
  sizePx: number;
  color: string;
  isSel: boolean;
  isOnline: boolean;
  isHigh: boolean;
  icon: DivIcon;
}

interface ActiveMap {
  bounds: LatLngBoundsExpression;
  center: LatLngExpression;
  districtsFC: FeatureCollection;
  provinceFC: FeatureCollection;
}

const KK_PROVINCE_CODE = '40';

export default function ProvinceMapLeaflet({
  hospitals,
  selected,
  onSelect,
  mode = 'light',
  size = 'mini',
}: ProvinceMapLeafletProps) {
  const router = useRouter();
  const palette = buildPalette(mode);
  const w = WEIGHTS[size];

  // Active province drives which shapes + pin list are rendered. A missing
  // config means default to Khon Kaen so first-run deployments don't blank.
  const { data: configData } = useSWR<{ config: { active_province_code?: string } }>(
    '/api/admin/config',
  );
  const activeProvince = configData?.config?.active_province_code ?? KK_PROVINCE_CODE;

  // For non-KK provinces we fetch the full Thailand GeoJSON + filter to the
  // active province at runtime. KK keeps using the pre-simplified inline
  // KK_GEOJSON to avoid the 6 MB network round-trip (regression-safe path).
  // Null SWR key when KK means no fetch runs — SWR also cache-dedupes the
  // result, so flipping between provinces is instant after first load.
  const { data: loadedShapes } = useSWR<ProvinceShapes>(
    activeProvince === KK_PROVINCE_CODE ? null : ['thai-geo-shapes', activeProvince],
    () => loadProvinceShapes(activeProvince),
  );

  const liveByHcode = useMemo(
    () => new Map(hospitals.map((h) => [h.hcode, h])),
    [hospitals],
  );

  const tileUrl =
    mode === 'kiosk'
      ? 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png'
      : 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
  const tileAttribution =
    mode === 'kiosk'
      ? '© OpenStreetMap contributors, © CARTO'
      : '© OpenStreetMap contributors';

  const handleMarkerClick = (hcode: string) => {
    if (onSelect) onSelect(hcode === selected ? null : hcode);
    else router.push(`/hospitals/${hcode}`);
  };

  // Build the active shapes + a coord resolver. For KK this is effectively a
  // no-op wrapper around the inline assets; for other provinces we compute
  // bounds + district centroids from the fetched GeoJSON.
  const activeMap: ActiveMap | null = useMemo(() => {
    if (activeProvince === KK_PROVINCE_CODE) {
      return {
        bounds: KK_BOUNDS,
        center: KK_CENTER,
        districtsFC: KK_GEOJSON,
        provinceFC: KK_GEOJSON,
      };
    }
    if (!loadedShapes) return null;
    const bbox = computeBounds(loadedShapes.province);
    if (!bbox) return null;
    const center: LatLngExpression = [
      (bbox[0][0] + bbox[1][0]) / 2,
      (bbox[0][1] + bbox[1][1]) / 2,
    ];
    return {
      bounds: bbox,
      center,
      districtsFC: loadedShapes.districts,
      provinceFC: loadedShapes.province,
    };
  }, [activeProvince, loadedShapes]);

  const centroidByDistrict = useMemo(() => {
    if (activeProvince === KK_PROVINCE_CODE || !loadedShapes) return {};
    return districtCentroids(loadedShapes.districts);
  }, [activeProvince, loadedShapes]);

  const hospitalPins: PinEntry[] = useMemo(() => {
    const buildPin = (
      hcode: string,
      name: string,
      level: HospitalLevel,
      coord: { lat: number; lon: number },
    ): PinEntry => {
      const live = liveByHcode.get(hcode);
      const baseRadius =
        (LEVEL_BASE_RADIUS[level] ?? DEFAULT_RADIUS) +
        activeCountRadiusBoost(live?.counts.total ?? 0);
      const sizePx = Math.round(
        Math.min(w.pinMaxPx, Math.max(w.pinMinPx, baseRadius * w.pinMult)),
      );
      const color = riskColor(live, palette);
      const isSel = selected === hcode;
      // Status is tri-state: ONLINE / OFFLINE / UNKNOWN. Anything not
      // explicitly set falls back to UNKNOWN so a hospital we've never
      // reached doesn't visually pose as ONLINE.
      const rawStatus = live?.connectionStatus;
      const connectionStatus: 'ONLINE' | 'OFFLINE' | 'UNKNOWN' =
        rawStatus === ConnectionStatusEnum.ONLINE
          ? 'ONLINE'
          : rawStatus === ConnectionStatusEnum.OFFLINE
            ? 'OFFLINE'
            : 'UNKNOWN';
      const isOnline = connectionStatus === 'ONLINE';
      const isHigh = !!live && live.counts.high > 0;
      const syncStatus = live?.syncStatus ?? 'NEVER_SYNCED';
      const syncBlockedReason = live?.syncBlockedReason ?? null;
      const icon = buildHospitalIcon({
        color,
        sizePx,
        isHigh,
        isSelected: isSel,
        connectionStatus,
        syncStatus,
        syncBlockedReason,
      });
      return {
        hcode,
        name,
        coord,
        level,
        live,
        sizePx,
        color,
        isSel,
        isOnline,
        isHigh,
        icon,
      };
    };

    // Single source of truth: the `hospitals` prop (what the caller fetched
    // from /api/dashboard or /api/admin/hospitals). Previously the KK path
    // iterated the hardcoded KK_HOSPITALS config, so pins showed for all 26
    // MOPH facilities even when the admin list was empty. That was wrong for
    // the admin page — fixed by iterating the prop everywhere.
    if (!activeMap) return [];
    const [sw, ne] = activeMap.bounds as [[number, number], [number, number]];
    const fallback = { lat: (sw[0] + ne[0]) / 2, lon: (sw[1] + ne[1]) / 2 };

    // Resolve coord per-hospital:
    //   1. operator-entered lat/lon on the hospital row
    //   2. the pre-mapped HOSPITAL_COORDS table (KK only — 26 known hcodes)
    //   3. amphoe centroid via districtCode (works for any province whose
    //      shapes are loaded)
    //   4. province center (so an unmapped hospital is still reachable)
    const pins: PinEntry[] = [];
    for (const h of hospitals) {
      let coord: { lat: number; lon: number } | null = null;
      if (typeof h.lat === 'number' && typeof h.lon === 'number') {
        coord = { lat: h.lat, lon: h.lon };
      } else if (HOSPITAL_COORDS[h.hcode]) {
        coord = HOSPITAL_COORDS[h.hcode];
      } else if (h.districtCode && centroidByDistrict[h.districtCode]) {
        coord = centroidByDistrict[h.districtCode];
      } else {
        coord = fallback;
      }
      pins.push(buildPin(h.hcode, h.name, h.level, coord));
    }
    return pins;
  }, [
    activeMap,
    hospitals,
    liveByHcode,
    centroidByDistrict,
    selected,
    palette,
    w,
  ]);

  if (!activeMap) {
    return (
      <div
        className="grid h-full w-full place-items-center"
        style={{
          background: mode === 'kiosk' ? '#06121f' : 'var(--surface-cool)',
          isolation: 'isolate',
        }}
      >
        <span className="font-mono text-[10px] tracking-[0.18em] text-[var(--ink-navy-muted)]">
          LOADING {activeProvince === KK_PROVINCE_CODE ? 'MAP' : `PROVINCE ${activeProvince}`}…
        </span>
      </div>
    );
  }

  return (
    <div
      className="relative h-full w-full overflow-hidden"
      style={{
        background: mode === 'kiosk' ? '#06121f' : '#eef1f6',
        // Contain Leaflet's internal pane z-indexes (200–700) so they
        // can't render on top of modal dialogs or page chrome.
        isolation: 'isolate',
      }}
    >
      <MapContainer
        key={activeProvince}
        bounds={activeMap.bounds}
        center={activeMap.center}
        style={{ height: '100%', width: '100%', background: 'transparent' }}
        scrollWheelZoom
        zoomControl={false}
        attributionControl
        minZoom={7}
        maxZoom={13}
      >
        <TileLayer
          attribution={tileAttribution}
          url={tileUrl}
          opacity={mode === 'kiosk' ? 0.85 : 0.95}
        />

        {/* Amphoe outlines (subtle, interior hairlines) */}
        <GeoJSON
          data={activeMap.districtsFC}
          style={{
            color: palette.amphoeStroke,
            weight: w.amphoeWeight,
            fillColor: palette.boundaryFill,
            fillOpacity: 1,
          }}
        />

        {/* Province-wide outline — drawn thicker, no fill, on top of tiles */}
        <GeoJSON
          data={activeMap.provinceFC}
          style={{
            color: palette.boundaryStroke,
            weight: w.boundaryWeight,
            fill: false,
            dashArray: mode === 'kiosk' ? '4 3' : undefined,
          }}
          pane="overlayPane"
          interactive={false}
        />

        {/* Hospital markers — rendered as hospital-sign divIcons (risk-colored
             square with a medical cross). Pulse halo on HIGH risk via CSS.
             Tooltip direction is picked dynamically per pin so the popup
             never gets clipped by the map div edge — see HospitalMarker. */}
        {hospitalPins.map((pin) => (
          <HospitalMarker
            key={pin.hcode}
            pin={pin}
            onClick={handleMarkerClick}
          />
        ))}

        <ZoomControl position="bottomright" />
      </MapContainer>

      {/* Status legend — top-left overlay, dense single column. Sits above
          the Leaflet pane via z-index so it stays interactive even though
          the map captures pointer events. Theme adapts to light vs kiosk. */}
      <MapStatusLegend mode={mode} />
    </div>
  );
}

// Wraps Marker + Tooltip with direction-aware placement so the rich
// HospitalTooltip never gets clipped by the map container edges. The
// tooltip is ~280 × ~150 px, so we estimate the half-extents below and
// re-pick a direction whenever the pointer enters the marker. Re-picking
// on hover (not on every map move) keeps the cost trivial.
function HospitalMarker({
  pin,
  onClick,
}: {
  pin: PinEntry;
  onClick: (hcode: string) => void;
}) {
  const map = useMap();
  const [direction, setDirection] = useState<
    'top' | 'bottom' | 'left' | 'right'
  >('top');

  // Approx tooltip extents — keep generous so we err on the side of safety
  // and pick a different direction even if the pin is moderately close to
  // the edge. Real tooltip min-width is 220, max-width 280, body height
  // varies with content (~110 px when no risks, up to ~170 with HR3 chip
  // + sync footer). Padding + arrow add ~12 px on the anchor side.
  const TT_HALF_W = 150;
  const TT_HEIGHT = 180;

  const recompute = () => {
    if (!map) return;
    const cp = map.latLngToContainerPoint([pin.coord.lat, pin.coord.lon]);
    const size = map.getSize();
    const room = {
      top: cp.y,
      bottom: size.y - cp.y,
      left: cp.x,
      right: size.x - cp.x,
    };
    // Prefer vertical (top/bottom) — feels more natural for map pins.
    // Switch to a horizontal direction only when neither vertical fits.
    if (room.top >= TT_HEIGHT) {
      setDirection('top');
      return;
    }
    if (room.bottom >= TT_HEIGHT) {
      setDirection('bottom');
      return;
    }
    if (room.right >= TT_HALF_W * 2) {
      setDirection('right');
      return;
    }
    setDirection('left');
  };

  // Direction-dependent offset so the tooltip clears the pin body. Leaflet
  // adds its own ~6 px gap from the arrow; we layer pin radius on top.
  const offset: [number, number] =
    direction === 'top'
      ? [0, -pin.sizePx / 2]
      : direction === 'bottom'
        ? [0, pin.sizePx / 2]
        : direction === 'left'
          ? [-pin.sizePx / 2, 0]
          : [pin.sizePx / 2, 0];

  return (
    <Marker
      position={[pin.coord.lat, pin.coord.lon]}
      icon={pin.icon}
      eventHandlers={{
        click: () => onClick(pin.hcode),
        mouseover: recompute,
      }}
    >
      <Tooltip
        direction={direction}
        offset={offset}
        sticky
        className="kk-map-tooltip"
      >
        <HospitalTooltip pin={pin} />
      </Tooltip>
    </Marker>
  );
}

// Rich hover tooltip — replaces the original two-line summary. Surfaces
// the operational state operators usually need next: connection + sync
// verdict, labor floor breakdown, ANC registry, last-sync freshness.
// Keeps Thai-first copy for the floor staff while leaving structural
// labels (LABOR / ANC / SYNC) in mono caps for at-a-glance scanning.
function HospitalTooltip({ pin }: { pin: PinEntry }) {
  const { live, name, level, hcode } = pin;
  // Tooltip backdrop is forced dark via .kk-map-tooltip CSS so the same
  // white-on-navy palette works in both light and kiosk app modes.
  const ink = '#e6ecf5';
  const muted = 'rgba(255,255,255,0.65)';
  const ruleColor = 'rgba(255,255,255,0.18)';

  // Connection + sync state — same precedence as the corner dot so the
  // tooltip and the dot tell a consistent story.
  const conn = live?.connectionStatus ?? 'UNKNOWN';
  const syncStatus = live?.syncStatus ?? 'NEVER_SYNCED';
  const isBlocked = syncStatus === 'BLOCKED';
  const isNeverSynced = syncStatus === 'NEVER_SYNCED';
  const statusLabel = isBlocked
    ? 'BLOCKED'
    : conn === 'ONLINE' && !isNeverSynced
      ? 'ONLINE'
      : conn === 'OFFLINE'
        ? 'OFFLINE'
        : isNeverSynced
          ? 'NO SYNC'
          : 'UNKNOWN';
  const statusColor = isBlocked
    ? '#eab308'
    : conn === 'ONLINE' && !isNeverSynced
      ? '#22c55e'
      : conn === 'OFFLINE'
        ? '#ef4444'
        : muted;
  const statusDetail = isBlocked
    ? `Sync ถูกระงับ — ${live?.syncBlockedReason ?? 'unknown'}`
    : isNeverSynced
      ? 'ยังไม่เคยเชื่อม sync'
      : conn === 'OFFLINE'
        ? 'ติดต่อตู้ BMS ไม่ได้'
        : conn === 'ONLINE'
          ? 'sync ปกติ'
          : 'ยังไม่ทราบสถานะ';

  // Labor + ANC breakdown — fall back to "—" cells when no data so the
  // grid layout doesn't shift between hospitals with vs without data.
  const labor = live?.counts ?? { low: 0, medium: 0, high: 0, total: 0 };
  const anc = live?.ancCounts ?? { total: 0, hr3: 0 };
  const lastSync = live?.lastSyncAt ?? null;
  const lastSyncRel = formatRelativeAgeShort(lastSync);
  const lastSyncAbs = lastSync ? new Date(lastSync).toLocaleString('th-TH') : null;

  return (
    <div
      style={{
        color: ink,
        fontSize: 12,
        lineHeight: 1.35,
        minWidth: 220,
        maxWidth: 280,
        fontFamily:
          'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
      }}
    >
      {/* Title block */}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
        <strong style={{ fontSize: 13 }}>{name}</strong>
      </div>
      <div style={{ color: muted, fontSize: 10, marginTop: 1 }}>
        <span
          style={{
            border: `1px solid ${ruleColor}`,
            padding: '0 4px',
            marginRight: 6,
            fontFamily: 'ui-monospace, Menlo, Consolas, monospace',
          }}
        >
          {level}
        </span>
        <span style={{ fontFamily: 'ui-monospace, Menlo, Consolas, monospace' }}>
          {hcode}
        </span>
      </div>

      {/* Status row */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          marginTop: 6,
          paddingTop: 6,
          borderTop: `1px solid ${ruleColor}`,
        }}
      >
        <span
          style={{
            width: 8,
            height: 8,
            borderRadius: '50%',
            background: statusColor,
            border: '1.5px solid rgba(255,255,255,0.3)',
            flexShrink: 0,
          }}
        />
        <span style={{ fontWeight: 600, fontSize: 11, letterSpacing: '0.04em' }}>
          {statusLabel}
        </span>
        <span style={{ color: muted, fontSize: 11 }}>· {statusDetail}</span>
      </div>

      {/* LABOR + ANC two-column grid */}
      <div
        style={{
          marginTop: 6,
          paddingTop: 6,
          borderTop: `1px solid ${ruleColor}`,
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 8,
        }}
      >
        <div>
          <div
            style={{
              fontSize: 9,
              color: muted,
              letterSpacing: '0.12em',
              fontFamily: 'ui-monospace, Menlo, Consolas, monospace',
            }}
          >
            LABOR FLOOR
          </div>
          <div style={{ fontSize: 16, fontWeight: 700, lineHeight: 1.1 }}>
            {labor.total}
            <span style={{ fontSize: 10, color: muted, marginLeft: 3 }}>ราย</span>
          </div>
          <div
            style={{
              fontSize: 10,
              fontFamily: 'ui-monospace, Menlo, Consolas, monospace',
              marginTop: 2,
            }}
          >
            <span style={{ color: '#ef4444' }}>H {labor.high}</span>
            <span style={{ color: muted }}> · </span>
            <span style={{ color: '#eab308' }}>M {labor.medium}</span>
            <span style={{ color: muted }}> · </span>
            <span style={{ color: '#22c55e' }}>L {labor.low}</span>
          </div>
        </div>
        <div>
          <div
            style={{
              fontSize: 9,
              color: muted,
              letterSpacing: '0.12em',
              fontFamily: 'ui-monospace, Menlo, Consolas, monospace',
            }}
          >
            ANC REGISTRY
          </div>
          <div style={{ fontSize: 16, fontWeight: 700, lineHeight: 1.1 }}>
            {anc.total}
            <span style={{ fontSize: 10, color: muted, marginLeft: 3 }}>ราย</span>
          </div>
          {anc.hr3 > 0 ? (
            <div
              style={{
                fontSize: 10,
                fontFamily: 'ui-monospace, Menlo, Consolas, monospace',
                marginTop: 2,
                color: '#ef4444',
                fontWeight: 700,
              }}
            >
              HR3 {anc.hr3}
            </div>
          ) : (
            <div style={{ fontSize: 10, color: muted, marginTop: 2 }}>—</div>
          )}
        </div>
      </div>

      {/* Sync freshness footer */}
      <div
        style={{
          marginTop: 6,
          paddingTop: 6,
          borderTop: `1px solid ${ruleColor}`,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'baseline',
          fontSize: 10,
          color: muted,
          fontFamily: 'ui-monospace, Menlo, Consolas, monospace',
        }}
      >
        <span>SYNC · {lastSyncRel}</span>
        {lastSyncAbs && (
          <span style={{ fontSize: 9, opacity: 0.8 }}>{lastSyncAbs}</span>
        )}
      </div>

      {/* Click hint */}
      <div
        style={{
          marginTop: 4,
          fontSize: 9,
          color: muted,
          fontFamily: 'ui-monospace, Menlo, Consolas, monospace',
          letterSpacing: '0.08em',
        }}
      >
        คลิกเพื่อเปิดหน้าโรงพยาบาล →
      </div>
    </div>
  );
}

function formatRelativeAgeShort(iso: string | null): string {
  if (!iso) return 'ยังไม่ sync';
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(ms / 60000);
  const hrs = Math.floor(mins / 60);
  const days = Math.floor(hrs / 24);
  if (mins < 60) return `${Math.max(1, mins)} นาทีที่แล้ว`;
  if (hrs < 24) return `${hrs} ชม.ที่แล้ว`;
  return `${days} วันที่แล้ว`;
}

function MapStatusLegend({ mode }: { mode: 'light' | 'kiosk' }) {
  const isKiosk = mode === 'kiosk';
  const bg = isKiosk ? 'rgba(11, 27, 46, 0.85)' : 'rgba(255, 255, 255, 0.92)';
  const ink = isKiosk ? '#e6ecf5' : '#0b1b2e';
  const inkMuted = isKiosk ? 'rgba(230,236,245,0.7)' : 'rgba(11,27,46,0.65)';
  const border = isKiosk ? 'rgba(107,167,229,0.3)' : 'rgba(43,58,140,0.22)';
  const items: Array<{ color: string; label: string; sub: string }> = [
    { color: '#22c55e', label: 'ONLINE', sub: 'sync ปกติ' },
    { color: '#eab308', label: 'BLOCKED', sub: 'sync ถูกระงับ' },
    { color: '#ef4444', label: 'OFFLINE', sub: 'ติดต่อไม่ได้' },
    { color: '#94a3b8', label: 'UNKNOWN', sub: 'ยังไม่ sync' },
  ];
  return (
    <div
      className="absolute"
      style={{
        top: 8,
        left: 8,
        zIndex: 500,
        background: bg,
        color: ink,
        border: `1px solid ${border}`,
        borderRadius: 4,
        padding: '6px 8px',
        boxShadow: '0 1px 3px rgba(0,0,0,0.18)',
        fontFamily:
          'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
        pointerEvents: 'none',
      }}
      aria-label="Map dot color legend"
    >
      <div
        style={{
          fontSize: 9,
          letterSpacing: '0.14em',
          color: inkMuted,
          marginBottom: 4,
        }}
      >
        STATUS DOT
      </div>
      <div className="flex flex-col gap-[2px]">
        {items.map((it) => (
          <div key={it.label} className="flex items-center gap-2">
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                background: it.color,
                border: `1.5px solid ${isKiosk ? '#06121f' : '#ffffff'}`,
                boxShadow: '0 0 0 0.5px rgba(0,0,0,0.15)',
                flexShrink: 0,
              }}
            />
            <span style={{ fontSize: 10, fontWeight: 600 }}>{it.label}</span>
            <span style={{ fontSize: 10, color: inkMuted }}>·&nbsp;{it.sub}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
