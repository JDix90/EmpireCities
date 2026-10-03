// ============================================================
// Garrison doctrines — d8 dice for a tile's defence or its attacks
// ============================================================
//
// Galactic Age buildings, Phase 3 (docs/GALACTIC_AGE_BUILDINGS.md §5). A
// doctrine belongs to a tile's GARRISON, not to its units, so nothing has to
// track which units are elite through fortifies, splits and losses:
//
//   Hardened — the stack defending this tile rolls d8s;
//   Forward  — attacks launched from this tile roll d8s.
//
// Defence and attack are separate and exclusive (decided in review): one
// doctrine per tile, and buying the other replaces it with no refund. Dice
// COUNTS never change — a Forward crossing of a hyperspace lane still rolls the
// lane's two dice — so the era's first design principle ("never add dice on a
// lane") holds. A d8 wins its matchup against a d6 about 56% of the time,
// where a d6 wins 42%.
//
// Bought in the draft or fortify phase for PP (the fuel; tech stays research),
// on a tile that has any building, once the player has researched Lattice
// Logistics — which gives the tree's economic root an early payoff. Captured
// tiles lose it (the garrison that held it is gone); moving units out does not
// carry it anywhere. Read by the combat modifiers, so humans, bots, blitzes and
// drop assaults all roll the same dice.
//
// Gated by `settings.galaxy_garrisons`, baked at create from the
// `galaxy_garrisons_enabled` flag, so a flip never re-rules a match in
// progress. Off, no tile carries a doctrine and nothing here changes a roll.

import {
  GARRISON_DOCTRINE_COST,
  GARRISON_DOCTRINE_DIE_FACES,
  GARRISON_DOCTRINE_DISPLAY,
  GARRISON_DOCTRINE_TECH_ID,
  isGarrisonDoctrine,
  type GarrisonDoctrine,
} from '@borderfall/shared';
import type { GameState, TerritoryState } from '../../types';

/**
 * Price knob. Mutable so the balance sim can measure a candidate
 * (`SIM_DOCTRINE_COST`) without editing this file, the way SCHISM_TUNING is.
 */
export const GARRISON_DOCTRINE_TUNING = { cost: GARRISON_DOCTRINE_COST };

/** True when this game plays garrison doctrines. */
export function garrisonsEnabled(state: Pick<GameState, 'settings'>): boolean {
  return state.settings?.galaxy_garrisons === true;
}

/** Faces the attacker rolls on an attack launched from `fromId`. */
export function attackerDieFaces(state: GameState, fromId: string): number {
  if (!garrisonsEnabled(state)) return 6;
  return state.territories[fromId]?.garrison_doctrine === 'forward' ? GARRISON_DOCTRINE_DIE_FACES : 6;
}

/**
 * Faces the defender rolls holding `toId`. A held tile only: a stack that went
 * neutral (rebels, a resignation) is not the garrison that bought the doctrine.
 */
export function defenderDieFaces(state: GameState, toId: string): number {
  if (!garrisonsEnabled(state)) return 6;
  const t = state.territories[toId];
  if (!t?.owner_id) return 6;
  return t.garrison_doctrine === 'hardened' ? GARRISON_DOCTRINE_DIE_FACES : 6;
}

/** The capture rule: the garrison that held the doctrine is gone. */
export function clearGarrisonDoctrine(territory: TerritoryState): void {
  if (territory.garrison_doctrine !== undefined) delete territory.garrison_doctrine;
}

export interface DoctrineValidation {
  valid: boolean;
  error?: string;
  cost?: number;
}

/**
 * May `playerId` give `territoryId`'s garrison `doctrine` now? The single gate
 * for the socket handler, the AI and the sim. Phase and turn are the caller's
 * to check as they are for a build; everything else is here.
 */
export function validateGarrisonDoctrine(
  state: GameState,
  playerId: string,
  territoryId: string,
  doctrine: unknown,
): DoctrineValidation {
  if (!garrisonsEnabled(state)) return { valid: false, error: 'Garrison doctrines are not enabled for this game' };
  if (!state.settings.economy_enabled) return { valid: false, error: 'Economy feature is not enabled for this game' };
  if (!isGarrisonDoctrine(doctrine)) return { valid: false, error: 'Unknown garrison doctrine' };
  const territory = state.territories[territoryId];
  if (!territory || territory.owner_id !== playerId) {
    return { valid: false, error: 'You can only train a garrison you hold' };
  }
  const player = state.players.find((p) => p.player_id === playerId);
  if (!player) return { valid: false, error: 'Player not found' };
  const name = GARRISON_DOCTRINE_DISPLAY[doctrine].name;
  if (territory.garrison_doctrine === doctrine) {
    return { valid: false, error: `This system already holds a ${name}` };
  }
  if ((territory.buildings ?? []).length === 0) {
    return { valid: false, error: 'A garrison doctrine needs a building on the system' };
  }
  if (state.settings.tech_trees_enabled && !(player.unlocked_techs ?? []).includes(GARRISON_DOCTRINE_TECH_ID)) {
    return { valid: false, error: 'Research Lattice Logistics to train garrisons' };
  }
  const cost = GARRISON_DOCTRINE_TUNING.cost;
  if ((player.special_resource ?? 0) < cost) {
    return { valid: false, error: `A ${name} costs ${cost} PP` };
  }
  return { valid: true, cost };
}

/**
 * Apply a validated doctrine: spend the PP and set (or replace) it. Replacing
 * refunds nothing — the choice between the two is the point.
 */
export function applyGarrisonDoctrine(
  state: GameState,
  playerId: string,
  territoryId: string,
  doctrine: GarrisonDoctrine,
): void {
  const territory = state.territories[territoryId];
  const player = state.players.find((p) => p.player_id === playerId);
  if (!territory || !player) return;
  player.special_resource = (player.special_resource ?? 0) - GARRISON_DOCTRINE_TUNING.cost;
  territory.garrison_doctrine = doctrine;
}

/** Doctrines a player's garrisons hold, by kind (for the Bonuses modal and the sim). */
export function countPlayerDoctrines(state: GameState, playerId: string): Record<GarrisonDoctrine, number> {
  const out: Record<GarrisonDoctrine, number> = { hardened: 0, forward: 0 };
  if (!garrisonsEnabled(state)) return out;
  for (const t of Object.values(state.territories)) {
    if (t.owner_id === playerId && t.garrison_doctrine) out[t.garrison_doctrine] += 1;
  }
  return out;
}
