import type { Server } from 'socket.io';
import type { GameState } from '../types';

/**
 * Delayed spectator broadcasting.
 *
 * Spectators see the game on a fixed delay (anti stream-sniping: a player must
 * not be able to open a second tab and scout the live board). Two feeds run
 * through the same delay so what spectators SEE and what they're TOLD stay in
 * sync:
 *
 *  - STATE: every `broadcastState` records a redacted snapshot into a ring
 *    buffer; a per-game loop emits the newest snapshot older than the delay.
 *  - EVENTS: overlay events (event cards, strike animations, map visuals,
 *    naval results, game over) are queued with a timestamp and drained by the
 *    same loop once they age past the delay. Emitting these live while the
 *    board lags 30s behind made animations fire on territories the spectator
 *    board hadn't caught up to — and leaked real-time intel past the delay.
 *
 * NOTE (scale-out): buffers, loops, and the spectator socket registry are all
 * per-process. With multiple Socket.io instances behind the Redis adapter, a
 * spectator served by a node that isn't processing the game's actions would
 * get a frozen buffer. Revisit before enabling multi-instance (see
 * SCALE-OUT-RUNBOOK.md).
 */

export const SPECTATOR_DELAY_MS = 30_000;
export const SPECTATOR_BROADCAST_MS = 3_000;
const SPECTATOR_STATE_BUFFER_LIMIT = 24;
const SPECTATOR_EVENT_BUFFER_LIMIT = 200;
// A due event older than this has "missed its window" (queued while no
// spectator loop was running). It predates the snapshot a joining spectator
// starts from, so it is dropped instead of burst-emitted at them.
const SPECTATOR_EVENT_GRACE_MS = SPECTATOR_BROADCAST_MS * 2;

interface SpectatorStateEntry {
  timestamp: number;
  seq: number;
  state: GameState;
}

interface SpectatorEventEntry {
  timestamp: number;
  event: string;
  payload: unknown;
}

const spectatorSocketsByGame = new Map<string, Set<string>>();
const stateBuffers = new Map<string, SpectatorStateEntry[]>();
const seqCounters = new Map<string, number>();
const eventBuffers = new Map<string, SpectatorEventEntry[]>();
const broadcastLoops = new Map<string, ReturnType<typeof setInterval>>();
const lastEmittedSeq = new Map<string, number>();

function spectatorRoom(gameId: string): string {
  return `${gameId}:spectators`;
}

/**
 * Register a spectator socket. Returns true only when the socket was not
 * already tracked — callers use this to keep the persistent
 * `games.spectator_count` accounting idempotent (a duplicate `spectate_join`
 * from the same socket must not double-increment).
 */
export function trackSpectator(gameId: string, socketId: string): boolean {
  let spectators = spectatorSocketsByGame.get(gameId);
  if (!spectators) {
    spectators = new Set();
    spectatorSocketsByGame.set(gameId, spectators);
  }
  if (spectators.has(socketId)) return false;
  spectators.add(socketId);
  return true;
}

/**
 * Remove a spectator socket. Returns true only when the socket was actually
 * tracked — a stray `spectate_leave` (e.g. one buffered by the client across
 * a reconnect) must not decrement the persistent count.
 */
export function untrackSpectator(gameId: string, socketId: string): boolean {
  const spectators = spectatorSocketsByGame.get(gameId);
  if (!spectators?.delete(socketId)) return false;
  if (spectators.size === 0) {
    spectatorSocketsByGame.delete(gameId);
    stopSpectatorBroadcastLoop(gameId);
  }
  return true;
}

export function hasSpectators(gameId: string): boolean {
  return (spectatorSocketsByGame.get(gameId)?.size ?? 0) > 0;
}

/**
 * Record an already-redacted state snapshot into the delay buffer. The
 * snapshot is deep-cloned: the engine mutates state objects in place, and a
 * buffered reference would otherwise "time travel" to the live board.
 */
