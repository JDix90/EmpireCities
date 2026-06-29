/**
 * Game room lifecycle — Redis-authoritative state with a per-process hot cache
 * and local connected-socket tracking (Phases 5–8 of the Redis migration).
 */

import { query, queryOne } from '../db/postgres';
import {
  repairDraftUnitsIfMissing,
  repairLegacyGameState,
} from '../game-engine/state/gameStateManager';
import type { GameState, GameMap } from '../types';
import { mapHasEraGrowth, repairEraTerritoryGrowth } from '../game-engine/eraAdvancement/territoryUnlock';
import { resolveMap } from './mapResolver';
import { runWithGameLock } from './gameLock';
import {
  recordPostgresBackupFailure,
  recordRedisSaveFailure,
  recordLockFailure,
} from './migrationMetrics';
import {
  deleteGameKeys,
  getConnectedPlayers,
  getGameMap,
  getGameState,
  markPlayerConnected,
  markPlayerDisconnected,
  refreshGameTTL,
  setGameMap,
  setGameState,
  acquireAiInFlight,
  releaseAiInFlight,
  isAiInFlight as isAiInFlightRedis,
} from './redisGameStore';

export class GameRoomNotFoundError extends Error {
  constructor(gameId: string) {
    super(`Game room not found: ${gameId}`);
    this.name = 'GameRoomNotFoundError';
  }
}

const POSTGRES_DEBOUNCE_MS = 800;
const pendingPostgresSaves = new Map<string, ReturnType<typeof setTimeout>>();
const pendingPostgresState = new Map<string, GameState>();

export interface ActiveGameRoom {
  state: GameState;
  map: GameMap;
  connectedSockets: Map<string, string>;
}

/** Hot cache: state + map only. Authority is Redis after Phase 5. */
const roomCache = new Map<string, { state: GameState; map: GameMap }>();

/** Per-process socketId → playerId (instance-local). */
const connectedSocketsByGame = new Map<string, Map<string, string>>();

function ensureConnectedMap(gameId: string): Map<string, string> {
  let map = connectedSocketsByGame.get(gameId);
  if (!map) {
    map = new Map();
    connectedSocketsByGame.set(gameId, map);
  }
  return map;
}

export function getCachedRoom(gameId: string): ActiveGameRoom | undefined {
  const cached = roomCache.get(gameId);
  if (!cached) return undefined;
  return {
    state: cached.state,
    map: cached.map,
    connectedSockets: ensureConnectedMap(gameId),
  };
}

export function hasCachedRoom(gameId: string): boolean {
  return roomCache.has(gameId);
}

export function setCachedRoom(gameId: string, state: GameState, map: GameMap): ActiveGameRoom {
  roomCache.set(gameId, { state, map });
  return getCachedRoom(gameId)!;
}

export function updateCachedState(gameId: string, state: GameState): void {
  const cached = roomCache.get(gameId);
  if (cached) cached.state = state;
}

export function deleteCachedRoom(gameId: string): void {
  roomCache.delete(gameId);
  connectedSocketsByGame.delete(gameId);
}

export function getCachedRoomCount(): number {
  return roomCache.size;
}

export function connectSocket(gameId: string, socketId: string, playerId: string): void {
  ensureConnectedMap(gameId).set(socketId, playerId);
}

export function disconnectSocket(gameId: string, socketId: string): string | undefined {
  const map = connectedSocketsByGame.get(gameId);
  if (!map) return undefined;
  const playerId = map.get(socketId);
  map.delete(socketId);
  return playerId;
}

export async function onPlayerConnected(gameId: string, socketId: string, playerId: string): Promise<void> {
  connectSocket(gameId, socketId, playerId);
  await markPlayerConnected(gameId, playerId).catch((err) => {
    console.error('[Redis] markPlayerConnected failed', gameId, err);
  });
}

export async function onPlayerDisconnected(
  gameId: string,
  socketId: string,
  playerId: string,
): Promise<void> {
  disconnectSocket(gameId, socketId);
  await markPlayerDisconnected(gameId, playerId).catch((err) => {
    console.error('[Redis] markPlayerDisconnected failed', gameId, err);
  });
}

/** Cross-instance human presence (Redis) with local fallback. */
export async function hasHumanConnections(gameId: string, state: GameState): Promise<boolean> {
  const connectedIds = await getConnectedPlayers(gameId);
  if (connectedIds.length > 0) {
    return connectedIds.some((pid) => state.players.some((p) => p.player_id === pid && !p.is_ai));
  }
  const local = connectedSocketsByGame.get(gameId);
  if (!local) return false;
  return [...local.values()].some((pid) => state.players.some((p) => p.player_id === pid && !p.is_ai));
}

function repairRoom(state: GameState, map: GameMap): void {
  repairDraftUnitsIfMissing(state, map);
  repairLegacyGameState(state, map);
  // Backfill territory growth for games that predate the map's growth content
  // (idempotent; no-op for non-growth maps / non-era-advancement games).
  repairEraTerritoryGrowth(state, map);
}

