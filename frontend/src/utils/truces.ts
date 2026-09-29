import type { GameState, PlayerState } from '../store/gameStore';
import { TERRITORY_ABILITY_UI } from './techAbilities';
import { FACTION_ABILITY_UI } from './factionAbilities';

/**
 * The player who owns `territoryId`, when you hold a truce with them. Nothing
 * forbids attacking a truce partner, but any attack breaks the truce: a land
 * or Fleet Attack, a blitz, a strike, the atom bomb, a Drop Assault, or
 * Influence. So the client asks first; the server refuses one sent without
 * `breakTruce`.
 */
export function trucePartnerOwning(
  gameState: GameState,
  myPlayerId: string,
  territoryId: string,
): PlayerState | null {
  const ownerId = gameState.territories[territoryId]?.owner_id;
  if (!ownerId || ownerId === myPlayerId) return null;
  const me = gameState.players.find((p) => p.player_id === myPlayerId);
  const owner = gameState.players.find((p) => p.player_id === ownerId);
  if (!me || !owner) return null;
  const entry = gameState.diplomacy?.find(
    (e) =>
      (e.player_index_a === me.player_index && e.player_index_b === owner.player_index) ||
      (e.player_index_a === owner.player_index && e.player_index_b === me.player_index),
  );
  return entry?.status === 'truce' && (entry.truce_turns_remaining ?? 0) > 0 ? owner : null;
}

/** Abilities fired at another player's ground: on a truce partner's, one breaks the truce. */
export function isHostileAbility(abilityId: string): boolean {
  return TERRITORY_ABILITY_UI[abilityId]?.enemyTarget === true
    || FACTION_ABILITY_UI[abilityId]?.enemyTarget === true;
}
