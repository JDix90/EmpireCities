/**
 * Galactic Age world generator — pure. Turns the world specs (`worldSpecs.ts`)
 * plus the map's header (name, projection, worlds and their rules) into the
 * three committed artifacts:
 *
 *   - `database/maps/era_galaxy.json` (+ the byte-identical public copy)
 *   - `frontend/src/data/galaxyExoVoronoiGlobe.ts`  (globe rings, far worlds)
 *   - `frontend/src/data/galaxySolGlobeGeo.ts`      (Natural Earth groups, Sol)
 *
 * No file I/O here: `scripts/buildGalaxyWorlds.ts` writes (or checks) the
 * files, and `src/data/galaxyWorldsDrift.test.ts` fails when the committed
 * files stop matching what this returns.
 *
 * FAR WORLDS (`kind: 'voronoi'`): territories are seeded across most of the
 * sphere on an R2 low-discrepancy lattice in a lng/lat band (a thin far-side
 * meridian and the poles stay unseeded). A planar Voronoi tiles the band, then
 * every shared edge gets a meandering coastline. The displacement is seeded on
 * the SORTED edge endpoints, so both cells sharing a border compute the same
 * wobble and the tiling stays watertight.
 *
 * SOL III stays real Earth: each territory groups existing Natural Earth
 * `TERRITORY_GEO_CONFIG` blocks. Its 2D/strategic footprint is a blob at the
 * group's centroid, joined to its three nearest neighbours.
 */

import voronoi from '@turf/voronoi';
import { featureCollection, point } from '@turf/helpers';
import { buildSkeletonWorld } from './skeletonWorld';
import type {
  FarWorldSpec, GalaxyLaneSpec, GalaxyRegionSpec, GalaxySpecs, LngLat,
  SkeletonTerritorySpec, SkeletonWorldSpec, VoronoiWorldSpec,
} from './worldSpecs';

export interface GalaxyTerritory {
  territory_id: string;
  name: string;
  world_id: string;
  region_id: string;
  galaxy_position: [number, number];
  polygon: number[][];
  center_point: [number, number];
  geo_polygon: LngLat[];
}

export interface GalaxyConnection {
  from: string;
  to: string;
  type: 'land' | 'sea' | 'orbit';
}

/** The parts of the map document the specs do not own (header, projection, worlds). */
export interface GalaxyMapScaffold {
  canvas_width?: number;
  canvas_height?: number;
  projection_bounds: { minLng: number; maxLng: number; minLat: number; maxLat: number };
  worlds?: Array<{ world_id: string }>;
  [key: string]: unknown;
}

export interface GalaxyWorldsOutput {
  map: Record<string, unknown> & { territories: GalaxyTerritory[]; connections: GalaxyConnection[] };
  /** era_galaxy.json contents, exactly as committed (2-space JSON + newline). */
  mapJson: string;
  /** frontend/src/data/galaxyExoVoronoiGlobe.ts contents. */
  exoGlobeModule: string;
  /** frontend/src/data/galaxySolGlobeGeo.ts contents. */
  solGeoModule: string;
}

// ── Voronoi layout constants (shipped values — changing one moves every border) ─
const COUNT = 16;
const LNG_MIN = -158, LNG_MAX = 158, LAT_MIN = -66, LAT_MAX = 66;
const CLIP: [number, number, number, number] = [-162, -70, 162, 70];
const MAX_AMP = 10; // degrees

// ── Helpers ────────────────────────────────────────────────────────────────────
function hashInt(...nums: number[]): number {
  let h = 2166136261;
  for (const n of nums) {
    h = Math.imul(h ^ (n | 0), 16777619);
    h = Math.imul(h ^ Math.round((n - (n | 0)) * 1e6), 16777619);
  }
  return (h >>> 0);
}
function rand01(seed: number): number { return (hashInt(seed) % 100000) / 100000; }
export function slug(name: string): string { return name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, ''); }
function toRad(d: number): number { return (d * Math.PI) / 180; }
function gcDistDeg(a: LngLat, b: LngLat): number {
  const x = Math.sin(toRad(a[1])) * Math.sin(toRad(b[1])) + Math.cos(toRad(a[1])) * Math.cos(toRad(b[1])) * Math.cos(toRad(b[0] - a[0]));
  return (Math.acos(Math.max(-1, Math.min(1, x))) * 180) / Math.PI;
}

