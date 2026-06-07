import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticate } from '../../middleware/authenticate';
import { rejectGuest } from '../../middleware/rejectGuest';
import { query, queryOne } from '../../db/postgres';
import { recordActivity } from '../../services/activityService';
import { formatZodError } from '../../utils/formatZodError';
import { resolveMap } from '../../sockets/mapResolver';
import { renderReplayOgPng } from './ogImage';
import { buildReplayPreviewData } from './replayOgData';

// Rendering an SVG→PNG is CPU-bound and blocks the event loop. Completed-game
// preview data is immutable, so memoize the rendered PNG per game. Bounded so a
// flood of distinct ids can't grow it without limit.
const OG_IMAGE_CACHE = new Map<string, Buffer>();
const OG_IMAGE_CACHE_MAX = 200;

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
  // Public replay data — no auth required. Snapshots are paginated by a 0-based
  // ROW offset (`from`) so pages tile the full snapshot stream without skipping
  // intra-turn frames at a page boundary. Clients follow `pagination.next_from`
  // until it's null.
  //
  // Defaults:  from=0, limit=200
  // Caps:      limit <= 500 (to bound payload size and serialization cost)
  // Auth:      none (route is intentionally public — only enabled when the
  //            owning participant flipped `is_replay_public`)
  fastify.get<{
    Params: { gameId: string };
    Querystring: { from?: string; limit?: string };
  }>('/:gameId/public-replay', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (request, reply) => {
    const { gameId } = request.params;
    const qs = request.query ?? {};
    const fromRaw = parseInt(qs.from ?? '0', 10);
    const limitRaw = parseInt(qs.limit ?? '200', 10);
    const from = Number.isFinite(fromRaw) && fromRaw > 0 ? fromRaw : 0;
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
       WHERE game_id = $1
       ORDER BY turn_number ASC, saved_at ASC
       OFFSET $2 LIMIT $3`,
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

    // Offset cursor: more rows remain when we haven't yet returned all of them.
    const nextOffset = from + rows.length;
    const hasMore = nextOffset < totalTurns;

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
        next_from: hasMore ? nextOffset : null,
      },
    });
  });

  // ── GET /api/share/:gameId/public-map ───────────────────────────────────
  // Map geometry for a public replay — no auth required. The public viewer
  // needs polygons/connections that aren't in the per-turn snapshots, and the
  // authed GET /api/maps/:mapId route is gated. We resolve the map id from the
  // game's own snapshots (never trusting the client) so this can't be abused
  // to fetch arbitrary private community maps.
  fastify.get<{ Params: { gameId: string } }>(
    '/:gameId/public-map',
    { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const { gameId } = request.params;

      const game = await queryOne<{ is_replay_public: boolean }>(
        'SELECT is_replay_public FROM games WHERE game_id = $1',
        [gameId],
      );
      if (!game) return reply.status(404).send({ error: 'Game not found' });
      if (!game.is_replay_public) return reply.status(403).send({ error: 'Replay is not public' });

      const mapRow = await queryOne<{ map_id: string | null }>(
        `SELECT state_json->>'map_id' AS map_id
         FROM game_states WHERE game_id = $1
         ORDER BY turn_number ASC, saved_at ASC LIMIT 1`,
        [gameId],
      );
      const mapId = mapRow?.map_id;
      if (!mapId) return reply.status(404).send({ error: 'Map not found for this replay' });

      const map = await resolveMap(mapId);
      if (!map) return reply.status(404).send({ error: 'Map not found' });

      return reply.send({ map });
    },
  );

  // ── GET /api/share/:gameId/og-image.png ─────────────────────────────────
  // Dynamic Open Graph preview image for social/chat link unfurls. Public and
  // cacheable; only renders for completed games. Shows non-sensitive aggregate
  // info (winner, era, turns, player colors).
  fastify.get<{ Params: { gameId: string } }>(
    '/:gameId/og-image.png',
    { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const { gameId } = request.params;

      const cached = OG_IMAGE_CACHE.get(gameId);
      if (cached) {
        return reply
          .header('Content-Type', 'image/png')
          .header('Cache-Control', 'public, max-age=86400, immutable')
          .send(cached);
      }

      const opts = await buildReplayPreviewData(gameId);
      // Only completed AND publicly-shared replays get a per-replay preview, so
      // a known gameId can't leak the winner/players of an un-shared game.
      if (!opts || !opts.isPublic) return reply.status(404).send({ error: 'Replay preview not available' });

      try {
        const png = renderReplayOgPng(opts);
        if (OG_IMAGE_CACHE.size >= OG_IMAGE_CACHE_MAX) {
          OG_IMAGE_CACHE.delete(OG_IMAGE_CACHE.keys().next().value as string);
        }
        OG_IMAGE_CACHE.set(gameId, png);
        return reply
          .header('Content-Type', 'image/png')
          .header('Cache-Control', 'public, max-age=86400, immutable')
          .send(png);
      } catch (err) {
        request.log.error({ err }, 'OG image render failed');
        return reply.status(500).send({ error: 'Failed to render preview' });
      }
    },
  );

  // ── POST /api/share/:gameId/make-private ────────────────────────────────
  // Revoke public access to a replay (inverse of make-public). Only a
  // participant can do this.
  fastify.post<{ Params: { gameId: string } }>(
    '/:gameId/make-private',
    { preHandler: [authenticate, rejectGuest] },
    async (request, reply) => {
      const { gameId } = request.params;

      const game = await queryOne<{ status: string }>(
        'SELECT status FROM games WHERE game_id = $1',
        [gameId],
      );
      if (!game) return reply.status(404).send({ error: 'Game not found' });

      const participant = await queryOne<{ user_id: string }>(
        'SELECT user_id FROM game_players WHERE game_id = $1 AND user_id = $2',
        [gameId, request.userId],
      );
      if (!participant) return reply.status(403).send({ error: 'Not a participant' });

      await query('UPDATE games SET is_replay_public = false WHERE game_id = $1', [gameId]);

      return reply.send({ ok: true });
    },
  );
}
