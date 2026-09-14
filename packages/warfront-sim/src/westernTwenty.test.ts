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
 * Every building in the game costs timber, and the only thing that makes timber is a
 * lumber camp, which needs a forest cell to stand on. So "is there forest within reach"
 * is not a flavour question — it decides whether a seat has an economy at all after its
 * opening purse of 160 timber is spent.
 *
 * The committed asset answers NO for two of the four seats in the roster, and this is
 * where that is written down. It was found by chasing why every bot policy stops growing
 * around minute six: the bots were the suspect, and the bots were mostly innocent.
 *
 * These assertions therefore pin a KNOWN GAP rather than a desired property. When the
 * terrain pipeline stops classifying the whole Mediterranean south as plains and highland,
 * these go red — and that is the point. A red test here means the map got better and the
 * seat roster, the lab's expectations and this file should be revisited together.
 */
describe('timber, and which seats the asset can support', () => {
  const FOREST = 3;
  const forestCells = new Map<number, number>();
  for (let i = 0; i < grid.size; i++) {
    const owner = grid.owner(i);
    if (owner > 0 && grid.isPassable(i) && grid.biome(i) === FOREST) {
      forestCells.set(owner, (forestCells.get(owner) ?? 0) + 1);
    }
  }
  const forestIn = (territoryId: string) => forestCells.get(grid.provinceIndex(territoryId)) ?? 0;

  /** Land hops from a province to the nearest one that could hold a lumber camp. */
  function hopsToForest(territoryId: string): number {
    const start = grid.provinceIndex(territoryId);
    if ((forestCells.get(start) ?? 0) > 0) return 0;
    const seen = new Set([start]);
    let frontier = [start];
    for (let hop = 1; hop <= grid.provinces.length; hop++) {
      const next: number[] = [];
      for (const province of frontier) {
        for (const neighbour of geography.neighbours.get(province) ?? []) {
          if (seen.has(neighbour)) continue;
          seen.add(neighbour);
          if ((forestCells.get(neighbour) ?? 0) > 0) return hop;
          next.push(neighbour);
        }
      }
      if (next.length === 0) break;
      frontier = next;
    }
    return -1;
  }

  it('gives Gaul and Hispania forest at home, so they can run an economy unaided', () => {
    expect(forestIn('lugdunensis')).toBeGreaterThan(0);
    expect(forestIn('tarraconensis')).toBeGreaterThan(0);
  });

  it('leaves Carthage no timber reachable by land AT ALL', () => {
    // africa_proconsularis, numidia and mauretania are one landmass and none of them has
    // a forest cell. Carthage's entire match is funded by its opening 160 timber unless it
    // ships a colonist over a lane — which is rule V, and which is the brief's own line
    // that Carthage is "the sea power". The map makes that a requirement, not a style.
    expect(forestIn('africa_proconsularis')).toBe(0);
    expect(forestIn('numidia')).toBe(0);
    expect(forestIn('mauretania')).toBe(0);
    expect(hopsToForest('africa_proconsularis')).toBe(-1);
  });

  it('puts Rome two colonisations away from a province holding ONE forest cell', () => {
    // The whole Italian peninsula is forestless, and the nearest province that is not —
    // narbonensis, two hops out — has a single qualifying cell in it. Rome can technically
    // reach timber by land; it cannot plausibly afford to.
    expect(forestIn('italia_central')).toBe(0);
    expect(forestIn('italia_north')).toBe(0);
    expect(forestIn('italia_south')).toBe(0);
    expect(hopsToForest('italia_central')).toBe(2);
    expect(forestIn('narbonensis')).toBe(1);
  });

  it('leaves the islands rule V reaches without timber of their own', () => {
    expect(forestIn('sicilia')).toBe(0);
    expect(forestIn('sardinia_corsica')).toBe(0);
    // Britannia is the exception, and the richest source on the map — which is why the
    // brief's Tin Route matters and why the Islander wants it.
    expect(forestIn('britannia')).toBeGreaterThan(1000);
  });
});
