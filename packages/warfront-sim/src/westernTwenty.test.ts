import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { TerrainGrid, type TerrainAsset } from './terrain';
import { buildProvinceGeography } from './tribes';

/**
 * The committed western-twenty asset, checked against the map document it was built from.
 *
 * This exists because the two disagreed and nothing noticed. The province polygons come
 * from the live globe's own geometry builder, and at this resolution several of them
 * spill onto ground they do not own — Britannia's covers a strip of Normandy — which made
 * BRITANNIA WALKABLE FROM GAUL in the shipped asset. That quietly deletes rule V: the sea
 * stops being a lane, the Tin Route stops being a route, and Carthage stops being a sea
 * power. It survived two merged steps because nothing until the lab depended on adjacency
 * being right.
 *
 * The terrain pipeline now reconciles the two and fails its own build on a mismatch. This
 * is the same check from the other side, on the COMMITTED asset, so a hand-edited or
 * stale asset cannot reach main either.
 */

const ROOT = join(__dirname, '..', '..', '..');
const ASSET = join(ROOT, 'database/warfront/western_twenty.terrain.json');
const MAP = join(ROOT, 'database/maps/community_roman_empire_117.json');
const CURATION = join(ROOT, 'database/warfront/curated/western_twenty.curation.json');

interface MapDoc {
  connections: Array<{ from: string; to: string; type: string }>;
}
interface Curation {
  provinces: string[];
  accepted_missing_land?: Array<{ pair: string; reason: string }>;
  extra_lanes?: Array<{ from: string; to: string; reason: string }>;
}

const grid = TerrainGrid.decode(JSON.parse(readFileSync(ASSET, 'utf8')) as TerrainAsset);
const map = JSON.parse(readFileSync(MAP, 'utf8')) as MapDoc;
const curation = JSON.parse(readFileSync(CURATION, 'utf8')) as Curation;

const wanted = new Set(curation.provinces);
const territoryOf = new Map(grid.provinces.map((p) => [p.index, p.territory_id]));
const pair = (a: number, b: number) => [territoryOf.get(a)!, territoryOf.get(b)!].sort().join(' | ');

const declaredLand = new Set<string>();
const declaredSea = new Set<string>();
for (const c of map.connections) {
  if (!wanted.has(c.from) || !wanted.has(c.to)) continue;
  const key = [c.from, c.to].sort().join(' | ');
  if (c.type === 'land') declaredLand.add(key);
  else if (c.type === 'sea') declaredSea.add(key);
}

const geography = buildProvinceGeography(grid);
const derivedLand = new Set<string>();
for (const [index, neighbours] of geography.neighbours) {
  for (const n of neighbours) derivedLand.add(pair(index, n));
}
const accepted = new Set((curation.accepted_missing_land ?? []).map((e) => e.pair));

describe('the committed western twenty asset agrees with its map document', () => {
  it('walks nowhere the map does not call a land border', () => {
    // The direction that matters most: an EXTRA border is a rule silently deleted.
    expect([...derivedLand].filter((k) => !declaredLand.has(k))).toEqual([]);
  });

  it('realises every declared land border except the ones curation accepts, with a reason', () => {
    const missing = [...declaredLand].filter((k) => !derivedLand.has(k));
    expect(missing.filter((k) => !accepted.has(k))).toEqual([]);
    for (const entry of curation.accepted_missing_land ?? []) {
      // An accepted divergence without a reason is an excuse, not a decision.
      expect(entry.reason.length).toBeGreaterThan(40);
    }
  });

  it('carries no stale acceptances', () => {
    expect([...accepted].filter((k) => derivedLand.has(k))).toEqual([]);
  });

  it('leaves Britannia an island, which is what rule V is built on', () => {
    const britannia = grid.provinceIndex('britannia');
    expect(britannia).toBeGreaterThan(0);
    expect(geography.neighbours.get(britannia)).toEqual([]);
    // And it is still reachable — by lane, which is the whole point.
    expect([...declaredSea].some((k) => k.includes('britannia'))).toBe(true);
  });

  it("gives Gaul the four land neighbours the brief's own seat table measures", () => {
    const gaul = grid.provinceIndex('lugdunensis');
    const names = (geography.neighbours.get(gaul) ?? []).map((i) => territoryOf.get(i)!).sort();
    expect(names).toEqual(['aquitania', 'belgica', 'germania_superior', 'narbonensis']);
  });

  it('keeps every seat province walkable, so a match can open on it', () => {
    for (const id of ['italia_central', 'lugdunensis', 'africa_proconsularis', 'tarraconensis']) {
      const index = grid.provinceIndex(id);
      expect(index).toBeGreaterThan(0);
      let walkable = 0;
      for (let i = 0; i < grid.size; i++) if (grid.owner(i) === index && grid.isPassable(i)) walkable += 1;
      expect(walkable).toBeGreaterThan(1000);
    }
  });
});

/**
 * Can a seat on this map actually run an economy?
 *
 * Every building in the game costs timber, the only thing that makes timber is a lumber
 * camp, and a lumber camp needs wooded ground. So "is there woodland within reach" is not
 * a flavour question — it decides whether a seat has an economy at all once its opening
 * purse of 160 timber is spent.
 *
 * This file used to record the answer NO for two of the four seats, because the pipeline
 * composed a cell by precedence and highland outranked forest: six of the fourteen curated
 * woods were erased outright, including all of Sila and all of Kroumirie, which are the
 * only woodland in Italy and in Africa. Woodland is now a flag carried beside the biome
 * (WOODED_BIT), so a wooded hill is highland to walk up and forest to fell.
 *
 * These assertions are the guard on that. They are deliberately about REACH rather than
 * exact cell counts, so repainting a polygon does not fail the build — only losing a
 * seat's timber does.
 */
