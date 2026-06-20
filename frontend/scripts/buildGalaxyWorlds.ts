#!/usr/bin/env tsx
/**
 * Galactic Age world generator — authors ALL four worlds for era_galaxy.
 *
 * EXO worlds (Verdan / Rust / Nexus): ~COUNT organic, globe-spanning territories.
 * Seeds are spread across most of the sphere via an R2 low-discrepancy lattice in
 * a lng/lat band (a thin far-side meridian + the poles stay unseeded → ocean +
 * polar caps from the procedural surface). A planar Voronoi tiles the band (cells
 * touch, so land borders stay meaningful), then every shared edge is given a wild,
 * meandering coastline. Displacement is seeded on the SORTED edge endpoints so
 * both cells sharing a border compute the identical wobble — the tiling stays
 * watertight (no gaps/overlaps).
 *
 * SOL III: kept as REAL Earth, but densified from 6 to ~16 territories for parity
 * with the exo worlds (so the four factions start even). Each Sol territory groups
 * a handful of the existing Natural-Earth `TERRITORY_GEO_CONFIG` building blocks,
 * so coastlines stay real. Globe geometry for Sol comes from GALAXY_SOL_TERRITORY_GEO
 * (regenerated here); its 2D/strategic footprint is a blob at the region centroid.
 *
 * Rules/factions/tech are unchanged; each world stays ONE region.
 *
 * Writes:
 *   - database/maps/era_galaxy.json + frontend/public/maps/regional/era_galaxy.json
 *   - frontend/src/data/galaxyExoVoronoiGlobe.ts  (organic globe rings, exo)
 *   - frontend/src/data/galaxySolGlobeGeo.ts       (Natural-Earth groupings, Sol)
 *
 * Usage: pnpm -C frontend exec tsx scripts/buildGalaxyWorlds.ts
 */

import voronoi from '@turf/voronoi';
import { featureCollection, point } from '@turf/helpers';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..', '..');
const DB_MAP = path.join(ROOT, 'database', 'maps', 'era_galaxy.json');
const PUBLIC_MAP = path.join(ROOT, 'frontend', 'public', 'maps', 'regional', 'era_galaxy.json');
const RINGS_OUT = path.join(ROOT, 'frontend', 'src', 'data', 'galaxyExoVoronoiGlobe.ts');
const SOL_OUT = path.join(ROOT, 'frontend', 'src', 'data', 'galaxySolGlobeGeo.ts');

type LngLat = [number, number];
interface Territory {
  territory_id: string;
  name: string;
  world_id: string;
  region_id: string;
  galaxy_position: [number, number];
  polygon: number[][];
  center_point: [number, number];
  geo_polygon: LngLat[];
}
interface Connection { from: string; to: string; type: 'land' | 'sea' | 'orbit' }

// ── Exo config ──────────────────────────────────────────────────────────────
const COUNT = 16;
const EXO: Array<{ world_id: string; prefix: string; region_id: string; seed: number; names: string[] }> = [
  { world_id: 'verdan', prefix: 'verdan', region_id: 'verdant_expanse', seed: 4404,
    names: ['Spore Reach', 'Glowmire Shelf', 'Cinder Bloom', 'Mistveil Hollow', 'Chlorophage Span', 'Saffron Mire', 'Verdigris Span', 'Thundercrown Belt', 'Lumen Bog', 'Photic Crown', 'Sulphur Drift', 'Pollen Sea', 'Emberleaf Basin', 'Mycel Deep', 'Witchlight Fen', 'Greenfire Vault'] },
  { world_id: 'rust', prefix: 'rust', region_id: 'industrial_rim', seed: 7711,
    names: ['Slag Reach', 'Ferro Span', 'Cinderworks', 'Oxide Flats', 'Tailing Drift', 'Anvil Basin', 'Smelter Crown', 'Ironstorm Belt', 'Caldera Foundry', 'Tether Anchorage', 'Bessemer Cut', 'Dross Hollow', 'Hematite Span', 'Crucible Deep', 'Scoria Flats', 'Furnace Marches'] },
  { world_id: 'nexus_station', prefix: 'nexus', region_id: 'station_corridor', seed: 9021,
    names: ['Gate Threshold', 'Halo Span', 'Custodian Quarter', 'Basin Mandate', 'Resonance Vault', 'Lodgeway', 'Toll Crater', 'Antenna Spire', 'Echo Concourse', 'Lattice Berth', 'Quietude Basin', 'Vault Approach', 'Harmonic Rim', 'Waystation Loni', 'Cordon March', 'Beacon Hollow'] },
];

