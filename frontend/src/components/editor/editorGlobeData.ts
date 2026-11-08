/**
 * Polygon data for the map editor's globe, kept out of the component so the
 * identity rules can be unit-tested.
 *
 * three-globe stamps an id on each polygon DATUM OBJECT and keys its scene
 * objects by it. A datum created fresh on every render reads as "old polygon
 * gone, new polygon arrived" and its cap is re-tessellated from scratch; with
 * ~240 country outlines in the layer that was a full rebuild of the globe per
 * click. So a datum here carries only what decides its geometry, and is reused
 * until that changes. Selection, hover, region colour and names are looked up
 * live by the globe's accessors, which only touch materials.
 */

import { homelandGeometry } from '../../utils/countryHomeland';

export type PolyGeom = GeoJSON.Polygon | GeoJSON.MultiPolygon;

export interface EditorTerritory {
  territory_id: string;
  name: string;
  polygon: [number, number][];
  center_point: [number, number];
  region_id: string;
  iso_codes?: string[];
  geo_polygon?: [number, number][];
  /** Province geometry: Natural Earth admin-1 iso_3166_2 codes ("US-CA"). */
  admin1?: string[];
}

export interface EditorConnection {
  from: string;
  to: string;
  type: 'land' | 'sea' | 'orbit';
}

export interface EditorRegion {
  region_id: string;
  name: string;
  bonus: number;
}

export type EditorTool = 'select' | 'draw' | 'country_pick' | 'connect' | 'paint' | 'delete';

/** Region colours by region index; the globe reads them with an alpha, the panels as-is. */
export const REGION_COLORS = [
  '#c9a84c', '#e74c3c', '#3498db', '#2ecc71', '#9b59b6',
  '#1abc9c', '#e67e22', '#e91e63', '#00bcd4', '#8bc34a',
];

export function regionColorHex(index: number): string {
  return REGION_COLORS[((index % REGION_COLORS.length) + REGION_COLORS.length) % REGION_COLORS.length];
}

