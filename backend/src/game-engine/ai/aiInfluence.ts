/**
 * A bot's paid influence: one set of rules for the planner that picks the
 * target (aiBot selectInfluenceTarget) and the turn that spends it
 * (runAiTurn), the same rules the human handler (gameSocket `game:influence`)
 * enforces.
 *
 * The two used to disagree. The planner reached as far as its era's base range
 * while the turn added tech and wonder range, and the planner never checked
 * the defender cap or that a neighbour could pay. So it could plan a target
 * the turn then refused (four defenders, or nobody beside it with three
 * spare), and the turn's influence was lost while a valid target sat next door.
 */
import type { GameMap, GameState } from '../../types';
import { getInfluenceUnitCost } from '../abilities/techAbilities';
import { getPlayerEraModifiers } from '../state/eraModifiers';
import {
  getAdjacentTerritoryIds,
  getInfluenceHopLimit,
  isTerritoryReachableWithinHops,
} from '../state/influenceManager';
import { getEraTechTreeForPlayer } from '../state/techManager';
import { getWonderInfluenceRange } from '../state/wonderManager';

/** The most defenders a paid influence may take (INFLUENCE_MAX_TARGET_UNITS in the human handler). */
export const INFLUENCE_MAX_TARGET_UNITS = 3;

/** How many hops a player's influence reaches: the era's range, plus range tech and wonders. */
export function influenceHopLimit(state: GameState, playerId: string): number {
  const player = state.players.find((p) => p.player_id === playerId);
  return getInfluenceHopLimit({
    baseHopLimit: getPlayerEraModifiers(state, playerId).influence_range ?? 1,
    unlockedTechs: player?.unlocked_techs ?? [],
    techTree: state.settings.tech_trees_enabled ? getEraTechTreeForPlayer(state, playerId) : [],
    wonderRangeBonus: state.settings.economy_enabled ? getWonderInfluenceRange(state, playerId) : 0,
  });
}

/**
 * The territories that pay for a paid influence on `targetId`: the player's
 * own neighbours of it, strongest first, each keeping one unit. Null when the
 * influence is not allowed: the target is the player's own, out of range, or
 * holds more than INFLUENCE_MAX_TARGET_UNITS; the player holds fewer than the
 * cost plus one unit in all; or its neighbours of the target cannot cover the
 * cost between them.
 */
export function influencePayers(
  state: GameState,
  map: GameMap,
  playerId: string,
  targetId: string,
): string[] | null {
  const target = state.territories[targetId];
  if (!target || target.owner_id === playerId) return null;
  if (target.unit_count > INFLUENCE_MAX_TARGET_UNITS) return null;

  const owned = Object.entries(state.territories)
    .filter(([, t]) => t.owner_id === playerId)
    .map(([id]) => id);
  const hopLimit = influenceHopLimit(state, playerId);
  if (!isTerritoryReachableWithinHops({ map, ownedTerritoryIds: owned, targetId, hopLimit })) return null;

  const cost = getInfluenceUnitCost(state, playerId);
  const total = owned.reduce((sum, id) => sum + state.territories[id]!.unit_count, 0);
  if (total < cost + 1) return null;

  const payers = [...new Set(getAdjacentTerritoryIds(map, targetId))]
    .filter((id) => state.territories[id]?.owner_id === playerId)
    .sort((a, b) => state.territories[b]!.unit_count - state.territories[a]!.unit_count);
  const spare = payers.reduce((sum, id) => sum + Math.max(0, state.territories[id]!.unit_count - 1), 0);
  return spare >= cost ? payers : null;
}
