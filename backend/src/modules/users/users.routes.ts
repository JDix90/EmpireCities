import type { FastifyInstance } from 'fastify';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { authenticate } from '../../middleware/authenticate';
import { query, queryOne } from '../../db/postgres';
import { getLeaderboard } from '../../db/redis';

const DeleteAccountSchema = z.object({
  password: z.string().min(1, 'Password is required to delete your account'),
});

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

  // ── DELETE /api/users/me (account deletion — run migration 003 first) ───
  fastify.delete('/me', { preHandler: authenticate }, async (request, reply) => {
    const parsed = DeleteAccountSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid input', details: parsed.error.flatten() });
    }
    const row = await queryOne<{ password_hash: string }>(
      'SELECT password_hash FROM users WHERE user_id = $1',
      [request.userId]
    );
    if (!row) return reply.status(404).send({ error: 'User not found' });
    const ok = await bcrypt.compare(parsed.data.password, row.password_hash);
    if (!ok) return reply.status(401).send({ error: 'Incorrect password' });

    await query('DELETE FROM users WHERE user_id = $1', [request.userId]);

    reply.clearCookie('refreshToken', { path: '/api/auth' });
    return reply.send({ message: 'Account deleted' });
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

  // ── GET /api/users/me/active-games ──────────────────────────────────────
  fastify.get('/me/active-games', { preHandler: authenticate }, async (request, reply) => {
    const games = await query<{
      game_id: string; era_id: string; game_type: string; created_at: Date;
      started_at: Date | null; turn_number: number | null; saved_at: Date | null;
    }>(
      `SELECT g.game_id, g.era_id, g.game_type, g.created_at, g.started_at,
              (gs.state_json::jsonb->>'turn_number')::int AS turn_number,
              gs.saved_at
       FROM games g
       JOIN game_players gp ON gp.game_id = g.game_id
       LEFT JOIN LATERAL (
         SELECT state_json::text::jsonb AS state_json, saved_at FROM game_states
         WHERE game_id = g.game_id ORDER BY turn_number DESC LIMIT 1
       ) gs ON true
       WHERE gp.user_id = $1 AND g.status = 'in_progress'
       ORDER BY COALESCE(gs.saved_at, g.started_at, g.created_at) DESC`,
      [request.userId]
    );
    return reply.send(games);
  });

  // ── GET /api/users/me/stats ───────────────────────────────────────────
  fastify.get('/me/stats', { preHandler: authenticate }, async (request, reply) => {
    const rows = await query<{
      game_type: string; era_id: string; won: boolean; game_count: string;
    }>(
      `SELECT g.game_type, g.era_id,
              (gp.final_rank = 1) AS won,
              COUNT(*) AS game_count
       FROM game_players gp
       JOIN games g ON g.game_id = gp.game_id
       WHERE gp.user_id = $1 AND g.status = 'completed'
       GROUP BY g.game_type, g.era_id, (gp.final_rank = 1)`,
      [request.userId]
    );

    type Bucket = { played: number; won: number; win_rate: number };
    const bucket = (): Bucket => ({ played: 0, won: 0, win_rate: 0 });
    const overall = bucket();
    const solo = bucket();
    const multi = bucket();
    const hybrid = bucket();
    const byEra: Record<string, { played: number; won: number }> = {};

    const categoryMap: Record<string, Bucket> = { solo, multiplayer: multi, hybrid };

    for (const row of rows) {
      const count = parseInt(row.game_count, 10);
      const cat = categoryMap[row.game_type] ?? hybrid;
      cat.played += count;
      overall.played += count;
      if (row.won) {
        cat.won += count;
        overall.won += count;
      }
      if (!byEra[row.era_id]) byEra[row.era_id] = { played: 0, won: 0 };
      byEra[row.era_id].played += count;
      if (row.won) byEra[row.era_id].won += count;
    }

    const rate = (b: Bucket) => { b.win_rate = b.played > 0 ? +(b.won / b.played).toFixed(2) : 0; };
    rate(overall); rate(solo); rate(multi); rate(hybrid);

    // Streak calculation
    const recentGames = await query<{ won: boolean; ended_at: Date }>(
      `SELECT (gp.final_rank = 1) AS won, g.ended_at
       FROM game_players gp
       JOIN games g ON g.game_id = gp.game_id
       WHERE gp.user_id = $1 AND g.status = 'completed'
       ORDER BY g.ended_at DESC
       LIMIT 100`,
      [request.userId]
    );
    let currentWinStreak = 0;
    let bestWinStreak = 0;
    let streak = 0;
    for (const g of recentGames) {
      if (g.won) {
        streak++;
        if (streak > bestWinStreak) bestWinStreak = streak;
      } else {
        if (currentWinStreak === 0) currentWinStreak = streak;
        streak = 0;
      }
    }
    if (currentWinStreak === 0) currentWinStreak = streak;
    if (streak > bestWinStreak) bestWinStreak = streak;

    let favoriteEra: string | null = null;
    let maxPlayed = 0;
    for (const [era, data] of Object.entries(byEra)) {
      if (data.played > maxPlayed) { maxPlayed = data.played; favoriteEra = era; }
    }

    return reply.send({
      overall,
      solo,
      multi,
      hybrid,
      by_era: byEra,
      streaks: { current_win: currentWinStreak, best_win: bestWinStreak },
      favorite_era: favoriteEra,
    });
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
