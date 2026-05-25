import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticate } from '../../middleware/authenticate';
import { rejectGuest } from '../../middleware/rejectGuest';
import { query, queryOne } from '../../db/postgres';
import { recordActivity } from '../../services/activityService';
import { formatZodError } from '../../utils/formatZodError';

export async function shareRoutes(fastify: FastifyInstance): Promise<void> {
  // ── POST /api/share/:gameId ─────────────────────────────────────────────
  // Record that a user shared a game result
  fastify.post<{ Params: { gameId: string } }>(
    '/:gameId',
    { preHandler: [authenticate, rejectGuest] },
    async (request, reply) => {
      const { gameId } = request.params;
      const schema = z.object({
        platform: z.enum(['link', 'twitter', 'discord', 'native', 'clipboard']).default('link'),
      });
      const parsed = schema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply.status(400).send(formatZodError(parsed.error));
      }

      // Verify game exists and user participated
      const game = await queryOne<{ game_id: string; status: string; era_id: string }>(
        'SELECT game_id, status, era_id FROM games WHERE game_id = $1',
        [gameId],
      );
      if (!game) return reply.status(404).send({ error: 'Game not found' });

      const participant = await queryOne<{ user_id: string }>(
        'SELECT user_id FROM game_players WHERE game_id = $1 AND user_id = $2',
        [gameId, request.userId],
      );
      if (!participant) return reply.status(403).send({ error: 'Not a participant' });

      const shareUrl = `${request.headers.origin ?? ''}/replay/${gameId}`;

      await query(
        `INSERT INTO game_shares (game_id, user_id, platform, share_url)
         VALUES ($1, $2, $3, $4)`,
        [gameId, request.userId, parsed.data.platform, shareUrl],
      );

      await query(
        'UPDATE games SET share_count = share_count + 1 WHERE game_id = $1',
        [gameId],
      );

      // Fire activity event
      const user = await queryOne<{ username: string }>(
        'SELECT username FROM users WHERE user_id = $1',
        [request.userId],
      );
      await recordActivity(request.userId, 'game_shared', {
        game_id: gameId,
        platform: parsed.data.platform,
        era_id: game.era_id,
        username: user?.username,
      });

      return reply.send({ ok: true, share_url: shareUrl });
    },
  );

  // ── POST /api/share/:gameId/make-public ─────────────────────────────────
  // Make a game replay publicly accessible (no auth required to watch)
  fastify.post<{ Params: { gameId: string } }>(
    '/:gameId/make-public',
    { preHandler: [authenticate, rejectGuest] },
    async (request, reply) => {
      const { gameId } = request.params;

      const game = await queryOne<{ status: string }>(
        'SELECT status FROM games WHERE game_id = $1',
        [gameId],
      );
      if (!game) return reply.status(404).send({ error: 'Game not found' });
      if (game.status !== 'completed') return reply.status(409).send({ error: 'Only completed games can be shared' });

      const participant = await queryOne<{ user_id: string }>(
        'SELECT user_id FROM game_players WHERE game_id = $1 AND user_id = $2',
        [gameId, request.userId],
      );
      if (!participant) return reply.status(403).send({ error: 'Not a participant' });

      await query('UPDATE games SET is_replay_public = true WHERE game_id = $1', [gameId]);

      return reply.send({ ok: true, public_url: `/replay/${gameId}` });
    },
  );

  // ── GET /api/share/:gameId/public-replay ────────────────────────────────
  // Public replay data — no auth required. Snapshots are paginated; the legacy
  // behavior of "first 200 turns only" silently truncated long matches and
  // caused the share link to render an incomplete game. Clients can scroll
  // through the entire match by following `next_from`.
  //
  // Defaults:  from=1, limit=200
  // Caps:      limit <= 500 (to bound payload size and serialization cost)
  // Auth:      none (route is intentionally public — only enabled when the
  //            owning participant flipped `is_replay_public`)
  fastify.get<{
    Params: { gameId: string };
    Querystring: { from?: string; limit?: string };
  }>('/:gameId/public-replay', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (request, reply) => {
    const { gameId } = request.params;
    const qs = request.query ?? {};
    const fromRaw = parseInt(qs.from ?? '1', 10);
    const limitRaw = parseInt(qs.limit ?? '200', 10);
    const from = Number.isFinite(fromRaw) && fromRaw > 0 ? fromRaw : 1;
    const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(limitRaw, 500)) : 200;

    const game = await queryOne<{ game_id: string; status: string; is_replay_public: boolean; era_id: string; winner_id: string }>(
      'SELECT game_id, status, is_replay_public, era_id, winner_id FROM games WHERE game_id = $1',
      [gameId],
    );
    if (!game) return reply.status(404).send({ error: 'Game not found' });
    if (!game.is_replay_public) return reply.status(403).send({ error: 'Replay is not public' });
    if (game.status !== 'completed') return reply.status(409).send({ error: 'Game not completed' });

    const players = await query<{ user_id: string; username: string; player_color: string; is_ai: boolean }>(
      `SELECT gp.user_id, u.username, gp.player_color, gp.is_ai
       FROM game_players gp LEFT JOIN users u ON u.user_id = gp.user_id
       WHERE gp.game_id = $1 ORDER BY gp.player_index`,
      [gameId],
    );

    const totalRow = await queryOne<{ total: string; max_turn: number | null }>(
      `SELECT COUNT(*)::text AS total, MAX(turn_number) AS max_turn
       FROM game_states WHERE game_id = $1`,
      [gameId],
    );
    const totalTurns = parseInt(totalRow?.total ?? '0', 10);
    const maxTurn = totalRow?.max_turn ?? 0;

    const rows = await query<{ turn_number: number; state_json: unknown }>(
      `SELECT turn_number, state_json
       FROM game_states
       WHERE game_id = $1 AND turn_number >= $2
       ORDER BY turn_number ASC
       LIMIT $3`,
      [gameId, from, limit],
    );

    const snapshots = rows.map((row) => {
      const state = typeof row.state_json === 'string' ? JSON.parse(row.state_json) : row.state_json;
      if (state && typeof state === 'object') {
        const s = state as Record<string, unknown>;
        delete s.card_deck;
        delete s.mission_seed_salt;
        if (Array.isArray(s.players)) {
          s.players = (s.players as Array<Record<string, unknown>>).map((p) => ({
            ...p,
            secret_mission: null,
          }));
        }
      }
      return { turn_number: row.turn_number, state };
    });

    const lastReturned = snapshots.length > 0 ? snapshots[snapshots.length - 1].turn_number : from - 1;
    const hasMore = lastReturned < maxTurn;

    return reply.send({
      game_id: game.game_id,
      era_id: game.era_id,
      winner_id: game.winner_id,
      players,
      snapshots,
      pagination: {
        from,
        limit,
        returned: snapshots.length,
        total_turns: totalTurns,
        max_turn: maxTurn,
        next_from: hasMore ? lastReturned + 1 : null,
      },
    });
  });
}
