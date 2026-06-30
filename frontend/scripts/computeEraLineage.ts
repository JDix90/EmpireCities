/**
 * Computes the era→era territory LINEAGE for the full-ascension timeline and
 * writes `database/era-lineage.json`.
 *
 * The full-transform feature recomposes the board when a game advances eras
 * (era_ancient → era_medieval → … → era_space_age). Because every territory on
 * every era map now resolves to real WGS84 geometry, the correspondence between
 * a territory and its successors on the next era's board can be COMPUTED by
 * geographic overlap rather than hand-authored. For each consecutive era pair we
 * record, per source territory, the target territories its footprint overlaps
 * (with the overlap fraction), plus:
 *   • `no_successor` — source territories whose area isn't covered by any target
 *     (their land leaves play on transition).
 *   • `new_land`     — target territories with no source parent (they spawn as
 *     fresh neutral frontiers — "successors go neutral").
 *
 * Hand corrections live in `database/era-lineage.overrides.json` and are merged
 * on top of the computed result (the auto-mapper is good but not perfect at the
 * coarse boundaries between independently-authored maps).
 *
 * Run from repo root:
 *   pnpm -C frontend exec tsx scripts/computeEraLineage.ts
 * Offline — reads the committed ne_50m admin-0 the globe renders from.
 */
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import intersect from '@turf/intersect';
import { feature, featureCollection } from '@turf/helpers';
import { inferWorldId } from '@borderfall/shared';
import { buildTerritoryGlobeGeometries } from '../src/utils/globeTerritoryGeometry';
import type { GameMap } from '../src/services/mapService';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MAPS_DIR = join(__dirname, '../../database/maps');
const NE_PATH = join(__dirname, '../public/geo/ne_50m_admin_0_countries.json');
const OUT_PATH = join(__dirname, '../../database/era-lineage.json');
const OVERRIDES_PATH = join(__dirname, '../../database/era-lineage.overrides.json');

/** Canonical full-ascension timeline (mirrors the `full_ascension` spine). */
const SEQUENCE = ['ancient', 'medieval', 'discovery', 'ww2', 'coldwar', 'modern', 'space_age'] as const;
/** A target counts as a successor when it covers ≥ this fraction of the source's area. */
const OVERLAP_THRESHOLD = 0.08;
/** A target counts as "parented" (not new land) when a source covers ≥ this fraction of IT. */
const PARENT_THRESHOLD = 0.15;

type Ring = number[][];
const R = 6371; // km

/** Geodesic area (km²) of a GeoJSON Polygon/MultiPolygon — correct at any latitude. */
function geodesicArea(geom: GeoJSON.Geometry | null | undefined): number {
  if (!geom) return 0;
  const polys =
    geom.type === 'Polygon' ? [geom.coordinates] : geom.type === 'MultiPolygon' ? geom.coordinates : [];
  let total = 0;
  for (const poly of polys) {
    for (let r = 0; r < poly.length; r++) {
      const ring = poly[r] as Ring;
      const a = ringArea(ring);
      total += r === 0 ? a : -a; // holes subtract
    }
  }
  return Math.abs(total);
}
function ringArea(ring: Ring): number {
  if (ring.length < 3) return 0;
  const rad = (d: number) => (d * Math.PI) / 180;
  let sum = 0;
  for (let i = 0; i < ring.length; i++) {
    const [lon1, lat1] = ring[i];
    const [lon2, lat2] = ring[(i + 1) % ring.length];
    sum += (rad(lon2) - rad(lon1)) * (2 + Math.sin(rad(lat1)) + Math.sin(rad(lat2)));
  }
  return Math.abs((sum * R * R) / 2);
}

let intersectFailures = 0;
function overlapArea(a: GeoJSON.Geometry, b: GeoJSON.Geometry): number {
  try {
    const i = intersect(featureCollection([feature(a as never), feature(b as never)]));
    return i ? geodesicArea(i.geometry) : 0;
  } catch {
    intersectFailures += 1; // surfaced at the end so silent geometry corruption is auditable
    return 0;
  }
}

let neCache: GeoJSON.FeatureCollection | null = null;
function loadNE(): GeoJSON.FeatureCollection {
  if (!neCache) neCache = JSON.parse(readFileSync(NE_PATH, 'utf8')) as GeoJSON.FeatureCollection;
  return neCache;
}

