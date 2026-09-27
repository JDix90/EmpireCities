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
 * FAR WORLDS (`kind: 'skeleton'`) are built from an authored landmass
 * skeleton by `skeletonWorld.ts`, which also checks the geometry against the
 * spec's designed land borders and sea links.
 *
 * SOL III stays real Earth: each territory groups existing Natural Earth
 * `TERRITORY_GEO_CONFIG` blocks. Its 2D/strategic footprint is a blob at the
 * group's centroid, joined to its three nearest neighbours.
 */

import { buildSkeletonWorld } from './skeletonWorld';
import type { FarWorldSpec, GalaxyLaneSpec, GalaxyRegionSpec, GalaxySpecs, LngLat } from './worldSpecs';

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

// ── Helpers ────────────────────────────────────────────────────────────────────
function toRad(d: number): number { return (d * Math.PI) / 180; }
function gcDistDeg(a: LngLat, b: LngLat): number {
  const x = Math.sin(toRad(a[1])) * Math.sin(toRad(b[1])) + Math.cos(toRad(a[1])) * Math.cos(toRad(b[1])) * Math.cos(toRad(b[0] - a[0]));
  return (Math.acos(Math.max(-1, Math.min(1, x))) * 180) / Math.PI;
}

function addEdge(adj: Map<string, Set<string>>, a: string, b: string): void {
  (adj.get(a) ?? adj.set(a, new Set()).get(a)!).add(b);
  (adj.get(b) ?? adj.set(b, new Set()).get(b)!).add(a);
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
    for (const t of w.territories) claim(w.world_id, t.id, t.region_id);
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

// ── Far worlds: authored landmass skeleton ────────────────────────────────────
function buildFarWorld(
  world: FarWorldSpec,
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

function renderExoGlobeModule(exoRings: Record<string, LngLat[]>): string {
  const ids = Object.keys(exoRings).sort();
  const lines = [
    '/**',
    ' * Globe rings for the Galactic Age far worlds (Verdan, Rust Belt, Nexus),',
    ' * built from their landmass skeletons, in WGS84 [lng,lat].',
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