// ── Sol config: 16 real-Earth territories regrouped from the 46 Natural-Earth
// building blocks the old 6 Sol territories used (so coastlines stay real). ─────
const SOL_REGION = 'stellar_core';
const SOL: Array<{ id: string; name: string; keys: string[]; centroid: LngLat }> = [
  { id: 'sol_columbia', name: 'Columbia Reach', keys: ['na_eastern_corridor', 'na_launch_base', 'na_southern_belt', 'la_caribbean'], centroid: [-82, 36] },
  { id: 'sol_pacifica', name: 'Pacifica Shelf', keys: ['na_western_states', 'na_central_plains', 'na_arctic_dominion'], centroid: [-112, 50] },
  { id: 'sol_atlantic_europe', name: 'Atlantic Europe', keys: ['euro_british_isles', 'euro_iberia', 'euro_nordic'], centroid: [-4, 52] },
  { id: 'sol_eastern_reach', name: 'Eastern Reach', keys: ['euro_balkan', 'euro_spaceport', 'euro_east'], centroid: [28, 52] },
  { id: 'sol_maghreb', name: 'Maghreb Span', keys: ['mena_maghreb', 'mena_nile', 'mena_levant'], centroid: [20, 28] },
  { id: 'sol_arabia', name: 'Arabian Gate', keys: ['mena_arabia', 'mena_persia'], centroid: [50, 27] },
  { id: 'sol_guinea', name: 'Guinea Coast', keys: ['africa_west', 'africa_sahel'], centroid: [0, 12] },
  { id: 'sol_equatoria', name: 'Equatorial Reach', keys: ['africa_congo_basin', 'africa_horn', 'africa_east'], centroid: [28, 2] },
  { id: 'sol_austral', name: 'Austral Cape', keys: ['africa_south'], centroid: [25, -28] },
  { id: 'sol_turkestan', name: 'Turkestan Steppe', keys: ['ca_steppe', 'ca_tien_shan', 'asia_siberia_belt'], centroid: [78, 56] },
  { id: 'sol_hindustan', name: 'Hindustan', keys: ['ca_indus', 'ca_ganges', 'ca_deccan'], centroid: [78, 22] },
  { id: 'sol_cathay', name: 'Cathay', keys: ['asia_cosmodrome', 'asia_heartland', 'asia_coastal'], centroid: [104, 36] },
  { id: 'sol_pacific_rim', name: 'Pacific Rim', keys: ['asia_korea_archipelago', 'asia_japan_islands', 'asia_indochina', 'asia_malay_archipelago', 'megacity_pacific_rim'], centroid: [128, 22] },
  { id: 'sol_oceania', name: 'Oceania', keys: ['oc_australia', 'oc_new_zealand', 'oc_micronesia', 'oc_polynesia'], centroid: [140, -26] },
  { id: 'sol_amazonia', name: 'Amazon Basin', keys: ['la_amazonia', 'la_andes'], centroid: [-66, -8] },
  { id: 'sol_southern_cone', name: 'Southern Cone', keys: ['la_pampas', 'la_patagonia'], centroid: [-63, -38] },
];