type BBox = [number, number, number, number]; // [minLng,minLat,maxLng,maxLat]
function bboxOf(geom: GeoJSON.Geometry): BBox {
  let a = 180, b = 90, c = -180, d = -90;
  const polys = geom.type === 'Polygon' ? [geom.coordinates] : geom.type === 'MultiPolygon' ? geom.coordinates : [];
  for (const poly of polys) for (const ring of poly) for (const [x, y] of ring as number[][]) {
    if (x < a) a = x; if (y < b) b = y; if (x > c) c = x; if (y > d) d = y;
  }
  return [a, b, c, d];
}
const bboxesDisjoint = (a: BBox, b: BBox): boolean => a[2] < b[0] || b[2] < a[0] || a[3] < b[1] || b[3] < a[1];

interface MapGeoms {
  geom: Map<string, GeoJSON.Geometry>;
  bbox: Map<string, BBox>;
  area: Map<string, number>;
  /** territory_id → world ('earth', 'moon', …). Lineage never crosses worlds. */
  world: Map<string, string>;
  ids: string[];
}
const mapCache = new Map<string, MapGeoms>();
function geomsForMap(eraId: string): MapGeoms {
  const cached = mapCache.get(eraId);
  if (cached) return cached;
  const map = JSON.parse(readFileSync(join(MAPS_DIR, `era_${eraId}.json`), 'utf8')) as GameMap;
  const worldOf = new Map<string, string>();
  for (const t of map.territories) worldOf.set(t.territory_id, inferWorldId(t));
  // Full territory set (base + every growth frontier), so frontiers map to frontiers.
  const polys = buildTerritoryGlobeGeometries(map, {
    countriesGeo: loadNE(),
    statesGeo: null,
    risorgimentoGeo: { type: 'FeatureCollection', features: [] },
  });
  const out: MapGeoms = { geom: new Map(), bbox: new Map(), area: new Map(), world: new Map(), ids: [] };
  for (const p of polys) {
    if (!p.geometry) continue;
    out.geom.set(p.territory_id, p.geometry);
    out.bbox.set(p.territory_id, bboxOf(p.geometry));
    out.area.set(p.territory_id, geodesicArea(p.geometry));
    out.world.set(p.territory_id, worldOf.get(p.territory_id) ?? 'earth');
  }
  out.ids = [...out.geom.keys()];
  mapCache.set(eraId, out);
  return out;
}

interface LineageEdge { to: string; overlap: number; target_overlap: number; primary?: true; manual?: true }
interface Transition {
  from_map: string;
  to_map: string;
  lineage: Record<string, LineageEdge[]>;
  no_successor: string[];
  new_land: string[];
}

function computeTransition(fromEra: string, toEra: string): Transition {
  const ga = geomsForMap(fromEra);
  const gb = geomsForMap(toEra);

  const lineage: Record<string, LineageEdge[]> = {};
  const no_successor: string[] = [];
  const hasParent = new Set<string>();

  for (const [aid, ag] of ga.geom) {
    const aArea = ga.area.get(aid) ?? 0;
    const aWorld = ga.world.get(aid) ?? 'earth';
    if (aArea <= 0) {
      // Degenerate geometry (no real footprint) → its land can't be matched; it
      // leaves play. Keeps the {lineage, no_successor} partition exact.
      no_successor.push(aid);
      continue;
    }
    const aBox = ga.bbox.get(aid)!;
    const edges: LineageEdge[] = [];
    for (const [bid, bg] of gb.geom) {
      // Lineage never crosses worlds: a space-age Moon territory's geometry sits
      // on Earth's sphere and would otherwise "capture" Earth sources as lunar.
      if ((gb.world.get(bid) ?? 'earth') !== aWorld) continue;
      if (bboxesDisjoint(aBox, gb.bbox.get(bid)!)) continue; // cheap reject before the costly intersect
      const o = overlapArea(ag, bg);
      if (o <= 0) continue;
      const fracA = o / aArea; // how much of the SOURCE this target takes
      const fracB = o / Math.max(1, gb.area.get(bid) ?? 0); // how much of the TARGET the source covers
      // An edge exists when the overlap is significant from EITHER perspective:
      // fracA catches "B is a big chunk of A"; fracB catches "A covers most of a
      // small B that sits inside A". new_land is then the exact complement.
      if (fracA >= OVERLAP_THRESHOLD || fracB >= PARENT_THRESHOLD) {
        edges.push({ to: bid, overlap: round(fracA), target_overlap: round(fracB) });
        hasParent.add(bid);
      }
    }
    edges.sort((x, y) => y.overlap - x.overlap);
    if (edges.length) {
      edges[0].primary = true;
      lineage[aid] = edges;
    } else {
      no_successor.push(aid);
    }
  }
  // new_land = target territories with no incoming lineage edge (spawn neutral).
  const new_land = [...gb.geom.keys()].filter((b) => !hasParent.has(b)).sort();
  return { from_map: `era_${fromEra}`, to_map: `era_${toEra}`, lineage, no_successor: no_successor.sort(), new_land };
}

