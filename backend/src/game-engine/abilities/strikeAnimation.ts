import type { Server } from 'socket.io';
import { TERRITORY_ABILITY_DEFS } from './techAbilities';

/** Abilities that trigger the full-screen strike animation for all clients. */
export const STRIKE_ANIMATION_ABILITIES = new Set(['atom_bomb', 'nuclear_strike']);

export interface StrikeAnimationPayload {
  abilityId: string;
  attackerId: string;
  attackerName: string;
  attackerColor: string;
  territoryId: string;
  targetOwnerId: string | null;
  targetOwnerName: string | null;
  unitReduction?: number;
}

export function shouldEmitStrikeAnimation(abilityId: string, effect?: string): boolean {
  if (!STRIKE_ANIMATION_ABILITIES.has(abilityId)) return false;
  return effect === 'atom_bomb_detonated' || effect === 'unit_reduction';
}

export function buildStrikeAnimationPayload(params: {
  abilityId: string;
  attackerId: string;
  attackerName: string;
  attackerColor: string;
  territoryId: string;
  targetOwnerId: string | null;
  targetOwnerName: string | null;
}): StrikeAnimationPayload {
  const def = TERRITORY_ABILITY_DEFS[params.abilityId];
  return {
    ...params,
    unitReduction: def?.unitReduction,
  };
}

/** Broadcast strike visuals to every human in the match (players + spectators). */
export function emitStrikeAnimation(
  io: Server,
  gameId: string,
  payload: StrikeAnimationPayload,
): void {
  io.to(gameId).emit('game:strike_animation', payload);
  io.to(`${gameId}:spectators`).emit('game:strike_animation', payload);
}
