// ============================================================
// Wonder Manager — era wonder uniqueness, ownership, passive bonuses
// ============================================================

import type { BuildingType, GameState, PlayerState } from '../../types';
import type { EraWonder } from '../eras/types';
import { getEraWonder, getWonderById } from '../eras';
import { resolvePlayerEraId } from '../eraAdvancement/constants';

/**
 * A game used to hold exactly one wonder, so every lookup here resolved it as
 * `getEraWonder(state.era)` — the era the MAP was created in. Under era
 * advancement that is not the era its players are in: `state.era` never moves
 * when a player advances. The result was that a player who advanced, built
 * their era's wonder, and paid 20 production for it owned a building this file
 * could not see. None of its bonuses ever paid out, and because the uniqueness
 * gate also only looked for the base era's wonder, a second player could raise
 * a second wonder in the same game.
 *
 * Wonders are now resolved from what is actually STANDING ON THE BOARD, so a
 * wonder works for whoever holds its territory no matter which era minted it.
 * That also keeps capture honest: `onTerritoryCapture` preserves wonders while
 * razing everything else, so a wonder changes hands with its city and the
 * bonus follows the new owner.
 *
 * UNIQUENESS is a separate question from resolution, and it is the one real
 * balance decision here — see `wonderUniquenessScope`.
 */

export interface StandingWonder {
  wonderId: BuildingType;
  territoryId: string;
  ownerId: string | null;
  def: EraWonder;
}

/** All wonder building ID prefixes, for quick type narrowing. */
export function isWonderId(b: string): b is BuildingType {
  return b.startsWith('wonder_');
}

/**
 * How many wonders a game may hold.
 *
 * - `game`: one wonder, full stop — the rule the game shipped with. Whoever
 *   builds first ends it for everyone.
 * - `era`: one of EACH era's wonder. Advancing opens a new wonder to compete
 *   for, which is the point of advancing; the older ones keep working.
 *
 * With era advancement OFF the two are identical, because only one era's wonder
 * is ever reachable. The setting is baked at create, so a flag flip never
 * changes the rules of a game already running.
 */
export function wonderUniquenessScope(state: GameState): 'game' | 'era' {
  return state.settings.era_wonder_per_era_enabled === true ? 'era' : 'game';
}

/** Every wonder standing on the board right now, with whoever holds its city. */
export function getStandingWonders(state: GameState): StandingWonder[] {
  const out: StandingWonder[] = [];
  for (const [territoryId, t] of Object.entries(state.territories)) {
    for (const b of t.buildings ?? []) {
      if (!isWonderId(b)) continue;
      const def = getWonderById(b);
      if (!def) continue; // a wonder id no era defines: ignore rather than crash
      out.push({ wonderId: b, territoryId, ownerId: t.owner_id ?? null, def });
    }
  }
  return out;
}

/** The wonders this player currently holds. */
export function getPlayerWonders(state: GameState, playerId: string): StandingWonder[] {
  return getStandingWonders(state).filter((w) => w.ownerId === playerId);
}

/** The wonder a player may build right now: the one their CURRENT era defines. */
export function getWonderForPlayer(state: GameState, player: PlayerState): EraWonder | undefined {
  return getEraWonder(resolvePlayerEraId(state, player));
}

/**
 * Is a wonder already standing that blocks `wonderId` from being built?
 *
 * Under the `game` scope any wonder blocks any other. Under `era` scope only
 * the same wonder blocks it, so each era's wonder is its own contested prize.
 * Called with no id (legacy callers) it answers "is any wonder built".
 */
export function isWonderBuilt(state: GameState, wonderId?: BuildingType): boolean {
  const standing = getStandingWonders(state);
  if (!wonderId || wonderUniquenessScope(state) === 'game') return standing.length > 0;
  return standing.some((w) => w.wonderId === wonderId);
}

/** The player_id holding `wonderId`, or null. With no id, the holder of any wonder. */
export function getWonderOwner(state: GameState, wonderId?: BuildingType): string | null {
  const standing = getStandingWonders(state);
  const hit = wonderId ? standing.find((w) => w.wonderId === wonderId) : standing[0];
  return hit?.ownerId ?? null;
}

/** The territory holding `wonderId`, or null. With no id, any wonder's territory. */
export function getWonderTerritory(state: GameState, wonderId?: BuildingType): string | null {
  const standing = getStandingWonders(state);
  const hit = wonderId ? standing.find((w) => w.wonderId === wonderId) : standing[0];
  return hit?.territoryId ?? null;
}

/**
 * Sum one passive across every wonder this player holds. A player can hold more
 * than one only under the `era` scope; under `game` scope this is the old
 * single-wonder answer.
 */
function sumPassive(
  state: GameState,
  playerId: string,
  effect: EraWonder['passive_effect_type'],
): number {
  return getPlayerWonders(state, playerId)
    .filter((w) => w.def.passive_effect_type === effect)
    .reduce((total, w) => total + w.def.passive_effect_value, 0);
}

/**
 * Extra reinforce units from wonders the player holds.
 * Called once per player turn during draft calculation.
 */
export function getWonderReinforceBonus(state: GameState, playerId: string): number {
  return sumPassive(state, playerId, 'reinforce_bonus') + sumPassive(state, playerId, 'flat_reinforce');
}

/** Extra tech points per owned territory (Sputnik). Called in collectProduction. */
export function getWonderTechPerTerritory(state: GameState, playerId: string): number {
  return sumPassive(state, playerId, 'tech_point_per_territory');
}

/** Extra defense die on every territory this player defends (Colosseum). */
export function getWonderDefenseBonus(state: GameState, playerId: string): number {
  return sumPassive(state, playerId, 'defense_die_global');
}

/**
 * Sea-attack dice override (Lighthouse). This REPLACES the die count rather than
 * adding to it, so two of them would not mean six dice — take the highest.
 */
export function getWonderSeaAttackDice(state: GameState, playerId: string): number {
  return getPlayerWonders(state, playerId)
    .filter((w) => w.def.passive_effect_type === 'sea_attack_dice')
    .reduce((best, w) => Math.max(best, w.def.passive_effect_value), 0);
}

/** Tech cost multiplier from CERN (0.5 = half cost), or 1 if the player holds none. */
export function getWonderTechCostMultiplier(state: GameState, playerId: string): number {
  const half = getPlayerWonders(state, playerId)
    .some((w) => w.def.passive_effect_type === 'tech_cost_half');
  return half ? 0.5 : 1;
}

/** Extra influence range (Unification Monument, Space Elevator). */
export function getWonderInfluenceRange(state: GameState, playerId: string): number {
  return sumPassive(state, playerId, 'influence_range');
}

/**
 * Apply wonder income during collectProduction.
 * Mutates player.tech_points with the Sputnik bonus.
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
