import { describe, it, expect } from 'vitest';
import { Biome, TerrainGrid, packCell } from '@borderfall/warfront-sim';
import {
  BIOME_HEIGHT,
  MOUNTAIN_DOME,
  SHELF_CELLS,
  UPLAND_DOME,
  boxBlur,
  chamferDistance,
  computeRelief,
  octaveNoise,
  valueNoise,
} from './relief';

function gridOf(width: number, height: number, cells: number[]): TerrainGrid {
  return new TerrainGrid(width, height, Uint16Array.from(cells));
}

const sea = packCell({ owner: 0, tier: 0, passable: false, biome: Biome.Sea });
const plains = packCell({ owner: 1, tier: 0, passable: true, biome: Biome.Plains });
const mountain = packCell({ owner: 1, tier: 1, passable: false, biome: Biome.Mountain });

/** A rectangle of `fill` painted into a field of `ground`. */
function blockGrid(width: number, height: number, ground: number, fill: number, x0: number, y0: number, x1: number, y1: number) {
  const cells = new Array<number>(width * height).fill(ground);
  for (let row = y0; row < y1; row++) for (let col = x0; col < x1; col++) cells[row * width + col] = fill;
  return gridOf(width, height, cells);
}

describe('boxBlur', () => {
  it('spreads a spike over its radius and conserves what it spread', () => {
    const width = 9;
    const field = new Float32Array(width * width);
    field[4 * width + 4] = 100;
    const before = field.reduce((a, b) => a + b, 0);
    boxBlur(field, new Float32Array(field.length), width, width, 1);
    expect(field[4 * width + 4]).toBeGreaterThan(0);
    expect(field[4 * width + 3]).toBeGreaterThan(0);
    expect(field[4 * width + 1]).toBe(0);
    expect(field.reduce((a, b) => a + b, 0)).toBeCloseTo(before, 3);
  });

  it('clamps at the edges rather than wrapping', () => {
    // A spike on the left edge must not reappear on the right.
    const width = 8;
    const field = new Float32Array(width);
    field[0] = 80;
    boxBlur(field, new Float32Array(width), width, 1, 1);
    expect(field[0]).toBeGreaterThan(0);
    expect(field[width - 1]).toBe(0);
  });

  it('is a no-op below radius 1', () => {
    const field = Float32Array.from([1, 2, 3, 4]);
    boxBlur(field, new Float32Array(4), 4, 1, 0);
    expect([...field]).toEqual([1, 2, 3, 4]);
  });
});

describe('chamferDistance', () => {
  it('measures out from the seeds, diagonals costing more than orthogonals', () => {
    const width = 7;
    const seed = new Uint8Array(width * width);
    seed[3 * width + 3] = 1;
    const dist = chamferDistance(seed, width, width);
    expect(dist[3 * width + 3]).toBe(0);
    expect(dist[3 * width + 4]).toBeCloseTo(1, 5);
    expect(dist[2 * width + 4]).toBeCloseTo(Math.SQRT2, 5);
    expect(dist[3 * width + 6]).toBeCloseTo(3, 5);
    // Both sweeps ran: the cell BEFORE the seed is as far as the one after it.
    expect(dist[3 * width + 2]).toBeCloseTo(1, 5);
  });

  it('reaches every cell when there is a seed at all', () => {
    const seed = new Uint8Array(16);
    seed[0] = 1;
    const dist = chamferDistance(seed, 4, 4);
    for (const d of dist) expect(d).toBeLessThan(8);
  });
});

