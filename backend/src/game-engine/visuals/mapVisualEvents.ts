import { randomUUID } from 'crypto';
import type { Server } from 'socket.io';
import type { EventEffect, EventEffectResult, GameState } from '../../types';

export type MapVisualKind =
  | 'reinforce'
  | 'combat'
  | 'fortify'
  | 'capture'
  | 'strike'
  | 'naval'
  | 'influence'
  | 'event';

/** Payload broadcast to all clients for map-local animations. */
export interface MapVisualEventPayload {
  id: string;
  kind: MapVisualKind;
  territoryId: string;
  fromTerritoryId?: string;
  playerId?: string;
  playerColor?: string;
  attackerColor?: string;
  defenderColor?: string;
  /** New owner color after capture / influence seize */
  newOwnerColor?: string;
  units?: number;
  totalAfter?: number;
  attackerLosses?: number;
  defenderLosses?: number;
  captured?: boolean;
  /** Strike ability id or other variant key */
  variant?: string;
  unitReduction?: number;
  /** Event card — affected territories with unit deltas */
  affectedTerritories?: Array<{ territory_id: string; delta: number }>;
  regionId?: string;
  global?: boolean;
  cardId?: string;
}

export function playerColor(state: GameState, playerId: string | null | undefined): string | undefined {
  if (!playerId) return undefined;
  return state.players.find((p) => p.player_id === playerId)?.color;
}

export function buildReinforceMapVisual(params: {
  territoryId: string;
  units: number;
  totalAfter: number;
  playerId: string;
  state: GameState;
}): Omit<MapVisualEventPayload, 'id'> {
  return {
    kind: 'reinforce',
    territoryId: params.territoryId,
    units: params.units,
    totalAfter: params.totalAfter,
    playerId: params.playerId,
    playerColor: playerColor(params.state, params.playerId),
  };
}

export function buildFortifyMapVisual(params: {
  fromTerritoryId: string;
  toTerritoryId: string;
  units: number;
  playerId: string;
  state: GameState;
}): Omit<MapVisualEventPayload, 'id'> {
  return {
    kind: 'fortify',
    territoryId: params.toTerritoryId,
    fromTerritoryId: params.fromTerritoryId,
    units: params.units,
    playerId: params.playerId,
    playerColor: playerColor(params.state, params.playerId),
  };
}

export function buildCombatMapVisual(params: {
  fromId: string;
  toId: string;
  attackerId: string;
  defenderId: string | null | undefined;
  attackerLosses: number;
  defenderLosses: number;
  territoryCaptured: boolean;
  state: GameState;
}): Omit<MapVisualEventPayload, 'id'> {
  const attackerColor = playerColor(params.state, params.attackerId);
  const defenderColor = playerColor(params.state, params.defenderId);
  return {
    kind: 'combat',
    territoryId: params.toId,
    fromTerritoryId: params.fromId,
    attackerLosses: params.attackerLosses,
    defenderLosses: params.defenderLosses,
    captured: params.territoryCaptured,
    attackerColor,
    defenderColor,
    newOwnerColor: params.territoryCaptured ? attackerColor : undefined,
  };
}

export function buildStrikeMapVisual(params: {
  territoryId: string;
  abilityId: string;
  attackerColor?: string;
  defenderLosses?: number;
  unitReduction?: number;
  fromTerritoryId?: string;
}): Omit<MapVisualEventPayload, 'id'> {
  return {
    kind: 'strike',
    territoryId: params.territoryId,
    fromTerritoryId: params.fromTerritoryId,
    variant: params.abilityId,
    attackerColor: params.attackerColor,
    defenderLosses: params.defenderLosses,
    unitReduction: params.unitReduction,
  };
}