// Seed band for exo worlds (most of the sphere; far-side meridian + poles left open).
const LNG_MIN = -158, LNG_MAX = 158, LAT_MIN = -66, LAT_MAX = 66;
const CLIP: [number, number, number, number] = [-162, -70, 162, 70];
const MAX_AMP = 10; // degrees — wilder coastlines

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
function slug(name: string): string { return name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, ''); }
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

// ── Load scaffold (header / regions / worlds / projection) ─────────────────────
const map = JSON.parse(fs.readFileSync(DB_MAP, 'utf-8'));
const W = map.canvas_width ?? 1200;
const H = map.canvas_height ?? 700;
const B = map.projection_bounds;
const toCanvas = (lng: number, lat: number): [number, number] => [
  Math.round(((lng - B.minLng) / (B.maxLng - B.minLng)) * W),
  Math.round(((B.maxLat - lat) / (B.maxLat - B.minLat)) * H),
];
const galaxyPos = (lng: number, lat: number): [number, number] => [
  Math.round(Math.min(1, Math.max(0, (lng - B.minLng) / (B.maxLng - B.minLng))) * 100) / 100,
  Math.round(Math.min(1, Math.max(0, (B.maxLat - lat) / (B.maxLat - B.minLat))) * 100) / 100,
];

const territories: Territory[] = [];
const connections: Connection[] = [];
const exoRings: Record<string, LngLat[]> = {};
const gateways: Record<string, { west: string; east: string }> = {};

// ── Sol (real Earth, densified) ───────────────────────────────────────────────
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
    territory_id: t.id, name: t.name, world_id: 'sol', region_id: SOL_REGION,
    galaxy_position: galaxyPos(clng, clat),
    polygon: ring.map(([lng, lat]) => toCanvas(lng, lat)),
    center_point: toCanvas(clng, clat),
    geo_polygon: geo,
  });
}
// Sol adjacency: 3 nearest neighbours by great-circle distance; land if close else sea.
{
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
  // connectivity repair
  const adj = new Map<string, Set<string>>();
  for (const c of connections) {
    (adj.get(c.from) ?? adj.set(c.from, new Set()).get(c.from)!).add(c.to);
    (adj.get(c.to) ?? adj.set(c.to, new Set()).get(c.to)!).add(c.from);
  }
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
}

// ── Exo worlds (organic Voronoi) ───────────────────────────────────────────────
for (const world of EXO) {
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
    const id = `${world.prefix}_${slug(world.names[si])}`;
    idByCell[ci] = id; rawRingById[id] = cells[ci].ring; seedById[id] = seeds[si];
    for (let i = 0; i < cells[ci].ring.length; i++) {
      const key = edgeKey(cells[ci].ring[i], cells[ci].ring[(i + 1) % cells[ci].ring.length]);
      const list = edgeMap.get(key) ?? []; if (!list.includes(id)) list.push(id); edgeMap.set(key, list);
    }
  }
  const seenPair = new Set<string>();
  const worldLand: Connection[] = [];
  for (const ids of edgeMap.values()) {
    if (ids.length !== 2) continue;
    const [a, b] = ids.slice().sort();
    if (seenPair.has(`${a}|${b}`)) continue;
    seenPair.add(`${a}|${b}`); worldLand.push({ from: a, to: b, type: 'land' });
  }
  // connectivity repair within world
  const adj = new Map<string, Set<string>>();
  for (const c of worldLand) { (adj.get(c.from) ?? adj.set(c.from, new Set()).get(c.from)!).add(c.to); (adj.get(c.to) ?? adj.set(c.to, new Set()).get(c.to)!).add(c.from); }
  const allIds = Object.values(idByCell);
  const seen = new Set([allIds[0]]); const stack = [allIds[0]];
  while (stack.length) { const cur = stack.pop()!; for (const nb of adj.get(cur) ?? []) if (!seen.has(nb)) { seen.add(nb); stack.push(nb); } }
  for (const id of allIds) {
    if (seen.has(id)) continue;
    let best = allIds[0], bd = Infinity;
    for (const oid of seen) { const dx = seedById[id][0] - seedById[oid][0], dy = seedById[id][1] - seedById[oid][1]; const d = dx * dx + dy * dy; if (d < bd) { bd = d; best = oid; } }
    worldLand.push({ from: id, to: best, type: 'land' }); seen.add(id);
  }
  connections.push(...worldLand);

  let westId = '', eastId = '', westLng = Infinity, eastLng = -Infinity;
  for (let si = 0; si < COUNT; si++) {
    const id = idByCell[seedCell[si]!];
    const s = seeds[si];
    const geo = organicRing(rawRingById[id]);
    const geoClosed = [...geo, [...geo[0]] as LngLat];
    exoRings[id] = geoClosed;
    territories.push({
      territory_id: id, name: world.names[si], world_id: world.world_id, region_id: world.region_id,
      galaxy_position: galaxyPos(s[0], s[1]),
      polygon: geo.map(([lng, lat]) => toCanvas(lng, lat)),
      center_point: toCanvas(s[0], s[1]),
      geo_polygon: geoClosed,
    });
    if (s[0] < westLng) { westLng = s[0]; westId = id; }
    if (s[0] > eastLng) { eastLng = s[0]; eastId = id; }
  }
  gateways[world.world_id] = { west: westId, east: eastId };
}

