import { describe, it, expect } from 'vitest';
import { Biome, TerrainGrid, packCell } from '@borderfall/warfront-sim';
import {
  BEACH_LIFT,
  BIOME_COLORS,
  BORDER_DARKEN,
  FORD_COLOR,
  PASS_COLOR,
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

  it('lifts a beach off its base biome rather than replacing it', () => {
    const beach = packCell({ owner: 1, tier: 0, passable: true, biome: Biome.Plains, beach: true });
    const base = BIOME_COLORS[Biome.Plains];
    expect(colorForCell(beach)).toEqual([base[0] + BEACH_LIFT, base[1] + BEACH_LIFT, base[2] + BEACH_LIFT]);
  });

  it('falls through to the biome colour', () => {
    expect(colorForCell(sea)).toEqual(BIOME_COLORS[Biome.Sea]);
    expect(colorForCell(plainsA)).toEqual(BIOME_COLORS[Biome.Plains]);
  });
});

describe('buildTerrainImage', () => {
  it('produces one opaque pixel per cell, row 0 north', () => {
    const grid = gridOf(2, 2, [sea, plainsA, plainsA, sea]);
    const img = buildTerrainImage(grid);
    expect(img.width).toBe(2);
    expect(img.height).toBe(2);
    expect(img.rgba.length).toBe(2 * 2 * 4);
    expect(pixel(img.rgba, 2, 0, 0)).toEqual([...BIOME_COLORS[Biome.Sea], 255]);
    expect(pixel(img.rgba, 2, 1, 0)).toEqual([...BIOME_COLORS[Biome.Plains], 255]);
  });

  it('darkens the border between two different provinces', () => {
    const grid = gridOf(2, 1, [plainsA, plainsB]);
    const img = buildTerrainImage(grid);
    const base = BIOME_COLORS[Biome.Plains];
    const expected = Math.round(base[0] * BORDER_DARKEN);
    expect(pixel(img.rgba, 2, 0, 0)[0]).toBe(expected);
  });

  it('leaves a coastline alone: the colour change already reads', () => {
    // Outlining every province against the sea turned the Mediterranean into noise.
    const grid = gridOf(2, 1, [plainsA, sea]);
    const img = buildTerrainImage(grid);
    expect(pixel(img.rgba, 2, 0, 0)).toEqual([...BIOME_COLORS[Biome.Plains], 255]);
  });

  it('does not draw a border inside one province', () => {
    const grid = gridOf(2, 1, [plainsA, plainsA]);
    const img = buildTerrainImage(grid);
    expect(pixel(img.rgba, 2, 0, 0)).toEqual([...BIOME_COLORS[Biome.Plains], 255]);
  });
});
