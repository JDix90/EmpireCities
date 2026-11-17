#!/usr/bin/env tsx
/**
 * Build the Strait of Hormuz map (`community_strait_of_hormuz`) from Natural Earth.
 *
 * Every territory is a real place: a whole province (an emirate, a governorate,
 * Bahrain, Qatar), or the part of a large province nearest to its town. The
 * large provinces (Bushehr, Fars, Hormozgan, Sistan and Baluchestan, Abu Dhabi,
 * Saudi Arabia's Eastern Province) are split between their territories' towns
 * by a Voronoi diagram computed inside each province, so a split never crosses
 * a real border and never leaves land unassigned. Islands are given out by
 * name, not by position. Nothing is drawn at sea except a small territorial
 * water ring around the two groups of islets too small to tap.
 *
 * It writes:
 * - frontend/public/geo/strait_of_hormuz_admin1.json: the map's admin-1 subset.
 *   Provinces used whole keep their Natural Earth `iso_3166_2` code; a piece of
 *   a split province gets the province's code plus `~TERRITORY` (Natural Earth
 *   marks its own unofficial codes with `~`, e.g. `AE-X01~`). The globe and the
 *   2D map resolve these through the generic `admin1` path
 *   (globeTerritoryGeometry.ts) via REGIONAL_ADMIN1_SUBSET.
 * - database/maps/community_strait_of_hormuz.json and its public copy, with
 *   `admin1` per territory, a `geo_polygon` fallback, canvas polygons and
 *   connections (land from the geometry, sea from the curated list below).
 *
 * Usage (Natural Earth is public domain; the 41 MB file is not committed):
 *   curl -L -o /tmp/ne10m.geojson \
 *     https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_admin_1_states_provinces.geojson
 *   pnpm -C frontend exec tsx scripts/buildStraitOfHormuz.ts /tmp/ne10m.geojson
 */
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { intersection, union, difference } from 'polyclip-ts';
import voronoi from '@turf/voronoi';
import buffer from '@turf/buffer';
import turfArea from '@turf/area';
import booleanPointInPolygon from '@turf/boolean-point-in-polygon';
import rewind from '@turf/rewind';
import { feature, featureCollection, point, polygon as turfPolygon, multiPolygon as turfMultiPolygon } from '@turf/helpers';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..', '..');

type Ring = [number, number][];
type Poly = Ring[];
type MultiPoly = Poly[];
type LngLat = [number, number];

export const MAP_ID = 'community_strait_of_hormuz';
const BOUNDS = { minLng: 48.8, maxLng: 61.0, minLat: 22.2, maxLat: 29.6 };

export const REGIONS: { region_id: string; name: string; bonus: number }[] = [
  { region_id: 'bushehr_fars', name: 'Bushehr & Fars', bonus: 3 },
  { region_id: 'hormozgan', name: 'Hormozgan', bonus: 2 },
  { region_id: 'makran', name: 'Makran Coast', bonus: 1 },
  { region_id: 'islands', name: 'Islands of the Strait', bonus: 2 },
  { region_id: 'abu_dhabi', name: 'Abu Dhabi', bonus: 2 },
  { region_id: 'northern_emirates', name: 'Northern Emirates', bonus: 3 },
  { region_id: 'gulf_west', name: 'Bahrain, Qatar & Al-Hasa', bonus: 3 },
  { region_id: 'oman', name: 'Oman', bonus: 4 },
];

/**
 * How a territory takes land from a province:
 * - `whole`: all of it (inside the map's bounds);
 * - `split`: the part nearest this territory's seed among the province's other `split` takers;
 * - `islands`: the named island parts (each found by a point on it), nothing else.
 */
type Take =
  | { code: string; mode: 'whole' }
  | { code: string; mode: 'split' }
  | { code: string; mode: 'islands'; points: LngLat[] };

export interface TerritoryDef {
  id: string;
  name: string;
  region: string;
  /** The town the territory is named for; split provinces are divided between these. */
  seed: LngLat;
  take: Take[];
  /** Hand-placed islets missing from Natural Earth: [lng, lat, radius km]. */
  islets?: [number, number, number][];
  /** Territorial-water ring (km) around the territory's islands, for islets too small to tap. */
  haloKm?: number;
}

