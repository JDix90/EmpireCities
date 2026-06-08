import type { Server } from 'socket.io';
import type { GameMap, GameState } from '../../types';
import { getAdjacentTerritoryIds } from '../state/influenceManager';
import { TERRITORY_ABILITY_DEFS } from './techAbilities';
import { buildStrikeMapVisual, emitMapVisual } from '../visuals/mapVisualEvents';

/** Abilities with full-screen overlay + map/globe strike visuals. */
export const FULL_SCREEN_STRIKE_ABILITIES = new Set([
  'atom_bomb',
  'nuclear_strike',
  'orbital_strike',
  'hypersonic_strike',
  'swarm_strike',
  'dyson_beam',
]);

/** Map/globe strike visuals only — no full-screen takeover. */
export const MAP_ONLY_STRIKE_ABILITIES = new Set([
  'air_strike',
  'cyber_attack',
  'data_breach',
  'river_blockade',
]);

/** @deprecated Use FULL_SCREEN_STRIKE_ABILITIES */
export const STRIKE_ANIMATION_ABILITIES = FULL_SCREEN_STRIKE_ABILITIES;

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
  return shouldEmitFullScreenStrike(abilityId, effect);
}

export function shouldEmitFullScreenStrike(abilityId: string, effect?: string): boolean {
  if (!FULL_SCREEN_STRIKE_ABILITIES.has(abilityId)) return false;
  return effect === 'atom_bomb_detonated' || effect === 'unit_reduction';
}

export function shouldEmitMapOnlyStrike(abilityId: string, effect?: string): boolean {
  if (!MAP_ONLY_STRIKE_ABILITIES.has(abilityId)) return false;
  return effect === 'unit_reduction';
}

export function shouldEmitAbilityStrikeVisuals(abilityId: string, effect?: string): boolean {
  if (effect === 'atom_bomb_detonated') return true;
  if (effect !== 'unit_reduction') return false;
  const def = TERRITORY_ABILITY_DEFS[abilityId];
  return (def?.unitReduction ?? 0) > 0;
}

export function findStrikeSourceTerritory(
  state: GameState,
  map: GameMap,
  playerId: string,
  targetTerritoryId: string,
): string | undefined {
  const adjacent = getAdjacentTerritoryIds(map, targetTerritoryId);
  return adjacent.find((id) => state.territories[id]?.owner_id === playerId);
}

export function buildStrikeAnimationPayload(params: {
  abilityId: string;
  attackerId: string;
  attackerName: string;
  attackerColor: string;
  territoryId: string;
  targetOwnerId: string | null;
  targetOwnerName: string | null;
  unitReduction?: number;
}): StrikeAnimationPayload {
  const def = TERRITORY_ABILITY_DEFS[params.abilityId];
  return {
    ...params,
    unitReduction: params.unitReduction ?? def?.unitReduction,
  };
}

/** Pre-combat air strike when Tactical Air Support buff is consumed on attack. */
export function emitPreAttackAirStrikeVisuals(
  io: Server,
  gameId: string,
  params: {
    preAttackDamage: number;
    fromTerritoryId: string;
    targetTerritoryId: string;
    attacker: { player_id: string; username: string; color: string };
    defenderId: string | null;
    state: GameState;
    map: GameMap;
  },
): void {
  if (params.preAttackDamage <= 0) return;

  const defender = params.defenderId
    ? params.state.players.find((p) => p.player_id === params.defenderId)
    : undefined;

  emitAbilityStrikeVisuals(io, gameId, buildStrikeAnimationPayload({
    abilityId: 'air_strike',
    attackerId: params.attacker.player_id,
    attackerName: params.attacker.username,
    attackerColor: params.attacker.color,
    territoryId: params.targetTerritoryId,
    targetOwnerId: params.defenderId,
    targetOwnerName: defender?.username ?? null,
    unitReduction: params.preAttackDamage,
  }), {
    fromTerritoryId: params.fromTerritoryId,
    state: params.state,
    map: params.map,
  });
}

/**
 * Broadcast strike visuals: full-screen overlay when applicable, always map/globe.
 * Emits `game:strike_animation` for client toasts/combat log on all strike abilities.
 */
export function emitAbilityStrikeVisuals(
  io: Server,
  gameId: string,
  payload: StrikeAnimationPayload,
  options?: { fromTerritoryId?: string; state?: GameState; map?: GameMap },
): void {
  const def = TERRITORY_ABILITY_DEFS[payload.abilityId];
  const fromTerritoryId = options?.fromTerritoryId
    ?? (options?.state && options?.map
      ? findStrikeSourceTerritory(options.state, options.map, payload.attackerId, payload.territoryId)
      : undefined);

  io.to(gameId).emit('game:strike_animation', payload);
  io.to(`${gameId}:spectators`).emit('game:strike_animation', payload);

  const unitReduction = payload.unitReduction ?? def?.unitReduction;
  emitMapVisual(io, gameId, buildStrikeMapVisual({
    territoryId: payload.territoryId,
    abilityId: payload.abilityId,
    attackerColor: payload.attackerColor,
    defenderLosses: unitReduction,
    unitReduction,
    fromTerritoryId,
  }));
}

/** @deprecated Prefer emitAbilityStrikeVisuals */
export function emitStrikeAnimation(
  io: Server,
  gameId: string,
  payload: StrikeAnimationPayload,
): void {
  emitAbilityStrikeVisuals(io, gameId, payload);
}
