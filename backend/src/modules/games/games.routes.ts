import type { FastifyInstance } from 'fastify';
import { v4 as uuidv4, validate as uuidValidate } from 'uuid';
import { z } from 'zod';
import { authenticate } from '../../middleware/authenticate';
import { rejectGuest } from '../../middleware/rejectGuest';
import { query, queryOne } from '../../db/postgres';
import { generateJoinCode, normalizeJoinInput } from '../../utils/joinCode';
import { getGameIo } from '../../sockets/gameSocket';

/** Optional body for POST /tutorial/start — default matches lobby quick-start (small tutorial map). */
const TutorialStartSchema = z.object({
  era: z.enum(['ancient', 'ww2']).optional(),
});

const CreateGameSchema = z.object({
  era_id: z.enum(['ancient', 'medieval', 'discovery', 'ww2', 'coldwar', 'modern', 'acw', 'risorgimento', 'custom']),
  map_id: z.string().min(1).max(128),
  max_players: z.number().int().min(2).max(8),
  settings: z.object({
    fog_of_war: z.boolean().default(false),
    victory_type: z.enum(['domination', 'secret_mission', 'capital', 'threshold']).default('domination'),
    victory_threshold: z.number().optional(),
    turn_timer_seconds: z.number().int().min(0).default(300),
    initial_unit_count: z.number().int().min(1).max(10).default(3),
    card_set_escalating: z.boolean().default(true),
    diplomacy_enabled: z.boolean().default(true),
  }),
  ai_count: z.number().int().min(0).max(7).default(0),
  ai_difficulty: z.enum(['easy', 'medium', 'hard', 'expert']).default('medium'),
});