function r2Seeds(n: number, worldSeed: number): LngLat[] {
  const g = 1.32471795724474602596;
  const a1 = 1 / g, a2 = 1 / (g * g);
  const j0 = rand01(worldSeed) * 0.5;
  const out: LngLat[] = [];
  for (let i = 0; i < n; i++) {
    const x = (j0 + a1 * (i + 1)) % 1;
    const y = (j0 + a2 * (i + 1)) % 1;
    const jx = (rand01(worldSeed + i * 7 + 1) - 0.5) * 0.04;
    const jy = (rand01(worldSeed + i * 7 + 2) - 0.5) * 0.04;
    const lng = LNG_MIN + Math.min(1, Math.max(0, x + jx)) * (LNG_MAX - LNG_MIN);
    const lat = LAT_MIN + Math.min(1, Math.max(0, y + jy)) * (LAT_MAX - LAT_MIN);
    out.push([Math.round(lng * 1000) / 1000, Math.round(lat * 1000) / 1000]);
  }
  return out;
}

function edgeNoise(seed: number, t: number): number {
  let s = 0, amp = 1, norm = 0;
  for (let k = 1; k <= 4; k++) {
    const f = k + (rand01(seed + k * 31) * 0.7);
    const ph = rand01(seed + k * 53) * Math.PI * 2;
    s += amp * Math.sin(t * f * Math.PI * 2 + ph);
    norm += amp;
    amp *= 0.62;
  }
  return s / norm;
}
function organicEdgePoints(p: LngLat, q: LngLat): LngLat[] {
  const swapped = !(p[0] < q[0] || (p[0] === q[0] && p[1] < q[1]));
  const a = swapped ? q : p;
  const b = swapped ? p : q;
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len, ny = dx / len;
  const seed = hashInt(Math.round(a[0] * 64), Math.round(a[1] * 64), Math.round(b[0] * 64), Math.round(b[1] * 64));
  const amp = Math.min(MAX_AMP, len * 0.18);
  const segs = Math.max(3, Math.min(9, Math.round(len / 7)));
  const pts: LngLat[] = [];
  for (let k = 1; k < segs; k++) {
    const t = k / segs;
    const env = Math.sin(Math.PI * t) ** 0.7; // fuller envelope → wilder mid-edge
    const d = amp * env * edgeNoise(seed, t);
    let lng = a[0] + dx * t + nx * d;
    let lat = a[1] + dy * t + ny * d;
    lng = Math.min(173, Math.max(-173, lng));
    lat = Math.min(83, Math.max(-83, lat));
    pts.push([Math.round(lng * 1e5) / 1e5, Math.round(lat * 1e5) / 1e5]);
  }
  return swapped ? pts.reverse() : pts;
}
function organicRing(ring: LngLat[]): LngLat[] {
  const out: LngLat[] = [];
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length];
    out.push([Math.round(a[0] * 1e5) / 1e5, Math.round(a[1] * 1e5) / 1e5]);
    out.push(...organicEdgePoints(a, b));
  }
  return out;
}
function edgeKey(a: LngLat, b: LngLat): string {
  const r = (p: LngLat) => `${p[0].toFixed(4)},${p[1].toFixed(4)}`;
  const ka = r(a), kb = r(b);
  return ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
}

function addEdge(adj: Map<string, Set<string>>, a: string, b: string): void {
  (adj.get(a) ?? adj.set(a, new Set()).get(a)!).add(b);
  (adj.get(b) ?? adj.set(b, new Set()).get(b)!).add(a);
}

function farTerritoryId(w: FarWorldSpec, t: FarWorldSpec['territories'][number]): string {
  return w.kind === 'skeleton' ? (t as SkeletonTerritorySpec).id : `${w.prefix}_${slug(t.name)}`;
}

