/**
 * Warfront terrain pipeline — rasterises the western twenty provinces of the Roman 117
 * map into the cell grid that packages/warfront-sim walks on (Slice A step 1;
 * docs/WARFRONT_RTS_MODE.md §10 "Terrain pipeline", decision 28).
 *
 * Run from the repo root:
 *
 *   pnpm run build:warfront-terrain
 *   (= pnpm -C packages/warfront-sim run build && pnpm -C frontend exec tsx --tsconfig tsconfig.node.json scripts/buildWarfrontTerrain.ts)
 *
 * `--tsconfig tsconfig.node.json` matters: the frontend tsconfig aliases
 * `@borderfall/shared` to the package's TypeScript SOURCE, and tsx then compiles that
 * source as CommonJS on the fly, whose re-exports Node's ESM loader cannot see
 * (`does not provide an export named 'inferWorldId'`). The node tsconfig has no
 * aliases, so the package resolves from its built `dist/` like it does everywhere else.
 * The sim package is required from its `dist/` for the same reason.
 *
 * Inputs
 *   database/maps/community_roman_empire_117.json         provinces, typed connections (the lane graph)
 *   frontend/public/geo/ne_50m_admin_0_countries.json     coastlines, via buildTerritoryGlobeGeometries
 *   database/warfront/curated/western_twenty.curation.json HAND-CURATED: passes, forest mask, river list, cell size
 *   database/warfront/sources/*.json                      extracts of Natural Earth 10m rivers + physical regions,
 *                                                         fetched once by this script (`--refresh-sources` re-fetches)
 * Output
 *   database/warfront/western_twenty.terrain.json         GENERATED — never edit by hand
 *
 * Why database/warfront/: the asset is read by the match host (backend, which already
 * resolves database/ by path for map documents), by the lab (Node), and by the client —
 * which gets it through an admin-guarded endpoint rather than from frontend/public/,
 * because anything under public/ is served to every anonymous visitor and every Warfront
 * surface is admin-only until further notice.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { createRequire } from 'module';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { buildTerritoryGlobeGeometries } from '../src/utils/globeTerritoryGeometry';
import type { TerrainAsset, TerrainLane, TerrainProvince } from '../../packages/warfront-sim/src/terrain';

const require = createRequire(import.meta.url);
const sim = require('../../packages/warfront-sim/dist/index.js') as typeof import('../../packages/warfront-sim/src/index');

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '../..');
const MAP_PATH = join(ROOT, 'database/maps/community_roman_empire_117.json');
const COUNTRIES_PATH = join(ROOT, 'frontend/public/geo/ne_50m_admin_0_countries.json');
const CURATION_PATH = join(ROOT, 'database/warfront/curated/western_twenty.curation.json');
const SOURCES_DIR = join(ROOT, 'database/warfront/sources');
const RIVERS_EXTRACT = join(SOURCES_DIR, 'ne_10m_rivers_western.json');
const REGIONS_EXTRACT = join(SOURCES_DIR, 'ne_10m_geography_regions_western.json');
const OUT_PATH = join(ROOT, 'database/warfront/western_twenty.terrain.json');
const GENERATOR = 'frontend/scripts/buildWarfrontTerrain.ts';

const NE_RIVERS_URL =
  'https://cdn.jsdelivr.net/gh/nvkelso/natural-earth-vector@master/geojson/ne_10m_rivers_lake_centerlines.geojson';
const NE_REGIONS_URL =
  'https://cdn.jsdelivr.net/gh/nvkelso/natural-earth-vector@master/geojson/ne_10m_geography_regions_polys.geojson';

const KM_PER_DEG = 111.32;
const REGION_CLASSES = new Set(['Range/mtn', 'Plateau', 'Desert']);

type Position = [number, number];
type Ring = Position[];

interface Curation {
  map_id: string;
  cell_km: number;
  provinces: string[];
  rivers: Array<{ name: string; match: string[] }>;
  ford_spacing_km: number;
  extra_fords: Array<{ name?: string; at: Position }>;
  barrier_ranges: string[];
  highland_plateaus: string[];
  passes: Array<{ name: string; width_km: number; line: Position[] }>;
  forests: Array<{ name: string; ring: Ring }>;
}

interface GridSpec {
  width: number;
  height: number;
  minLng: number;
  maxLng: number;
  minLat: number;
  maxLat: number;
  dLng: number;
  dLat: number;
  lat0: number;
}

function log(msg: string): void {
  process.stdout.write(`${msg}\n`);
}

function polygonsOf(g: GeoJSON.Geometry): Ring[][] {
  if (g.type === 'Polygon') return [g.coordinates as Ring[]];
  if (g.type === 'MultiPolygon') return g.coordinates as Ring[][];
  return [];
}

function linesOf(g: GeoJSON.Geometry): Position[][] {
  if (g.type === 'LineString') return [g.coordinates as Position[]];
  if (g.type === 'MultiLineString') return g.coordinates as Position[][];
  return [];
}

function touchesBox(g: GeoJSON.Geometry, box: { minLng: number; maxLng: number; minLat: number; maxLat: number }): boolean {
  let hit = false;
  const walk = (c: unknown): void => {
    if (hit) return;
    if (Array.isArray(c) && typeof c[0] === 'number') {
      const [x, y] = c as number[];
      if (x >= box.minLng && x <= box.maxLng && y >= box.minLat && y <= box.maxLat) hit = true;
    } else if (Array.isArray(c)) {
      for (const child of c) walk(child);
    }
  };
  walk((g as { coordinates: unknown }).coordinates);
  return hit;
}

function roundCoords(c: unknown): unknown {
  if (Array.isArray(c) && typeof c[0] === 'number') return (c as number[]).map((v) => Math.round(v * 1e5) / 1e5);
  if (Array.isArray(c)) return c.map(roundCoords);
  return c;
}

async function fetchJson(url: string): Promise<GeoJSON.FeatureCollection> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return (await res.json()) as GeoJSON.FeatureCollection;
}

/** Fetches the Natural Earth files once and keeps bbox-filtered, trimmed extracts under sources/. */
async function ensureSources(box: GridSpec, refresh: boolean): Promise<void> {
  mkdirSync(SOURCES_DIR, { recursive: true });
  const wide = { minLng: box.minLng - 1, maxLng: box.maxLng + 1, minLat: box.minLat - 1, maxLat: box.maxLat + 1 };
  if (refresh || !existsSync(RIVERS_EXTRACT)) {
    log(`fetching ${NE_RIVERS_URL}`);
    const all = await fetchJson(NE_RIVERS_URL);
    const features = all.features
      .filter((f) => f.geometry && touchesBox(f.geometry, wide))
      .map((f) => ({
        type: 'Feature' as const,
        properties: {
          name: f.properties?.name ?? null,
          name_en: f.properties?.name_en ?? null,
          featurecla: f.properties?.featurecla ?? null,
          scalerank: f.properties?.scalerank ?? null,
        },
        geometry: { ...f.geometry, coordinates: roundCoords((f.geometry as { coordinates: unknown }).coordinates) } as GeoJSON.Geometry,
      }));
    writeFileSync(
      RIVERS_EXTRACT,
      JSON.stringify({ type: 'FeatureCollection', source: NE_RIVERS_URL, generator: GENERATOR, features }) + '\n',
    );
    log(`  wrote ${features.length} river features to ${RIVERS_EXTRACT}`);
  }
  if (refresh || !existsSync(REGIONS_EXTRACT)) {
    log(`fetching ${NE_REGIONS_URL}`);
    const all = await fetchJson(NE_REGIONS_URL);
    const features = all.features
      .filter((f) => f.geometry && REGION_CLASSES.has(String(f.properties?.FEATURECLA)) && touchesBox(f.geometry, wide))
      .map((f) => ({
        type: 'Feature' as const,
        properties: { featurecla: f.properties?.FEATURECLA ?? null, name: f.properties?.NAME ?? null },
        geometry: { ...f.geometry, coordinates: roundCoords((f.geometry as { coordinates: unknown }).coordinates) } as GeoJSON.Geometry,
      }));
    writeFileSync(
      REGIONS_EXTRACT,
      JSON.stringify({ type: 'FeatureCollection', source: NE_REGIONS_URL, generator: GENERATOR, features }) + '\n',
    );
    log(`  wrote ${features.length} physical-region features to ${REGIONS_EXTRACT}`);
  }
}

