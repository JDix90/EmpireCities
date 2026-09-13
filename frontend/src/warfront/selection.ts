/**
 * Selection and control groups — the input half of the tactical view.
 *
 * Pure functions over plain unit views so the rules are testable without PixiJS or a
 * running simulation. Nothing here mutates the sim; issuing orders is the page's job.
 */

import type { UnitView } from './simRunner';

/** A world-space rectangle in cells, normalised so width and height are non-negative. */
export interface WorldRect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export function normalizeRect(ax: number, ay: number, bx: number, by: number): WorldRect {
  return { x0: Math.min(ax, bx), y0: Math.min(ay, by), x1: Math.max(ax, bx), y1: Math.max(ay, by) };
}

/** A drag shorter than this (in screen pixels) is a click, not a box. */
export const DRAG_THRESHOLD_PX = 4;

/** Ids of every unit whose centre falls inside the rectangle, in ascending id order. */
export function unitsInRect(units: readonly UnitView[], rect: WorldRect, owner?: number): number[] {
  const hits: number[] = [];
  for (const u of units) {
    if (owner !== undefined && u.owner !== owner) continue;
    if (u.x >= rect.x0 && u.x <= rect.x1 && u.y >= rect.y0 && u.y <= rect.y1) hits.push(u.id);
  }
  return hits.sort((a, b) => a - b);
}

/**
 * The unit nearest a world point within `radiusCells`, or null. Nearest rather than
 * first-match so that clicking a cluster picks the one actually under the cursor.
 */
export function unitAtPoint(
  units: readonly UnitView[],
  wx: number,
  wy: number,
  radiusCells: number,
  owner?: number,
): number | null {
  let best: number | null = null;
  let bestDist = radiusCells * radiusCells;
  for (const u of units) {
    if (owner !== undefined && u.owner !== owner) continue;
    const dx = u.x - wx;
    const dy = u.y - wy;
    const d = dx * dx + dy * dy;
    if (d <= bestDist) {
      bestDist = d;
      best = u.id;
    }
  }
  return best;
}

/**
 * Applies a new set of hits to the current selection. `additive` (shift) unions rather
 * than replaces; an empty non-additive hit list clears, which is what clicking bare
 * ground should do.
 */
export function applySelection(current: ReadonlySet<number>, hits: readonly number[], additive: boolean): Set<number> {
  if (!additive) return new Set(hits);
  const next = new Set(current);
  for (const id of hits) next.add(id);
  return next;
}

/** Drops ids that no longer exist, so a stale selection cannot outlive its units. */
export function pruneSelection(current: ReadonlySet<number>, units: readonly UnitView[]): Set<number> {
  const alive = new Set(units.map((u) => u.id));
  const next = new Set<number>();
  for (const id of current) if (alive.has(id)) next.add(id);
  return next;
}

export const CONTROL_GROUP_KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9'] as const;

/**
 * Nine control groups, assigned with ctrl/cmd + digit and recalled with the digit.
 * A group is a plain id list; membership is re-checked against live units on recall so a
 * group whose units are gone recalls nothing rather than selecting ghosts.
 */
export class ControlGroups {
  private readonly groups = new Map<number, number[]>();

  assign(slot: number, ids: Iterable<number>): void {
    this.groups.set(slot, [...ids].sort((a, b) => a - b));
  }

  recall(slot: number, units: readonly UnitView[]): number[] {
    const ids = this.groups.get(slot);
    if (!ids) return [];
    const alive = new Set(units.map((u) => u.id));
    return ids.filter((id) => alive.has(id));
  }

  /** Slots that currently hold at least one live unit, for a HUD readout. */
  occupied(units: readonly UnitView[]): number[] {
    const out: number[] = [];
    for (const slot of this.groups.keys()) if (this.recall(slot, units).length > 0) out.push(slot);
    return out.sort((a, b) => a - b);
  }
}

/**
 * Spread targets for a group order, so ordering six units to one point does not stack
 * six dots on one cell and look like they vanished.
 *
 * This is an INPUT-layer concern, not a simulation rule: the sim has no collision and
 * would happily let them overlap. Real formation behaviour is a later step; this is the
 * minimum that keeps a group order legible. Deterministic — a ring spiral, ordered so
 * unit 0 lands on the exact point the player clicked.
 */
export function formationTargets(
  count: number,
  centerX: number,
  centerY: number,
  spacingCells: number,
): Array<{ x: number; y: number }> {
  const out: Array<{ x: number; y: number }> = [];
  if (count <= 0) return out;
  out.push({ x: centerX, y: centerY });
  let ring = 1;
  while (out.length < count) {
    const perRing = ring * 6;
    for (let i = 0; i < perRing && out.length < count; i++) {
      const angle = (Math.PI * 2 * i) / perRing;
      out.push({
        x: centerX + Math.cos(angle) * ring * spacingCells,
        y: centerY + Math.sin(angle) * ring * spacingCells,
      });
    }
    ring += 1;
  }
  return out;
}
