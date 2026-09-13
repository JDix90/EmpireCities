import { describe, it, expect } from 'vitest';
import {
  ControlGroups,
  applySelection,
  formationTargets,
  normalizeRect,
  pruneSelection,
  unitAtPoint,
  unitsInRect,
} from './selection';
import type { UnitView } from './simRunner';

const at = (id: number, owner: number, x: number, y: number): UnitView => ({
  id,
  owner,
  kind: 1,
  hp: 40,
  maxHp: 40,
  x,
  y,
  moving: false,
});

const units: UnitView[] = [at(1, 1, 10, 10), at(2, 1, 12, 11), at(3, 2, 40, 40)];

describe('rects', () => {
  it('normalises a drag in any direction', () => {
    expect(normalizeRect(20, 30, 5, 10)).toEqual({ x0: 5, y0: 10, x1: 20, y1: 30 });
  });

  it('selects the units inside, in ascending id order', () => {
    expect(unitsInRect(units, normalizeRect(0, 0, 20, 20))).toEqual([1, 2]);
    expect(unitsInRect(units, normalizeRect(0, 0, 5, 5))).toEqual([]);
  });

  it('can filter to one owner', () => {
    expect(unitsInRect(units, normalizeRect(0, 0, 100, 100), 2)).toEqual([3]);
  });
});

describe('point picking', () => {
  it('picks the nearest unit within the radius, not merely the first', () => {
    expect(unitAtPoint(units, 11.6, 11, 3)).toBe(2);
    expect(unitAtPoint(units, 10.1, 10, 3)).toBe(1);
  });

  it('returns null when nothing is close enough', () => {
    expect(unitAtPoint(units, 25, 25, 3)).toBeNull();
  });
});

describe('applySelection', () => {
  it('replaces without shift and unions with it', () => {
    expect([...applySelection(new Set([1]), [2], false)]).toEqual([2]);
    expect([...applySelection(new Set([1]), [2], true)].sort()).toEqual([1, 2]);
  });

  it('clicking bare ground clears the selection', () => {
    expect(applySelection(new Set([1, 2]), [], false).size).toBe(0);
  });

  it('but shift-clicking bare ground keeps it', () => {
    expect(applySelection(new Set([1, 2]), [], true).size).toBe(2);
  });
});

describe('pruneSelection', () => {
  it('drops ids whose units are gone', () => {
    expect([...pruneSelection(new Set([1, 3, 99]), units)].sort()).toEqual([1, 3]);
  });
});

describe('ControlGroups', () => {
  it('assigns and recalls', () => {
    const g = new ControlGroups();
    g.assign(0, [2, 1]);
    expect(g.recall(0, units)).toEqual([1, 2]);
    expect(g.recall(4, units)).toEqual([]);
  });

  it('recalls only units that are still alive, never ghosts', () => {
    const g = new ControlGroups();
    g.assign(1, [1, 99]);
    expect(g.recall(1, units)).toEqual([1]);
  });

  it('reports occupied slots for the HUD', () => {
    const g = new ControlGroups();
    g.assign(0, [1]);
    g.assign(3, [99]); // all dead
    expect(g.occupied(units)).toEqual([0]);
  });
});

describe('formationTargets', () => {
  it('puts the first unit exactly where the player clicked', () => {
    const t = formationTargets(5, 100, 200, 2);
    expect(t[0]).toEqual({ x: 100, y: 200 });
    expect(t).toHaveLength(5);
  });

  it('spreads the rest so a group order does not stack on one cell', () => {
    const t = formationTargets(7, 0, 0, 2);
    const distinct = new Set(t.map((p) => `${p.x.toFixed(4)},${p.y.toFixed(4)}`));
    expect(distinct.size).toBe(7);
    for (const p of t) expect(Math.hypot(p.x, p.y)).toBeLessThanOrEqual(2 * 2 + 1e-9);
  });

  it('is deterministic and handles degenerate counts', () => {
    expect(formationTargets(4, 3, 4, 1)).toEqual(formationTargets(4, 3, 4, 1));
    expect(formationTargets(0, 0, 0, 1)).toEqual([]);
  });
});