/** Even-odd scanline fill: visits every cell whose CENTRE lies inside the polygon. */
function fillPolygon(rings: Ring[], grid: GridSpec, visit: (col: number, row: number) => void): void {
  let minLat = Infinity;
  let maxLat = -Infinity;
  for (const ring of rings) for (const [, y] of ring) {
    if (y < minLat) minLat = y;
    if (y > maxLat) maxLat = y;
  }
  const rowStart = Math.max(0, Math.floor((grid.maxLat - maxLat) / grid.dLat) - 1);
  const rowEnd = Math.min(grid.height - 1, Math.ceil((grid.maxLat - minLat) / grid.dLat) + 1);
  const xs: number[] = [];
  for (let row = rowStart; row <= rowEnd; row++) {
    const latc = grid.maxLat - (row + 0.5) * grid.dLat;
    xs.length = 0;
    for (const ring of rings) {
      for (let i = 0, n = ring.length; i < n; i++) {
        const a = ring[i];
        const b = ring[(i + 1) % n];
        if (a[1] <= latc === b[1] <= latc) continue;
        xs.push(a[0] + ((latc - a[1]) * (b[0] - a[0])) / (b[1] - a[1]));
      }
    }
    if (xs.length < 2) continue;
    xs.sort((p, q) => p - q);
    for (let i = 0; i + 1 < xs.length; i += 2) {
      const c0 = Math.max(0, Math.ceil((xs[i] - grid.minLng) / grid.dLng - 0.5));
      const c1 = Math.min(grid.width - 1, Math.floor((xs[i + 1] - grid.minLng) / grid.dLng - 0.5));
      for (let c = c0; c <= c1; c++) visit(c, row);
    }
  }
}