export const TERRITORIES: TerritoryDef[] = [
  // ── Bushehr & Fars ────────────────────────────────────────────────────────
  { id: 'bushehr', name: 'Bushehr', region: 'bushehr_fars', seed: [50.84, 28.97], take: [{ code: 'IR-06', mode: 'split' }] },
  { id: 'kangan', name: 'Kangan & Asaluyeh', region: 'bushehr_fars', seed: [52.2, 27.75], take: [{ code: 'IR-06', mode: 'split' }] },
  { id: 'firuzabad', name: 'Firuzabad & Jahrom', region: 'bushehr_fars', seed: [52.9, 28.75], take: [{ code: 'IR-14', mode: 'split' }] },
  { id: 'larestan', name: 'Larestan', region: 'bushehr_fars', seed: [54.34, 27.68], take: [{ code: 'IR-14', mode: 'split' }] },
  // ── Hormozgan ─────────────────────────────────────────────────────────────
  { id: 'bandar_lengeh', name: 'Lengeh & Bastak', region: 'hormozgan', seed: [54.6, 26.95], take: [{ code: 'IR-23', mode: 'split' }] },
  { id: 'bandar_abbas', name: 'Bandar Abbas', region: 'hormozgan', seed: [56.27, 27.3], take: [{ code: 'IR-23', mode: 'split' }] },
  { id: 'minab', name: 'Minab & Rudan', region: 'hormozgan', seed: [57.3, 27.2], take: [{ code: 'IR-23', mode: 'split' }] },
  // ── Makran Coast ──────────────────────────────────────────────────────────
  { id: 'jask', name: 'Jask & Bashagard', region: 'makran', seed: [58.1, 26.0], take: [{ code: 'IR-23', mode: 'split' }] },
  { id: 'chabahar', name: 'Chabahar', region: 'makran', seed: [60.3, 25.6], take: [{ code: 'IR-13', mode: 'whole' }] },
  // ── Islands of the Strait ─────────────────────────────────────────────────
  {
    id: 'qeshm',
    name: 'Qeshm & Hormuz',
    region: 'islands',
    seed: [55.9, 26.8],
    // Qeshm County: Qeshm, Hengam, Hormuz and Larak.
    take: [{ code: 'IR-23', mode: 'islands', points: [[55.85, 26.8], [55.89, 26.64], [56.46, 27.06], [56.35, 26.86]] }],
  },
  {
    id: 'kish',
    name: 'Kish & Lavan',
    region: 'islands',
    seed: [53.98, 26.53],
    // Kish, Lavan, Hendurabi and Forur.
    take: [{ code: 'IR-23', mode: 'islands', points: [[53.98, 26.53], [53.27, 26.82], [53.63, 26.67], [54.52, 26.29]] }],
    haloKm: 9,
  },
  {
    id: 'abu_musa',
    name: 'Abu Musa & Tunbs',
    region: 'islands',
    seed: [55.03, 25.88],
    take: [{ code: 'IR-23', mode: 'islands', points: [[55.03, 25.88], [54.54, 25.91]] }],
    // Greater and Lesser Tunb are not in Natural Earth's admin-1 set.
    islets: [[55.305, 26.265, 1.8], [55.145, 26.242, 0.8]],
    haloKm: 9,
  },
  // ── Abu Dhabi ─────────────────────────────────────────────────────────────
  { id: 'abu_dhabi', name: 'Abu Dhabi', region: 'abu_dhabi', seed: [54.37, 24.45], take: [{ code: 'AE-AZ', mode: 'split' }] },
  // Seeded toward Liwa, so the capital's district stays on the coast and Liwa and the south are Al Dhafra's.
  { id: 'al_dhafra', name: 'Al Dhafra & Liwa', region: 'abu_dhabi', seed: [53.3, 23.3], take: [{ code: 'AE-AZ', mode: 'split' }] },
  { id: 'al_ain', name: 'Al Ain', region: 'abu_dhabi', seed: [55.74, 24.21], take: [{ code: 'AE-AZ', mode: 'split' }] },
  // ── Northern Emirates ─────────────────────────────────────────────────────
  { id: 'dubai', name: 'Dubai', region: 'northern_emirates', seed: [55.3, 25.2], take: [{ code: 'AE-DU', mode: 'whole' }] },
  {
    id: 'sharjah',
    name: 'Sharjah, Ajman & UAQ',
    region: 'northern_emirates',
    seed: [55.45, 25.33],
    take: [
      { code: 'AE-SH', mode: 'whole' },
      { code: 'AE-AJ', mode: 'whole' },
      { code: 'AE-UQ', mode: 'whole' },
      // Under joint Ajman–Oman control.
      { code: 'AE-X02~', mode: 'whole' },
    ],
  },
  { id: 'ras_al_khaimah', name: 'Ras al-Khaimah', region: 'northern_emirates', seed: [55.95, 25.75], take: [{ code: 'AE-RK', mode: 'whole' }] },
  {
    id: 'fujairah',
    name: 'Fujairah',
    region: 'northern_emirates',
    seed: [56.33, 25.13],
    // Plus the Fujairah–Sharjah joint zone.
    take: [{ code: 'AE-FU', mode: 'whole' }, { code: 'AE-X01~', mode: 'whole' }],
  },
  // ── Bahrain, Qatar & Al-Hasa ──────────────────────────────────────────────
  {
    id: 'bahrain',
    name: 'Bahrain',
    region: 'gulf_west',
    seed: [50.56, 26.12],
    take: ['BH-13', 'BH-14', 'BH-15', 'BH-16', 'BH-17'].map((code) => ({ code, mode: 'whole' as const })),
  },
  {
    id: 'qatar',
    name: 'Qatar',
    region: 'gulf_west',
    seed: [51.25, 25.3],
    take: ['QA-DA', 'QA-RA', 'QA-WA', 'QA-ZA', 'QA-US', 'QA-KH', 'QA-MS'].map((code) => ({ code, mode: 'whole' as const })),
  },
  { id: 'dammam', name: 'Dammam & Qatif', region: 'gulf_west', seed: [50.1, 26.43], take: [{ code: 'SA-04', mode: 'split' }] },
  { id: 'al_ahsa', name: 'Al-Ahsa', region: 'gulf_west', seed: [49.59, 25.38], take: [{ code: 'SA-04', mode: 'split' }] },
  { id: 'empty_quarter', name: 'Empty Quarter', region: 'gulf_west', seed: [51.6, 23.1], take: [{ code: 'SA-04', mode: 'split' }] },
  // ── Oman ──────────────────────────────────────────────────────────────────
  { id: 'musandam', name: 'Musandam', region: 'oman', seed: [56.25, 26.2], take: [{ code: 'OM-MU', mode: 'whole' }] },
  { id: 'sohar', name: 'Sohar & Batinah', region: 'oman', seed: [56.74, 24.36], take: [{ code: 'OM-BA', mode: 'whole' }] },
  { id: 'rustaq', name: 'Rustaq & Barka', region: 'oman', seed: [57.42, 23.39], take: [{ code: 'OM-BJ', mode: 'whole' }] },
  { id: 'muscat', name: 'Muscat', region: 'oman', seed: [58.4, 23.6], take: [{ code: 'OM-MA', mode: 'whole' }] },
  {
    id: 'buraimi',
    name: 'Buraimi & Ibri',
    region: 'oman',
    seed: [56.2, 23.6],
    take: [{ code: 'OM-BU', mode: 'whole' }, { code: 'OM-ZA', mode: 'whole' }],
  },
  { id: 'nizwa', name: 'Nizwa', region: 'oman', seed: [57.53, 22.93], take: [{ code: 'OM-DA', mode: 'whole' }] },
  {
    id: 'sharqiyah',
    name: 'Sur & Sharqiyah',
    region: 'oman',
    seed: [59.0, 22.6],
    take: [{ code: 'OM-SS', mode: 'whole' }, { code: 'OM-SH', mode: 'whole' }],
  },
];

