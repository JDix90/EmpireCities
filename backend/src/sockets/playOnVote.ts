/**
 * Play on after a win (`play_on_enabled`): the vote, and the game it starts.
 * The rules are game-engine/victory/playOn.ts.
 *
 * As a game ends, `finalizeGame` asks `offerPlayOn` whether it can be played
 * on; when it can, the offer is kept in Redis (`play_on:<gameId>`) and named
 * in `game:over` so the winner's Victory screen can ask. The table answers
 * there, in the finished game's room, which outlives its board:
 *
 *   client → `game:play_on_propose { gameId }`       a winner asks, once
 *   client → `game:play_on_vote { gameId, yes }`     each human still in answers
 *   room   ← `game:play_on`        the vote as it stands (who has said yes)
 *   room   ← `game:play_on_result` accepted (with the new game's id), declined,
 *                                  expired, or failed
 *   socket ← `game:play_on_refused` why this ask or answer was not taken
 *
 * Every change to the record happens under the finished game's lock, so two
 * answers arriving together are counted one after the other, and the game is
 * started once. A vote nobody finishes fails at its time, by a timer here or,
 * after a restart, at the next answer.
 *
 * On a unanimous yes the continuation starts as a new game (a new games row,
 * the same seats) from the final board: the finished game's record, and the
 * win in it, are never touched.
 */
import type { Server, Socket } from 'socket.io';
import { randomUUID } from 'crypto';
import { redis } from '../db/redis';
import { pgPool, queryOne } from '../db/postgres';
import { featureFlags } from '../config/featureFlags';
import { recordServerEvent } from '../services/analyticsEvents';
import type { GameMap, GameState } from '../types';
import {
  castPlayOnVote,
  openPlayOnVote,
  playOnOffer,
  playOnState,
  playOnVoteOutcome,
  PLAY_ON_OFFER_MS,
  PLAY_ON_VOTE_MS,
  type PlayOnOffer,
  type PlayOnOutcome,
  type PlayOnVote,
} from '../game-engine/victory/playOn';
import { runWithGameLock } from './gameLock';
import { getGameMap, getGameState } from './redisGameStore';
import {
  flushGameState,
  getCachedRoom,
  mapIdForSavedState,
  saveGameMapAuthoritative,
  setCachedRoom,
} from './gameRoomManager';
import { resolveMap } from './mapResolver';

const recordKey = (gameId: string) => `play_on:${gameId}`;
/** Long enough to outlast the offer and its vote, and short enough to clean itself up. */
const RECORD_TTL_SECONDS = Math.ceil((PLAY_ON_OFFER_MS + PLAY_ON_VOTE_MS) / 1000) + 600;

type PlayOnResult = { outcome: PlayOnOutcome | 'failed'; new_game_id?: string };

interface PlayOnRecord {
  offer: PlayOnOffer;
  /** Name and colour of each seat still in, for the vote card. */
  seats: Record<string, { username: string; color: string }>;
  vote?: PlayOnVote;
  result?: PlayOnResult;
}

/** What `game:over` tells the table about the offer. */
export interface PlayOnOfferPayload {
  proposer_ids: string[];
  human_ids: string[];
  bot_count: number;
  expires_in_ms: number;
}

/** What the game started from a vote needs from the socket layer. */
export interface PlayOnStartDeps {
  /** Run the opening turn: the bot's, or the human's clock. */
  beginTurn: (io: Server, gameId: string, state: GameState, map: GameMap) => void;
}

async function readRecord(gameId: string): Promise<PlayOnRecord | null> {
  const raw = await redis.get(recordKey(gameId));
  return raw ? (JSON.parse(raw) as PlayOnRecord) : null;
}

async function writeRecord(gameId: string, record: PlayOnRecord): Promise<void> {
  await redis.set(recordKey(gameId), JSON.stringify(record), 'EX', RECORD_TTL_SECONDS);
}

