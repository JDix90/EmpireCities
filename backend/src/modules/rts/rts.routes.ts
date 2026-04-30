import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { query, queryOne } from '../../db/postgres';
import { authenticate } from '../../middleware/authenticate';
import { generateJoinCode } from '../../utils/joinCode';
import { ensureRtsRoom } from '../../rts/rtsService';

const CreateRtsGameSchema = z.object({
  max_players: z.number().int().min(1).max(2).default(1),
  map_id: z.string().default('rts_slice_v1'),
});

const RTS_ERA = 'rts';

export async function rtsRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.post('/games', { preHandler: authenticate }, async (request, reply) => {
    const body = CreateRtsGameSchema.safeParse(request.body ?? {});
    if (!body.success) {
      return reply.status(400).send({ error: 'Invalid input', details: body.error.flatten() });
    }
    const { max_players, map_id } = body.data;
    const gameId = uuidv4();
    const colors = ['#e74c3c', '#3498db', '#2ecc71', '#f39c12', '#9b59b6', '#1abc9c', '#e67e22', '#ecf0f1'];
    const settings = { rts: true, max_players, game_mode: 'rts' };

    let joinCodeOut: string | null = null;
    for (let attempt = 0; attempt < 15; attempt++) {
      const joinCode = generateJoinCode();
      try {
        await query(
          `INSERT INTO games (game_id, map_id, era_id, status, settings_json, game_type, join_code, game_mode)
           VALUES ($1, $2, $3, 'waiting', $4, 'multiplayer', $5, 'rts')`,
          [gameId, map_id, RTS_ERA, JSON.stringify(settings), joinCode],
        );
        joinCodeOut = joinCode;
        break;
      } catch (e: unknown) {
        const code = typeof e === 'object' && e && 'code' in e ? String((e as { code: string }).code) : '';
        if (code === '23505') continue;
        throw e;
      }
    }
    if (!joinCodeOut) {
      return reply.status(503).send({ error: 'Could not allocate join code' });
    }
    await query(
      `INSERT INTO game_players (game_id, user_id, player_index, player_color, is_ai)
       VALUES ($1, $2, 0, $3, false)`,
      [gameId, request.userId, colors[0]],
    );
    return reply.status(201).send({ game_id: gameId, map_id, era_id: RTS_ERA, join_code: joinCodeOut, settings });
  });

  fastify.get<{ Params: { gameId: string } }>('/games/:gameId', { preHandler: authenticate }, async (request, reply) => {
    const { gameId } = request.params;
    const g = await queryOne<{
      game_id: string;
      map_id: string;
      status: string;
      settings_json: unknown;
    }>(`SELECT game_id, map_id, status, settings_json FROM games WHERE game_id = $1`, [gameId]);
    if (!g) return reply.status(404).send({ error: 'Not found' });
    const mod = await queryOne<{ game_mode: string }>(`SELECT game_mode FROM games WHERE game_id = $1`, [gameId]);
    if (mod?.game_mode !== 'rts') {
      return reply.status(404).send({ error: 'Not an RTS game' });
    }
    const member = await queryOne('SELECT 1 FROM game_players WHERE game_id = $1 AND user_id = $2', [
      gameId,
      request.userId,
    ]);
    if (!member) return reply.status(403).send({ error: 'Forbidden' });
    const room = await ensureRtsRoom(gameId);
    return reply.send({
      game_id: g.game_id,
      map_id: g.map_id,
      status: g.status,
      state: room.state,
    });
  });
}