const round = (n: number) => Math.round(n * 1000) / 1000;

interface Override { set?: Record<string, string[]>; remove?: Record<string, string[]> }
function applyOverrides(t: Transition, key: string, ov: Override | undefined, validSources: Set<string>, validTargets: Set<string>): Transition {
  // Universe of ids BEFORE editing, so derived fields stay exact afterwards.
  const sourceUniverse = new Set([...Object.keys(t.lineage), ...t.no_successor]);
  const targetUniverse = new Set<string>(t.new_land);
  for (const edges of Object.values(t.lineage)) for (const e of edges) targetUniverse.add(e.to);

  if (ov) {
    // Fail loudly on a typo'd override id rather than writing an edge to a
    // territory that doesn't exist (which would crash at runtime).
    for (const [src, targets] of Object.entries(ov.set ?? {})) {
      if (!validSources.has(src)) throw new Error(`override ${key}.set: unknown source "${src}"`);
      for (const to of targets) if (!validTargets.has(to)) throw new Error(`override ${key}.set[${src}]: unknown target "${to}"`);
    }
    for (const [src, drop] of Object.entries(ov.remove ?? {})) {
      if (!validSources.has(src)) throw new Error(`override ${key}.remove: unknown source "${src}"`);
      for (const to of drop) if (!validTargets.has(to)) throw new Error(`override ${key}.remove[${src}]: unknown target "${to}"`);
    }
    for (const [src, targets] of Object.entries(ov.set ?? {})) {
      t.lineage[src] = targets.map((to, i) => ({
        to, overlap: 0, target_overlap: 0, manual: true as const, ...(i === 0 ? { primary: true as const } : {}),
      }));
      targets.forEach((to) => targetUniverse.add(to));
      sourceUniverse.add(src);
    }
    for (const [src, drop] of Object.entries(ov.remove ?? {})) {
      if (t.lineage[src]) {
        t.lineage[src] = t.lineage[src].filter((e) => !drop.includes(e.to));
        if (t.lineage[src].length === 0) delete t.lineage[src];
        else if (!t.lineage[src].some((e) => e.primary)) t.lineage[src][0].primary = true;
      }
    }
  }

  // Recompute the exact partition after edits.
  const hasParent = new Set<string>();
  for (const edges of Object.values(t.lineage)) for (const e of edges) hasParent.add(e.to);
  t.no_successor = [...sourceUniverse].filter((s) => !t.lineage[s]).sort();
  t.new_land = [...targetUniverse].filter((b) => !hasParent.has(b)).sort();
  return t;
}

function main(): void {
  const overrides: Record<string, Override> = existsSync(OVERRIDES_PATH)
    ? JSON.parse(readFileSync(OVERRIDES_PATH, 'utf8'))
    : {};
  const transitions: Record<string, Transition> = {};
  for (let i = 0; i < SEQUENCE.length - 1; i++) {
    const key = `${SEQUENCE[i]}->${SEQUENCE[i + 1]}`;
    const validSources = new Set(geomsForMap(SEQUENCE[i]).ids);
    const validTargets = new Set(geomsForMap(SEQUENCE[i + 1]).ids);
    const t = applyOverrides(computeTransition(SEQUENCE[i], SEQUENCE[i + 1]), key, overrides[key], validSources, validTargets);
    transitions[key] = t;
    const mappedSrc = Object.keys(t.lineage).length;
    console.log(
      `${key.padEnd(20)} lineage ${String(mappedSrc).padStart(2)} src · no_successor ${t.no_successor.length} · new_land ${t.new_land.length}`,
    );
  }
  if (intersectFailures > 0) console.warn(`\n⚠ ${intersectFailures} turf.intersect failures were swallowed as zero-overlap — inspect for corrupt geometry.`);
  const out = {
    version: 1,
    method: 'geometry-overlap (ne_50m admin-0, geodesic area)',
    overlap_threshold: OVERLAP_THRESHOLD,
    parent_threshold: PARENT_THRESHOLD,
    sequence: SEQUENCE,
    transitions,
  };
  writeFileSync(OUT_PATH, `${JSON.stringify(out, null, 2)}\n`);
  console.log(`\nWrote ${OUT_PATH}`);
}

main();
