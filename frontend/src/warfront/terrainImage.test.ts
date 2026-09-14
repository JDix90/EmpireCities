import { describe, it, expect } from 'vitest';
import { Biome, TerrainGrid, packCell } from '@borderfall/warfront-sim';
import type { ReliefFields } from './relief';
import { SHELF_CELLS, computeRelief } from './relief';
import {
  BEACH_SAND,
  BIOME_COLORS,
  BLOCKED_SLATE,
  BORDER_INK,
  FORD_COLOR,
  PASS_COLOR,
  SHADOW_TINT,
  SNOW_START,
  SUN_TINT,
  buildTerrainImage,
  colorForCell,
} from './terrainImage';

function gridOf(width: number, height: number, cells: number[]): TerrainGrid {
  return new TerrainGrid(width, height, Uint16Array.from(cells));
}

function pixel(rgba: Uint8Array, width: number, col: number, row: number): [number, number, number, number] {
  const p = (row * width + col) * 4;
  return [rgba[p], rgba[p + 1], rgba[p + 2], rgba[p + 3]];
}

/**
 * Dead-flat light: no shading, no grain, no snow, deep inland, deep inside a wood.
 *
 * Every one of those is a neighbour-dependent layer, so pinning them all to their neutral
 * value leaves exactly the part of the colour a single cell value decides — which is what
 * `colorForCell` is. Tests that care about one layer override just that layer.
 */
function flatRelief(size: number, over: Partial<ReliefFields> = {}): ReliefFields {
  const fill = (v: number) => new Float32Array(size).fill(v);
  return { height: fill(0), macro: fill(0), shade: fill(1), depth: fill(0), shore: fill(50), wood: fill(50), grain: fill(0), ...over };
}

const sea = packCell({ owner: 0, tier: 0, passable: false, biome: Biome.Sea });
const plainsA = packCell({ owner: 1, tier: 0, passable: true, biome: Biome.Plains });
const plainsB = packCell({ owner: 2, tier: 0, passable: true, biome: Biome.Plains });

describe('colorForCell', () => {
  it('gives crossings their own colour, since they are the only way through', () => {
    const ford = packCell({ owner: 1, tier: 0, passable: true, biome: Biome.River, ford: true });
    const pass = packCell({ owner: 1, tier: 1, passable: true, biome: Biome.Highland, pass: true });
    expect(colorForCell(ford)).toEqual(FORD_COLOR);
    expect(colorForCell(pass)).toEqual(PASS_COLOR);
  });

  it('blends sand into a beach rather than replacing the ground', () => {
    const beach = packCell({ owner: 1, tier: 0, passable: true, biome: Biome.Plains, beach: true });
    const [r] = colorForCell(beach);
    expect(r).toBeGreaterThan(BIOME_COLORS[Biome.Plains][0]);
    expect(r).toBeLessThan(BEACH_SAND[0]);
  });

  it('drains the colour out of ground that only looks walkable', () => {
    // Plains, forest and highland promise a walk their passable bit does not honour.
    for (const biome of [Biome.Plains, Biome.Forest, Biome.Highland] as const) {
      const open = colorForCell(packCell({ owner: 1, tier: 0, passable: true, biome }));
      const shut = colorForCell(packCell({ owner: 1, tier: 0, passable: false, biome }));
      expect(shut).not.toEqual(open);
      const spread = (c: readonly number[]) => Math.max(...c) - Math.min(...c);
      expect(spread(shut)).toBeLessThan(spread(open));
      expect(shut[1]).toBeLessThan(open[1]);
    }
  });

  it('leaves alone the biomes that already read as blocked', () => {
    // Mountain and desert say "no" by their own colour; slating them too would lose the
    // distinction between a range and a border the pipeline drew.
    for (const biome of [Biome.Mountain, Biome.Desert] as const) {
      expect(colorForCell(packCell({ owner: 1, tier: 0, passable: false, biome }))).toEqual(BIOME_COLORS[biome]);
    }
    expect(BLOCKED_SLATE).toBeDefined();
  });

  it('tints wooded ground toward the forest without recolouring it', () => {
    const bareHill = packCell({ owner: 1, tier: 1, passable: true, biome: Biome.Highland });
    const woodedHill = packCell({ owner: 1, tier: 1, passable: true, biome: Biome.Highland, wooded: true });
    const hill = colorForCell(bareHill);
    const wood = colorForCell(woodedHill);
    expect(wood).not.toEqual(hill);
    expect(wood).not.toEqual(BIOME_COLORS[Biome.Forest]);
    // Moved toward the forest on every channel, and still recognisably the hill.
    for (let k = 0; k < 3; k++) {
      const toward = BIOME_COLORS[Biome.Forest][k] - hill[k];
      expect(Math.sign(wood[k] - hill[k]) || Math.sign(toward)).toBe(Math.sign(toward));
      expect(Math.abs(wood[k] - hill[k])).toBeLessThan(Math.abs(toward));
    }
  });

  it('does not tint the forest toward itself twice', () => {
    const wooded = packCell({ owner: 1, tier: 0, passable: true, biome: Biome.Forest, wooded: true });
    expect(colorForCell(wooded)).toEqual(BIOME_COLORS[Biome.Forest]);
  });
});