/** 4-connected rasterisation of a polyline (so a river blocks diagonals too), with arc length callbacks. */
function traceLine(
  line: Position[],
  grid: GridSpec,
  visit: (col: number, row: number) => void,
  everyKm: number,
  atKm: (lng: number, lat: number) => void,
): void {
  let travelled = 0;
  let nextMark = everyKm / 2;
  let prevCol = -1;
  let prevRow = -1;
  const mark = (col: number, row: number): void => {
    if (col === prevCol && row === prevRow) return;
    if (prevCol >= 0 && col !== prevCol && row !== prevRow) visit(prevCol, row); // keep 4-connectivity
    visit(col, row);
    prevCol = col;
    prevRow = row;
  };
  for (let i = 0; i + 1 < line.length; i++) {
    const [x0, y0] = line[i];
    const [x1, y1] = line[i + 1];
    const kmX = (x1 - x0) * KM_PER_DEG * Math.cos((((y0 + y1) / 2) * Math.PI) / 180);
    const kmY = (y1 - y0) * KM_PER_DEG;
    const segKm = Math.hypot(kmX, kmY);
    const steps = Math.max(1, Math.ceil((segKm / grid.dLat / KM_PER_DEG) * 5));
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const lng = x0 + (x1 - x0) * t;
      const lat = y0 + (y1 - y0) * t;
      const col = Math.floor((lng - grid.minLng) / grid.dLng);
      const row = Math.floor((grid.maxLat - lat) / grid.dLat);
      if (col >= 0 && row >= 0 && col < grid.width && row < grid.height) mark(col, row);
      if (s > 0) {
        travelled += segKm / steps;
        while (travelled >= nextMark) {
          atKm(lng, lat);
          nextMark += everyKm;
        }
      }
    }
  }
}

/** Distance in km from a point to a polyline, in a local equirectangular frame. */
function distanceToLineKm(lng: number, lat: number, line: Position[]): number {
  const k = KM_PER_DEG * Math.cos((lat * Math.PI) / 180);
  let best = Infinity;
  for (let i = 0; i + 1 < line.length; i++) {
    const ax = (line[i][0] - lng) * k;
    const ay = (line[i][1] - lat) * KM_PER_DEG;
    const bx = (line[i + 1][0] - lng) * k;
    const by = (line[i + 1][1] - lat) * KM_PER_DEG;
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2));
    const px = ax + t * dx;
    const py = ay + t * dy;
    best = Math.min(best, Math.hypot(px, py));
  }
  return best;
}

