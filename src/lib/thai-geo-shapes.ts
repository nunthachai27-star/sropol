// Client-side loader for the Thai admin-boundary GeoJSON shipped in
// public/geo. Filters the Thailand-wide FeatureCollections down to a single
// MOPH province (2-digit pro_code / chwpart) so ProvinceMapLeaflet can
// render any of the 77 provinces.
//
// Sources:
//   public/geo/th-provinces.geojson — 77 province polygons, ~1.6 MB
//   public/geo/th-districts.geojson — 928 amphoe polygons,  ~4.6 MB
// Files are fetched once per page load and cached by the browser.
import type { Feature, FeatureCollection, Geometry } from 'geojson';
import { withBasePath } from '@/lib/base-path';

export interface ThaiProvinceProps {
  pro_code: string;
  pro_th: string;
  pro_en: string;
  reg_nesdb: string;
  reg_royin: string;
  area_sqkm: number;
  perimeter: number;
}

export interface ThaiDistrictProps extends ThaiProvinceProps {
  amp_code: string;
  amp_th: string;
  amp_en: string;
}

export interface ProvinceShapes {
  province: FeatureCollection<Geometry, ThaiProvinceProps>;
  districts: FeatureCollection<Geometry, ThaiDistrictProps>;
}

let provincesCache: FeatureCollection<Geometry, ThaiProvinceProps> | null = null;
let districtsCache: FeatureCollection<Geometry, ThaiDistrictProps> | null = null;

async function loadAllProvinces(): Promise<FeatureCollection<Geometry, ThaiProvinceProps>> {
  if (provincesCache) return provincesCache;
  const res = await fetch(withBasePath('/geo/th-provinces.geojson'));
  if (!res.ok) throw new Error(`failed to load provinces: ${res.status}`);
  const data = (await res.json()) as FeatureCollection<Geometry, ThaiProvinceProps>;
  provincesCache = data;
  return data;
}

async function loadAllDistricts(): Promise<FeatureCollection<Geometry, ThaiDistrictProps>> {
  if (districtsCache) return districtsCache;
  const res = await fetch(withBasePath('/geo/th-districts.geojson'));
  if (!res.ok) throw new Error(`failed to load districts: ${res.status}`);
  const data = (await res.json()) as FeatureCollection<Geometry, ThaiDistrictProps>;
  districtsCache = data;
  return data;
}

// [south, west, north, east] — matches Leaflet's LatLngBoundsExpression row
// shape. Iterates every coordinate so MultiPolygon provinces (Phuket etc.)
// are handled without special-casing.
export type Bounds = [[number, number], [number, number]];

function walkCoords(coords: unknown, cb: (lon: number, lat: number) => void): void {
  if (!Array.isArray(coords)) return;
  if (typeof coords[0] === 'number' && typeof coords[1] === 'number') {
    cb(coords[0] as number, coords[1] as number);
    return;
  }
  for (const c of coords) walkCoords(c, cb);
}

export function computeBounds(fc: FeatureCollection): Bounds | null {
  let minLat = Infinity;
  let minLon = Infinity;
  let maxLat = -Infinity;
  let maxLon = -Infinity;
  let seen = false;
  for (const f of fc.features) {
    const g = f.geometry as { coordinates?: unknown } | null;
    if (!g || !g.coordinates) continue;
    walkCoords(g.coordinates, (lon, lat) => {
      seen = true;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
      if (lon < minLon) minLon = lon;
      if (lon > maxLon) maxLon = lon;
    });
  }
  if (!seen) return null;
  return [
    [minLat, minLon],
    [maxLat, maxLon],
  ];
}

export function districtCentroids(
  districts: FeatureCollection<Geometry, ThaiDistrictProps>,
): Record<string, { lat: number; lon: number }> {
  const out: Record<string, { lat: number; lon: number }> = {};
  for (const f of districts.features) {
    const code = f.properties?.amp_code;
    if (!code || !f.geometry) continue;
    let latSum = 0;
    let lonSum = 0;
    let n = 0;
    walkCoords((f.geometry as { coordinates?: unknown }).coordinates, (lon, lat) => {
      latSum += lat;
      lonSum += lon;
      n += 1;
    });
    if (n > 0) out[code] = { lat: latSum / n, lon: lonSum / n };
  }
  return out;
}

export async function loadProvinceShapes(provinceCode: string): Promise<ProvinceShapes> {
  const [allProvinces, allDistricts] = await Promise.all([
    loadAllProvinces(),
    loadAllDistricts(),
  ]);

  const provinceFeatures = allProvinces.features.filter(
    (f) => f.properties?.pro_code === provinceCode,
  ) as Feature<Geometry, ThaiProvinceProps>[];
  const districtFeatures = allDistricts.features.filter(
    (f) => f.properties?.pro_code === provinceCode,
  ) as Feature<Geometry, ThaiDistrictProps>[];

  return {
    province: { type: 'FeatureCollection', features: provinceFeatures },
    districts: { type: 'FeatureCollection', features: districtFeatures },
  };
}
