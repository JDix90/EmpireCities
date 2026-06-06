/**
 * Redis state layer for Borderfall game sessions — Phase 2 of the
 * Redis-stateless backend migration.
 *
 * SERIALIZATION AUDIT (June 2026)
 * ─────────────────────────────────────────────────────────────────────────────
 * GameState and GameMap were audited field-by-field against backend/src/types/index.ts.
 * Neither type contains any Map, Set, Date, or class-instance fields:
 *   - territories: Record<string, TerritoryState>   — plain object ✓
 *   - players: PlayerState[]                        — array of plain objects ✓
 *   - card_deck / diplomacy / win_probability_history — arrays ✓
 *   - turn_started_at / game_started_at              — Unix ms numbers ✓
 *   - all other fields: primitives, arrays, or nested plain objects ✓
 * JSON.stringify / JSON.parse round-trips both types without data loss.
 * If GameState ever gains a Map or Set field, this file must be updated.
 */

import { redis } from '../db/redis';
import type { GameState, GameMap } from '../types';

const STATE_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days

// ── Keys ─────────────────────────────────────────────────────────────────────

const keys = {
  state: (gameId: string) => `game:${gameId}:state`,
  map: (gameId: string) => `game:${gameId}:map`,
  connected: (gameId: string) => `game:${gameId}:connected`,
  aiInFlight: (gameId: string) => `game:${gameId}:ai-flight`,
};

// ── Game state ────────────────────────────────────────────────────────────────

export async function setGameState(gameId: string, state: GameState): Promise<void> {
  await redis.set(keys.state(gameId), JSON.stringify(state), 'EX', STATE_TTL_SECONDS);
}

export async function getGameState(gameId: string): Promise<GameState | null> {
  const raw = await redis.get(keys.state(gameId));
  if (!raw) return null;
  return JSON.parse(raw) as GameState;
}

// ── Game map ──────────────────────────────────────────────────────────────────

export async function setGameMap(gameId: string, map: GameMap): Promise<void> {
  await redis.set(keys.map(gameId), JSON.stringify(map), 'EX', STATE_TTL_SECONDS);
}

export async function getGameMap(gameId: string): Promise<GameMap | null> {
  const raw = await redis.get(keys.map(gameId));
  if (!raw) return null;
  return JSON.parse(raw) as GameMap;
}

// ── Lifecycle ─────────────────────────────────────────────────────────────────

/**
 * Delete all Redis keys for a finished or abandoned game.
 * Call after Postgres has been updated so Redis memory stays bounded.
 */
export async function deleteGameKeys(gameId: string): Promise<void> {
  await redis.del(
    keys.state(gameId),
    keys.map(gameId),
    keys.connected(gameId),
    keys.aiInFlight(gameId),
  );
}

/**
 * Reset the TTL on state + map keys when meaningful activity occurs.
 * Prevents Redis evicting a long-running async game before it finishes.
 */
export async function refreshGameTTL(gameId: string): Promise<void> {
  await Promise.all([
    redis.expire(keys.state(gameId), STATE_TTL_SECONDS),
    redis.expire(keys.map(gameId), STATE_TTL_SECONDS),
  ]);
}

// ── Connected-player presence ─────────────────────────────────────────────────
// Phase 6 will migrate connectedSockets tracking here fully.
// These functions are built now so the API is stable.

export async function markPlayerConnected(gameId: string, playerId: string): Promise<void> {
  await redis.sadd(keys.connected(gameId), playerId);
  await redis.expire(keys.connected(gameId), STATE_TTL_SECONDS);
}

export async function markPlayerDisconnected(gameId: string, playerId: string): Promise<void> {
  await redis.srem(keys.connected(gameId), playerId);
}

export async function getConnectedPlayers(gameId: string): Promise<string[]> {
  return redis.smembers(keys.connected(gameId));
}

export async function isPlayerConnected(gameId: string, playerId: string): Promise<boolean> {
  return (await redis.sismember(keys.connected(gameId), playerId)) === 1;
}

// ── AI in-flight guard ────────────────────────────────────────────────────────
// Replaces the in-memory `aiInFlight: Set<string>` in gameSocket.ts.
// The 30-second TTL auto-expires the lock if the AI worker dies mid-turn.

/**
 * Attempt to acquire the AI in-flight lock.
 * Returns true if the lock was acquired (SET NX), false if already held.
 */
export async function acquireAiInFlight(gameId: string): Promise<boolean> {
  const result = await redis.set(keys.aiInFlight(gameId), '1', 'EX', 30, 'NX');
  return result === 'OK';
}

export async function releaseAiInFlight(gameId: string): Promise<void> {
  await redis.del(keys.aiInFlight(gameId));
}

export async function isAiInFlight(gameId: string): Promise<boolean> {
  return (await redis.exists(keys.aiInFlight(gameId))) === 1;
}