/**
 * Called by `finalizeGame` as a game ends, with the flag on: keep the offer
 * this game makes, if any, and return what `game:over` says about it.
 */
export async function offerPlayOn(
  gameId: string,
  state: GameState,
  creditedIds: readonly string[],
): Promise<PlayOnOfferPayload | null> {
  // The pure check first: most games never get as far as the query.
  if (!playOnOffer(state, creditedIds, { isRanked: false, now: Date.now() })) return null;
  const row = await queryOne<{ is_ranked: boolean }>(
    'SELECT COALESCE(is_ranked, false) AS is_ranked FROM games WHERE game_id = $1',
    [gameId],
  );
  const offer = playOnOffer(state, creditedIds, { isRanked: row?.is_ranked ?? true, now: Date.now() });
  if (!offer) return null;
  const seats: PlayOnRecord['seats'] = {};
  for (const p of state.players) {
    if (!p.is_eliminated) seats[p.player_id] = { username: p.username, color: p.color };
  }
  await writeRecord(gameId, { offer, seats });
  return offerPayload(offer, Date.now());
}

function offerPayload(offer: PlayOnOffer, now: number): PlayOnOfferPayload {
  return {
    proposer_ids: offer.proposer_ids,
    human_ids: offer.human_ids,
    bot_count: offer.bot_ids.length,
    expires_in_ms: Math.max(0, offer.expires_at - now),
  };
}

function votePayload(gameId: string, record: PlayOnRecord, vote: PlayOnVote, now: number) {
  const seat = (id: string) => record.seats[id] ?? { username: 'Player', color: '#888888' };
  return {
    gameId,
    proposer_id: vote.proposer_id,
    proposer_name: seat(vote.proposer_id).username,
    voters: Object.entries(vote.votes).map(([player_id, answer]) => ({
      player_id,
      username: seat(player_id).username,
      color: seat(player_id).color,
      vote: answer,
    })),
    bot_count: vote.bot_ids.length,
    expires_in_ms: Math.max(0, vote.expires_at - now),
  };
}

const expiryTimers = new Map<string, NodeJS.Timeout>();

function clearExpiryTimer(gameId: string): void {
  const t = expiryTimers.get(gameId);
  if (t) clearTimeout(t);
  expiryTimers.delete(gameId);
}

/** Settle a vote and tell the table. The caller holds the lock and writes the record after. */
function settle(io: Server, gameId: string, record: PlayOnRecord, result: PlayOnResult): void {
  record.result = result;
  clearExpiryTimer(gameId);
  io.to(gameId).emit('game:play_on_result', { gameId, ...result });
  const vote = record.vote;
  recordServerEvent('play_on_result', {
    game_id: gameId,
    outcome: result.outcome,
    new_game_id: result.new_game_id ?? null,
    human_voters: vote ? Object.keys(vote.votes).length : 0,
    bot_count: vote?.bot_ids.length ?? record.offer.bot_ids.length,
  }, vote?.proposer_id ?? null);
}

function refuse(socket: Socket, gameId: string, message: string): void {
  socket.emit('game:play_on_refused', { gameId, message });
}

/**
 * The final board of a finished game: this instance's room while it is still
 * cached, then Redis until the room is evicted, then the last saved snapshot
 * and its map.
 */
async function loadFinalBoard(gameId: string): Promise<{ state: GameState; map: GameMap } | null> {
  const cached = getCachedRoom(gameId);
  if (cached?.state.phase === 'game_over') return { state: cached.state, map: cached.map };
  const [state, map] = await Promise.all([getGameState(gameId), getGameMap(gameId)]);
  if (state?.phase === 'game_over' && map) return { state, map };
  const saved = await queryOne<{ state_json: GameState; map_id: string }>(
    `SELECT gs.state_json, g.map_id
     FROM game_states gs JOIN games g ON g.game_id = gs.game_id
     WHERE gs.game_id = $1
     ORDER BY gs.turn_number DESC, gs.saved_at DESC LIMIT 1`,
    [gameId],
  );
  if (!saved || saved.state_json.phase !== 'game_over') return null;
  const savedMap = await resolveMap(mapIdForSavedState(saved.state_json, saved.map_id));
  return savedMap ? { state: saved.state_json, map: savedMap } : null;
}