/** Fail loudly on a spec that would produce a map the engine silently mishandles. */
export function validateGalaxySpecs(specs: GalaxySpecs, worldIds: string[]): void {
  const errors: string[] = [];
  const regionWorld = new Map<string, string>();
  const regionSize = new Map<string, number>();
  const territoryWorld = new Map<string, string>();
  const declareRegions = (worldId: string, regions: GalaxyRegionSpec[]) => {
    for (const r of regions) {
      if (regionWorld.has(r.region_id)) errors.push(`region ${r.region_id} is declared twice`);
      regionWorld.set(r.region_id, worldId);
    }
  };
  const claim = (worldId: string, id: string, regionId: string) => {
    if (territoryWorld.has(id)) errors.push(`territory ${id} is declared twice`);
    territoryWorld.set(id, worldId);
    regionSize.set(regionId, (regionSize.get(regionId) ?? 0) + 1);
    const rw = regionWorld.get(regionId);
    if (!rw) errors.push(`${id}: region ${regionId} is not declared`);
    else if (rw !== worldId) errors.push(`${id}: region ${regionId} belongs to ${rw}, not ${worldId}`);
  };

  declareRegions(specs.sol.world_id, specs.sol.regions);
  for (const w of specs.farWorlds) declareRegions(w.world_id, w.regions);
  for (const t of specs.sol.territories) claim(specs.sol.world_id, t.id, t.region_id);
  for (const w of specs.farWorlds) {
    if (!worldIds.includes(w.world_id)) errors.push(`world ${w.world_id} has no worlds[] entry in the map`);
    if (w.kind === 'voronoi' && w.territories.length !== COUNT) {
      errors.push(`${w.world_id}: a voronoi world has exactly ${COUNT} territories, got ${w.territories.length}`);
    }
    for (const t of w.territories) claim(w.world_id, farTerritoryId(w, t), t.region_id);
  }
  for (const regionId of regionWorld.keys()) {
    if (!regionSize.get(regionId)) errors.push(`region ${regionId} has no territories`);
  }
  const laneEnds = new Set<string>();
  for (const lane of specs.lanes) {
    for (const end of [lane.from, lane.to]) {
      if (!territoryWorld.has(end)) errors.push(`lane ${lane.from}–${lane.to}: ${end} is not a territory`);
      if (laneEnds.has(end)) errors.push(`${end} ends more than one lane`);
      laneEnds.add(end);
    }
    if (territoryWorld.get(lane.from) === territoryWorld.get(lane.to)) {
      errors.push(`lane ${lane.from}–${lane.to} does not leave its world`);
    }
  }
  if (errors.length) throw new Error(`Galaxy world specs are invalid:\n  - ${errors.join('\n  - ')}`);
}

// ── Sol (real Earth, grouped Natural Earth blocks) ────────────────────────────
function buildSol(
  specs: GalaxySpecs,
  toCanvas: (lng: number, lat: number) => [number, number],
  galaxyPos: (lng: number, lat: number) => [number, number],
): { territories: GalaxyTerritory[]; connections: GalaxyConnection[] } {
  const SOL = specs.sol.territories;
  const territories: GalaxyTerritory[] = [];
  const connections: GalaxyConnection[] = [];
  for (const t of SOL) {
    const [clng, clat] = t.centroid;
    const rLat = 12;
    const rLng = Math.min(22, rLat / Math.max(0.4, Math.cos(toRad(clat))));
    const ring: LngLat[] = [];
    for (let k = 0; k < 7; k++) {
      const a = (k / 7) * Math.PI * 2;
      ring.push([Math.round((clng + Math.cos(a) * rLng) * 100) / 100, Math.round((clat + Math.sin(a) * rLat) * 100) / 100]);
    }
    const geo = [...ring, [...ring[0]] as LngLat];
    territories.push({
      territory_id: t.id, name: t.name, world_id: specs.sol.world_id, region_id: t.region_id,
      galaxy_position: galaxyPos(clng, clat),
      polygon: ring.map(([lng, lat]) => toCanvas(lng, lat)),
      center_point: toCanvas(clng, clat),
      geo_polygon: geo,
    });
  }
  // Three nearest neighbours by great-circle distance; land if close, else sea.
  const seenPair = new Set<string>();
  for (const t of SOL) {
    const others = SOL.filter((o) => o.id !== t.id)
      .map((o) => ({ id: o.id, d: gcDistDeg(t.centroid, o.centroid) }))
      .sort((a, b) => a.d - b.d)
      .slice(0, 3);
    for (const o of others) {
      const [a, b] = [t.id, o.id].sort();
      const pk = `${a}|${b}`;
      if (seenPair.has(pk)) continue;
      seenPair.add(pk);
      connections.push({ from: a, to: b, type: o.d < 38 ? 'land' : 'sea' });
    }
  }
  // Connectivity repair.
  const adj = new Map<string, Set<string>>();
  for (const c of connections) addEdge(adj, c.from, c.to);
  const ids = SOL.map((s) => s.id);
  const seen = new Set([ids[0]]); const stack = [ids[0]];
  while (stack.length) { const cur = stack.pop()!; for (const nb of adj.get(cur) ?? []) if (!seen.has(nb)) { seen.add(nb); stack.push(nb); } }
  for (const s of SOL) {
    if (seen.has(s.id)) continue;
    let best = ids[0], bd = Infinity;
    for (const oid of seen) { const d = gcDistDeg(s.centroid, SOL.find((x) => x.id === oid)!.centroid); if (d < bd) { bd = d; best = oid; } }
    connections.push({ from: s.id, to: best, type: bd < 38 ? 'land' : 'sea' });
    seen.add(s.id);
  }
  return { territories, connections };
}