describe('buildTerrainImage', () => {
  it('produces one opaque pixel per cell, row 0 north', () => {
    const grid = gridOf(2, 2, [sea, plainsA, plainsA, sea]);
    const img = buildTerrainImage(grid, flatRelief(4));
    expect(img.width).toBe(2);
    expect(img.height).toBe(2);
    expect(img.rgba.length).toBe(2 * 2 * 4);
    expect(pixel(img.rgba, 2, 1, 0)).toEqual([...BIOME_COLORS[Biome.Plains], 255]);
    expect(pixel(img.rgba, 2, 0, 0)[3]).toBe(255);
  });

  it('paints exactly what colorForCell says, once the light is flat', () => {
    // The bake unpacks a cell with the raw masks for speed while `colorForCell` uses the
    // accessors; this is the one test that stops those two drifting. Every land cell the
    // asset can hold, under neutral light, must come out as the documented colour.
    const cells: number[] = [];
    for (const biome of [Biome.Plains, Biome.Forest, Biome.Highland, Biome.Mountain, Biome.River, Biome.Desert] as const) {
      for (const passable of [true, false]) {
        for (const wooded of [true, false]) {
          for (const extra of [{}, { beach: true }, { ford: true }, { pass: true }]) {
            cells.push(packCell({ owner: 1, tier: 0, passable, biome, wooded, ...extra }));
          }
        }
      }
    }
    const grid = gridOf(cells.length, 1, cells);
    const img = buildTerrainImage(grid, flatRelief(cells.length));
    for (let i = 0; i < cells.length; i++) {
      expect(pixel(img.rgba, cells.length, i, 0).slice(0, 3)).toEqual([...colorForCell(cells[i])]);
    }
  });

  it('deepens the sea away from the shoreline', () => {
    const width = 40;
    const cells = new Array<number>(width).fill(sea);
    cells[0] = plainsA;
    const grid = gridOf(width, 1, cells);
    const img = buildTerrainImage(grid);
    const lum = (col: number) => pixel(img.rgba, width, col, 0).slice(0, 3).reduce((a, b) => a + b, 0);
    expect(lum(1)).toBeGreaterThan(lum(1 + Math.ceil(SHELF_CELLS)));
    expect(lum(Math.ceil(SHELF_CELLS) + 2)).toBeCloseTo(lum(width - 1), -1);
  });

  it('darkens the land at the water line', () => {
    const width = 12;
    const cells = new Array<number>(width).fill(plainsA);
    cells[0] = sea;
    const grid = gridOf(width, 1, cells);
    const relief = computeRelief(grid);
    const img = buildTerrainImage(grid, { ...flatRelief(width), shore: relief.shore });
    const lum = (col: number) => pixel(img.rgba, width, col, 0).slice(0, 3).reduce((a, b) => a + b, 0);
    expect(lum(1)).toBeLessThan(lum(6));
  });

  it('warms a lit slope and cools a shadowed one, beyond what brightness alone would do', () => {
    // Not just lighter and darker: the sun is warm and the shadow is the sky that fills
    // it. Measured as red OVER blue, a ratio a plain brightness multiplier leaves
    // unchanged — so the hillshade alone cannot satisfy this. Rock, because it is
    // near-neutral and the two tints therefore have somewhere to move it. The margin is
    // there because rounding to a byte moves the ratio a little on its own, and by luck
    // it moves it the RIGHT way: without one, this test passes with the tints deleted.
    const rock = packCell({ owner: 1, tier: 1, passable: false, biome: Biome.Mountain });
    const grid = gridOf(3, 1, [rock, rock, rock]);
    const img = buildTerrainImage(grid, flatRelief(3, { shade: Float32Array.from([0.6, 1, 1.4]) }));
    const [dark, flat, lit] = [0, 1, 2].map((c) => pixel(img.rgba, 3, c, 0));
    const sum = (p: number[]) => p[0] + p[1] + p[2];
    const warmth = (p: number[]) => p[0] / p[2];
    expect(sum(dark.slice(0, 3))).toBeLessThan(sum(flat.slice(0, 3)));
    expect(sum(lit.slice(0, 3))).toBeGreaterThan(sum(flat.slice(0, 3)));
    const ROUNDING = 0.03;
    expect(warmth(lit.slice(0, 3))).toBeGreaterThan(warmth(flat.slice(0, 3)) + ROUNDING);
    expect(warmth(dark.slice(0, 3))).toBeLessThan(warmth(flat.slice(0, 3)) - ROUNDING);
    expect(SUN_TINT[0] / SUN_TINT[2]).toBeGreaterThan(SHADOW_TINT[0] / SHADOW_TINT[2]);
  });

  it('puts snow on a summit and not on the foot of the same range', () => {
    const mountain = packCell({ owner: 1, tier: 1, passable: false, biome: Biome.Mountain });
    const grid = gridOf(2, 1, [mountain, mountain]);
    const macro = Float32Array.from([SNOW_START - 0.2, SNOW_START + 0.2]);
    const img = buildTerrainImage(grid, flatRelief(2, { macro }));
    expect(pixel(img.rgba, 2, 0, 0).slice(0, 3)).toEqual([...BIOME_COLORS[Biome.Mountain]]);
    expect(pixel(img.rgba, 2, 1, 0)[0]).toBeGreaterThan(BIOME_COLORS[Biome.Mountain][0]);
  });

  it('inks the border between two different provinces', () => {
    const grid = gridOf(2, 1, [plainsA, plainsB]);
    const img = buildTerrainImage(grid, flatRelief(2));
    const base = BIOME_COLORS[Biome.Plains];
    const inked = pixel(img.rgba, 2, 0, 0);
    for (let k = 0; k < 3; k++) {
      expect(inked[k]).toBeLessThan(base[k]);
      expect(inked[k]).toBeGreaterThanOrEqual(BORDER_INK[k]);
    }
  });

  it('leaves a coastline alone: the colour change already reads', () => {
    // Outlining every province against the sea turned the Mediterranean into noise.
    const grid = gridOf(2, 1, [plainsA, sea]);
    const img = buildTerrainImage(grid, flatRelief(2));
    expect(pixel(img.rgba, 2, 0, 0)).toEqual([...BIOME_COLORS[Biome.Plains], 255]);
  });

  it('does not draw a border inside one province', () => {
    const grid = gridOf(2, 1, [plainsA, plainsA]);
    const img = buildTerrainImage(grid, flatRelief(2));
    expect(pixel(img.rgba, 2, 0, 0)).toEqual([...BIOME_COLORS[Biome.Plains], 255]);
  });

  it('feathers a canopy in from its rim without moving the rim', () => {
    // The wood mask is drawn by hand and several of its polygons are rectangles. The
    // feather softens that edge; what it must never do is leave a wooded cell looking
    // unwooded, which is the cell a lumber camp may stand on.
    const wooded = packCell({ owner: 1, tier: 0, passable: true, biome: Biome.Plains, wooded: true });
    const width = 14;
    const cells = new Array<number>(width).fill(wooded);
    cells[0] = plainsA;
    const grid = gridOf(width, 1, cells);
    const relief = computeRelief(grid);
    const img = buildTerrainImage(grid, { ...flatRelief(width), wood: relief.wood });
    const green = (col: number) => pixel(img.rgba, width, col, 0)[1] - pixel(img.rgba, width, col, 0)[0];
    expect(green(1)).toBeLessThan(green(12));
    expect(green(1)).toBeGreaterThan(green(0));
  });
});