/**
 * Start the continuation: a new game with the finished game's seats, from its
 * final board. Returns the new game's id, or null when the board could not be
 * found.
 */
async function startPlayOnGame(io: Server, oldGameId: string, deps: PlayOnStartDeps): Promise<string | null> {
  const board = await loadFinalBoard(oldGameId);
  if (!board) return null;
  const old = await queryOne<{
    map_id: string; era_id: string; settings_json: Record<string, unknown>;
    game_type: string; game_mode: string; is_private: boolean;
  }>(
    'SELECT map_id, era_id, settings_json, game_type, game_mode, is_private FROM games WHERE game_id = $1',
    [oldGameId],
  );
  if (!old) return null;

  const newGameId = randomUUID();
  const state = playOnState(board.state, newGameId, Date.now());
  const settingsJson: Record<string, unknown> = {
    ...old.settings_json,
    victory_type: 'domination',
    allowed_victory_conditions: ['domination'],
    max_turns: null,
    play_on_of: oldGameId,
  };
  delete settingsJson.victory_threshold;

  const client = await pgPool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO games (game_id, map_id, era_id, status, victory_type, settings_json, current_turn,
                          game_type, game_mode, is_private, is_ranked, async_mode, started_at)
       VALUES ($1, $2, $3, 'in_progress', 'domination', $4::jsonb, $5, $6, $7, $8, false, false, NOW())`,
      [newGameId, old.map_id, old.era_id, JSON.stringify(settingsJson), state.turn_number,
        old.game_type, old.game_mode, old.is_private],
    );
    await client.query(
      `INSERT INTO game_players (game_id, user_id, player_index, player_color, is_ai, ai_difficulty, is_eliminated, faction_id)
       SELECT $1, user_id, player_index, player_color, is_ai, ai_difficulty, is_eliminated, faction_id
       FROM game_players WHERE game_id = $2`,
      [newGameId, oldGameId],
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }

  setCachedRoom(newGameId, state, board.map);
  await saveGameMapAuthoritative(newGameId, board.map);
  await flushGameState(newGameId, state);
  deps.beginTurn(io, newGameId, state, board.map);

  const humans = state.players.filter((p) => !p.is_ai);
  for (const human of humans) {
    recordServerEvent('play_on_started', {
      game_id: newGameId,
      play_on_of: oldGameId,
      won_with: state.play_on?.won_with ?? null,
      turn_count: state.turn_number,
      human_count: humans.length,
      ai_count: state.players.length - humans.length,
    }, human.player_id);
  }
  return newGameId;
}

/** Carry a vote that every human has said yes to: start the game, then tell the table. */
async function carry(io: Server, gameId: string, record: PlayOnRecord, deps: PlayOnStartDeps): Promise<void> {
  let newGameId: string | null = null;
  try {
    newGameId = await startPlayOnGame(io, gameId, deps);
  } catch (err) {
    console.error('[PlayOn] Failed to start the continuation of', gameId, err);
  }
  settle(io, gameId, record, newGameId ? { outcome: 'accepted', new_game_id: newGameId } : { outcome: 'failed' });
}

function armExpiry(io: Server, gameId: string, expiresInMs: number): void {
  clearExpiryTimer(gameId);
  const timer = setTimeout(() => {
    expiryTimers.delete(gameId);
    void runWithGameLock(gameId, async () => {
      const record = await readRecord(gameId);
      if (!record?.vote || record.result) return;
      if (playOnVoteOutcome(record.vote, Date.now()) !== 'expired') return;
      settle(io, gameId, record, { outcome: 'expired' });
      await writeRecord(gameId, record);
    }).catch((err) => console.error('[PlayOn] Expiry check failed for', gameId, err));
  }, expiresInMs + 250);
  timer.unref();
  expiryTimers.set(gameId, timer);
}

/** The ask and the answers. Registered once per connected socket. */
export function registerPlayOnHandlers(io: Server, socket: Socket, userId: string, deps: PlayOnStartDeps): void {
  socket.on('game:play_on_propose', async (payload: { gameId?: unknown } | undefined) => {
    const gameId = typeof payload?.gameId === 'string' ? payload.gameId : null;
    if (!gameId) return;
    if (!featureFlags.playOnEnabled) return refuse(socket, gameId, 'Playing on isn’t available right now.');
    try {
      await runWithGameLock(gameId, async () => {
        const record = await readRecord(gameId);
        if (!record) return refuse(socket, gameId, 'This game can no longer be played on.');
        if (record.vote || record.result) return refuse(socket, gameId, 'The table has already been asked.');
        const now = Date.now();
        const opened = openPlayOnVote(record.offer, userId, now);
        if (!opened.ok) {
          return refuse(socket, gameId, opened.reason === 'too_late'
            ? 'It’s too late to ask: the offer to play on has run out.'
            : 'Only the winner can ask to play on.');
        }
        record.vote = opened.vote;
        recordServerEvent('play_on_proposed', {
          game_id: gameId,
          human_voters: Object.keys(opened.vote.votes).length,
          bot_count: opened.vote.bot_ids.length,
        }, userId);
        if (playOnVoteOutcome(opened.vote, now) === 'accepted') {
          // Nobody to ask: bots always say yes.
          await carry(io, gameId, record, deps);
        } else {
          io.to(gameId).emit('game:play_on', votePayload(gameId, record, opened.vote, now));
          armExpiry(io, gameId, opened.vote.expires_at - now);
        }
        await writeRecord(gameId, record);
      }, 15_000);
    } catch (err) {
      console.error('[PlayOn] Propose failed for', gameId, err);
      refuse(socket, gameId, 'Something went wrong asking the table. Please try again.');
    }
  });

  socket.on('game:play_on_vote', async (payload: { gameId?: unknown; yes?: unknown } | undefined) => {
    const gameId = typeof payload?.gameId === 'string' ? payload.gameId : null;
    if (!gameId || typeof payload?.yes !== 'boolean') return;
    const yes = payload.yes;
    try {
      await runWithGameLock(gameId, async () => {
        const record = await readRecord(gameId);
        const vote = record?.vote;
        if (!record || !vote) return refuse(socket, gameId, 'There is no vote to answer.');
        if (record.result) return refuse(socket, gameId, 'The vote is already over.');
        const now = Date.now();
        if (!castPlayOnVote(vote, userId, yes, now)) {
          if (playOnVoteOutcome(vote, now) === 'expired') {
            settle(io, gameId, record, { outcome: 'expired' });
            await writeRecord(gameId, record);
          }
          return;
        }
        const outcome = playOnVoteOutcome(vote, now);
        if (outcome === 'pending') {
          io.to(gameId).emit('game:play_on', votePayload(gameId, record, vote, now));
        } else if (outcome === 'accepted') {
          await carry(io, gameId, record, deps);
        } else {
          settle(io, gameId, record, { outcome });
        }
        await writeRecord(gameId, record);
      }, 15_000);
    } catch (err) {
      console.error('[PlayOn] Vote failed for', gameId, err);
      refuse(socket, gameId, 'Your answer didn’t go through. Please try again.');
    }
  });
}

/** Test hook: forget every pending expiry timer. */
export function clearPlayOnTimersForTests(): void {
  for (const id of [...expiryTimers.keys()]) clearExpiryTimer(id);
}
