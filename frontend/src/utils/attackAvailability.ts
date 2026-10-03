/**
 * Whether the viewer has anything to attack this turn, anywhere on the board.
 *
 * The territory panel lists the legal targets of ONE territory and, when
 * there are none, says "No enemy borders this territory. Attack from one that
 * does." On a cleared daily board that was true of every tile and false of
 * the board: the player's territories bordered only empty neutrals, which no
 * one can take, and the enemy sat across an ocean. The attack phase still
 * ran each turn, and the message sent players hunting for a territory that
 * did not exist. This answers the question for the whole board, so the HUD
 * and the panel can say so once.
 */
import type { GameState } from '../store/gameStore';
import { computePhaseAdjacencyTargets, type MapConnection } from './mapAdjacencyTargets';

export interface AttackAvailability {
  /** Some territory of the viewer's has a legal target beside it. */
  anyTarget: boolean;
  /** Some territory of the viewer's borders an empty neutral, which no one can take. */
  emptyNeutralBorder: boolean;
}

const NONE: AttackAvailability = { anyTarget: false, emptyNeutralBorder: false };

/**
 * Mirrors the territory panel's per-territory target list over every
 * territory the viewer holds, with the attack-phase rules applied whatever
 * the current phase, so a caller can ask before the phase begins.
 */
export function attackAvailability(
  gameState: GameState | null | undefined,
  connections: MapConnection[],
  viewerId: string | null | undefined,
): AttackAvailability {
  if (!gameState || !viewerId) return NONE;
  const asAttack: GameState = gameState.phase === 'attack' ? gameState : { ...gameState, phase: 'attack' };
  let emptyNeutralBorder = false;
  for (const [territoryId, territory] of Object.entries(gameState.territories)) {
    if (territory.owner_id !== viewerId) continue;
    const targets = computePhaseAdjacencyTargets(asAttack, connections, {
      sourceTerritoryId: territoryId,
      attackSource: territoryId,
    });
    if (targets.size > 0) return { anyTarget: true, emptyNeutralBorder };
    if (emptyNeutralBorder) continue;
    for (const conn of connections) {
      const other = conn.from === territoryId ? conn.to : conn.to === territoryId ? conn.from : null;
      if (!other) continue;
      const neighbor = gameState.territories[other];
      if (neighbor && !neighbor.owner_id && (neighbor.unit_count ?? 0) < 1) {
        emptyNeutralBorder = true;
        break;
      }
    }
  }
  return { anyTarget: false, emptyNeutralBorder };
}

/** The sentence for a turn with nothing to fight, or null when there is something. */
export function nothingToFightMessage(
  gameState: GameState | null | undefined,
  connections: MapConnection[],
  viewerId: string | null | undefined,
): string | null {
  const availability = attackAvailability(gameState, connections, viewerId);
  if (availability.anyTarget) return null;
  return availability.emptyNeutralBorder
    ? 'Nothing to fight: no enemy borders any of your territories, and empty land cannot be taken. Carry on to Fortify.'
    : 'Nothing to fight: no enemy borders any of your territories. Carry on to Fortify.';
}
