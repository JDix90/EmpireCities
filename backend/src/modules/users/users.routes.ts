import type { FastifyInstance } from 'fastify';
import { authenticate } from '../../middleware/authenticate';
import { query, queryOne } from '../../db/postgres';
import { getLeaderboard } from '../../db/redis';

export async function usersRoutes(fastify: FastifyInstance): Promise<void> {
  // ── GET /api/users/me ────────────────────────────────────────────────────
  fastify.get('/me', { preHandler: authenticate }, async (request, reply) => {
    const user = await queryOne<{
      user_id: string; username: string; level: number; xp: number;
      mmr: number; avatar_url: string | null; created_at: Date;
    }>(
      'SELECT user_id, username, level, xp, mmr, avatar_url, created_at FROM users WHERE user_id = $1',
      [request.userId]
    );
    if (!user) return reply.status(404).send({ error: 'User not found' });
    return reply.send(user);
  });

  // ── GET /api/users/:userId ───────────────────────────────────────────────
  fastify.get<{ Params: { userId: string } }>('/:userId', async (request, reply) => {
    const user = await queryOne<{
      user_id: string; username: string; level: number; mmr: number; avatar_url: string | null;
    }>(
      'SELECT user_id, username, level, mmr, avatar_url FROM users WHERE user_id = $1',
      [request.params.userId]
    );
    if (!user) return reply.status(404).send({ error: 'User not found' });
    return reply.send(user);
  });

  // ── GET /api/users/me/achievements ──────────────────────────────────────
  fastify.get('/me/achievements', { preHandler: authenticate }, async (request, reply) => {
    const achievements = await query(
      `SELECT a.achievement_id, a.name, a.description, a.xp_reward, a.icon_url, ua.unlocked_at
       FROM user_achievements ua
       JOIN achievements a ON a.achievement_id = ua.achievement_id
       WHERE ua.user_id = $1
       ORDER BY ua.unlocked_at DESC`,
      [request.userId]
    );
    return reply.send(achievements);
  });

  // ── GET /api/users/me/games ──────────────────────────────────────────────
  fastify.get('/me/games', { preHandler: authenticate }, async (request, reply) => {
    const games = await query(
      `SELECT g.game_id, g.era_id, g.status, g.created_at, g.ended_at,
              gp.player_color, gp.final_rank, gp.xp_earned, gp.mmr_change
       FROM game_players gp
       JOIN games g ON g.game_id = gp.game_id
       WHERE gp.user_id = $1
       ORDER BY g.created_at DESC
       LIMIT 20`,
      [request.userId]
    );
    return reply.send(games);
  });

  // ── GET /api/users/leaderboard/:era ─────────────────────────────────────
  fastify.get<{ Params: { era: string } }>('/leaderboard/:era', async (request, reply) => {
    const { era } = request.params;
    const validEras = ['ancient', 'medieval', 'discovery', 'ww2', 'coldwar', 'modern', 'global'];
    if (!validEras.includes(era)) {
      return reply.status(400).send({ error: 'Invalid era' });
    }

    const leaderboard = await getLeaderboard(era, 100);
    if (leaderboard.length === 0) {
      // Fallback to PostgreSQL if Redis is empty
      const rows = await query<{ user_id: string; username: string; mmr: number; level: number }>(
        'SELECT user_id, username, mmr, level FROM users ORDER BY mmr DESC LIMIT 100'
      );
      return reply.send(rows);
    }

    // Enrich with usernames
    const userIds = leaderboard.map((e) => e.userId);
    const users = await query<{ user_id: string; username: string; level: number }>(
      `SELECT user_id, username, level FROM users WHERE user_id = ANY($1)`,
      [userIds]
    );
    const userMap = Object.fromEntries(users.map((u) => [u.user_id, u]));
    const enriched = leaderboard.map((e, i) => ({
      rank: i + 1,
      ...userMap[e.userId],
      mmr: e.mmr,
    }));

    return reply.send(enriched);
  });

  // ── GET /api/users/me/friends ────────────────────────────────────────────
  fastify.get('/me/friends', { preHandler: authenticate }, async (request, reply) => {
    const friends = await query(
      `SELECT u.user_id, u.username, u.level, u.mmr, u.avatar_url, f.status, f.created_at
       FROM friendships f
       JOIN users u ON (
         CASE WHEN f.user_id_a = $1 THEN f.user_id_b ELSE f.user_id_a END = u.user_id
       )
       WHERE (f.user_id_a = $1 OR f.user_id_b = $1)
         AND f.status = 'accepted'`,
      [request.userId]
    );
    return reply.send(friends);
  });
}