/**
 * The persisted map snapshot can predate growth content that has since shipped
 * (era maps now carry `unlock_era_index` frontiers). For an in-progress
 * Era-Advancement game whose snapshot lacks that content, re-resolve the map from
 * the current source and re-persist it, so existing games can grow on next load.
 * No-op once the snapshot is current, and for non-era-advancement games.
 */
async function refreshMapForEraGrowth(gameId: string, state: GameState, map: GameMap): Promise<GameMap> {
  if (state.settings?.era_advancement_enabled !== true) return map;
  if (mapHasEraGrowth(map)) return map;
  const fresh = await resolveMap(map.map_id);
  if (fresh && mapHasEraGrowth(fresh)) {
    await setGameMap(gameId, fresh).catch((err) =>
      console.error('[Room] growth map refresh persist failed', gameId, err),
    );
    return fresh;
  }
  return map;
}

export async function loadGameRoomFromRedis(gameId: string): Promise<ActiveGameRoom | null> {
  const state = await getGameState(gameId);
  if (!state) return null;
  let map = await getGameMap(gameId);
  if (!map) return null;
  map = await refreshMapForEraGrowth(gameId, state, map);
  repairRoom(state, map);
  return setCachedRoom(gameId, state, map);
}

export async function loadGameRoomFromPostgres(gameId: string, mapId: string): Promise<ActiveGameRoom | null> {
  const saved = await queryOne<{ state_json: GameState }>(
    `SELECT state_json FROM game_states WHERE game_id = $1 ORDER BY turn_number DESC, saved_at DESC LIMIT 1`,
    [gameId],
  );
  if (!saved) return null;
  const gameMap = await resolveMap(mapId);
  if (!gameMap) return null;
  repairRoom(saved.state_json, gameMap);
  const room = setCachedRoom(gameId, saved.state_json, gameMap);
  await Promise.all([
    setGameState(gameId, saved.state_json),
    setGameMap(gameId, gameMap),
  ]).catch((err) => console.error('[Redis] Warm failed', gameId, err));
  return room;
}

/** Redis-first load with Postgres fallback. Populates the hot cache. */
export async function ensureGameRoom(gameId: string, mapId: string): Promise<ActiveGameRoom | null> {
  const cached = getCachedRoom(gameId);
  if (cached) return cached;

  const fromRedis = await loadGameRoomFromRedis(gameId);
  if (fromRedis) return fromRedis;

  return loadGameRoomFromPostgres(gameId, mapId);
}

/**
 * Load the authoritative room for a mutation — always reads Redis first so
 * multi-instance writers see the latest state even when local cache is stale.
 */
export async function loadAuthoritativeRoom(gameId: string, mapId?: string): Promise<ActiveGameRoom | null> {
  const fromRedis = await loadGameRoomFromRedis(gameId);
  if (fromRedis) return fromRedis;
  if (mapId) {
    const fromPg = await loadGameRoomFromPostgres(gameId, mapId);
    if (fromPg) return fromPg;
  }
  const cached = getCachedRoom(gameId);
  if (cached) return cached;

  // Last-resort self-heal: most action paths don't know the map id, which
  // used to mean any total miss (backend restart + Redis flush) failed every
  // action with GAME_NOT_FOUND even though the game was safe in Postgres —
  // only game:join could repair the room. Look the map id up ourselves and
  // retry. In-progress games only: a finished game's eviction must stay final,
  // or a stray action could resurrect its pre-victory state from the backups.
  if (!mapId) {
    const row = await queryOne<{ map_id: string }>(
      `SELECT map_id FROM games WHERE game_id = $1 AND status = 'in_progress'`,
      [gameId],
    ).catch((err) => {
      console.error('[Room] Self-heal map_id lookup failed for', gameId, err);
      return null;
    });
    if (row) {
      const recovered = await loadGameRoomFromPostgres(gameId, row.map_id);
      if (recovered) {
        console.warn('[Room] Recovered game', gameId, 'from Postgres after redis+cache miss');
        return recovered;
      }
    }
  }

  // Every load layer missed — surfaced to players as GAME_NOT_FOUND.
  // Log which layers were consulted so eviction/persistence gaps are diagnosable.
  console.warn(
    '[Room] Authoritative load failed for', gameId,
    `(redis: miss, postgres: ${mapId ? 'miss' : 'miss via self-heal lookup'}, cache: miss)`,
  );
  return null;
}

/**
 * Run fn under the per-game lock after reloading state from Redis.
 */