export function pushSpectatorState(gameId: string, snapshot: GameState): void {
  const seq = (seqCounters.get(gameId) ?? 0) + 1;
  seqCounters.set(gameId, seq);
  const buffer = stateBuffers.get(gameId) ?? [];
  buffer.push({
    timestamp: Date.now(),
    seq,
    state: JSON.parse(JSON.stringify(snapshot)) as GameState,
  });
  while (buffer.length > SPECTATOR_STATE_BUFFER_LIMIT) {
    buffer.shift();
  }
  stateBuffers.set(gameId, buffer);
}

export function getDelayedSpectatorState(
  gameId: string,
): { state: GameState; seq: number } | null {
  const buffer = stateBuffers.get(gameId);
  if (!buffer || buffer.length === 0) return null;

  const cutoff = Date.now() - SPECTATOR_DELAY_MS;
  for (let index = buffer.length - 1; index >= 0; index -= 1) {
    if (buffer[index].timestamp <= cutoff) {
      return { state: buffer[index].state, seq: buffer[index].seq };
    }
  }

  return { state: buffer[0].state, seq: buffer[0].seq };
}

/**
 * Queue an overlay event for delayed delivery to the spectator room. Safe to
 * call for games nobody is watching — entries expire unemitted.
 */
export function queueSpectatorEvent(gameId: string, event: string, payload: unknown): void {
  const buffer = eventBuffers.get(gameId) ?? [];
  buffer.push({ timestamp: Date.now(), event, payload });
  while (buffer.length > SPECTATOR_EVENT_BUFFER_LIMIT) {
    buffer.shift();
  }
  eventBuffers.set(gameId, buffer);
}

function drainDueSpectatorEvents(io: Server, gameId: string): void {
  const buffer = eventBuffers.get(gameId);
  if (!buffer || buffer.length === 0) return;

  const cutoff = Date.now() - SPECTATOR_DELAY_MS;
  while (buffer.length > 0 && buffer[0].timestamp <= cutoff) {
    const entry = buffer.shift()!;
    // Long-overdue entries were queued while no loop was running; they predate
    // any watching spectator's starting snapshot, so drop rather than emit.
    if (entry.timestamp > cutoff - SPECTATOR_EVENT_GRACE_MS) {
      io.to(spectatorRoom(gameId)).emit(entry.event, entry.payload);
    }
  }
}

export function ensureSpectatorBroadcastLoop(io: Server, gameId: string): void {
  if (broadcastLoops.has(gameId)) return;

  const timer = setInterval(() => {
    if (!hasSpectators(gameId)) {
      stopSpectatorBroadcastLoop(gameId);
      return;
    }

    const entry = getDelayedSpectatorState(gameId);
    // Skip re-emitting a snapshot the room already has — an unchanged
    // broadcast every tick forced a full client re-render (and, before the
    // client-side fix, a map re-fetch) every 3 seconds.
    if (entry && lastEmittedSeq.get(gameId) !== entry.seq) {
      lastEmittedSeq.set(gameId, entry.seq);
      io.to(spectatorRoom(gameId)).emit('game:state', { ...entry.state, _spectator_seq: entry.seq });
    }

    drainDueSpectatorEvents(io, gameId);
  }, SPECTATOR_BROADCAST_MS);
  timer.unref();
  broadcastLoops.set(gameId, timer);
}

export function stopSpectatorBroadcastLoop(gameId: string): void {
  const timer = broadcastLoops.get(gameId);
  if (timer) {
    clearInterval(timer);
    broadcastLoops.delete(gameId);
  }
}

/**
 * Drop a game's buffered snapshots/events (room eviction, tests). Spectator
 * socket tracking and any running loop are left alone — they resolve
 * themselves as sockets leave.
 */
export function clearSpectatorGame(gameId: string): void {
  stateBuffers.delete(gameId);
  seqCounters.delete(gameId);
  eventBuffers.delete(gameId);
  lastEmittedSeq.delete(gameId);
}

/** Test-only: reset all module state, including tracking and loops. */
export function resetSpectatorBroadcastForTests(): void {
  for (const gameId of Array.from(broadcastLoops.keys())) {
    stopSpectatorBroadcastLoop(gameId);
  }
  spectatorSocketsByGame.clear();
  stateBuffers.clear();
  seqCounters.clear();
  eventBuffers.clear();
  lastEmittedSeq.clear();
}
