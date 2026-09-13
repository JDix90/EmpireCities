import { describe, it, expect } from 'vitest';
import { Biome, Sim, TerrainGrid, cellCentre, fpRatio, packCell } from '@borderfall/warfront-sim';
import { AlertQueue, DEDUPE_TICKS, MAX_ALERTS, blockedUnitIds } from './alerts';

describe('AlertQueue', () => {
  it('keeps the newest first', () => {
    const q = new AlertQueue();
    q.push('blocked', 'a', 1, 0);
    q.push('no-route', 'b', 2, 1);
    expect(q.list().map((a) => a.message)).toEqual(['b', 'a']);
    expect(q.latest()?.message).toBe('b');
  });

  it('suppresses the same alert about the same place until it is news again', () => {
    const q = new AlertQueue();
    expect(q.push('blocked', 'stuck', 5, 0)).not.toBeNull();
    expect(q.push('blocked', 'stuck', 5, DEDUPE_TICKS - 1)).toBeNull();
    expect(q.push('blocked', 'stuck', 5, DEDUPE_TICKS)).not.toBeNull();
    // A different place, or a different kind, is always news.
    expect(q.push('blocked', 'stuck', 6, 1)).not.toBeNull();
    expect(q.push('no-route', 'stuck', 5, 1)).not.toBeNull();
  });

  it('drops the oldest past the cap', () => {
    const q = new AlertQueue();
    for (let i = 0; i < MAX_ALERTS + 3; i++) q.push('blocked', `m${i}`, i, i * DEDUPE_TICKS);
    expect(q.list()).toHaveLength(MAX_ALERTS);
    expect(q.latest()?.message).toBe(`m${MAX_ALERTS + 2}`);
  });

  it('dismisses and clears', () => {
    const q = new AlertQueue();
    const a = q.push('blocked', 'x', 1, 0)!;
    q.push('blocked', 'y', 2, 0);
    q.dismiss(a.id);
    expect(q.list().map((x) => x.message)).toEqual(['y']);
    q.clear();
    expect(q.latest()).toBeNull();
  });
});

describe('blockedUnitIds', () => {
  const land = packCell({ owner: 1, tier: 0, passable: true, biome: Biome.Plains });
  const rock = packCell({ owner: 1, tier: 1, passable: false, biome: Biome.Mountain });

  /** Two walkable pockets either side of an impassable wall. */
  function splitGrid(): TerrainGrid {
    const width = 5;
    const height = 1;
    const cells = Uint16Array.from([land, land, rock, land, land]);
    return new TerrainGrid(width, height, cells);
  }

  it('is empty for units that have never been ordered', () => {
    const grid = splitGrid();
    const sim = new Sim({
      seed: 1,
      scenario: { units: [{ owner: 1, x: cellCentre(0), y: cellCentre(0), speed: fpRatio(1, 2) }] },
      terrain: grid,
    });
    expect(blockedUnitIds(sim)).toEqual([]);
  });

  it('reports a unit the terrain has cut off from its goal', () => {
    const grid = splitGrid();
    const sim = new Sim({
      seed: 1,
      scenario: { units: [{ owner: 1, x: cellCentre(0), y: cellCentre(0), speed: fpRatio(1, 2) }] },
      terrain: grid,
    });
    // Across the wall: reachable cell, no land route.
    sim.issue({ type: 'move', unit: 1, x: cellCentre(4), y: cellCentre(0) });
    sim.run(20);
    expect(sim.entities.get(1)!.moving).toBe(false);
    expect(blockedUnitIds(sim)).toEqual([1]);
  });

  it('is empty again once a unit reaches a goal it can reach', () => {
    const grid = splitGrid();
    const sim = new Sim({
      seed: 1,
      scenario: { units: [{ owner: 1, x: cellCentre(0), y: cellCentre(0), speed: fpRatio(1, 2) }] },
      terrain: grid,
    });
    sim.issue({ type: 'move', unit: 1, x: cellCentre(1), y: cellCentre(0) });
    sim.run(40);
    expect(blockedUnitIds(sim)).toEqual([]);
  });
});