describe('valueNoise', () => {
  it('is a lattice, not per-cell static: neighbours within a cell of lattice agree closely', () => {
    const field = valueNoise(40, 40, 8, 1);
    let jumps = 0;
    for (let i = 1; i < 40; i++) if (Math.abs(field[i] - field[i - 1]) > 0.3) jumps += 1;
    expect(jumps).toBe(0);
  });

  it('is deterministic in its seed, and different between seeds', () => {
    expect([...valueNoise(12, 12, 4, 7)]).toEqual([...valueNoise(12, 12, 4, 7)]);
    expect([...valueNoise(12, 12, 4, 7)]).not.toEqual([...valueNoise(12, 12, 4, 8)]);
  });

  it('stays inside [0,1)', () => {
    for (const v of valueNoise(30, 30, 5, 3)) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe('octaveNoise', () => {
  it('folds the ridged share about zero, exactly', () => {
    // The whole point of the ridged half is `1 − |n|`: a crest where the noise changes
    // sign. Pinned against the billow field it is derived from, so a change to the fold
    // cannot pass as "the noise looks different now".
    const billow = octaveNoise(20, 20, [6], [1], 11, 1);
    const ridged = octaveNoise(20, 20, [6], [1], 11, 0);
    for (let i = 0; i < billow.length; i++) {
      expect(ridged[i]).toBeCloseTo((1 - Math.abs(billow[i]) - 0.5) * 2, 5);
    }
  });

  it('centres on zero rather than riding above it', () => {
    const field = octaveNoise(64, 64, [13, 6, 3], [0.5, 0.33, 0.17], 5, 0.45);
    const mean = field.reduce((a, b) => a + b, 0) / field.length;
    expect(Math.abs(mean)).toBeLessThan(0.2);
  });
});

describe('computeRelief', () => {
  it('goes on rising past the reach of the smoothing: a massif is a dome', () => {
    // The bug this pins: with height taken from the biome alone, every interior cell of a
    // range held the SAME value, so the gradient inside it was zero and the light found
    // nothing. Measured on the committed asset, half of all mountain cells sat at exactly
    // the biome constant. The Alps rendered as a white plateau with a lit rim.
    //
    // Both samples are deeper than the blur reaches (about five cells), so the blur alone
    // cannot separate them — which it could, and did, when this compared a foot cell.
    const grid = blockGrid(70, 70, plains, mountain, 10, 10, 60, 60);
    const { macro } = computeRelief(grid);
    const shallow = macro[16 * 70 + 16];
    const deep = macro[35 * 70 + 35];
    expect(deep).toBeGreaterThan(shallow + 0.08);
    expect(deep).toBeGreaterThan(BIOME_HEIGHT[Biome.Mountain] + UPLAND_DOME + MOUNTAIN_DOME - 0.01);
  });

  it('lights the inside of a massif, not only its rim', () => {
    // The same bug seen from the renderer. Sampled where BOTH domes have already capped
    // and the blur cannot reach the cap — so the macro form there is flat by construction
    // and every bit of variation in the light comes from the ridge detail. Drop the ridge
    // term and this collapses to a single value.
    const grid = blockGrid(70, 70, plains, mountain, 10, 10, 60, 60);
    const { shade } = computeRelief(grid);
    const inside: number[] = [];
    for (let row = 30; row < 40; row++) for (let col = 30; col < 40; col++) inside.push(shade[row * 70 + col]);
    expect(Math.max(...inside) - Math.min(...inside)).toBeGreaterThan(0.15);
  });

  it('lifts the interior of a continent away from its own coast', () => {
    // Small, and the reason a thousand cells of inland plain are not one flat green field.
    const grid = blockGrid(140, 12, sea, plains, 10, 0, 140, 12);
    const { macro } = computeRelief(grid);
    expect(macro[6 * 140 + 130]).toBeGreaterThan(macro[6 * 140 + 14] + 0.03);
  });

  it('puts the sea at zero and the land above it', () => {
    const grid = blockGrid(20, 20, sea, plains, 5, 5, 15, 15);
    const { macro } = computeRelief(grid);
    expect(macro[0]).toBe(0);
    expect(macro[10 * 20 + 10]).toBeGreaterThan(0.2);
  });

  it('deepens away from the shore and caps at the shelf', () => {
    const grid = blockGrid(60, 8, sea, plains, 0, 0, 4, 8);
    const { depth } = computeRelief(grid);
    expect(depth[4 * 60 + 2]).toBe(0); // land
    expect(depth[4 * 60 + 5]).toBeLessThan(depth[4 * 60 + 9]);
    expect(depth[4 * 60 + 4 + Math.ceil(SHELF_CELLS)]).toBe(1);
    expect(depth[4 * 60 + 50]).toBe(1);
  });

  it('measures the shore from the water and the wood from open ground', () => {
    const wooded = packCell({ owner: 1, tier: 0, passable: true, biome: Biome.Plains, wooded: true });
    const grid = blockGrid(30, 30, sea, plains, 4, 4, 26, 26);
    const withWood = blockGrid(30, 30, plains, wooded, 10, 10, 20, 20);
    expect(computeRelief(grid).shore[15 * 30 + 15]).toBeGreaterThan(8);
    expect(computeRelief(grid).shore[2 * 30 + 2]).toBe(0);
    const { wood } = computeRelief(withWood);
    expect(wood[5 * 30 + 5]).toBe(0);
    expect(wood[15 * 30 + 15]).toBeGreaterThan(4);
  });

  it('does not raise a ridge along a severed land contact', () => {
    // Impassable lowland is a border the pipeline drew, not a hill (see terrainImage.ts).
    // Lifting it would put a lit escarpment along every one of them.
    const walkable = packCell({ owner: 1, tier: 1, passable: true, biome: Biome.Plains });
    const severed = packCell({ owner: 1, tier: 1, passable: false, biome: Biome.Plains });
    const a = computeRelief(gridOf(3, 1, [walkable, walkable, walkable]));
    const b = computeRelief(gridOf(3, 1, [severed, severed, severed]));
    expect(a.macro[1]).toBeGreaterThan(b.macro[1]);
  });

  it('is a pure function of the cells', () => {
    const grid = blockGrid(24, 24, plains, mountain, 6, 6, 18, 18);
    const first = computeRelief(grid);
    const second = computeRelief(grid);
    expect([...first.shade]).toEqual([...second.shade]);
    expect([...first.height]).toEqual([...second.height]);
    expect([...first.grain]).toEqual([...second.grain]);
  });
});
