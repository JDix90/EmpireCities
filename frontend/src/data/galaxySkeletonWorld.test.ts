/**
 * Verdan Reach, the Twilight Ring, as built from its skeleton spec.
 *
 * The generator already refuses geometry whose land borders differ from the
 * spec; these tests pin the design properties the balance work measured, so a
 * spec edit that keeps the geometry honest but changes the game fails here.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { generateGalaxyWorlds, type GalaxyMapScaffold } from '../../scripts/galaxy/generateGalaxyWorlds';
import { buildSkeletonWorld } from '../../scripts/galaxy/skeletonWorld';
import { GALAXY_SPECS, type SkeletonWorldSpec } from '../../scripts/galaxy/worldSpecs';
import { GALAXY_OUTPUT_PATHS } from '../../scripts/buildGalaxyWorlds';
import { GALAXY_TERRITORY_LORE_DETAIL } from '../constants/galaxyLore';

const scaffold = JSON.parse(readFileSync(GALAXY_OUTPUT_PATHS.map, 'utf8')) as GalaxyMapScaffold;
const { map } = generateGalaxyWorlds(scaffold, GALAXY_SPECS);
const verdanSpec = GALAXY_SPECS.farWorlds.find((w) => w.world_id === 'verdan') as SkeletonWorldSpec;

const tiles = map.territories.filter((t) => t.world_id === 'verdan');
const ids = new Set(tiles.map((t) => t.territory_id));
const regionOf = new Map(tiles.map((t) => [t.territory_id, t.region_id]));
const inner = map.connections.filter((c) => c.type !== 'orbit' && ids.has(c.from) && ids.has(c.to));
const lanes = map.connections.filter((c) => c.type === 'orbit' && (ids.has(c.from) || ids.has(c.to)));

function adjacency(edges: Array<{ from: string; to: string }>): Map<string, string[]> {
  const adj = new Map([...ids].map((id) => [id, [] as string[]]));
  for (const e of edges) { adj.get(e.from)!.push(e.to); adj.get(e.to)!.push(e.from); }
  return adj;
}

function reachable(adj: Map<string, string[]>, from: string, without?: string): Set<string> {
  const seen = new Set([from]);
  const stack = [from];
  while (stack.length) {
    for (const n of adj.get(stack.pop()!)!) {
      if (n !== without && !seen.has(n)) { seen.add(n); stack.push(n); }
    }
  }
  return seen;
}

describe('Verdan Reach — the Twilight Ring', () => {
  it('keeps 16 tiles and a region-bonus total of 12 in five regions', () => {
    expect(tiles).toHaveLength(16);
    const regions = (map.regions as Array<{ region_id: string; bonus: number }>).filter((r) => r.region_id.startsWith('verdan_'));
    expect(regions.map((r) => r.region_id).sort()).toEqual([
      'verdan_brilliance', 'verdan_lumen_crown', 'verdan_mirelands', 'verdan_sporefields', 'verdan_stormbelts',
    ]);
    expect(regions.reduce((s, r) => s + r.bonus, 0)).toBe(12);
  });

  it('is a ring: no tile whose loss cuts the world in two', () => {
    const adj = adjacency(inner);
    for (const id of ids) {
      const start = [...ids].find((x) => x !== id)!;
      expect(reachable(adj, start, id).size, `removing ${id}`).toBe(15);
    }
  });

  it('is joined only by its straits and the chord through the Eye', () => {
    const sea = inner.filter((c) => c.type === 'sea').map((c) => [c.from, c.to].sort().join('–')).sort();
    expect(sea).toEqual([
      'verdan_cinder_bloom–verdan_glowmire_shelf',
      'verdan_emberleaf_basin–verdan_mycel_deep',
      'verdan_emberleaf_basin–verdan_pollen_sea',
      'verdan_mycel_deep–verdan_saffron_mire',
      'verdan_photic_crown–verdan_spore_reach',
      'verdan_pollen_sea–verdan_witchlight_fen',
    ]);
    // Cut the two storm straits and the chord, and the crescents fall apart.
    const land = adjacency(inner.filter((c) => c.type === 'land'));
    const dawn = reachable(land, 'verdan_chlorophage_span');
    expect(dawn.has('verdan_photic_crown')).toBe(false);
  });

  it("lands Sol's lanes on the Dawn crescent and Rust's on the Dusk crescent", () => {
    const end = (otherPrefix: string) => lanes
      .filter((c) => c.from.startsWith(otherPrefix) || c.to.startsWith(otherPrefix))
      .map((c) => (ids.has(c.from) ? c.from : c.to));
    const dawn = new Set(['verdan_sporefields', 'verdan_mirelands']);
    const dusk = new Set(['verdan_lumen_crown', 'verdan_stormbelts']);
    const solEnds = end('sol_');
    const rustEnds = end('rust_');
    expect(solEnds).toHaveLength(2);
    expect(rustEnds).toHaveLength(2);
    for (const id of solEnds) expect(dawn.has(regionOf.get(id)!), id).toBe(true);
    for (const id of rustEnds) expect(dusk.has(regionOf.get(id)!), id).toBe(true);
    // One per region on each front, so a single region cannot hold both lanes.
    expect(new Set(solEnds.map((id) => regionOf.get(id))).size).toBe(2);
    expect(new Set(rustEnds.map((id) => regionOf.get(id))).size).toBe(2);
  });

  it('gives every Verdan tile its own lore, and no lore to tiles that no longer exist', () => {
    const loreIds = Object.keys(GALAXY_TERRITORY_LORE_DETAIL).filter((k) => k.startsWith('verdan_'));
    expect(loreIds.sort()).toEqual([...ids].sort());
  });
});

describe('buildSkeletonWorld', () => {
  const clone = (): SkeletonWorldSpec => JSON.parse(JSON.stringify(verdanSpec));

  it('refuses geometry that disagrees with the designed graph', () => {
    const s = clone();
    s.landBorders = s.landBorders.filter(([a, b]) => !(a === 'verdan_spore_reach' && b === 'verdan_verdigris_span'));
    s.landBorders.push(['verdan_spore_reach', 'verdan_sulphur_drift']);
    s.seaLinks.push(['verdan_saffron_mire', 'verdan_chlorophage_span']);
    s.seaLinks.push(['verdan_spore_reach', 'verdan_sulphur_drift']);
    let message = '';
    try { buildSkeletonWorld(s); } catch (e) { message = (e as Error).message; }
    expect(message).toMatch(/verdan_spore_reach–verdan_verdigris_span share a land border the design does not have/);
    expect(message).toMatch(/designed land border verdan_spore_reach–verdan_sulphur_drift is missing/);
    expect(message).toMatch(/sea link verdan_saffron_mire–verdan_chlorophage_span already shares a land border/);
    expect(message).toMatch(/sea link verdan_spore_reach–verdan_sulphur_drift crosses [\d.]+° of water \(limit 14°\)/);
  });

  it('refuses a seed in the sea', () => {
    const s = clone();
    s.territories[0].at = [180, -60];
    expect(() => buildSkeletonWorld(s)).toThrow(/seed of verdan_spore_reach at \[180,-60\] is not on land/);
  });
});