export async function withLockedRoom<T>(
  gameId: string,
  fn: (room: ActiveGameRoom) => Promise<T>,
  options?: { durationMs?: number; mapId?: string },
): Promise<T> {
  const durationMs = options?.durationMs ?? 5000;
  const mapId = options?.mapId;
  try {
    return await runWithGameLock(gameId, async () => {
      const room = await loadAuthoritativeRoom(gameId, mapId);
      if (!room) throw new GameRoomNotFoundError(gameId);
      return fn(room);
    }, durationMs);
  } catch (err) {
    if (!(err instanceof GameRoomNotFoundError)) {
      recordLockFailure();
    }
    throw err;
  }
}

function writePostgresBackup(gameId: string, state: GameState): void {
  query(
    'INSERT INTO game_states (game_id, turn_number, state_json) VALUES ($1, $2, $3)',
    [gameId, state.turn_number, JSON.stringify(state)],
  ).catch((err) => {
    recordPostgresBackupFailure();
    console.error('[DB] Postgres backup write failed for game', gameId, err);
  });
}

function cancelPendingPostgresSave(gameId: string): void {
  const existing = pendingPostgresSaves.get(gameId);
  if (existing) clearTimeout(existing);
  pendingPostgresSaves.delete(gameId);
  pendingPostgresState.delete(gameId);
}

/** Immediate Redis persist (authoritative). Throws on Redis failure. */
export async function persistStateToRedis(gameId: string, state: GameState): Promise<void> {
  try {
    await setGameState(gameId, state);
    await refreshGameTTL(gameId).catch(() => {});
    updateCachedState(gameId, state);
  } catch (err) {
    recordRedisSaveFailure();
    console.error('[Redis] State persist failed for game', gameId, err);
    throw err;
  }
}

function schedulePostgresBackup(gameId: string, state: GameState): void {
  pendingPostgresState.set(gameId, state);
  const existing = pendingPostgresSaves.get(gameId);
  if (existing) clearTimeout(existing);
  const timer = setTimeout(() => {
    pendingPostgresSaves.delete(gameId);
    const latest = pendingPostgresState.get(gameId);
    pendingPostgresState.delete(gameId);
    if (latest) writePostgresBackup(gameId, latest);
  }, POSTGRES_DEBOUNCE_MS);
  timer.unref();
  pendingPostgresSaves.set(gameId, timer);
}

/** After a mutation: Redis immediately, Postgres debounced (restart-safe). */
export async function persistGameStateAfterMutation(gameId: string, state: GameState): Promise<void> {
  await persistStateToRedis(gameId, state);
  schedulePostgresBackup(gameId, state);
}

/** Full flush: Redis + Postgres immediately (game over, leave, shutdown). */
export async function flushGameState(gameId: string, state: GameState): Promise<void> {
  cancelPendingPostgresSave(gameId);
  await persistStateToRedis(gameId, state);
  writePostgresBackup(gameId, state);
}

export async function flushAllPendingPostgresSaves(): Promise<void> {
  const flushes: Promise<void>[] = [];
  for (const [gameId, timer] of pendingPostgresSaves.entries()) {
    clearTimeout(timer);
    const state = pendingPostgresState.get(gameId);
    pendingPostgresSaves.delete(gameId);
    pendingPostgresState.delete(gameId);
    if (state) {
      flushes.push(
        flushGameState(gameId, state).catch((err) => {
          console.error('[DB] flushAllPendingPostgresSaves failed for', gameId, err);
        }),
      );
    }
  }
  await Promise.allSettled(flushes);
}

/** @deprecated Use flushGameState or persistGameStateAfterMutation. */
export async function saveGameStateAuthoritative(gameId: string, state: GameState): Promise<void> {
  return flushGameState(gameId, state);
}

export async function saveGameMapAuthoritative(gameId: string, map: GameMap): Promise<void> {
  await setGameMap(gameId, map);
  const cached = roomCache.get(gameId);
  if (cached) cached.map = map;
}

export async function evictGameRoom(gameId: string): Promise<void> {
  deleteCachedRoom(gameId);
  await deleteGameKeys(gameId).catch((err) => {
    console.error('[Redis] deleteGameKeys failed', gameId, err);
  });
}

export async function tryAcquireAiTurn(gameId: string): Promise<boolean> {
  return acquireAiInFlight(gameId);
}

export async function releaseAiTurn(gameId: string): Promise<void> {
  await releaseAiInFlight(gameId);
}

export async function isAiTurnInFlight(gameId: string): Promise<boolean> {
  return isAiInFlightRedis(gameId);
}

/** Iterate cached game ids (for disconnect cleanup). */
export function forEachCachedRoom(
  fn: (gameId: string, room: ActiveGameRoom) => void,
): void {
  for (const gameId of roomCache.keys()) {
    const room = getCachedRoom(gameId);
    if (room) fn(gameId, room);
  }
}

/** Local-only iteration including rooms with only connected sockets. */
export function forEachConnectedGame(
  fn: (gameId: string, sockets: Map<string, string>) => void,
): void {
  for (const [gameId, sockets] of connectedSocketsByGame.entries()) {
    fn(gameId, sockets);
  }
}
