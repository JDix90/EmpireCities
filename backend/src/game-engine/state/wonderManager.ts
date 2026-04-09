// ============================================================
// Wonder Manager — era wonder uniqueness, ownership, passive bonuses
// ============================================================

import type { GameState, GameMap, BuildingType } from '../../types';
import { getEraWonder } from '../eras';

/** All wonder building ID prefixes, for quick type narrowing. */
export function isWonderId(b: string): b is BuildingType {
  return b.startsWith('wonder_');
}

/** Returns true if the era wonder has already been built by any player in this game. */
export function isWonderBuilt(state: GameState): boolean {
  const wonder = getEraWonder(state.era);
  if (!wonder) return false;
  return Object.values(state.territories).some((t) =>
    t.buildings?.includes(wonder.wonder_id),
  );
}

/** Returns the player_id of the wonder owner, or null if not built. */
export function getWonderOwner(state: GameState): string | null {
  const wonder = getEraWonder(state.era);
  if (!wonder) return null;
  for (const [, t] of Object.entries(state.territories)) {
    if (t.buildings?.includes(wonder.wonder_id) && t.owner_id) {
      return t.owner_id;
    }
  }
  return null;
}

/** Returns the territory_id that contains the wonder, or null. */
export function getWonderTerritory(state: GameState): string | null {
  const wonder = getEraWonder(state.era);
  if (!wonder) return null;
  for (const [tid, t] of Object.entries(state.territories)) {
    if (t.buildings?.includes(wonder.wonder_id)) return tid;
  }
  return null;
}

/**
 * Apply wonder passive bonuses that manifest during a player's turn.
 * Called once per player turn during `collectProduction` and draft calculation.
 *
 * Returns extra reinforce units to add (0 if none or wrong player).
 */
export function getWonderReinforceBonus(state: GameState, playerId: string): number {
  const wonder = getEraWonder(state.era);
  if (!wonder) return 0;
  const owner = getWonderOwner(state);
  if (owner !== playerId) return 0;

  switch (wonder.passive_effect_type) {
    case 'reinforce_bonus':
      return wonder.passive_effect_value;
    case 'flat_reinforce':
      return wonder.passive_effect_value;
    default:
      return 0;
  }
}

/**
 * Returns extra tech points per owned territory from the wonder (Sputnik).
 * Called in collectProduction.
 */
export function getWonderTechPerTerritory(state: GameState, playerId: string): number {
  const wonder = getEraWonder(state.era);
  if (!wonder || wonder.passive_effect_type !== 'tech_point_per_territory') return 0;
  if (getWonderOwner(state) !== playerId) return 0;
  return wonder.passive_effect_value;
}

/**
 * Returns the extra defense die bonus from the wonder (Colosseum) for a territory.
 * Only applies if playerId owns the wonder.
 */
export function getWonderDefenseBonus(state: GameState, playerId: string): number {
  const wonder = getEraWonder(state.era);
  if (!wonder || wonder.passive_effect_type !== 'defense_die_global') return 0;
  if (getWonderOwner(state) !== playerId) return 0;
  return wonder.passive_effect_value;
}

/**
 * Returns the sea-attack dice override from the lighthouse wonder.
 * Returns 0 if not applicable.
 */
export function getWonderSeaAttackDice(state: GameState, playerId: string): number {
  const wonder = getEraWonder(state.era);
  if (!wonder || wonder.passive_effect_type !== 'sea_attack_dice') return 0;
  if (getWonderOwner(state) !== playerId) return 0;
  return wonder.passive_effect_value;
}

/**
 * Returns the tech cost multiplier from CERN (0.5 = half cost), or 1 if not applicable.
 */
export function getWonderTechCostMultiplier(state: GameState, playerId: string): number {
  const wonder = getEraWonder(state.era);
  if (!wonder || wonder.passive_effect_type !== 'tech_cost_half') return 1;
  if (getWonderOwner(state) !== playerId) return 1;
  return 0.5;
}

/**
 * Returns extra influence range from the Unification Monument (Risorgimento), or 0.
 */
export function getWonderInfluenceRange(state: GameState, playerId: string): number {
  const wonder = getEraWonder(state.era);
  if (!wonder || wonder.passive_effect_type !== 'influence_range') return 0;
  if (getWonderOwner(state) !== playerId) return 0;
  return wonder.passive_effect_value;
}

/**
 * Apply wonder income during collectProduction.
 * Mutates player.tech_points with Sputnik bonus.
 */
export function applyWonderProductionIncome(
  state: GameState,
  playerId: string,
): { extraTechPoints: number } {
  const player = state.players.find((p) => p.player_id === playerId);
  if (!player) return { extraTechPoints: 0 };

  const techPerTerr = getWonderTechPerTerritory(state, playerId);
  if (techPerTerr > 0 && state.settings.tech_trees_enabled) {
    const ownedCount = Object.values(state.territories).filter(
      (t) => t.owner_id === playerId,
    ).length;
    const bonus = techPerTerr * ownedCount;
    player.tech_points = (player.tech_points ?? 0) + bonus;
    return { extraTechPoints: bonus };
  }
  return { extraTechPoints: 0 };
}

/**
 * Wonder map for frontend lookup. Returns { wonder_id, name, owner_player_id | null, territory_id | null }
 * or null if this era has no wonder.
 */
export function getWonderStatus(
  state: GameState,
): { wonder_id: BuildingType; name: string; owner_player_id: string | null; territory_id: string | null } | null {
  const wonder = getEraWonder(state.era);
  if (!wonder) return null;
  return {
    wonder_id: wonder.wonder_id,
    name: wonder.name,
    owner_player_id: getWonderOwner(state),
    territory_id: getWonderTerritory(state),
  };
}