/** A province clipped before it is shared out: Sistan and Baluchestan only along its Makran coast. */
const UNIT_CLIPS: Record<string, [number, number, number, number]> = {
  'IR-13': [58.5, 24.8, 61.0, 26.6],
};

/**
 * Sea crossings. Land links come from the geometry; these are the water
 * crossings worth fighting over, each between coasts that face each other.
 */
export const SEA_LINKS: [string, string][] = [
  // The Strait itself.
  ['qeshm', 'bandar_abbas'],
  ['qeshm', 'bandar_lengeh'],
  ['qeshm', 'musandam'],
  ['qeshm', 'minab'],
  ['musandam', 'bandar_abbas'],
  ['musandam', 'jask'],
  // The islands.
  ['kish', 'bandar_lengeh'],
  ['kish', 'larestan'],
  ['kish', 'kangan'],
  ['kish', 'abu_musa'],
  ['abu_musa', 'bandar_lengeh'],
  ['abu_musa', 'qeshm'],
  ['abu_musa', 'sharjah'],
  ['abu_musa', 'ras_al_khaimah'],
  ['abu_musa', 'dubai'],
  // Across the Gulf.
  ['kangan', 'qatar'],
  ['bushehr', 'dammam'],
  ['bahrain', 'dammam'],
  ['bahrain', 'qatar'],
  ['bahrain', 'al_ahsa'],
  ['qatar', 'al_dhafra'],
  ['kish', 'abu_dhabi'],
  // The Gulf of Oman.
  ['jask', 'fujairah'],
  ['jask', 'sohar'],
  ['chabahar', 'muscat'],
  ['chabahar', 'sharqiyah'],
];

