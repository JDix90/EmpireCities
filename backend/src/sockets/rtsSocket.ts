import type { Server, Socket } from 'socket.io';
import { z } from 'zod';
import type { RtsCommand } from '@erasofempire/rts-shared';
import { verifyAccessToken } from '../utils/jwt.js';
import { runRtsCommand, ensureRtsRoom } from '../rts/rtsService';
import { query, queryOne } from '../db/postgres';
import { rateLimit } from '../utils/socketLimiter';

/**
 * Token-bucket configuration for `rts:command`. The RTS reducer is cheap but
 * a malicious client could still spam it to wash through the dedupe set or
 * nudge the income tick boundary. 30 commands/second is a generous ceiling
 * for legitimate RTS play (humans don't out-click DOTA pros) and well below
 * what a single Node.js process can handle without sweating.
 */
const RTS_COMMAND_RATE = { max: 30, windowMs: 1000 } as const;

/**
 * Per-socket cache of validated game memberships. Set on `rts:join` after
 * the SQL membership check passes; consulted on every `rts:command` to skip
 * the DB lookup that previously fired on every command (a 30 cmd/s player
 * was sustaining 30 round-trips/s). The set is automatically dropped when
 * the socket disconnects because it lives on `socket.data`.
 */
type RtsSocketData = {
  userId: string;
  rtsGames?: Set<string>;
};

const RtsCommandSchema: z.ZodType<RtsCommand> = z.discriminatedUnion('type', [
  z.object({ type: z.literal('startPicking') }),
  z.object({ type: z.literal('pickStart'), territoryId: z.string() }),
  z.object({
    type: z.literal('moveUnit'),
    unitId: z.string(),
    toTerritoryId: z.string(),
    toNodeId: z.string(),
  }),
  z.object({ type: z.literal('resolveClaim'), claim: z.boolean() }),
  z.object({ type: z.literal('buyUnit') }),
  z.object({ type: z.literal('buildMarket'), territoryId: z.string() }),
  z.object({ type: z.literal('assignWork'), unitId: z.string(), marketTerritoryId: z.string() }),
  z.object({ type: z.literal('unassignWork'), unitId: z.string() }),
]);

/**
 * /rts namespace — separate from classic game socket; same JWT auth.
 */
export function initRtsSocketNamespace(io: Server): void {
  const nsp = io.of('/rts');
  nsp.use((socket, next) => {
    const token = socket.handshake.auth?.token as string | undefined;
    if (!token) return next(new Error('Authentication required'));
    const payload = verifyAccessToken(token);
    if (!payload) return next(new Error('Invalid or expired token'));
    (socket as Socket & { userId: string }).userId = payload.sub;
    socket.data.userId = payload.sub;
    next();
  });

  nsp.on('connection', (socket) => {
    const userId = (socket as Socket & { userId: string }).userId;

    socket.on('rts:join', async (payload: { gameId?: string }, ack?: (r: unknown) => void) => {
      const gameId = payload?.gameId;
      if (!gameId) {
        ack?.({ error: 'gameId required' });
        return;
      }
      const g = await queryOne<{ game_mode: string; status: string }>(
        'SELECT game_mode, status FROM games WHERE game_id = $1',
        [gameId],
      );
      if (!g || g.game_mode !== 'rts') {
        ack?.({ error: 'Not an RTS game' });
        return;
      }
      const member = await queryOne(
        'SELECT 1 FROM game_players WHERE game_id = $1 AND user_id = $2',
        [gameId, userId],
      );
      if (!member) {
        ack?.({ error: 'Not in this game' });
        return;
      }
      // Cache membership: every subsequent rts:command for this game can
      // skip the DB round-trip and rely on this set instead.
      const data = socket.data as RtsSocketData;
      if (!data.rtsGames) data.rtsGames = new Set();
      data.rtsGames.add(gameId);
      await socket.join(gameId);
      try {
        const room = await ensureRtsRoom(gameId);
        if (g.status === 'waiting' && room.state.phase !== 'lobby') {
          /* state may have been started by another */
        }
        nsp.to(gameId).emit('rts:state', { gameId, state: room.state });
        ack?.({ ok: true, state: room.state });
      } catch (e) {
        console.error('[rts] join', e);
        ack?.({ error: 'Failed to load' });
      }
    });

    socket.on('rts:command', async (raw: { gameId?: string; command?: unknown; actionId?: string }, ack?: (r: unknown) => void) => {
      const gameId = raw?.gameId;
      if (!gameId) {
        ack?.({ error: 'gameId required' });
        return;
      }

      // Per-(user, game) rate limit. Exceeding the bucket fails fast without
      // touching Postgres, so a flood actor can't DDoS the DB layer.
      const allowed = await rateLimit(`rts:cmd:${userId}:${gameId}`, RTS_COMMAND_RATE);
      if (!allowed) {
        ack?.({ error: 'Rate limit exceeded' });
        return;
      }

      const parsed = RtsCommandSchema.safeParse(raw?.command);
      if (!parsed.success) {
        ack?.({ error: 'Invalid command' });
        return;
      }

      // Membership: prefer the in-memory cache populated at rts:join. Fall
      // back to a DB lookup (and cache the result) if the cache is cold —
      // covers reconnect paths where the client jumped straight into
      // commanding without re-joining first.
      const data = socket.data as RtsSocketData;
      if (!data.rtsGames?.has(gameId)) {
        const member = await queryOne(
          'SELECT 1 FROM game_players WHERE game_id = $1 AND user_id = $2',
          [gameId, userId],
        );
        if (!member) {
          ack?.({ error: 'Not in this game' });
          return;
        }
        if (!data.rtsGames) data.rtsGames = new Set();
        data.rtsGames.add(gameId);
      }

      try {
        if (raw.command && typeof raw.command === 'object' && (raw.command as { type?: string }).type === 'startPicking') {
          const host = await queryOne(
            "SELECT 1 FROM game_players WHERE game_id = $1 AND user_id = $2 AND player_index = 0",
            [gameId, userId],
          );
          if (!host) {
            ack?.({ error: 'Only host can start' });
            return;
          }
          await query("UPDATE games SET status = 'in_progress', started_at = COALESCE(started_at, NOW()) WHERE game_id = $1", [
            gameId,
          ]);
        }
        const r = await runRtsCommand(gameId, userId, parsed.data, raw.actionId);
        if (!r.ok) {
          ack?.({ error: r.error });
          return;
        }
        // TODO(rts-fork): apply per-player visibility filtering before
        // broadcasting state. Today the entire RtsGameState (including
        // hidden enemy units / pending orders) is broadcast to every
        // participant, which leaks fog-of-war information. Tracked under
        // the L7 follow-up — deferred to the RTS lead per QA review 2026-04.
        nsp.to(gameId).emit('rts:state', { gameId, state: r.state });
        ack?.({ ok: true, state: r.state });
      } catch (e) {
        console.error('[rts] command', e);
        ack?.({ error: 'Command failed' });
      }
    });

    socket.on('disconnect', () => {
      void userId;
    });
  });
}
