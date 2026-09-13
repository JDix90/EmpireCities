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
