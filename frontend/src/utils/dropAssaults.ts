/**
 * Drop Assault markers (Space Age Moon Race, Phase 2b) — read-only views over
 * the shared `drop_assaults` list the server broadcasts to everyone.
 *
 * The telegraph is the whole balance of this ability: three units land anywhere
 * on Earth, but the target is marked for a full round first and the defender's
 * counterplay is simply to reinforce it. A marker nobody notices is the same as
 * no telegraph at all, which is why this is surfaced twice — on the territory
 * itself, and as a standing alert on the HUD for the player whose ground it is.
 */

import type { DropAssault, GameState } from '../store/gameStore';

/** Drops in flight aimed at this territory. */
export function dropAssaultsTargeting(
  gameState: Pick<GameState, 'drop_assaults'> | null | undefined,
  territoryId: string,
): DropAssault[] {
  return (gameState?.drop_assaults ?? []).filter((d) => d.target_id === territoryId);
}

export interface IncomingDropAssault {
  assault: DropAssault;
  /** Display name of the player who declared it, when they can be resolved. */
  declaredBy: string;
}

/**
 * Drops aimed at ground this player currently holds — what the HUD warns about.
 * A drop the player declared themselves is not "incoming"; it is theirs.
 */
export function incomingDropAssaultsAgainst(
  gameState: GameState | null | undefined,
  playerId: string | null | undefined,
): IncomingDropAssault[] {
  if (!gameState || !playerId) return [];
  return (gameState.drop_assaults ?? [])
    .filter((d) => d.owner_id !== playerId
      && gameState.territories[d.target_id]?.owner_id === playerId)
    .map((assault) => ({
      assault,
      declaredBy: gameState.players.find((p) => p.player_id === assault.owner_id)?.username ?? 'Someone',
    }));
}
