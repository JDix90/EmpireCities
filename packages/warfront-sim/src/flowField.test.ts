import { describe, it, expect } from 'vitest';
import { Biome, TerrainGrid, packCell } from './terrain';
import { COST_DIAGONAL, COST_ORTHOGONAL, FlowField, FlowFieldCache } from './flowField';

const LAND = packCell({ owner: 1, tier: 0, passable: true, biome: Biome.Plains });
const ROCK = packCell({ owner: 1, tier: 1, passable: false, biome: Biome.Mountain });

/** Builds a grid from an ASCII picture: `.` passable, `#` blocked. */
function gridFrom(picture: string[]): TerrainGrid {
  const height = picture.length;
  const width = picture[0].length;
  const cells = new Uint16Array(width * height);
  for (let r = 0; r < height; r++) {
    for (let c = 0; c < width; c++) cells[r * width + c] = picture[r][c] === '#' ? ROCK : LAND;
  }
  return new TerrainGrid(width, height, cells);
}

function walk(field: FlowField, grid: TerrainGrid, from: number): number[] {
  const path = [from];
  let cur = from;
  for (let guard = 0; guard < 1000 && cur !== field.target; guard++) {
    field.ensure(cur);
    const next = field.next[cur];
    if (next < 0) break;
    path.push(next);
    cur = next;
  }
  return path;
}

describe('FlowField', () => {
  it('routes through a gap in a wall rather than across it', () => {
    const grid = gridFrom([
      '..........',
      '....#.....',
      '....#.....',
      '....#.....',
      '....#.....',
      '....#.....',
      '..........',
    ]);
    const target = grid.index(8, 3);
    const start = grid.index(1, 3);
    const field = new FlowField(grid, target);
    const path = walk(field, grid, start);
    expect(path[path.length - 1]).toBe(target);
    for (const cell of path) expect(grid.isPassable(cell)).toBe(true);
    // A straight line would be 7 orthogonal steps; going round the wall costs more.
    expect(field.cost[start]).toBeGreaterThan(7 * COST_ORTHOGONAL);
    expect(field.cost[target]).toBe(0);
    expect(field.next[target]).toBe(-1);
  });

  it('never cuts a corner past a blocked orthogonal neighbour', () => {
    const grid = gridFrom(['.#.', '.#.', '...']);
    // Column 1 is blocked above row 2, so (2,1) → (1,2) must not cut the corner past (1,1).
    const target = grid.index(0, 2);
    const field = new FlowField(grid, target);
    const from = grid.index(2, 2);
    const path = walk(field, grid, from);
    expect(path).toEqual([grid.index(2, 2), grid.index(1, 2), grid.index(0, 2)]);
    field.ensure(grid.index(2, 0));
    // (2,0) → (2,1) → (2,2) → (1,2) → (0,2): four orthogonal steps, no diagonal.
    expect(field.cost[grid.index(2, 0)]).toBe(4 * COST_ORTHOGONAL);
  });

  it('prefers a diagonal when both orthogonals are open', () => {
    const grid = gridFrom(['...', '...', '...']);
    const field = new FlowField(grid, grid.index(2, 2));
    field.ensure(grid.index(0, 0));
    expect(field.cost[grid.index(0, 0)]).toBe(2 * COST_DIAGONAL);
  });

  it('reports unreachable cells once the search is exhausted', () => {
    const grid = gridFrom(['..#..', '..#..', '..#..']);
    const field = new FlowField(grid, grid.index(0, 0));
    const island = grid.index(4, 1);
    expect(field.isResolved(island)).toBe(false);
    field.ensure(island);
    expect(field.isResolved(island)).toBe(true);
    expect(field.cost[island]).toBe(-1);
    expect(field.next[island]).toBe(-1);
  });

  it('a field extended step by step equals one built in a single sweep', () => {
    const picture = [
      '..........#.........',
      '....#.....#....#....',
      '....#.........#.....',
      '....#####....#......',
      '............#.......',
      '.#####.....#........',
      '....................',
    ];
    const grid = gridFrom(picture);
    const target = grid.index(19, 6);
    const full = new FlowField(grid, target);
    full.ensure(grid.index(0, 0));
    for (let i = 0; i < grid.size; i++) full.ensure(i);
    const incremental = new FlowField(grid, target);
    const order = [grid.index(3, 6), grid.index(0, 0), grid.index(18, 0), grid.index(7, 2)];
    for (const cell of order) incremental.ensure(cell);
    for (const cell of order) {
      expect(incremental.cost[cell]).toBe(full.cost[cell]);
      expect(walk(incremental, grid, cell)).toEqual(walk(full, grid, cell));
    }
    for (let i = 0; i < grid.size; i++) {
      if (incremental.isResolved(i)) expect(incremental.next[i]).toBe(full.next[i]);
    }
  });

  it('refuses an impassable target', () => {
    const grid = gridFrom(['.#']);
    expect(() => new FlowField(grid, 1)).toThrow(/not passable/);
  });
});

describe('FlowFieldCache', () => {
  it('shares fields per target and evicts the oldest past capacity', () => {
    const grid = gridFrom(['.....', '.....']);
    const cache = new FlowFieldCache(grid, 2);
    const a = cache.get(0);
    expect(cache.get(0)).toBe(a);
    cache.get(1);
    cache.get(2);
    expect(cache.size).toBe(2);
    expect(cache.get(0)).not.toBe(a); // evicted and rebuilt
  });
});