// ── Far worlds: seeded Voronoi ────────────────────────────────────────────────
function buildVoronoiWorld(
  world: VoronoiWorldSpec,
  toCanvas: (lng: number, lat: number) => [number, number],
  galaxyPos: (lng: number, lat: number) => [number, number],
): { territories: GalaxyTerritory[]; connections: GalaxyConnection[]; rings: Record<string, LngLat[]> } {
  const names = world.territories.map((t) => t.name);
  const regionOf = new Map(world.territories.map((t) => [t.name, t.region_id]));
  const seeds = r2Seeds(COUNT, world.seed);
  const diagram = voronoi(featureCollection(seeds.map((s, i) => point(s, { idx: i }))), { bbox: CLIP });
  if (!diagram?.features?.length) throw new Error(`Voronoi failed for ${world.world_id}`);
  const cells = diagram.features.map((f) => {
    if (!f.geometry || f.geometry.type !== 'Polygon') return null;
    let ring = (f.geometry.coordinates[0] as LngLat[]).map((p) => [p[0], p[1]] as LngLat);
    if (ring.length > 1 && ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1]) ring = ring.slice(0, -1);
    let sx = 0, sy = 0; for (const [x, y] of ring) { sx += x; sy += y; }
    return { ring, c: [sx / ring.length, sy / ring.length] as LngLat };
  }).filter(Boolean) as { ring: LngLat[]; c: LngLat }[];

  const pairs: Array<{ si: number; ci: number; d: number }> = [];
  seeds.forEach((s, si) => cells.forEach((cell, ci) => { const dx = cell.c[0] - s[0], dy = cell.c[1] - s[1]; pairs.push({ si, ci, d: dx * dx + dy * dy }); }));
  pairs.sort((a, b) => a.d - b.d);
  const seedCell: (number | undefined)[] = new Array(COUNT);
  const usedCell = new Set<number>();
  for (const p of pairs) { if (seedCell[p.si] !== undefined || usedCell.has(p.ci)) continue; seedCell[p.si] = p.ci; usedCell.add(p.ci); }

  const idByCell: Record<number, string> = {};
  const rawRingById: Record<string, LngLat[]> = {};
  const seedById: Record<string, LngLat> = {};
  const edgeMap = new Map<string, string[]>();
  for (let si = 0; si < COUNT; si++) {
    const ci = seedCell[si];
    if (ci === undefined) throw new Error(`${world.world_id}: seed ${si} no cell`);
    const id = `${world.prefix}_${slug(names[si])}`;
    idByCell[ci] = id; rawRingById[id] = cells[ci].ring; seedById[id] = seeds[si];
    for (let i = 0; i < cells[ci].ring.length; i++) {
      const key = edgeKey(cells[ci].ring[i], cells[ci].ring[(i + 1) % cells[ci].ring.length]);
      const list = edgeMap.get(key) ?? []; if (!list.includes(id)) list.push(id); edgeMap.set(key, list);
    }
  }
  const seenPair = new Set<string>();
  const connections: GalaxyConnection[] = [];
  for (const ids of edgeMap.values()) {
    if (ids.length !== 2) continue;
    const [a, b] = ids.slice().sort();
    if (seenPair.has(`${a}|${b}`)) continue;
    seenPair.add(`${a}|${b}`); connections.push({ from: a, to: b, type: 'land' });
  }
  // Connectivity repair within the world.
  const adj = new Map<string, Set<string>>();
  for (const c of connections) addEdge(adj, c.from, c.to);
  const allIds = Object.values(idByCell);
  const seen = new Set([allIds[0]]); const stack = [allIds[0]];
  while (stack.length) { const cur = stack.pop()!; for (const nb of adj.get(cur) ?? []) if (!seen.has(nb)) { seen.add(nb); stack.push(nb); } }
  for (const id of allIds) {
    if (seen.has(id)) continue;
    let best = allIds[0], bd = Infinity;
    for (const oid of seen) { const dx = seedById[id][0] - seedById[oid][0], dy = seedById[id][1] - seedById[oid][1]; const d = dx * dx + dy * dy; if (d < bd) { bd = d; best = oid; } }
    connections.push({ from: id, to: best, type: 'land' }); seen.add(id);
  }

  const territories: GalaxyTerritory[] = [];
  const rings: Record<string, LngLat[]> = {};
  for (let si = 0; si < COUNT; si++) {
    const id = idByCell[seedCell[si]!];
    const s = seeds[si];
    const geo = organicRing(rawRingById[id]);
    const geoClosed = [...geo, [...geo[0]] as LngLat];
    rings[id] = geoClosed;
    territories.push({
      territory_id: id, name: names[si], world_id: world.world_id, region_id: regionOf.get(names[si])!,
      galaxy_position: galaxyPos(s[0], s[1]),
      polygon: geo.map(([lng, lat]) => toCanvas(lng, lat)),
      center_point: toCanvas(s[0], s[1]),
      geo_polygon: geoClosed,
    });
  }
  return { territories, connections, rings };
}

