/**
 * WW2 Manhattan Project, Phase 3: the atomic arsenal's charge
 * (docs/WW2_MANHATTAN_PROJECT.md §5; the rules are in state/atomicArsenal.ts).
 *
 * The same discipline as the Moon's He-3 and the lanes' PP: the purse is
 * checked before anything mutates, and the price is charged only once the
 * detonation has succeeded, so a bomb refused for a bad target costs nothing.
 *
 * A charge carried out of WW2 by an era advance is the bomb its player already
 * built: it fires without the PP price, with the fallout and the home cost.
 */

import type { GameState, PlayerState } from '../../types';
import { WW2_ATOMIC_ARSENAL } from '@borderfall/shared';
import { atomicArsenalEnabled, nextAtomBombPrice } from '../state/atomicArsenal';
import { applyStabilityChange } from '../state/stabilityManager';
import { playerHasUnlockedAbility } from './techAbilities';

const ATOM_BOMB = 'atom_bomb';

/** Is this use the charge carried from WW2 rather than the tech itself? */
export function atomBombIsCarriedCharge(state: GameState, player: PlayerState): boolean {
  return (player.legacy_ability_charges?.[ATOM_BOMB] ?? 0) > 0
    && !playerHasUnlockedAbility(state, player.player_id, ATOM_BOMB);
}

/** PP this player's next detonation would cost them now: none for a carried charge. */
export function atomBombPriceFor(state: GameState, player: PlayerState): number {
  return atomBombIsCarriedCharge(state, player) ? 0 : nextAtomBombPrice(player);
}

/** The refusal before a detonation, or null. Only the bomb, only under the arsenal. */
export function checkAtomicArsenalRequirement(state: GameState, playerId: string, abilityId: string): string | null {
  if (abilityId !== ATOM_BOMB || !atomicArsenalEnabled(state)) return null;
  const player = state.players.find((p) => p.player_id === playerId);
  if (!player) return 'Player not found';
  const price = atomBombPriceFor(state, player);
  const purse = player.special_resource ?? 0;
  return purse >= price ? null : `The Atom Bomb costs ${price} PP (you have ${purse})`;
}

/**
 * After a successful detonation: charge the price, count the detonation (the
 * next one costs more, and proliferation starts), and take the stability.
 * Returns the PP charged.
 */
export function spendAtomicArsenalCost(state: GameState, playerId: string, abilityId: string): number {
  if (abilityId !== ATOM_BOMB || !atomicArsenalEnabled(state)) return 0;
  const player = state.players.find((p) => p.player_id === playerId);
  if (!player) return 0;
  const price = atomBombPriceFor(state, player);
  player.special_resource = (player.special_resource ?? 0) - price;
  player.atom_bomb_uses = (player.atom_bomb_uses ?? 0) + 1;
  if (state.settings.stability_enabled) {
    applyStabilityChange(state, playerId, -WW2_ATOMIC_ARSENAL.homeStabilityLoss);
  }
  return price;
}