describe('timber, and which seats the asset can support', () => {
  /** Ground a lumber camp could actually stand on: wooded, walkable, owned. */
  const sites = new Map<number, number>();
  for (let i = 0; i < grid.size; i++) {
    const owner = grid.owner(i);
    if (owner > 0 && grid.isWooded(i) && grid.isPassable(i)) {
      sites.set(owner, (sites.get(owner) ?? 0) + 1);
    }
  }
  const sitesIn = (territoryId: string) => sites.get(grid.provinceIndex(territoryId)) ?? 0;

  /** Land hops from a province to the nearest one that could hold a lumber camp. */
  function hopsToTimber(territoryId: string): number {
    const start = grid.provinceIndex(territoryId);
    if ((sites.get(start) ?? 0) > 0) return 0;
    const seen = new Set([start]);
    let frontier = [start];
    for (let hop = 1; hop <= grid.provinces.length; hop++) {
      const next: number[] = [];
      for (const province of frontier) {
        for (const neighbour of geography.neighbours.get(province) ?? []) {
          if (seen.has(neighbour)) continue;
          seen.add(neighbour);
          if ((sites.get(neighbour) ?? 0) > 0) return hop;
          next.push(neighbour);
        }
      }
      if (next.length === 0) break;
      frontier = next;
    }
    return -1;
  }

  it('gives every seat in the roster timber it can actually reach', () => {
    // The whole point. Carthage is the one that was impossible: africa_proconsularis,
    // numidia and mauretania are one landmass and the composer had erased the only wood on
    // it, so no lumber camp could be built in Africa at any distance, ever.
    for (const seat of ['lugdunensis', 'tarraconensis', 'africa_proconsularis', 'italia_central']) {
      expect(hopsToTimber(seat)).toBeGreaterThanOrEqual(0);
    }
  });

  it('puts woodland at home for Gaul, Hispania and Carthage', () => {
    expect(sitesIn('lugdunensis')).toBeGreaterThan(0);
    expect(sitesIn('tarraconensis')).toBeGreaterThan(0);
    expect(sitesIn('africa_proconsularis')).toBeGreaterThan(0);
  });

  it('leaves Rome one colonisation from timber, not two', () => {
    // Italia_central itself is bare, but Sila is in italia_south next door. Before the
    // fix the nearest wood was narbonensis, two hops out, and it held a single cell.
    expect(sitesIn('italia_central')).toBe(0);
    expect(sitesIn('italia_south')).toBeGreaterThan(0);
    expect(hopsToTimber('italia_central')).toBe(1);
  });

  it('keeps the curated mask honest about which woods survive composition', () => {
    // Sila and Kroumirie are the two that were being erased. Narbonensis is the one that
    // shows the scale of it: the Massif Central woods came through as a single cell.
    expect(sitesIn('italia_south')).toBeGreaterThan(100);
    expect(sitesIn('africa_proconsularis')).toBeGreaterThan(100);
    expect(sitesIn('narbonensis')).toBeGreaterThan(100);
  });

  it('still leaves the small islands without timber of their own', () => {
    // Not a defect — nobody has drawn a wood on either, and rule V is how you leave them.
    // Here so that changing it is a decision rather than an accident.
    expect(sitesIn('sicilia')).toBe(0);
    expect(sitesIn('sardinia_corsica')).toBe(0);
    // Britannia is the richest source on the map, which is what the Tin Route is about.
    expect(sitesIn('britannia')).toBeGreaterThan(1000);
  });
});

/**
 * Sea lanes: the map document's own, plus the ones only Warfront wants.
 *
 * The document is live Borderfall data — seeded by seedMaps.ts, read by the live socket's
 * map resolver, used by two daily set-pieces — so a lane this mode needs and that mode
 * does not cannot be written there. `extra_lanes` in the curation file is the Warfront-only
 * side of the same question, and this is the check that the asset is exactly the union and
 * nothing has drifted into it from either direction.
 */
describe('the asset\'s lanes are the map document plus curation, exactly', () => {
  const assetLanes = new Set(grid.lanes.map((l) => [l.from, l.to].sort().join(' | ')));
  const curated = new Set((curation.extra_lanes ?? []).map((l) => [l.from, l.to].sort().join(' | ')));

  it('carries every sea connection the map declares inside the slice', () => {
    for (const key of declaredSea) expect(assetLanes.has(key)).toBe(true);
  });

  it('carries every lane the curation adds, and no others', () => {
    for (const key of curated) expect(assetLanes.has(key)).toBe(true);
    expect(assetLanes.size).toBe(declaredSea.size + curated.size);
    for (const key of assetLanes) {
      expect(declaredSea.has(key) || curated.has(key)).toBe(true);
    }
  });

  it('adds the Tin Route, and keeps it out of the live map document', () => {
    const tinRoute = ['lusitania', 'britannia'].sort().join(' | ');
    expect(curated.has(tinRoute)).toBe(true);
    expect(assetLanes.has(tinRoute)).toBe(true);
    // The point of the whole arrangement: Borderfall's own map is untouched by it.
    expect(declaredSea.has(tinRoute)).toBe(false);
  });
});