// ── Far worlds: authored landmass skeleton ────────────────────────────────────
function buildSkeletonFarWorld(
  world: SkeletonWorldSpec,
  toCanvas: (lng: number, lat: number) => [number, number],
  galaxyPos: (lng: number, lat: number) => [number, number],
): { territories: GalaxyTerritory[]; connections: GalaxyConnection[]; rings: Record<string, LngLat[]> } {
  const built = buildSkeletonWorld(world);
  const specById = new Map(world.territories.map((t) => [t.id, t]));
  const rings: Record<string, LngLat[]> = {};
  const territories = built.territories.map((t) => {
    const spec = specById.get(t.id)!;
    rings[t.id] = t.ring;
    return {
      territory_id: t.id, name: spec.name, world_id: world.world_id, region_id: spec.region_id,
      galaxy_position: galaxyPos(t.center[0], t.center[1]),
      polygon: t.ring.slice(0, -1).map(([lng, lat]) => toCanvas(lng, lat)),
      center_point: toCanvas(t.center[0], t.center[1]),
      geo_polygon: t.ring,
    };
  });
  const connections: GalaxyConnection[] = [
    ...built.land.map(([from, to]) => ({ from, to, type: 'land' as const })),
    ...built.sea.map(([from, to]) => ({ from, to, type: 'sea' as const })),
  ];
  return { territories, connections, rings };
}

function buildFarWorld(
  world: FarWorldSpec,
  toCanvas: (lng: number, lat: number) => [number, number],
  galaxyPos: (lng: number, lat: number) => [number, number],
) {
  switch (world.kind) {
    case 'voronoi':
      return buildVoronoiWorld(world, toCanvas, galaxyPos);
    case 'skeleton':
      return buildSkeletonFarWorld(world, toCanvas, galaxyPos);
    default: {
      const never: never = world;
      throw new Error(`Unknown far-world kind ${JSON.stringify(never)}`);
    }
  }
}

function renderExoGlobeModule(exoRings: Record<string, LngLat[]>): string {
  const ids = Object.keys(exoRings).sort();
  const lines = [
    '/**',
    ' * Voronoi globe caps for Galactic Age exo-worlds (Verdan, Rust Belt, Nexus).',
    ' * Organic, globe-spanning territory rings in WGS84 [lng,lat].',
    ' *',
    ' * Generated by: pnpm -C frontend exec tsx scripts/buildGalaxyWorlds.ts',
    ' * DO NOT EDIT MANUALLY.',
    ' */',
    '',
    'export const GALAXY_EXO_VORONOI_GLOBE: Record<string, [number, number][]> = {',
  ];
  for (const id of ids) { lines.push(`  '${id}': [`); for (const [lng, lat] of exoRings[id]) lines.push(`    [${lng}, ${lat}],`); lines.push('  ],'); }
  lines.push('};', '');
  return lines.join('\n');
}

