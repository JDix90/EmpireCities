import type { FastifyInstance } from 'fastify';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';
import { authenticate } from '../../middleware/authenticate';
import { query, queryOne } from '../../db/postgres';
import type { GameSettings, EraId, VictoryType } from '../../types';

const CreateGameSchema = z.object({
  era_id: z.enum(['ancient', 'medieval', 'discovery', 'ww2', 'coldwar', 'modern']),
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

    await query(
      `INSERT INTO games (game_id, map_id, era_id, status, settings_json)
       VALUES ($1, $2, $3, 'waiting', $4)`,
      [gameId, map_id, era_id, JSON.stringify(settings)]
    );

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

    return reply.status(201).send({ game_id: gameId, era_id, map_id, settings });
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
    const game = await queryOne<{ status: string; game_id: string }>(
      'SELECT game_id, status FROM games WHERE game_id = $1',
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

    const maxPlayers = 8;
    if (players.length >= maxPlayers) return reply.status(409).send({ error: 'Game is full' });

    const colors = ['#e74c3c', '#3498db', '#2ecc71', '#f39c12', '#9b59b6', '#1abc9c', '#e67e22', '#ecf0f1'];
    const nextIndex = players.length;

    await query(
      `INSERT INTO game_players (game_id, user_id, player_index, player_color, is_ai)
       VALUES ($1, $2, $3, $4, false)`,
      [request.params.gameId, request.userId, nextIndex, colors[nextIndex]]
    );

    return reply.send({ message: 'Joined game', player_index: nextIndex });
  });

  // ── GET /api/games/public ────────────────────────────────────────────────
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
}