// ── geometry helpers ─────────────────────────────────────────────────────────

function asMulti(g: GeoJSON.Polygon | GeoJSON.MultiPolygon): MultiPoly {
  return (g.type === 'Polygon' ? [g.coordinates] : g.coordinates) as MultiPoly;
}

function bboxPoly([w, s, e, n]: [number, number, number, number]): MultiPoly {
  return [[[[w, s], [e, s], [e, n], [w, n], [w, s]]]];
}

const BOUNDS_POLY = bboxPoly([BOUNDS.minLng, BOUNDS.minLat, BOUNDS.maxLng, BOUNDS.maxLat]);

function clipMP(a: MultiPoly, b: MultiPoly): MultiPoly {
  if (a.length === 0 || b.length === 0) return [];
  return intersection(a as never, b as never) as unknown as MultiPoly;
}

function unionMP(parts: MultiPoly[]): MultiPoly {
  const nonEmpty = parts.filter((p) => p.length > 0);
  if (nonEmpty.length === 0) return [];
  if (nonEmpty.length === 1) return nonEmpty[0];
  return union(nonEmpty[0] as never, ...(nonEmpty.slice(1) as never[])) as unknown as MultiPoly;
}

function minusMP(a: MultiPoly, b: MultiPoly): MultiPoly {
  if (a.length === 0 || b.length === 0) return a;
  return difference(a as never, b as never) as unknown as MultiPoly;
}

function km2(mp: MultiPoly): number {
  return mp.length === 0 ? 0 : turfArea(turfMultiPolygon(mp)) / 1e6;
}

function circle([lng, lat, km]: [number, number, number]): MultiPoly {
  const b = buffer(point([lng, lat]), km, { units: 'kilometers', steps: 12 });
  return b ? asMulti(b.geometry) : [];
}

function haloOf(mp: MultiPoly, km: number): MultiPoly {
  const b = buffer(turfMultiPolygon(mp), km, { units: 'kilometers', steps: 8 });
  return b ? asMulti(b.geometry) : [];
}

/**
 * Douglas–Peucker on a closed ring, in degrees; keeps the ring closed. A closed
 * ring starts and ends on the same point, which leaves no baseline to measure
 * from, so it is split at the vertex farthest from its start and each half
 * simplified on its own.
 */