export function regionColorRgba(index: number, alpha: number): string {
  const hex = regionColorHex(index);
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export interface EditorPolygonDatum {
  id: string;
  kind: 'territory' | 'country';
  geometry: PolyGeom;
  isoCode?: string;
  countryName?: string;
}

/**
 * Natural Earth folds these into their parent country's feature;
 * countryHomeland splits them out under their own codes, with no NAME of
 * their own in the file.
 */
export const POSSESSION_NAMES: Record<string, string> = {
  GF: 'French Guiana',
  GP: 'Guadeloupe',
  MQ: 'Martinique',
  YT: 'Mayotte',
  RE: 'Réunion',
  BQ: 'Caribbean Netherlands',
  IC: 'Canary Islands',
  SJ: 'Svalbard',
  TK: 'Tokelau',
  CX: 'Christmas Island',
  CC: 'Cocos Islands',
};

export function featureIsoCode(f: GeoJSON.Feature): string | null {
  const props = f.properties ?? {};
  const iso = props['ISO_A2'] ?? props['iso_a2'];
  const isoEH = props['ISO_A2_EH'] ?? props['iso_a2_eh'];
  const code = iso && iso !== '-99' ? iso : isoEH && isoEH !== '-99' ? isoEH : null;
  return typeof code === 'string' ? code : null;
}

function getPolygonCoordinates(geom: PolyGeom): GeoJSON.Position[][][] {
  if (geom.type === 'Polygon') return [geom.coordinates];
  return geom.coordinates;
}

function mergeGeometries(geometries: PolyGeom[]): GeoJSON.MultiPolygon {
  const polygons: GeoJSON.Position[][][] = [];
  for (const geom of geometries) {
    for (const poly of getPolygonCoordinates(geom)) {
      if (poly?.[0]?.length >= 4) polygons.push(poly);
    }
  }
  return { type: 'MultiPolygon', coordinates: polygons };
}

function singleOrMerged(geometries: PolyGeom[]): PolyGeom | null {
  if (geometries.length === 0) return null;
  if (geometries.length === 1) return geometries[0];
  return mergeGeometries(geometries);
}

/** A key that changes exactly when the territory's rendered geometry would. */
export function territoryGeometryKey(t: EditorTerritory, countriesReady: boolean, provincesReady = false): string {
  if (t.admin1 && t.admin1.length > 0 && provincesReady) return `admin1:${t.admin1.join(',')}`;
  if (t.iso_codes && t.iso_codes.length > 0 && countriesReady) return `iso:${t.iso_codes.join(',')}`;
  if (t.geo_polygon && t.geo_polygon.length >= 3) return `ring:${t.geo_polygon.join(';')}`;
  return 'none';
}

export function territoryGeometry(
  t: EditorTerritory,
  isoToFeatures: Map<string, GeoJSON.Feature[]>,
  admin1ByCode?: Map<string, PolyGeom>,
): PolyGeom | null {
  if (t.admin1 && t.admin1.length > 0 && admin1ByCode && admin1ByCode.size > 0) {
    const geometries: PolyGeom[] = [];
    for (const code of t.admin1) {
      const g = admin1ByCode.get(code);
      if (g) geometries.push(g);
    }
    const merged = singleOrMerged(geometries);
    if (merged) return merged;
  }

  if (t.iso_codes && t.iso_codes.length > 0 && isoToFeatures.size > 0) {
    const geometries: PolyGeom[] = [];
    for (const code of t.iso_codes) {
      for (const f of isoToFeatures.get(code) ?? []) {
        const g = f.geometry;
        if (g && (g.type === 'Polygon' || g.type === 'MultiPolygon')) {
          // Preview what the game draws: a bare code is the homeland only.
          const homeland = homelandGeometry(code, g);
          if (homeland) geometries.push(homeland);
        }
      }
    }
    const merged = singleOrMerged(geometries);
    if (merged) return merged;
  }

  if (t.geo_polygon && t.geo_polygon.length >= 3) {
    const ring: [number, number][] = [...t.geo_polygon];
    if (ring[0][0] !== ring[ring.length - 1][0] || ring[0][1] !== ring[ring.length - 1][1]) {
      ring.push([...ring[0]]);
    }
    return { type: 'Polygon', coordinates: [ring] };
  }

  return null;
}

/**
 * One cached datum per territory, replaced only when its geometry key changes
 * (a new ring, new codes, or the country data arriving). Territories that
 * leave the map leave the cache.
 */
export class TerritoryPolygonCache {
  private readonly entries = new Map<string, { key: string; datum: EditorPolygonDatum }>();

  build(
    territories: EditorTerritory[],
    isoToFeatures: Map<string, GeoJSON.Feature[]>,
    admin1ByCode?: Map<string, PolyGeom>,
  ): EditorPolygonDatum[] {
    const countriesReady = isoToFeatures.size > 0;
    const provincesReady = !!admin1ByCode && admin1ByCode.size > 0;
    const seen = new Set<string>();
    const result: EditorPolygonDatum[] = [];
    for (const t of territories) {
      seen.add(t.territory_id);
      const key = territoryGeometryKey(t, countriesReady, provincesReady);
      const hit = this.entries.get(t.territory_id);
      if (hit && hit.key === key) {
        result.push(hit.datum);
        continue;
      }
      const geometry = territoryGeometry(t, isoToFeatures, admin1ByCode);
      if (!geometry) {
        this.entries.delete(t.territory_id);
        continue;
      }
      const datum: EditorPolygonDatum = { id: t.territory_id, kind: 'territory', geometry };
      this.entries.set(t.territory_id, { key, datum });
      result.push(datum);
    }
    for (const id of Array.from(this.entries.keys())) {
      if (!seen.has(id)) this.entries.delete(id);
    }
    return result;
  }

  get size(): number {
    return this.entries.size;
  }
}

/**
 * Country outlines for the picker, one datum per ISO code, drawn as the game
 * draws a bare code (the homeland, not its overseas pieces). Built once per
 * data load, never per edit.
 */
export function buildCountryData(isoToFeatures: Map<string, GeoJSON.Feature[]>): EditorPolygonDatum[] {
  const result: EditorPolygonDatum[] = [];
  for (const [code, features] of isoToFeatures) {
    const geometries: PolyGeom[] = [];
    let name: string | null = null;
    for (const f of features) {
      const g = f.geometry;
      if (!g || (g.type !== 'Polygon' && g.type !== 'MultiPolygon')) continue;
      const homeland = homelandGeometry(code, g);
      if (homeland) geometries.push(homeland);
      if (name === null) {
        const props = f.properties ?? {};
        const n = props['NAME'] ?? props['name'];
        if (typeof n === 'string') name = n;
      }
    }
    const geometry = singleOrMerged(geometries);
    if (!geometry) continue;
    result.push({
      id: `country_${code}`,
      kind: 'country',
      geometry,
      isoCode: code,
      countryName: name ?? POSSESSION_NAMES[code] ?? code,
    });
  }
  return result;
}
