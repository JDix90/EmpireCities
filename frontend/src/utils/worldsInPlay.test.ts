/**
 * `worldsInPlay` — the world switcher's list.
 *
 * The bug it exists for: on a growth board the map manifest names every world
 * the board will EVER have, including ones held behind `unlock_era_index` and
 * projected off the emitted map. A switcher built from the manifest offers tabs
 * that open an empty globe long before anyone can go there.
 */
import { describe, it, expect } from 'vitest';
import { worldsInPlay } from './galaxyLanes';

const MANIFEST = [
  { world_id: 'earth', display_name: 'Earth, 2100' },
  { world_id: 'moon', display_name: 'Luna' },
  { world_id: 'verdan', display_name: 'Verdan Reach' },
];

const mapWith = (worldIds: string[]) => ({
  map_kind: 'galaxy' as const,
  worlds: MANIFEST,
  connections: [],
  territories: worldIds.map((wid, i) => ({
    territory_id: `t${i}`,
    region_id: `r_${wid}`,
    world_id: wid,
  })),
});

describe('worldsInPlay', () => {
  it('lists only worlds that have territories, in manifest order', () => {
    expect(worldsInPlay(mapWith(['moon', 'earth', 'earth']))).toEqual([
      { world_id: 'earth', display_name: 'Earth, 2100' },
      { world_id: 'moon', display_name: 'Luna' },
    ]);
  });

  it('adds a world the moment its tiles arrive', () => {
    const after = worldsInPlay(mapWith(['earth', 'moon', 'verdan']));
    expect(after.map((w) => w.world_id)).toEqual(['earth', 'moon', 'verdan']);
  });

  it('still lists a world the manifest never declared', () => {
    const out = worldsInPlay(mapWith(['earth', 'rust']));
    expect(out.map((w) => w.world_id)).toEqual(['earth', 'rust']);
  });

  it('is empty without a map', () => {
    expect(worldsInPlay(null)).toEqual([]);
  });
});