// ── Orbit lanes (cross-world hyperspace) — Sol hub + exo ring ───────────────────
const solAnchors = [SOL[0].id, SOL[2].id, SOL[5].id, SOL[8].id, SOL[11].id, SOL[14].id];
connections.push(
  { from: solAnchors[0], to: gateways['verdan'].west, type: 'orbit' },
  { from: solAnchors[1], to: gateways['verdan'].east, type: 'orbit' },
  { from: solAnchors[2], to: gateways['rust'].west, type: 'orbit' },
  { from: solAnchors[3], to: gateways['rust'].east, type: 'orbit' },
  { from: solAnchors[4], to: gateways['nexus_station'].west, type: 'orbit' },
  { from: solAnchors[5], to: gateways['nexus_station'].east, type: 'orbit' },
  { from: gateways['verdan'].east, to: gateways['rust'].west, type: 'orbit' },
  { from: gateways['rust'].east, to: gateways['nexus_station'].west, type: 'orbit' },
  { from: gateways['nexus_station'].east, to: gateways['verdan'].west, type: 'orbit' },
);

// ── Write era_galaxy.json (both copies) ────────────────────────────────────────
const outMap = { ...map, territories, connections };
const json = JSON.stringify(outMap, null, 2) + '\n';
fs.writeFileSync(DB_MAP, json);
fs.writeFileSync(PUBLIC_MAP, json);

// ── Write exo globe rings ──────────────────────────────────────────────────────
{
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
  fs.writeFileSync(RINGS_OUT, lines.join('\n'));
}

// ── Write Sol Natural-Earth groupings ──────────────────────────────────────────
{
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
  for (const t of SOL) {
    lines.push(`  ${t.id}: mergeConfigs(${t.keys.map((k) => `'${k}'`).join(', ')}),`);
  }
  lines.push('};', '');
  fs.writeFileSync(SOL_OUT, lines.join('\n'));
}

const perWorld = ['sol', 'verdan', 'rust', 'nexus_station'].map((w) => `${w}:${territories.filter((t) => t.world_id === w).length}`).join(' ');
const byType = connections.reduce((m, c) => ((m[c.type] = (m[c.type] || 0) + 1), m), {} as Record<string, number>);
console.log(`era_galaxy.json (x2): ${territories.length} territories (${perWorld}), ${connections.length} connections (${JSON.stringify(byType)}).`);
console.log(`globe rings: ${Object.keys(exoRings).length} exo → galaxyExoVoronoiGlobe.ts; ${SOL.length} sol groups → galaxySolGlobeGeo.ts`);
