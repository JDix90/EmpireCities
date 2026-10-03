// ============================================================
// WW2 Manhattan Project, Phase 3 — the atomic arsenal
// ============================================================
//
// docs/WW2_MANHATTAN_PROJECT.md §5. Under `settings.ww2_atomic_arsenal`:
//
//   uses           the Atom Bomb is once per turn, not once per game;
//   price          a player's first detonation costs 15 PP, each later one 5 more
//                  (`atomBombPrice`, shared), so a chain of them is what costs;
//   fallout        the bombed tile carries fallout for 3 rounds: whoever holds it
//                  loses a unit at each round start (never below one), it pays no
//                  income, and nothing can be built on it — the bomb denies
//                  ground, and taking it means paying the fallout;
//   home cost      in a game with stability, every territory of the bomber loses
//                  10 stability;
//   proliferation  once anyone has detonated, Manhattan Project costs half for
//                  every player who has not researched it.
//
// This module holds the rules that read only state: the price, the fallout tick
// and its readers, proliferation. The charge itself is in
// abilities/atomicArsenal.ts, beside the Moon's and the lanes' costs, and the
// detonation in executeTechAbility. Off, nothing here changes a game: no tile
// carries fallout, no price is asked, no tech is discounted.

import { WW2_ATOMIC_ARSENAL, atomBombPrice } from '@borderfall/shared';
import type { GameState, PlayerState, TerritoryState } from '../../types';
import type { TechNode } from '../eras/types';

/** True when this game plays the arsenal. */
export function atomicArsenalEnabled(state: Pick<GameState, 'settings'>): boolean {
  return state.settings?.ww2_atomic_arsenal === true;
}

/** PP this player's next detonation costs. */
export function nextAtomBombPrice(player: Pick<PlayerState, 'atom_bomb_uses'>): number {
  return atomBombPrice(player.atom_bomb_uses ?? 0);
}

/** Has anyone detonated a bomb in this game? */
export function anyAtomBombDetonated(state: Pick<GameState, 'players'>): boolean {
  return state.players.some((p) => (p.atom_bomb_uses ?? 0) > 0);
}

/**
 * Proliferation: once anyone has detonated, the node that unlocks the bomb costs
 * half for a player who has not researched it.
 */
export function proliferationApplies(
  state: Pick<GameState, 'settings' | 'players'>,
  player: Pick<PlayerState, 'unlocked_techs'>,
  node: Pick<TechNode, 'tech_id' | 'unlocks_ability'>,
): boolean {
  return atomicArsenalEnabled(state)
    && node.unlocks_ability === 'atom_bomb'
    && !(player.unlocked_techs ?? []).includes(node.tech_id)
    && anyAtomBombDetonated(state);
}

/** A tech's base price after proliferation: half, rounded up, where it applies. */
export function proliferatedTechCost(
  state: Pick<GameState, 'settings' | 'players'>,
  player: Pick<PlayerState, 'unlocked_techs'>,
  node: Pick<TechNode, 'tech_id' | 'unlocks_ability' | 'cost'>,
): number {
  return proliferationApplies(state, player, node)
    ? Math.ceil(node.cost * WW2_ATOMIC_ARSENAL.proliferationCostShare)
    : node.cost;
}

/** Rounds of fallout left on a tile (0 for a clean one). */
export function falloutRoundsLeft(t: Pick<TerritoryState, 'fallout_rounds'> | undefined): number {
  return Math.max(0, t?.fallout_rounds ?? 0);
}

/** Stamp a freshly bombed tile with its fallout (a second bomb restarts it). */
export function markFallout(t: TerritoryState): void {
  t.fallout_rounds = WW2_ATOMIC_ARSENAL.falloutRounds;
}

export interface FalloutLoss {
  territory_id: string;
  lost: number;
}

/**
 * Round start, beside the storms: every held tile with fallout loses
 * `falloutAttrition` units (never below one), and every fallout tile's count
 * runs down a round; at zero the stamp is gone. Neutral tiles count down but
 * lose nothing — the bomb left them at one. Returns what was lost so callers can
 * narrate it.
 */
export function applyFalloutAttrition(state: GameState): FalloutLoss[] {
  const losses: FalloutLoss[] = [];
  for (const [tid, t] of Object.entries(state.territories)) {
    if (falloutRoundsLeft(t) <= 0) continue;
    if (t.owner_id && t.unit_count > 1) {
      const lost = Math.min(WW2_ATOMIC_ARSENAL.falloutAttrition, t.unit_count - 1);
      t.unit_count -= lost;
      losses.push({ territory_id: tid, lost });
    }
    const left = falloutRoundsLeft(t) - 1;
    if (left > 0) t.fallout_rounds = left;
    else delete t.fallout_rounds;
  }
  return losses;
}
