// ============================================================
// Per-world economic identity modifiers (galaxy maps)
// ============================================================
//
// Each galaxy world can carry `modifiers` (production / tech / stability /
// build-cost). They are snapshotted from the map into `state.settings.world_modifiers`
// at init so the per-turn calc sites (which only have `state`) can apply them via
// the territory's `world_id` without threading the map around. All modifiers are
// additive/optional and gated by `settings.world_modifiers_enabled` (default on),
// so maps without modifiers — and standard maps — are completely unaffected.

import type { WorldModifiers } from '@borderfall/shared';
import type { GameState } from '../../types';

const EMPTY: WorldModifiers = {};

interface WorldsLike {
  worlds?: Array<{ world_id: string; modifiers?: WorldModifiers }>;
}

/**
 * Build the `world_id -> modifiers` snapshot from a map's worlds[], or undefined
 * when disabled or no world defines any modifier.
 */
export function buildWorldModifierSnapshot(
  map: WorldsLike,
  enabled: boolean,
): Record<string, WorldModifiers> | undefined {
  if (!enabled || !map.worlds) return undefined;
  const snap: Record<string, WorldModifiers> = {};
  for (const w of map.worlds) {
    if (w.modifiers && Object.keys(w.modifiers).length > 0) snap[w.world_id] = w.modifiers;
  }
  return Object.keys(snap).length > 0 ? snap : undefined;
}

/** Active modifiers for a world (empty object when none / feature off). */
export function getWorldModifier(state: GameState, worldId: string | undefined | null): WorldModifiers {
  if (!worldId) return EMPTY;
  return state.settings.world_modifiers?.[worldId] ?? EMPTY;
}

/** Building cost for a territory on `worldId` after its build_cost_mult (min 0, ceil). */
export function applyWorldBuildCost(state: GameState, worldId: string | undefined | null, baseCost: number): number {
  const mult = getWorldModifier(state, worldId).build_cost_mult;
  if (mult == null || mult === 1) return baseCost;
  return Math.max(0, Math.ceil(baseCost * mult));
}
