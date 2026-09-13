import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Sim, cellCentre, replayHash } from './sim';
import { TerrainGrid, type TerrainAsset } from './terrain';
import { fpRatio, toIntFloor } from './fixed';

/**
 * Behavioural tests on the committed western-twenty asset. They assert what the
 * golden fixture only hashes: that a unit ordered across the Alps actually walks a
 * pass, and one ordered across the Loire actually walks a ford.
 */
const ASSET_PATH = join(__dirname, '..', '..', '..', 'database', 'warfront', 'western_twenty.terrain.json');
const asset = JSON.parse(readFileSync(ASSET_PATH, 'utf8')) as TerrainAsset;
const grid = TerrainGrid.decode(asset);

function cellOf(grid: TerrainGrid, lng: number, lat: number): number {
  const i = grid.cellForLngLatE6(Math.round(lng * 1e6), Math.round(lat * 1e6));
  if (i < 0) throw new Error(`(${lng}, ${lat}) is outside the grid`);
  return i;
}

function centreOf(grid: TerrainGrid, cell: number): { x: number; y: number } {
  return { x: cellCentre(grid.colOf(cell)), y: cellCentre(grid.rowOf(cell)) };
}

/** Runs the sim, recording the cell the unit stands in after every tick. */
function walk(sim: Sim, unit: number, ticks: number): number[] {
  const visited: number[] = [];
  for (let t = 0; t < ticks; t++) {
    sim.step();
    const u = sim.entities.get(unit)!;
    visited.push(grid.index(toIntFloor(u.x), toIntFloor(u.y)));
  }
  return visited;
}

const MILAN = cellOf(grid, 9.19, 45.46);
const AUGSBURG = cellOf(grid, 10.9, 48.37);
const LE_MANS = cellOf(grid, 0.2, 48.0);
const POITIERS = cellOf(grid, 0.34, 46.58);

describe('the committed western-twenty asset', () => {
  it("decodes with its checksum, twenty provinces and the map's fourteen lanes", () => {
    expect(grid.width).toBe(asset.width);
    expect(grid.provinces).toHaveLength(20);
    expect(grid.lanes).toHaveLength(14);
    expect(grid.checksum()).toBe(asset.checksum);
    expect(grid.cellKm).toBe(4);
  });

  it('places known landmarks on the terrain they should be on', () => {
    expect(grid.provinces[grid.owner(MILAN) - 1].territory_id).toBe('italia_north');
    expect(grid.provinces[grid.owner(AUGSBURG) - 1].territory_id).toBe('raetia');
    expect(grid.isPass(cellOf(grid, 11.4, 47.27))).toBe(true); // Innsbruck sits in the Brenner corridor
    expect(grid.isPassable(cellOf(grid, 7.5, 46.2))).toBe(false); // Bernese Alps: barrier
    expect(grid.biome(cellOf(grid, 6.96, 50.94))).toBe(6); // Cologne is on the Rhine
    expect(grid.biome(cellOf(grid, 5.37, 43.3))).toBe(1); // Marseille's cell is sea at 4 km
    expect(grid.biome(cellOf(grid, 3.0, 30.0))).toBe(7); // deep Sahara: desert
  });
});

describe('flow-field movement on real terrain', () => {
  it('routes Milan → Augsburg through a mountain pass and arrives', () => {
    const start = centreOf(grid, MILAN);
    const goal = centreOf(grid, AUGSBURG);
    const sim = new Sim({ seed: 1, scenario: { units: [{ owner: 1, ...start, speed: fpRatio(1, 2) }] }, terrain: grid });
    sim.issue({ type: 'move', unit: 1, x: goal.x, y: goal.y });
    const visited = walk(sim, 1, 600);
    const unit = sim.entities.get(1)!;
    expect(unit.moving).toBe(false);
    expect(unit.x).toBe(goal.x);
    expect(unit.y).toBe(goal.y);
    expect(visited.some((c) => grid.isPass(c))).toBe(true);
    expect(visited.every((c) => grid.isPassable(c))).toBe(true);
    // The Alps force a detour: more distinct cells than the straight-line distance.
    const straight = Math.hypot(grid.colOf(AUGSBURG) - grid.colOf(MILAN), grid.rowOf(AUGSBURG) - grid.rowOf(MILAN));
    expect(new Set(visited).size).toBeGreaterThan(straight * 1.15);
  });

  it('routes Le Mans → Poitiers over a Loire ford, never through the river', () => {
    const start = centreOf(grid, LE_MANS);
    const goal = centreOf(grid, POITIERS);
    const sim = new Sim({ seed: 1, scenario: { units: [{ owner: 1, ...start, speed: fpRatio(2, 5) }] }, terrain: grid });
    sim.issue({ type: 'move', unit: 1, x: goal.x, y: goal.y });
    const visited = walk(sim, 1, 300);
    const unit = sim.entities.get(1)!;
    expect(unit.moving).toBe(false);
    expect(unit.x).toBe(goal.x);
    expect(visited.some((c) => grid.isFord(c))).toBe(true);
    expect(visited.some((c) => grid.biome(c) === 6 && !grid.isFord(c))).toBe(false);
  });

  it('redirects an order onto a mountain to the nearest walkable cell', () => {
    const start = centreOf(grid, MILAN);
    const bernese = cellOf(grid, 7.5, 46.2);
    const sim = new Sim({ seed: 1, scenario: { units: [{ owner: 1, ...start, speed: fpRatio(1, 2) }] }, terrain: grid });
    const target = centreOf(grid, bernese);
    sim.issue({ type: 'move', unit: 1, x: target.x, y: target.y });
    sim.run(3);
    const unit = sim.entities.get(1)!;
    const goalCell = grid.index(toIntFloor(unit.goalX), toIntFloor(unit.goalY));
    expect(goalCell).not.toBe(bernese);
    expect(grid.isPassable(goalCell)).toBe(true);
    expect(unit.moving).toBe(true);
  });

  it('drops an order into the open sea and stops a unit that cannot reach its goal', () => {
    const start = centreOf(grid, MILAN);
    const sim = new Sim({ seed: 1, scenario: { units: [{ owner: 1, ...start, speed: fpRatio(1, 2) }] }, terrain: grid });
    const midSea = centreOf(grid, cellOf(grid, 5.0, 40.0)); // Gulf of Lion, far from any coast
    sim.issue({ type: 'move', unit: 1, x: midSea.x, y: midSea.y });
    sim.run(3);
    expect(sim.entities.get(1)!.moving).toBe(false);
    // Corsica is walkable but not reachable by land from Milan: the unit stays put.
    const corsica = centreOf(grid, cellOf(grid, 9.0, 42.2));
    sim.issue({ type: 'move', unit: 1, x: corsica.x, y: corsica.y });
    sim.run(5);
    const unit = sim.entities.get(1)!;
    expect(unit.moving).toBe(false);
    expect(unit.x).toBe(start.x);
  });

  it('a replay on the same terrain reproduces the live hash and refuses a different grid', () => {
    const start = centreOf(grid, LE_MANS);
    const goal = centreOf(grid, POITIERS);
    const sim = new Sim({ seed: 9, scenario: { units: [{ owner: 1, ...start, speed: fpRatio(1, 2) }] }, terrain: grid });
    sim.issue({ type: 'move', unit: 1, x: goal.x, y: goal.y });
    sim.run(120);
    const replay = sim.toReplay();
    expect(replay.terrain_checksum).toBe(grid.checksum());
    expect(replayHash(replay, 120, grid)).toBe(sim.hash());
    expect(() => replayHash(replay, 120, null)).toThrow(/expects terrain/);
  });
});