function simplifyRing(ring: Ring, tol: number): Ring {
  if (ring.length <= 5) return ring;
  let far = 1;
  let farD = -1;
  for (let i = 1; i < ring.length - 1; i += 1) {
    const d = Math.hypot(ring[i][0] - ring[0][0], ring[i][1] - ring[0][1]);
    if (d > farD) {
      farD = d;
      far = i;
    }
  }
  const first = simplifyLine(ring.slice(0, far + 1), tol);
  const second = simplifyLine(ring.slice(far), tol);
  return [...first, ...second.slice(1)];
}

/** Douglas–Peucker on an open line, in degrees. */
function simplifyLine(ring: Ring, tol: number): Ring {
  if (ring.length <= 2) return ring;
  const keep = new Uint8Array(ring.length);
  keep[0] = 1;
  keep[ring.length - 1] = 1;
  const stack: [number, number][] = [[0, ring.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    const [ax, ay] = ring[a];
    const [bx, by] = ring[b];
    const dx = bx - ax;
    const dy = by - ay;
    const len = Math.hypot(dx, dy) || 1e-12;
    let maxD = -1;
    let idx = -1;
    for (let i = a + 1; i < b; i += 1) {
      const d = Math.abs(dy * ring[i][0] - dx * ring[i][1] + bx * ay - by * ax) / len;
      if (d > maxD) {
        maxD = d;
        idx = i;
      }
    }
    if (maxD > tol && idx > 0) {
      keep[idx] = 1;
      stack.push([a, idx], [idx, b]);
    }
  }
  return ring.filter((_, i) => keep[i]);
}

function round4(mp: MultiPoly): MultiPoly {
  return mp.map((poly) =>
    poly.map((ring) => {
      const out: Ring = [];
      for (const [x, y] of ring) {
        const p: [number, number] = [Math.round(x * 1e4) / 1e4, Math.round(y * 1e4) / 1e4];
        const last = out[out.length - 1];
        if (!last || last[0] !== p[0] || last[1] !== p[1]) out.push(p);
      }
      return out;
    }).filter((ring) => ring.length >= 4),
  ).filter((poly) => poly.length > 0);
}

/** Largest polygon (by area) of a multipolygon. */
function largestPart(mp: MultiPoly): Poly {
  let best = mp[0];
  let bestArea = -1;
  for (const poly of mp) {
    const a = turfArea(turfPolygon(poly));
    if (a > bestArea) {
      bestArea = a;
      best = poly;
    }
  }
  return best;
}

/** A well-inside label point for a polygon (grid search for the point farthest from its edges). */
function labelPoint(poly: Poly): LngLat {
  const outer = poly[0];
  const xs = outer.map((p) => p[0]);
  const ys = outer.map((p) => p[1]);
  const [w, e, s, n] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const f = turfPolygon(poly);
  let best: LngLat = [(w + e) / 2, (s + n) / 2];
  let bestD = -1;
  const N = 40;
  const cosLat = Math.cos(((s + n) / 2) * (Math.PI / 180));
  for (let i = 0; i <= N; i += 1) {
    for (let j = 0; j <= N; j += 1) {
      const p: LngLat = [w + ((e - w) * i) / N, s + ((n - s) * j) / N];
      if (!booleanPointInPolygon(point(p), f)) continue;
      let d = Infinity;
      for (const ring of poly) {
        for (let k = 0; k < ring.length - 1; k += 1) {
          const [x1, y1] = ring[k];
          const [x2, y2] = ring[k + 1];
          const vx = (x2 - x1) * cosLat;
          const vy = y2 - y1;
          const wx = (p[0] - x1) * cosLat;
          const wy = p[1] - y1;
          const t = Math.max(0, Math.min(1, (vx * wx + vy * wy) / (vx * vx + vy * vy || 1e-12)));
          d = Math.min(d, Math.hypot(wx - t * vx, wy - t * vy));
        }
      }
      if (d > bestD) {
        bestD = d;
        best = p;
      }
    }
  }
  return best;
}

function autoCanvas(width = 1200): [number, number] {
  const midLat = (BOUNDS.minLat + BOUNDS.maxLat) / 2;
  const aspect = ((BOUNDS.maxLng - BOUNDS.minLng) * Math.cos((midLat * Math.PI) / 180)) / (BOUNDS.maxLat - BOUNDS.minLat);
  return [width, Math.max(10, Math.round(width / aspect / 10) * 10)];
}

// ── build ────────────────────────────────────────────────────────────────────

export interface BuiltTerritory {
  def: TerritoryDef;
  /** Subset features: code → geometry (whole provinces under their own code, pieces under `CODE~ID`). */
  pieces: Map<string, MultiPoly>;
  /** Everything drawn, water rings included. */
  geometry: MultiPoly;
  /** Land only: what land links are measured on. */
  land: MultiPoly;
}

export function buildTerritories(neFile: string): { built: BuiltTerritory[]; units: Map<string, MultiPoly> } {
  const ne = JSON.parse(fs.readFileSync(neFile, 'utf-8')) as GeoJSON.FeatureCollection;
  const codes = new Set(TERRITORIES.flatMap((t) => t.take.map((k) => k.code)));
  const units = new Map<string, MultiPoly>();
  for (const f of ne.features) {
    const code = f.properties?.iso_3166_2 as string | undefined;
    if (!code || !codes.has(code) || !f.geometry) continue;
    if (f.geometry.type !== 'Polygon' && f.geometry.type !== 'MultiPolygon') continue;
    let mp = clipMP(asMulti(f.geometry), BOUNDS_POLY);
    if (UNIT_CLIPS[code]) mp = clipMP(mp, bboxPoly(UNIT_CLIPS[code]));
    units.set(code, mp);
  }
  for (const code of codes) if (!units.has(code)) throw new Error(`Natural Earth has no ${code}`);

  const built = new Map<string, BuiltTerritory>(
    TERRITORIES.map((def) => [def.id, { def, pieces: new Map(), geometry: [], land: [] }]),
  );

  // 1. Islands by name: each point picks the part of its province it lies on.
  const pool = new Map<string, MultiPoly>([...units].map(([c, mp]) => [c, mp.map((p) => p)]));
  for (const def of TERRITORIES) {
    for (const take of def.take) {
      if (take.mode !== 'islands') continue;
      const parts = pool.get(take.code)!;
      const mine: MultiPoly = [];
      for (const pt of take.points) {
        let idx = parts.findIndex((poly) => booleanPointInPolygon(point(pt), turfPolygon(poly)));
        if (idx < 0) {
          // A point just off a small island's simplified coast: take the nearest small part within 12 km.
          let bestD = Infinity;
          parts.forEach((poly, i) => {
            const [cx, cy] = labelPoint(poly);
            const d = Math.hypot((cx - pt[0]) * Math.cos((pt[1] * Math.PI) / 180), cy - pt[1]) * 111;
            if (d < bestD && turfArea(turfPolygon(poly)) < 2e9) {
              bestD = d;
              idx = i;
            }
          });
          if (bestD > 12) throw new Error(`${def.id}: no island near ${pt}`);
        }
        mine.push(parts[idx]);
        parts.splice(idx, 1);
      }
      built.get(def.id)!.pieces.set(`${take.code}~${def.id.toUpperCase()}`, mine);
    }
  }

  // 2. Whole provinces, and provinces split between their takers' towns.
  for (const [code, remaining] of pool) {
    const takers = TERRITORIES.filter((t) => t.take.some((k) => k.code === code && k.mode !== 'islands'));
    if (takers.length === 0) continue;
    const modes = new Set(takers.map((t) => t.take.find((k) => k.code === code)!.mode));
    if (modes.size !== 1) throw new Error(`${code}: mixed whole/split takers`);
    if (modes.has('whole')) {
      if (takers.length !== 1) throw new Error(`${code}: whole province with ${takers.length} takers`);
      built.get(takers[0].id)!.pieces.set(code, remaining);
      continue;
    }
    const fc = featureCollection(takers.map((t) => point(t.seed, { id: t.id })));
    const cells = voronoi(fc, { bbox: [BOUNDS.minLng - 5, BOUNDS.minLat - 5, BOUNDS.maxLng + 5, BOUNDS.maxLat + 5] });
    takers.forEach((t, i) => {
      const cell = cells.features[i];
      if (!cell?.geometry) throw new Error(`${code}: no Voronoi cell for ${t.id}`);
      const piece = clipMP(remaining, asMulti(cell.geometry));
      if (piece.length === 0) throw new Error(`${code}: ${t.id} got no land`);
      built.get(t.id)!.pieces.set(`${code}~${t.id.toUpperCase()}`, piece);
    });
  }

  // 3. Hand-placed islets, then the water rings, which may not cover anyone else's land.
  for (const b of built.values()) {
    if (b.def.islets) {
      const key = [...b.pieces.keys()][0];
      b.pieces.set(key, unionMP([b.pieces.get(key)!, ...b.def.islets.map(circle)]));
    }
  }
  const landOf = (b: BuiltTerritory) => unionMP([...b.pieces.values()]);
  for (const b of built.values()) b.land = round4(landOf(b));
  // A water ring stops 2 km short of anyone else's coast, so it never reads as joined to it.
  const othersCoast = (b: BuiltTerritory) =>
    haloOf(unionMP([...built.values()].filter((o) => o !== b).map((o) => o.land)), 2);
  for (const b of built.values()) {
    if (!b.def.haloKm) continue;
    const key = [...b.pieces.keys()][0];
    const own = b.pieces.get(key)!;
    const ring = minusMP(haloOf(own, b.def.haloKm), othersCoast(b));
    b.pieces.set(key, unionMP([own, clipMP(ring, BOUNDS_POLY)]));
  }

  for (const b of built.values()) {
    for (const [k, mp] of b.pieces) b.pieces.set(k, round4(mp));
    b.geometry = landOf(b);
  }
  return { built: [...built.values()], units };
}

// ── connections ──────────────────────────────────────────────────────────────

function sharedBorderKm(a: MultiPoly, b: MultiPoly): number {
  // Touching borders: overlap of a thin ring around each. Area / ring width ≈ shared length.
  const ringKm = 0.25;
  const ga = haloOf(a, ringKm);
  const inter = clipMP(ga, b);
  return km2(inter) / ringKm;
}

export function landLinks(built: BuiltTerritory[]): [string, string, number][] {
  const out: [string, string, number][] = [];
  for (let i = 0; i < built.length; i += 1) {
    for (let j = i + 1; j < built.length; j += 1) {
      const a = built[i];
      const b = built[j];
      const km = sharedBorderKm(a.land, b.land);
      if (km >= 2) out.push([a.def.id, b.def.id, Math.round(km)]);
    }
  }
  return out;
}

// ── output ───────────────────────────────────────────────────────────────────

export const NAME = 'Strait of Hormuz';
export const DESCRIPTION =
  "The world's busiest oil chokepoint and the coasts around it — 31 territories, from Bushehr and the Iranian " +
  'shore of Hormozgan and Makran to the islands of Qeshm, Kish and Abu Musa, the seven emirates, Bahrain, Qatar, ' +
  "Saudi Arabia's Gulf coast and northern Oman with its Musandam exclave. Hold the narrows and every tanker answers to you.";

function main(): void {
  const neFile = process.argv[2];
  if (!neFile || !fs.existsSync(neFile)) {
    console.error('Usage: tsx scripts/buildStraitOfHormuz.ts <ne_10m_admin_1_states_provinces.geojson>');
    process.exit(1);
  }
  const { built } = buildTerritories(neFile);
  const ids = new Set(built.map((b) => b.def.id));
  for (const [a, b] of SEA_LINKS) if (!ids.has(a) || !ids.has(b)) throw new Error(`sea link ${a}-${b}: unknown territory`);

  const land = landLinks(built);
  const landKey = new Set(land.map(([a, b]) => [a, b].sort().join('|')));
  const connections = [
    ...land.map(([a, b]) => ({ from: a, to: b, type: 'land' as const })),
    ...SEA_LINKS.filter(([a, b]) => !landKey.has([a, b].sort().join('|'))).map(([a, b]) => ({ from: a, to: b, type: 'sea' as const })),
  ];

  const [cw, ch] = autoCanvas();
  const project = ([lng, lat]: LngLat): [number, number] => [
    Math.round(((lng - BOUNDS.minLng) / (BOUNDS.maxLng - BOUNDS.minLng)) * cw * 100) / 100,
    Math.round(((BOUNDS.maxLat - lat) / (BOUNDS.maxLat - BOUNDS.minLat)) * ch * 100) / 100,
  ];

  const territories = built.map((b) => {
    const main = largestPart(b.geometry);
    const outer = simplifyRing(main[0], 0.01);
    return {
      territory_id: b.def.id,
      name: b.def.name,
      polygon: outer.slice(0, -1).map(project),
      center_point: project(labelPoint(main)),
      region_id: b.def.region,
      geo_polygon: outer.slice(0, -1).map(([x, y]) => [Math.round(x * 1000) / 1000, Math.round(y * 1000) / 1000]),
      admin1: [...b.pieces.keys()],
    };
  });

  const map = {
    map_id: MAP_ID,
    name: NAME,
    description: DESCRIPTION,
    era_theme: 'custom',
    canvas_width: cw,
    canvas_height: ch,
    projection_bounds: BOUNDS,
    globe_view: { lock_rotation: true, center_lat: 25.9, center_lng: 54.9, altitude: 0.75 },
    territories,
    connections,
    regions: REGIONS.map((r) => ({ ...r, territory_ids: built.filter((b) => b.def.region === r.region_id).map((b) => b.def.id) })),
    is_public: true,
    play_count: 0,
    creator_id: 'system',
  };

  /**
   * Clockwise exterior rings, as Natural Earth ships them: the globe (d3-geo,
   * spherical) fills a counter-clockwise ring as its complement, which draws as
   * shards. polyclip writes counter-clockwise, and the admin-1 path passes a
   * single-code territory through without the rewind a union would give it.
   */
  const clockwise = (mp: MultiPoly): GeoJSON.Polygon | GeoJSON.MultiPolygon =>
    (rewind(
      feature(mp.length === 1 ? { type: 'Polygon', coordinates: mp[0] } : { type: 'MultiPolygon', coordinates: mp }),
      { reverse: true },
    ) as GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon>).geometry;

  const subset = {
    type: 'FeatureCollection',
    features: built.flatMap((b) =>
      [...b.pieces].map(([code, mp]) => ({
        type: 'Feature',
        properties: {
          iso_3166_2: code,
          territory_id: b.def.id,
          name: b.def.name,
          source: code.includes('~') && !code.endsWith('~')
            ? `Natural Earth ne_10m admin-1 ${code.split('~')[0]}, the part for ${b.def.name} (buildStraitOfHormuz.ts)`
            : `Natural Earth ne_10m admin-1 ${code}`,
        },
        geometry: clockwise(mp),
      })),
    ),
  };

  const mapJson = `${JSON.stringify(map, null, 2)}\n`;
  fs.writeFileSync(path.join(REPO, 'database', 'maps', `${MAP_ID}.json`), mapJson);
  fs.writeFileSync(path.join(REPO, 'frontend', 'public', 'maps', 'regional', `${MAP_ID}.json`), mapJson);
  fs.writeFileSync(path.join(REPO, 'frontend', 'public', 'geo', 'strait_of_hormuz_admin1.json'), `${JSON.stringify(subset)}\n`);

  console.log(`${MAP_ID}: ${territories.length} territories, ${map.regions.length} regions, ${connections.length} connections (${land.length} land), canvas ${cw}x${ch}`);
  for (const b of built) {
    console.log(`  ${b.def.id.padEnd(16)} ${b.def.name.padEnd(32)} ${km2(b.geometry).toFixed(0).padStart(7)} km²  ${[...b.pieces.keys()].join(', ')}`);
  }
  console.log('Land links (shared border km):');
  for (const [a, b, km] of land) console.log(`  ${a} — ${b}  ${km} km`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename_resolved()) main();

function __filename_resolved(): string {
  return fileURLToPath(import.meta.url);
}
