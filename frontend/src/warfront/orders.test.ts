import { describe, it, expect } from 'vitest';
import { Biome, FP_ONE, TerrainGrid, packCell, validateCommand } from '@borderfall/warfront-sim';
import { moveTarget, toFixedWorld } from './orders';

const land = packCell({ owner: 1, tier: 0, passable: true, biome: Biome.Plains });

function grid(width: number, height: number): TerrainGrid {
  return new TerrainGrid(width, height, new Uint16Array(width * height).fill(land));
}

describe('toFixedWorld', () => {
  it('always returns a whole integer, which is what the simulation demands', () => {
    for (const v of [0, 1.5, 12.3456, 99.9999, 7 / 3]) {
      expect(Number.isInteger(toFixedWorld(v, 1000))).toBe(true);
    }
    expect(toFixedWorld(2, 1000)).toBe(2 * FP_ONE);
  });

  it('clamps to the world rather than trusting the pointer', () => {
    expect(toFixedWorld(-50, 100)).toBe(0);
    expect(toFixedWorld(1e9, 100)).toBe(100 * FP_ONE);
  });

  it('refuses to propagate NaN or Infinity into a command', () => {
    expect(toFixedWorld(Number.NaN, 100)).toBe(0);
    expect(toFixedWorld(Number.POSITIVE_INFINITY, 100)).toBe(100 * FP_ONE);
    expect(toFixedWorld(Number.NEGATIVE_INFINITY, 100)).toBe(0);
  });
});

describe('moveTarget', () => {
  it('produces a command the simulation accepts', () => {
    const g = grid(64, 32);
    const t = moveTarget(g, 12.7, 4.2);
    // validateCommand is the simulation's own boundary check: it rejects floats and
    // out-of-range values, so passing it is the real proof.
    expect(() => validateCommand({ type: 'move', unit: 1, x: t.x, y: t.y })).not.toThrow();
  });

  it('keeps a click on the far edge inside the world', () => {
    const g = grid(64, 32);
    const t = moveTarget(g, 999, 999);
    expect(t.x).toBeLessThan(64 * FP_ONE);
    expect(t.y).toBeLessThan(32 * FP_ONE);
    expect(() => validateCommand({ type: 'move', unit: 1, x: t.x, y: t.y })).not.toThrow();
  });

  it('survives a click off the top-left corner', () => {
    const g = grid(64, 32);
    const t = moveTarget(g, -12, -3);
    expect(t).toEqual({ x: 0, y: 0 });
  });
});