export async function gamesRoutes(fastify: FastifyInstance): Promise<void> {
  // ── POST /api/games ──────────────────────────────────────────────────────
  fastify.post('/', { preHandler: authenticate }, async (request, reply) => {
    const body = CreateGameSchema.safeParse(request.body);
    if (!body.success) {
      return reply.status(400).send({ error: 'Invalid input', details: body.error.flatten() });
    }
    const { era_id, map_id, max_players, settings, ai_count, ai_difficulty } = body.data;

    const gameId = uuidv4();
    const colors = ['#e74c3c', '#3498db', '#2ecc71', '#f39c12', '#9b59b6', '#1abc9c', '#e67e22', '#ecf0f1'];

    const totalPlayers = 1 + ai_count;
    const gameType = ai_count === 0 ? 'multiplayer' : ai_count >= totalPlayers - 1 ? 'solo' : 'hybrid';

    let gameInsertOk = false;
    for (let attempt = 0; attempt < 15; attempt++) {
      const joinCode = generateJoinCode();
      try {
        await query(
          `INSERT INTO games (game_id, map_id, era_id, status, settings_json, game_type, join_code)
           VALUES ($1, $2, $3, 'waiting', $4, $5, $6)`,
          [gameId, map_id, era_id, JSON.stringify({ ...settings, max_players }), gameType, joinCode],
        );
        gameInsertOk = true;
        break;
      } catch (e: unknown) {
        const pgCode = typeof e === 'object' && e !== null && 'code' in e ? (e as { code: string }).code : '';
        if (pgCode === '23505') continue;
        throw e;
      }
    }
    if (!gameInsertOk) {
      return reply.status(503).send({ error: 'Could not allocate a join code; try again.' });
    }

    // Add the host as player 0
    await query(
      `INSERT INTO game_players (game_id, user_id, player_index, player_color, is_ai)
       VALUES ($1, $2, 0, $3, false)`,
      [gameId, request.userId, colors[0]]
    );

    // Add AI bots
    for (let i = 0; i < ai_count; i++) {
      await query(
        `INSERT INTO game_players (game_id, user_id, player_index, player_color, is_ai, ai_difficulty)
         VALUES ($1, NULL, $2, $3, true, $4)`,
        [gameId, i + 1, colors[i + 1], ai_difficulty]
      );
    }

    return reply.status(201).send({ game_id: gameId, era_id, map_id, settings, game_type: gameType });
  });

  // ── POST /api/games/tutorial/start ────────────────────────────────────────
  fastify.post('/tutorial/start', { preHandler: authenticate }, async (request, reply) => {
    const parsed = TutorialStartSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid input', details: parsed.error.flatten() });
    }
    const useWw2 = parsed.data.era === 'ww2';
    const mapId = useWw2 ? 'era_ww2' : 'tutorial';
    const eraId = useWw2 ? 'ww2' : 'ancient';

    const gameId = uuidv4();
    const tutorialSettings = {
      fog_of_war: false,
      victory_type: 'domination',
      turn_timer_seconds: 0,
      initial_unit_count: 3,
      card_set_escalating: false,
      diplomacy_enabled: false,
      tutorial: true,
      tutorial_step: 0,
      max_players: 2,
    };

    await query(
      `INSERT INTO games (game_id, map_id, era_id, status, settings_json, game_type)
       VALUES ($1, $2, $3, 'waiting', $4, 'solo')`,
      [gameId, mapId, eraId, JSON.stringify(tutorialSettings)],
    );

    const colors = ['#3498db', '#e74c3c'];
    await query(
      `INSERT INTO game_players (game_id, user_id, player_index, player_color, is_ai)
       VALUES ($1, $2, 0, $3, false)`,
      [gameId, request.userId, colors[0]],
    );
    await query(
      `INSERT INTO game_players (game_id, user_id, player_index, player_color, is_ai, ai_difficulty)
       VALUES ($1, NULL, 1, $2, true, 'tutorial')`,
      [gameId, colors[1]],
    );

    return reply.status(201).send({ game_id: gameId });
  });

  // ── GET /api/games/public ────────────────────────────────────────────────
  // Static routes MUST be registered before parametric /:gameId
  fastify.get('/public', async (_request, reply) => {
    const games = await query(
      `SELECT g.game_id, g.era_id, g.map_id, g.status, g.created_at,
              COUNT(gp.id) AS player_count
       FROM games g
       LEFT JOIN game_players gp ON gp.game_id = g.game_id
       WHERE g.status = 'waiting'
       GROUP BY g.game_id
       ORDER BY g.created_at DESC
       LIMIT 20`
    );
    return reply.send(games);
  });

  // ── GET /api/games/lookup?code= ──────────────────────────────────────────
  fastify.get('/lookup', { preHandler: authenticate }, async (request, reply) => {
    const raw = (request.query as { code?: string }).code;
    if (!raw || typeof raw !== 'string' || !raw.trim()) {
      return reply.status(400).send({ error: 'Missing code' });
    }
    const { kind, value } = normalizeJoinInput(raw);
    type Row = { game_id: string; status: string; era_id: string; join_code: string | null };
    let row: Row | null = null;
    if (kind === 'uuid' && uuidValidate(value)) {
      row = await queryOne<Row>(
        `SELECT game_id, status, era_id, join_code FROM games WHERE game_id = $1`,
        [value],
      );
    } else {
      row = await queryOne<Row>(
        `SELECT game_id, status, era_id, join_code FROM games WHERE UPPER(join_code) = $1`,
        [value],
      );
    }
    if (!row) return reply.status(404).send({ error: 'Game not found' });
    return reply.send(row);
  });

  // ── GET /api/games/:gameId ───────────────────────────────────────────────
  fastify.get<{ Params: { gameId: string } }>('/:gameId', { preHandler: authenticate }, async (request, reply) => {
    const game = await queryOne(
      `SELECT g.*, 
              json_agg(json_build_object(
                'player_index', gp.player_index,
                'user_id', gp.user_id,
                'username', u.username,
                'player_color', gp.player_color,
                'is_ai', gp.is_ai,
                'ai_difficulty', gp.ai_difficulty,
                'is_eliminated', gp.is_eliminated,
                'final_rank', gp.final_rank
              ) ORDER BY gp.player_index) AS players
       FROM games g
       LEFT JOIN game_players gp ON gp.game_id = g.game_id
       LEFT JOIN users u ON u.user_id = gp.user_id
       WHERE g.game_id = $1
       GROUP BY g.game_id`,
      [request.params.gameId]
    );
    if (!game) return reply.status(404).send({ error: 'Game not found' });
    return reply.send(game);
  });

  // ── POST /api/games/:gameId/join ─────────────────────────────────────────
  fastify.post<{ Params: { gameId: string } }>('/:gameId/join', { preHandler: authenticate }, async (request, reply) => {
    const game = await queryOne<{ status: string; game_id: string; settings_json: Record<string, unknown> }>(
      'SELECT game_id, status, settings_json FROM games WHERE game_id = $1',
      [request.params.gameId]
    );
    if (!game) return reply.status(404).send({ error: 'Game not found' });
    if (game.status !== 'waiting') return reply.status(409).send({ error: 'Game already started' });

    const players = await query<{ player_index: number; user_id: string }>(
      'SELECT player_index, user_id FROM game_players WHERE game_id = $1 ORDER BY player_index',
      [request.params.gameId]
    );

    const alreadyJoined = players.some((p) => p.user_id === request.userId);
    if (alreadyJoined) return reply.status(409).send({ error: 'Already in this game' });

    const settingsMaxPlayers = typeof game.settings_json?.max_players === 'number' ? game.settings_json.max_players : 8;
    const maxPlayers = Math.min(8, Math.max(2, settingsMaxPlayers));
    if (players.length >= maxPlayers) return reply.status(409).send({ error: 'Game is full' });

    const colors = ['#e74c3c', '#3498db', '#2ecc71', '#f39c12', '#9b59b6', '#1abc9c', '#e67e22', '#ecf0f1'];
    const nextIndex = players.length;

    await query(
      `INSERT INTO game_players (game_id, user_id, player_index, player_color, is_ai)
       VALUES ($1, $2, $3, $4, false)`,
      [request.params.gameId, request.userId, nextIndex, colors[nextIndex]]
    );

    await query(
      `UPDATE game_invites SET consumed_at = NOW()
       WHERE game_id = $1 AND invitee_id = $2 AND consumed_at IS NULL`,
      [request.params.gameId, request.userId],
    );

    return reply.send({ message: 'Joined game', player_index: nextIndex });
  });

  const InviteFriendSchema = z.object({ friend_user_id: z.string().uuid() });

  // ── POST /api/games/:gameId/invite ───────────────────────────────────────
  fastify.post<{ Params: { gameId: string } }>(
    '/:gameId/invite',
    { preHandler: [authenticate, rejectGuest] },
    async (request, reply) => {
      const parsed = InviteFriendSchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply.status(400).send({ error: 'Invalid input', details: parsed.error.flatten() });
      }
      const { friend_user_id: friendId } = parsed.data;
      const gameId = request.params.gameId;
      if (friendId === request.userId) {
        return reply.status(400).send({ error: 'Cannot invite yourself' });
      }

      const game = await queryOne<{
        status: string;
        settings_json: Record<string, unknown>;
        era_id: string;
        join_code: string | null;
      }>(
        `SELECT status, settings_json, era_id, join_code FROM games WHERE game_id = $1`,
        [gameId],
      );
      if (!game) return reply.status(404).send({ error: 'Game not found' });
      if (game.status !== 'waiting') {
        return reply.status(409).send({ error: 'Game is not accepting invites' });
      }

      const hostRow = await queryOne<{ c: number }>(
        `SELECT 1 AS c FROM game_players WHERE game_id = $1 AND user_id = $2 AND player_index = 0`,
        [gameId, request.userId],
      );
      if (!hostRow) return reply.status(403).send({ error: 'Only the host can invite friends' });

      const [ua, ub] =
        request.userId < friendId ? [request.userId, friendId] : [friendId, request.userId];
      const friends = await queryOne<{ c: number }>(
        `SELECT 1 AS c FROM friendships
         WHERE user_id_a = $1 AND user_id_b = $2 AND status = 'accepted'`,
        [ua, ub],
      );
      if (!friends) return reply.status(403).send({ error: 'You can only invite accepted friends' });

      const players = await query<{ player_index: number; user_id: string | null }>(
        'SELECT player_index, user_id FROM game_players WHERE game_id = $1 ORDER BY player_index',
        [gameId],
      );
      const settingsMaxPlayers =
        typeof game.settings_json?.max_players === 'number' ? game.settings_json.max_players : 8;
      const maxPlayers = Math.min(8, Math.max(2, settingsMaxPlayers));
      if (players.length >= maxPlayers) return reply.status(409).send({ error: 'Game is full' });

      const already = players.some((p) => p.user_id === friendId);
      if (already) return reply.status(409).send({ error: 'Player is already in this game' });

      const inviter = await queryOne<{ username: string }>(
        'SELECT username FROM users WHERE user_id = $1',
        [request.userId],
      );

      await query(
        `INSERT INTO game_invites (game_id, inviter_id, invitee_id)
         VALUES ($1, $2, $3)
         ON CONFLICT (game_id, invitee_id) DO NOTHING`,
        [gameId, request.userId, friendId],
      );

      const io = getGameIo();
      if (io) {
        io.to(`user:${friendId}`).emit('lobby:game_invite', {
          game_id: gameId,
          era_id: game.era_id,
          join_code: game.join_code,
          inviter_username: inviter?.username ?? 'Friend',
        });
      }

      return reply.send({ ok: true });
    },
  );

  // ── DELETE /api/games/:gameId/abandon ──────────────────────────────────
  fastify.delete<{ Params: { gameId: string } }>('/:gameId/abandon', { preHandler: authenticate }, async (request, reply) => {
    const game = await queryOne<{ game_id: string; status: string; game_type: string }>(
      'SELECT game_id, status, game_type FROM games WHERE game_id = $1',
      [request.params.gameId]
    );
    if (!game) return reply.status(404).send({ error: 'Game not found' });

    // Verify the user is a participant
    const participant = await queryOne<{ user_id: string }>(
      'SELECT user_id FROM game_players WHERE game_id = $1 AND user_id = $2',
      [request.params.gameId, request.userId]
    );
    if (!participant) return reply.status(403).send({ error: 'Not a participant in this game' });

    // Only allow abandoning waiting or in-progress games
    if (game.status !== 'waiting' && game.status !== 'in_progress') {
      return reply.status(409).send({ error: 'Game already finished' });
    }

    await query(
      'UPDATE games SET status = $1, ended_at = NOW() WHERE game_id = $2',
      ['abandoned', request.params.gameId]
    );

    return reply.send({ message: 'Game abandoned' });
  });
}