async function main(): Promise<void> {
  const refresh = process.argv.includes('--refresh-sources');
  const curation = JSON.parse(readFileSync(CURATION_PATH, 'utf8')) as Curation;
  const map = JSON.parse(readFileSync(MAP_PATH, 'utf8')) as {
    map_id: string;
    territories: Array<{ territory_id: string; name: string }>;
    connections: Array<{ from: string; to: string; type: string }>;
  };
  if (map.map_id !== curation.map_id) throw new Error(`curation is for ${curation.map_id}, map is ${map.map_id}`);
  const wanted = new Set(curation.provinces);
  const territories = map.territories.filter((t) => wanted.has(t.territory_id));
  if (territories.length !== curation.provinces.length) {
    const missing = curation.provinces.filter((p) => !map.territories.some((t) => t.territory_id === p));
    throw new Error(`provinces missing from the map: ${missing.join(', ')}`);
  }

  // 1. Province polygons — the exact geometry the globe renders.
  const countriesGeo = JSON.parse(readFileSync(COUNTRIES_PATH, 'utf8')) as GeoJSON.FeatureCollection;
  const built = buildTerritoryGlobeGeometries(
    { ...(map as object), territories: territories as never } as Parameters<typeof buildTerritoryGlobeGeometries>[0],
    { countriesGeo, statesGeo: null, risorgimentoGeo: null },
  );
  const byId = new Map(built.map((p) => [p.territory_id, p]));
  const provinces: TerrainProvince[] = curation.provinces.map((id, i) => ({
    index: i + 1,
    territory_id: id,
    name: territories.find((t) => t.territory_id === id)?.name ?? id,
  }));
  if (provinces.length > 31) throw new Error('owner field holds at most 31 provinces');

  // 2. Grid: equirectangular, cells square in km at the standard parallel lat0.
  let minLng = Infinity;
  let maxLng = -Infinity;
  let minLat = Infinity;
  let maxLat = -Infinity;
  for (const p of built) {
    for (const poly of polygonsOf(p.geometry)) for (const ring of poly) for (const [x, y] of ring) {
      if (x < minLng) minLng = x;
      if (x > maxLng) maxLng = x;
      if (y < minLat) minLat = y;
      if (y > maxLat) maxLat = y;
    }
  }
  const lat0 = (minLat + maxLat) / 2;
  const dLat = curation.cell_km / KM_PER_DEG;
  const dLng = dLat / Math.cos((lat0 * Math.PI) / 180);
  const gMinLng = minLng - dLng;
  const gMaxLat = maxLat + dLat;
  const width = Math.ceil((maxLng + dLng - gMinLng) / dLng);
  const height = Math.ceil((gMaxLat - (minLat - dLat)) / dLat);
  const grid: GridSpec = {
    width,
    height,
    minLng: gMinLng,
    maxLng: gMinLng + width * dLng,
    minLat: gMaxLat - height * dLat,
    maxLat: gMaxLat,
    dLng,
    dLat,
    lat0,
  };
  log(`grid ${width} × ${height} cells of ${curation.cell_km} km (${(width * height).toLocaleString()} cells), lat0 ${lat0.toFixed(2)}°`);
  log(`bounds lng ${grid.minLng.toFixed(3)}..${grid.maxLng.toFixed(3)}  lat ${grid.minLat.toFixed(3)}..${grid.maxLat.toFixed(3)}`);
  if (width * height > sim.MAX_CELLS) throw new Error(`grid exceeds the sim's ${sim.MAX_CELLS}-cell limit; raise cell_km`);

  await ensureSources(grid, refresh);
  const rivers = JSON.parse(readFileSync(RIVERS_EXTRACT, 'utf8')) as GeoJSON.FeatureCollection;
  const regions = JSON.parse(readFileSync(REGIONS_EXTRACT, 'utf8')) as GeoJSON.FeatureCollection;

  const n = width * height;
  const idx = (c: number, r: number): number => r * width + c;
  const owner = new Uint8Array(n);
  const land = new Uint8Array(n);
  const barrier = new Uint8Array(n);
  const highland = new Uint8Array(n);
  const desert = new Uint8Array(n);
  const forest = new Uint8Array(n);
  const river = new Uint8Array(n);
  const ford = new Uint8Array(n);
  const pass = new Uint8Array(n);

  // 3. Owners (first province wins where clips overlap — report how often).
  let overlaps = 0;
  for (const p of provinces) {
    const geom = byId.get(p.territory_id);
    if (!geom) throw new Error(`no geometry built for ${p.territory_id}`);
    for (const poly of polygonsOf(geom.geometry)) {
      fillPolygon(poly, grid, (c, r) => {
        const i = idx(c, r);
        if (owner[i] === 0) owner[i] = p.index;
        else if (owner[i] !== p.index) overlaps += 1;
      });
    }
  }

  // 4. Land vs sea from the same Natural Earth coastlines the provinces were clipped from.
  for (const f of countriesGeo.features) {
    if (!f.geometry || !touchesBox(f.geometry, grid)) continue;
    for (const poly of polygonsOf(f.geometry)) fillPolygon(poly, grid, (c, r) => (land[idx(c, r)] = 1));
  }
  for (let i = 0; i < n; i++) if (owner[i] !== 0) land[i] = 1; // a province cell is land by definition

  // 5. Elevation tiers from Natural Earth physical regions: barrier ranges are impassable
  //    mountains, every other range (and the listed plateaus) is passable highland. Deserts
  //    are impassable — nobody marches an army across the Sahara.
  const barrierNames = new Set(curation.barrier_ranges);
  const plateauNames = new Set(curation.highland_plateaus);
  const rangesSeen: string[] = [];
  for (const f of regions.features) {
    if (!f.geometry) continue;
    const cla = String(f.properties?.featurecla);
    const name = String(f.properties?.name);
    let target: Uint8Array | null = null;
    if (cla === 'Desert') target = desert;
    else if (cla === 'Range/mtn') target = barrierNames.has(name) ? barrier : highland;
    else if (cla === 'Plateau' && plateauNames.has(name)) target = highland;
    if (!target) continue;
    rangesSeen.push(`${name} (${target === barrier ? 'barrier' : target === desert ? 'desert' : 'highland'})`);
    for (const poly of polygonsOf(f.geometry)) fillPolygon(poly, grid, (c, r) => (target![idx(c, r)] = 1));
  }
  for (const b of curation.barrier_ranges) {
    if (!rangesSeen.some((s) => s.startsWith(`${b} (`))) throw new Error(`barrier range "${b}" not found in the regions extract`);
  }

  // 6. Rivers from Natural Earth centrelines, fords every ford_spacing_km of arc length.
  const fordPoints: Position[] = curation.extra_fords.map((f) => f.at);
  const riverNames: string[] = [];
  for (const spec of curation.rivers) {
    const matches = rivers.features.filter((f) => {
      const a = String(f.properties?.name ?? '');
      const b = String(f.properties?.name_en ?? '');
      return spec.match.includes(a) || spec.match.includes(b);
    });
    if (matches.length === 0) throw new Error(`river "${spec.name}" matched nothing in ${RIVERS_EXTRACT}`);
    riverNames.push(spec.name);
    for (const f of matches) {
      for (const line of linesOf(f.geometry)) {
        traceLine(
          line,
          grid,
          (c, r) => {
            const i = idx(c, r);
            if (owner[i] !== 0) river[i] = 1;
          },
          curation.ford_spacing_km,
          (lng, lat) => fordPoints.push([lng, lat]),
        );
      }
    }
  }
  let fordsPlaced = 0;
  for (const [lng, lat] of fordPoints) {
    const c0 = Math.floor((lng - grid.minLng) / grid.dLng);
    const r0 = Math.floor((grid.maxLat - lat) / grid.dLat);
    let placed = false;
    for (let r = r0 - 1; r <= r0 + 1; r++) {
      for (let c = c0 - 1; c <= c0 + 1; c++) {
        if (c < 0 || r < 0 || c >= width || r >= height) continue;
        const i = idx(c, r);
        if (river[i] && !barrier[i] && !desert[i]) {
          ford[i] = 1;
          placed = true;
        }
      }
    }
    if (placed) fordsPlaced += 1;
  }

  // 7. Hand-curated forest mask and mountain passes.
  for (const f of curation.forests) fillPolygon([f.ring], grid, (c, r) => (forest[idx(c, r)] = 1));
  const isBarrierAt = (lng: number, lat: number): boolean => {
    const c = Math.floor((lng - grid.minLng) / grid.dLng);
    const r = Math.floor((grid.maxLat - lat) / grid.dLat);
    return c >= 0 && r >= 0 && c < width && r < height && barrier[idx(c, r)] === 1;
  };
  /**
   * A pass line is authored between two towns, but the Natural Earth range polygon is
   * often wider than the mountains a traveller would name — so each end is extended
   * along its final segment until it leaves the barrier. Without this a corridor stops
   * inside the range and the pass does nothing.
   */
  const extendOutOfBarrier = (line: Position[], name: string): { line: Position[]; extendedKm: number } => {
    const out = line.map((p) => [p[0], p[1]] as Position);
    let extendedKm = 0;
    for (const end of [0, out.length - 1]) {
      const inner = end === 0 ? out[1] : out[out.length - 2];
      const tip = out[end];
      const k = KM_PER_DEG * Math.cos((tip[1] * Math.PI) / 180);
      let dx = (tip[0] - inner[0]) * k;
      let dy = (tip[1] - inner[1]) * KM_PER_DEG;
      const len = Math.hypot(dx, dy) || 1;
      dx /= len;
      dy /= len;
      let km = 0;
      while (isBarrierAt(tip[0] + (dx * km) / k, tip[1] + (dy * km) / KM_PER_DEG) && km < 150) km += 2;
      if (km >= 150) throw new Error(`pass "${name}" could not be extended out of the barrier within 150 km`);
      if (km > 0) {
        km += curation.cell_km; // one more cell so the corridor overlaps the lowland
        out[end] = [tip[0] + (dx * km) / k, tip[1] + (dy * km) / KM_PER_DEG];
        extendedKm += km;
      }
    }
    return { line: out, extendedKm };
  };
  const passHits: Record<string, number> = {};
  for (const authored of curation.passes) {
    const { line, extendedKm } = extendOutOfBarrier(authored.line, authored.name);
    const p = { ...authored, line };
    if (extendedKm > 0) log(`pass "${p.name}" extended ${extendedKm.toFixed(0)} km to clear the range polygon`);
    let lngMin = Infinity;
    let lngMax = -Infinity;
    let latMin = Infinity;
    let latMax = -Infinity;
    for (const [x, y] of p.line) {
      lngMin = Math.min(lngMin, x);
      lngMax = Math.max(lngMax, x);
      latMin = Math.min(latMin, y);
      latMax = Math.max(latMax, y);
    }
    const padLat = p.width_km / KM_PER_DEG;
    const padLng = padLat / Math.cos((latMin * Math.PI) / 180);
    const c0 = Math.max(0, Math.floor((lngMin - padLng - grid.minLng) / grid.dLng));
    const c1 = Math.min(width - 1, Math.ceil((lngMax + padLng - grid.minLng) / grid.dLng));
    const r0 = Math.max(0, Math.floor((grid.maxLat - (latMax + padLat)) / grid.dLat));
    const r1 = Math.min(height - 1, Math.ceil((grid.maxLat - (latMin - padLat)) / grid.dLat));
    passHits[p.name] = 0;
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const i = idx(c, r);
        if (!barrier[i] || owner[i] === 0) continue;
        const lng = grid.minLng + (c + 0.5) * grid.dLng;
        const lat = grid.maxLat - (r + 0.5) * grid.dLat;
        if (distanceToLineKm(lng, lat, p.line) <= p.width_km / 2) {
          pass[i] = 1;
          passHits[p.name] += 1;
        }
      }
    }
  }

  // 8. Compose the packed cells.
  const cells = new Uint16Array(n);
  const B = sim.Biome;
  for (let i = 0; i < n; i++) {
    if (!land[i]) {
      cells[i] = sim.packCell({ owner: 0, tier: 0, passable: false, biome: B.Sea });
      continue;
    }
    if (owner[i] === 0) {
      cells[i] = sim.packCell({ owner: 0, tier: 0, passable: false, biome: B.Void });
      continue;
    }
    const o = owner[i];
    if (barrier[i] && !pass[i]) {
      cells[i] = sim.packCell({ owner: o, tier: 1, passable: false, biome: B.Mountain });
    } else if (desert[i]) {
      cells[i] = sim.packCell({ owner: o, tier: 0, passable: false, biome: B.Desert });
    } else if (river[i]) {
      const tier = highland[i] || barrier[i] ? 1 : 0;
      cells[i] = sim.packCell({ owner: o, tier, passable: ford[i] === 1, biome: B.River, ford: ford[i] === 1 });
    } else if (pass[i]) {
      cells[i] = sim.packCell({ owner: o, tier: 1, passable: true, biome: B.Highland, pass: true });
    } else if (highland[i]) {
      cells[i] = sim.packCell({ owner: o, tier: 1, passable: true, biome: B.Highland });
    } else if (forest[i]) {
      cells[i] = sim.packCell({ owner: o, tier: 0, passable: true, biome: B.Forest });
    } else {
      cells[i] = sim.packCell({ owner: o, tier: 0, passable: true, biome: B.Plains });
    }
  }
  // Beaches: passable lowland with the sea on an orthogonal side.
  let beaches = 0;
  for (let r = 0; r < height; r++) {
    for (let c = 0; c < width; c++) {
      const i = idx(c, r);
      const v = cells[i];
      if (!sim.cellPassable(v) || sim.cellTier(v) === 1) continue;
      const biome = sim.cellBiome(v);
      if (biome !== B.Plains && biome !== B.Forest) continue;
      const seaAt = (j: number): boolean => sim.cellBiome(cells[j]) === B.Sea;
      if ((c > 0 && seaAt(i - 1)) || (c < width - 1 && seaAt(i + 1)) || (r > 0 && seaAt(i - width)) || (r < height - 1 && seaAt(i + width))) {
        cells[i] = v | sim.BEACH_BIT;
        beaches += 1;
      }
    }
  }

  // 9. Validate against the map's own land graph: every typed land border between two of
  //    the twenty must be walkable on the grid, or a pass / ford is missing from curation.
  const grid2 = new sim.TerrainGrid(width, height, cells, { provinces });
  const landPairs = map.connections.filter((c) => c.type === 'land' && wanted.has(c.from) && wanted.has(c.to));
  const lanes: TerrainLane[] = map.connections
    .filter((c) => c.type === 'sea' && wanted.has(c.from) && wanted.has(c.to))
    .map((c) => ({ from: c.from, to: c.to }));
  const reach = new Map<string, Set<number>>();
  const unreachable: string[] = [];
  for (const pair of landPairs) {
    const a = grid2.provinceIndex(pair.from);
    const b = grid2.provinceIndex(pair.to);
    let seen = reach.get(pair.from);
    if (!seen) {
      seen = new Set<number>();
      const queue: number[] = [];
      for (let i = 0; i < n; i++) if (grid2.owner(i) === a && grid2.isPassable(i)) queue.push(i);
      const visited = new Uint8Array(n);
      for (const q of queue) visited[q] = 1;
      while (queue.length > 0) {
        const i = queue.pop() as number;
        seen.add(grid2.owner(i));
        const c = i % width;
        const r = Math.floor(i / width);
        const nb = [c > 0 ? i - 1 : -1, c < width - 1 ? i + 1 : -1, r > 0 ? i - width : -1, r < height - 1 ? i + width : -1];
        for (const j of nb) {
          if (j < 0 || visited[j] || !grid2.isPassable(j)) continue;
          visited[j] = 1;
          queue.push(j);
        }
      }
      reach.set(pair.from, seen);
    }
    if (!seen.has(b)) unreachable.push(`${pair.from} → ${pair.to}`);
  }

  // 10. Report.
  log(`overlapping province cells: ${overlaps}`);
  log(`ranges/deserts rasterised: ${rangesSeen.join(', ')}`);
  log(`rivers: ${riverNames.join(', ')}; fords placed at ${fordsPlaced} of ${fordPoints.length} points; beaches ${beaches}`);
  log(`pass cells: ${Object.entries(passHits).map(([k, v]) => `${k}=${v}`).join(', ')}`);
  const extents: number[] = [];
  log('province                cells  passable  plains  forest  highland  mountain  river  fords  beaches  extent');
  for (const p of provinces) {
    let cellsN = 0;
    let passable = 0;
    const biomes = new Array<number>(8).fill(0);
    let fords = 0;
    let beachN = 0;
    let cMin = Infinity;
    let cMax = -Infinity;
    let rMin = Infinity;
    let rMax = -Infinity;
    for (let i = 0; i < n; i++) {
      if (grid2.owner(i) !== p.index) continue;
      cellsN += 1;
      if (grid2.isPassable(i)) passable += 1;
      biomes[grid2.biome(i)] += 1;
      if (grid2.isFord(i)) fords += 1;
      if (grid2.isBeach(i)) beachN += 1;
      const c = i % width;
      const r = Math.floor(i / width);
      cMin = Math.min(cMin, c);
      cMax = Math.max(cMax, c);
      rMin = Math.min(rMin, r);
      rMax = Math.max(rMax, r);
    }
    const extent = Math.max(cMax - cMin + 1, rMax - rMin + 1);
    extents.push(extent);
    const pct = (x: number): string => `${((100 * x) / Math.max(1, cellsN)).toFixed(0)}%`.padStart(6);
    log(
      `${p.territory_id.padEnd(22)} ${String(cellsN).padStart(6)} ${pct(passable)}  ${pct(biomes[B.Plains])}  ${pct(biomes[B.Forest])}  ${pct(biomes[B.Highland]).padStart(8)}  ${pct(biomes[B.Mountain]).padStart(8)}  ${String(biomes[B.River]).padStart(5)}  ${String(fords).padStart(5)}  ${String(beachN).padStart(7)}  ${String(extent).padStart(6)}`,
    );
  }
  extents.sort((a, b) => a - b);
  log(`median province extent: ${extents[Math.floor(extents.length / 2)]} cells (brief: ~200 across a mid-sized province)`);
  if (unreachable.length > 0) {
    throw new Error(`land borders with no walkable route (add a pass or ford to curation):\n  ${unreachable.join('\n  ')}`);
  }
  log(`all ${landPairs.length} land borders among the twenty are walkable; ${lanes.length} sea lanes copied from the map`);

  // 11. Write the asset: pretty header, one RLE row per line, checksum from the sim's own hasher.
  const rows = sim.encodeTerrainRows(cells, width, height);
  const checksum = sim.terrainChecksum(cells, width, height);
  const e6 = (v: number): number => Math.round(v * 1e6);
  const header: Omit<TerrainAsset, 'rows'> & { rivers: string[]; sources: Record<string, string> } = {
    format: 'warfront-terrain',
    version: 1,
    map_id: map.map_id,
    generator: GENERATOR,
    cell_km: curation.cell_km,
    width,
    height,
    bounds_e6: { min_lng_e6: e6(grid.minLng), max_lng_e6: e6(grid.maxLng), min_lat_e6: e6(grid.minLat), max_lat_e6: e6(grid.maxLat) },
    lat0_e6: e6(lat0),
    provinces,
    lanes,
    rivers: riverNames,
    sources: {
      map: 'database/maps/community_roman_empire_117.json',
      countries: 'frontend/public/geo/ne_50m_admin_0_countries.json',
      rivers: NE_RIVERS_URL,
      regions: NE_REGIONS_URL,
      curation: 'database/warfront/curated/western_twenty.curation.json',
    },
    checksum,
  };
  let out = '{\n';
  for (const [k, v] of Object.entries(header)) out += `  ${JSON.stringify(k)}: ${JSON.stringify(v)},\n`;
  out += '  "rows": [\n' + rows.map((r) => `    ${JSON.stringify(r)}`).join(',\n') + '\n  ]\n}\n';
  writeFileSync(OUT_PATH, out);
  log(`wrote ${OUT_PATH} (${(out.length / 1024).toFixed(0)} KB, checksum ${checksum})`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