function renderSolGeoModule(specs: GalaxySpecs): string {
  const lines = [
    '/**',
    ' * Galactic Age — Sol III globe geometry.',
    ' *',
    ' * Reuses the Space Age Earth admin-0 partition (Natural Earth clips) so Sol III',
    ' * renders with real coastlines. Each Sol territory aggregates several',
    ' * `TERRITORY_GEO_CONFIG` entries; together they tile the planet without overlap.',
    ' *',
    ' * Generated by: pnpm -C frontend exec tsx scripts/buildGalaxyWorlds.ts',
    ' * DO NOT EDIT MANUALLY.',
    ' */',
    '',
    "import type { TerritoryGeoConfig } from './territoryGeoMapping';",
    "import { TERRITORY_GEO_CONFIG } from './territoryGeoMapping';",
    '',
    'function mergeConfigs(...keys: (keyof typeof TERRITORY_GEO_CONFIG)[]): TerritoryGeoConfig {',
    '  const out: TerritoryGeoConfig = [];',
    '  for (const k of keys) {',
    '    const chunk = TERRITORY_GEO_CONFIG[k];',
    '    if (chunk?.length) out.push(...chunk);',
    '  }',
    '  return out;',
    '}',
    '',
    'export const GALAXY_SOL_TERRITORY_GEO: Record<string, TerritoryGeoConfig> = {',
  ];
  for (const t of specs.sol.territories) {
    lines.push(`  ${t.id}: mergeConfigs(${t.keys.map((k) => `'${k}'`).join(', ')}),`);
  }
  lines.push('};', '');
  return lines.join('\n');
}

/** Build every galaxy artifact from the specs. Deterministic: same input, same bytes. */
export function generateGalaxyWorlds(scaffold: GalaxyMapScaffold, specs: GalaxySpecs): GalaxyWorldsOutput {
  validateGalaxySpecs(specs, (scaffold.worlds ?? []).map((w) => w.world_id));

  const W = scaffold.canvas_width ?? 1200;
  const H = scaffold.canvas_height ?? 700;
  const B = scaffold.projection_bounds;
  const toCanvas = (lng: number, lat: number): [number, number] => [
    Math.round(((lng - B.minLng) / (B.maxLng - B.minLng)) * W),
    Math.round(((B.maxLat - lat) / (B.maxLat - B.minLat)) * H),
  ];
  const galaxyPos = (lng: number, lat: number): [number, number] => [
    Math.round(Math.min(1, Math.max(0, (lng - B.minLng) / (B.maxLng - B.minLng))) * 100) / 100,
    Math.round(Math.min(1, Math.max(0, (B.maxLat - lat) / (B.maxLat - B.minLat))) * 100) / 100,
  ];

  const sol = buildSol(specs, toCanvas, galaxyPos);
  const territories: GalaxyTerritory[] = [...sol.territories];
  const connections: GalaxyConnection[] = [...sol.connections];
  const exoRings: Record<string, LngLat[]> = {};
  for (const world of specs.farWorlds) {
    const built = buildFarWorld(world, toCanvas, galaxyPos);
    territories.push(...built.territories);
    connections.push(...built.connections);
    Object.assign(exoRings, built.rings);
  }
  connections.push(...specs.lanes.map((l: GalaxyLaneSpec) => ({ from: l.from, to: l.to, type: 'orbit' as const })));

  const regions = [specs.sol.regions, ...specs.farWorlds.map((w) => w.regions)].flat()
    .map((r) => ({ region_id: r.region_id, name: r.name, bonus: r.bonus }));
  const map = { ...scaffold, regions, territories, connections };
  return {
    map,
    mapJson: JSON.stringify(map, null, 2) + '\n',
    exoGlobeModule: renderExoGlobeModule(exoRings),
    solGeoModule: renderSolGeoModule(specs),
  };
}