export function buildNavalMapVisual(params: {
  fromId: string;
  toId: string;
  attackerId: string;
  attackerLosses: number;
  defenderLosses: number;
  attackerWon: boolean;
  state: GameState;
}): Omit<MapVisualEventPayload, 'id'> {
  const attackerColor = playerColor(params.state, params.attackerId);
  const defenderId = params.state.territories[params.toId]?.owner_id;
  return {
    kind: 'naval',
    territoryId: params.toId,
    fromTerritoryId: params.fromId,
    playerId: params.attackerId,
    playerColor: attackerColor,
    attackerColor,
    defenderColor: playerColor(params.state, defenderId),
    attackerLosses: params.attackerLosses,
    defenderLosses: params.defenderLosses,
    captured: params.attackerWon,
    variant: 'naval_combat',
  };
}

export function buildInfluenceMapVisual(params: {
  targetId: string;
  actorId: string;
  previousOwnerId: string | null;
  /** `blocked` is infra-only until influence counterplay can fail in game rules. */
  variant?: 'seize' | 'garibaldi' | 'detente' | 'blocked';
  state: GameState;
}): Omit<MapVisualEventPayload, 'id'> {
  const actorColor = playerColor(params.state, params.actorId);
  const blocked = params.variant === 'blocked';
  return {
    kind: 'influence',
    territoryId: params.targetId,
    playerId: params.actorId,
    playerColor: actorColor,
    attackerColor: actorColor,
    defenderColor: playerColor(params.state, params.previousOwnerId),
    newOwnerColor: blocked ? undefined : actorColor,
    captured: !blocked,
    variant: params.variant ?? 'seize',
  };
}

/** Broadcast a map visual to every human in the match (players + spectators). */
export function buildEventMapVisual(params: {
  cardId: string;
  effectType?: string;
  regionId?: string;
  global?: boolean;
  affectedTerritories?: Array<{ territory_id: string; delta: number }>;
  draftUnitsGranted?: number;
}): Omit<MapVisualEventPayload, 'id'> {
  const mapTerritories = params.affectedTerritories?.filter(
    (row) => row.territory_id && !row.territory_id.startsWith('__'),
  ) ?? [];
  const primaryTerritoryId = mapTerritories[0]?.territory_id ?? '__global__';
  return {
    kind: 'event',
    territoryId: primaryTerritoryId,
    variant: params.effectType ?? params.cardId,
    cardId: params.cardId,
    regionId: params.regionId,
    global: params.global,
    affectedTerritories: mapTerritories.length > 0 ? mapTerritories : undefined,
    units: params.draftUnitsGranted,
  };
}

/** Emit map visuals when an event card resolves with territory or global effects. */
export function emitEventCardMapVisuals(
  io: Server,
  gameId: string,
  params: {
    cardId: string;
    effect?: EventEffect;
    result: EventEffectResult;
  },
): void {
  const { cardId, effect, result } = params;
  const hasTerritoryDeltas = (result.affected_territories?.length ?? 0) > 0;
  const hasDraftBonus = (result.draft_units_granted ?? 0) > 0;
  const hasModifierVisual = effect?.type === 'truce' || effect?.type === 'stability_change';
  if (!result.global && !hasTerritoryDeltas && !hasDraftBonus && !hasModifierVisual) {
    return;
  }

  const regionId = effect?.target === 'region' ? effect.target_id : undefined;
  emitMapVisual(io, gameId, buildEventMapVisual({
    cardId,
    effectType: effect?.type,
    regionId,
    global: result.global,
    affectedTerritories: result.affected_territories,
    draftUnitsGranted: result.draft_units_granted,
  }));
}

/** Broadcast a map visual to every human in the match (players + spectators). */
export function emitMapVisual(
  io: Server,
  gameId: string,
  event: Omit<MapVisualEventPayload, 'id'>,
): MapVisualEventPayload {
  const payload: MapVisualEventPayload = { ...event, id: randomUUID() };
  io.to(gameId).emit('game:map_visual', payload);
  io.to(`${gameId}:spectators`).emit('game:map_visual', payload);
  return payload;
}
