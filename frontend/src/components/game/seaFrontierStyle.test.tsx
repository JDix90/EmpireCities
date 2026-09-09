import { describe, it, expect } from 'vitest';
import { drawDashedRing, type DashTarget } from './GameMap';
import { isSeaFrontier, MARITIME_FRONTIER_PROFILES } from '../../utils/maritimeFrontierRing';
import {
  SEA_FRONTIER_FILL_ALPHA,
  LAND_FILL_ALPHA,
  SEA_FRONTIER_COLOR,
} from '../../utils/mapVisualStyles';

/**
 * The Space Age sea tiles are open water and ice on a board where every other
 * territory is a real coastline. Giving them an organic outline fixed their
 * silhouette; this is the other half — they should read as water at a glance.
 */

function recorder() {
  const calls: { op: string; args: number[] }[] = [];
  const g: DashTarget = {
    lineStyle: (...args: number[]) => calls.push({ op: 'lineStyle', args }),
    moveTo: (...args: number[]) => calls.push({ op: 'moveTo', args }),
    lineTo: (...args: number[]) => calls.push({ op: 'lineTo', args }),
  };
  return { g, calls };
}

/** Total length of the spans the walker actually drew. */
function drawnLength(calls: { op: string; args: number[] }[]): number {
  let total = 0;
  for (let i = 0; i < calls.length - 1; i++) {
    if (calls[i].op === 'moveTo' && calls[i + 1].op === 'lineTo') {
      total += Math.hypot(
        calls[i + 1].args[0] - calls[i].args[0],
        calls[i + 1].args[1] - calls[i].args[1],
      );
    }
  }
  return total;
}

const SQUARE: [number, number][] = [[0, 0], [100, 0], [100, 100], [0, 100], [0, 0]];

describe('sea frontier identity', () => {
  it('marks exactly the tiles that get a sea outline', () => {
    // Shape and styling answer to one list, so a tile cannot end up drawn as
    // water with a rectangle's silhouette, or the reverse.
    for (const id of Object.keys(MARITIME_FRONTIER_PROFILES)) {
      expect(isSeaFrontier(id), id).toBe(true);
    }
    for (const id of ['mena_arabia', 'asia_coastal', 'moon_mare_imbrium', '']) {
      expect(isSeaFrontier(id), id).toBe(false);
    }
  });

  it('does not answer true for inherited Object keys', () => {
    // `id in obj` would say yes to 'constructor' and 'toString'.
    for (const id of ['constructor', 'toString', 'hasOwnProperty', '__proto__']) {
      expect(isSeaFrontier(id), id).toBe(false);
    }
  });

  it('washes the sea fill out relative to land', () => {
    expect(SEA_FRONTIER_FILL_ALPHA).toBeLessThan(LAND_FILL_ALPHA);
  });
});

describe('drawDashedRing', () => {
  it('beads roughly the on/off duty cycle of the perimeter', () => {
    const { g, calls } = recorder();
    drawDashedRing(g, SQUARE, 0x5ec8f0, 1, 5, 5);
    // 400px perimeter, half on: allow slack for the phase at the closing corner.
    expect(drawnLength(calls)).toBeGreaterThan(160);
    expect(drawnLength(calls)).toBeLessThan(240);
  });

  it('carries the stride across vertices instead of restarting at each one', () => {
    // A many-vertex organic outline has edges far shorter than one dash — about
    // 4.9px here against a 12px dash. Restarting the stride at each vertex would
    // draw every edge in full and produce a solid line, so the duty cycle is
    // what separates the two, not the number of spans emitted. (One dash
    // legitimately spans several edges and emits a moveTo for each.)
    const dense: [number, number][] = [];
    for (let i = 0; i < 64; i++) {
      const t = (i / 64) * Math.PI * 2;
      dense.push([50 + 50 * Math.cos(t), 50 + 50 * Math.sin(t)]);
    }
    const perimeter = dense.reduce((sum, p, i) => {
      const q = dense[(i + 1) % dense.length];
      return sum + Math.hypot(q[0] - p[0], q[1] - p[1]);
    }, 0);
    const { g, calls } = recorder();
    drawDashedRing(g, dense, 0x5ec8f0, 1, 12, 12);
    const duty = drawnLength(calls) / perimeter;
    expect(duty).toBeGreaterThan(0.35);
    expect(duty).toBeLessThan(0.65);
  });

  it('terminates on a degenerate stride rather than hanging the render loop', () => {
    // This runs inside the Pixi draw pass; a non-advancing walk would freeze
    // the map, not just draw wrongly.
    const { g, calls } = recorder();
    drawDashedRing(g, SQUARE, 0x5ec8f0, 1, 0, 0);
    expect(calls.length).toBeGreaterThan(0);
  });

  it('terminates on repeated points', () => {
    const { g } = recorder();
    const degenerate: [number, number][] = [[0, 0], [0, 0], [0, 0]];
    expect(() => drawDashedRing(g, degenerate, 0x5ec8f0, 1)).not.toThrow();
  });

  it('draws in the sea colour it was handed', () => {
    const { g, calls } = recorder();
    const color = parseInt(SEA_FRONTIER_COLOR.slice(1), 16);
    drawDashedRing(g, SQUARE, color, 2);
    expect(calls[0]).toMatchObject({ op: 'lineStyle', args: [2, color, 0.9] });
  });
});
