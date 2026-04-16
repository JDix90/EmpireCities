import type { FastifyInstance } from 'fastify';
import { authenticate } from '../../middleware/authenticate';
import { query, queryOne } from '../../db/postgres';
import { redis } from '../../db/redis';
import { getTier } from '../../game-engine/rating/ratingService';
import { getLevel } from '@erasofempire/shared';

const CACHE_TTL = 300; // 5 minutes

export async function leaderboardRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get('/top', { preHandler: authenticate }, async (request, reply) => {
    const cacheKey = `lb:top:${request.userId}`;
    const cached = await redis.get(cacheKey);
    if (cached) return reply.send(JSON.parse(cached));

    const top = await query<{
      user_id: string;
      username: string;
      mu: number;
    }>(
      `SELECT u.user_id, u.username, ur.mu
       FROM user_ratings ur
       JOIN users u ON u.user_id = ur.user_id
       WHERE ur.rating_type = 'ranked' AND u.is_guest = false
       ORDER BY ur.mu DESC
       LIMIT 5`,
    );

    const mine = await queryOne<{
      rating_rank: string;
      rating: number;
    }>(
      `WITH ranked AS (
         SELECT ur.user_id,
                ur.mu,
                ROW_NUMBER() OVER (ORDER BY ur.mu DESC) AS rank
         FROM user_ratings ur
         JOIN users u ON u.user_id = ur.user_id
         WHERE ur.rating_type = 'ranked' AND u.is_guest = false
       )
       SELECT rank::text AS rating_rank, mu AS rating
       FROM ranked
       WHERE user_id = $1`,
      [request.userId],
    );

    const result = {
      top: top.map((row, index) => ({
        rank: index + 1,
        user_id: row.user_id,
        username: row.username,
        rating: Math.round(row.mu),
        tier: getTier(row.mu),
      })),
      my_rank: mine
        ? {
            rank: parseInt(mine.rating_rank, 10),
            rating: Math.round(mine.rating),
            tier: getTier(mine.rating),
          }
        : null,
    };

    await redis.set(cacheKey, JSON.stringify(result), 'EX', CACHE_TTL);
    return reply.send(result);
  });

  fastify.get('/my-rank', { preHandler: authenticate }, async (request, reply) => {
    const cacheKey = `lb:my-rank:${request.userId}`;
    const cached = await redis.get(cacheKey);
    if (cached) return reply.send(JSON.parse(cached));

    const rating = await queryOne<{ rating_rank: string; mu: number }>(
      `WITH ranked AS (
         SELECT ur.user_id,
                ur.mu,
                ROW_NUMBER() OVER (ORDER BY ur.mu DESC) AS rank
         FROM user_ratings ur
         JOIN users u ON u.user_id = ur.user_id
         WHERE ur.rating_type = 'ranked' AND u.is_guest = false
       )
       SELECT rank::text AS rating_rank, mu
       FROM ranked WHERE user_id = $1`,
      [request.userId],
    );

    const level = await queryOne<{ level_rank: string; xp: number }>(
      `WITH leveled AS (
         SELECT user_id, xp, ROW_NUMBER() OVER (ORDER BY xp DESC) AS rank
         FROM users
         WHERE is_guest = false
       )
       SELECT rank::text AS level_rank, xp
       FROM leveled WHERE user_id = $1`,
      [request.userId],
    );

    const streak = await queryOne<{ streak_rank: string; win_streak: number; daily_streak: number }>(
      `WITH streaked AS (
        SELECT user_id, username, win_streak, daily_streak,
                ROW_NUMBER() OVER (ORDER BY win_streak DESC, daily_streak DESC, username ASC) AS rank
         FROM users
         WHERE is_guest = false AND (win_streak > 0 OR daily_streak > 0)
       )
       SELECT rank::text AS streak_rank, win_streak, daily_streak
       FROM streaked WHERE user_id = $1`,
      [request.userId],
    );

    const result = {
      rating: rating
        ? {
            rank: parseInt(rating.rating_rank, 10),
            value: Math.round(rating.mu),
            tier: getTier(rating.mu),
          }
        : null,
      level: level
        ? {
            rank: parseInt(level.level_rank, 10),
            value: getLevel(level.xp),
            xp: level.xp,
          }
        : null,
      streak: streak
        ? {
            rank: parseInt(streak.streak_rank, 10),
            win_streak: streak.win_streak,
            daily_streak: streak.daily_streak,
          }
        : null,
    };

    await redis.set(cacheKey, JSON.stringify(result), 'EX', CACHE_TTL);
    return reply.send(result);
  });

  // ── GET /api/leaderboards/rating ─────────────────────────────────────────
  fastify.get('/rating', { preHandler: authenticate }, async (request, reply) => {
    const qs = request.query as { limit?: string; offset?: string };
    const limit = Math.min(parseInt(qs.limit ?? '50', 10) || 50, 100);
    const offset = parseInt(qs.offset ?? '0', 10) || 0;

    const cacheKey = `lb:rating:${limit}:${offset}`;
    const cached = await redis.get(cacheKey);
    if (cached) return reply.send(JSON.parse(cached));

    const rows = await query<{
      user_id: string; username: string; mu: number; phi: number;
      level: number; xp: number; games_played: string;
    }>(
      `SELECT u.user_id, u.username, ur.mu, ur.phi, u.level, u.xp,
              (SELECT COUNT(*) FROM game_players gp JOIN games g ON g.game_id = gp.game_id
               WHERE gp.user_id = u.user_id AND g.status = 'completed') AS games_played
       FROM user_ratings ur
       JOIN users u ON u.user_id = ur.user_id
       WHERE ur.rating_type = 'ranked' AND u.is_guest = false
       ORDER BY ur.mu DESC
       LIMIT $1 OFFSET $2`,
      [limit, offset],
    );

    const result = {
      type: 'rating',
      entries: rows.map((r, i) => ({
        rank: offset + i + 1,
        user_id: r.user_id,
        username: r.username,
        rating: Math.round(r.mu),
        tier: getTier(r.mu),
        level: getLevel(r.xp),
        games_played: parseInt(r.games_played, 10),
      })),
    };

    await redis.set(cacheKey, JSON.stringify(result), 'EX', CACHE_TTL);
    return reply.send(result);
  });

  fastify.get('/weekly', { preHandler: authenticate }, async (request, reply) => {
    const qs = request.query as { limit?: string; offset?: string };
    const limit = Math.min(parseInt(qs.limit ?? '50', 10) || 50, 100);
    const offset = parseInt(qs.offset ?? '0', 10) || 0;

    const cacheKey = `lb:weekly:${limit}:${offset}`;
    const cached = await redis.get(cacheKey);
    if (cached) return reply.send(JSON.parse(cached));

    const rows = await query<{
      user_id: string;
      username: string;
      wins: string;
      games_played: string;
      mu: number | null;
    }>(
      `SELECT gp.user_id,
              u.username,
              COUNT(*) FILTER (WHERE gp.final_rank = 1)::text AS wins,
              COUNT(*)::text AS games_played,
              MAX(ur.mu) AS mu
       FROM game_players gp
       JOIN games g ON g.game_id = gp.game_id
       JOIN users u ON u.user_id = gp.user_id
       LEFT JOIN user_ratings ur ON ur.user_id = gp.user_id AND ur.rating_type = 'ranked'
       WHERE g.status = 'completed'
         AND g.ended_at >= NOW() - INTERVAL '7 days'
         AND gp.user_id IS NOT NULL
         AND u.is_guest = false
       GROUP BY gp.user_id, u.username
       HAVING COUNT(*) FILTER (WHERE gp.final_rank = 1) > 0
       ORDER BY COUNT(*) FILTER (WHERE gp.final_rank = 1) DESC,
                COUNT(*) DESC,
                MAX(ur.mu) DESC NULLS LAST,
                u.username ASC
       LIMIT $1 OFFSET $2`,
      [limit, offset],
    );

    const result = {
      type: 'weekly',
      entries: rows.map((row, index) => ({
        rank: offset + index + 1,
        user_id: row.user_id,
        username: row.username,
        wins: parseInt(row.wins, 10),
        games_played: parseInt(row.games_played, 10),
        tier: getTier(row.mu ?? 0),
      })),
    };

    await redis.set(cacheKey, JSON.stringify(result), 'EX', CACHE_TTL);
    return reply.send(result);
  });

  // ── GET /api/leaderboards/level ──────────────────────────────────────────
  fastify.get('/level', { preHandler: authenticate }, async (request, reply) => {
    const qs = request.query as { limit?: string; offset?: string };
    const limit = Math.min(parseInt(qs.limit ?? '50', 10) || 50, 100);
    const offset = parseInt(qs.offset ?? '0', 10) || 0;

    const cacheKey = `lb:level:${limit}:${offset}`;
    const cached = await redis.get(cacheKey);
    if (cached) return reply.send(JSON.parse(cached));

    const rows = await query<{
      user_id: string; username: string; xp: number; level: number;
    }>(
      `SELECT user_id, username, xp, level
       FROM users
       WHERE is_guest = false
       ORDER BY xp DESC
       LIMIT $1 OFFSET $2`,
      [limit, offset],
    );

    const result = {
      type: 'level',
      entries: rows.map((r, i) => ({
        rank: offset + i + 1,
        user_id: r.user_id,
        username: r.username,
        level: getLevel(r.xp),
        xp: r.xp,
      })),
    };

    await redis.set(cacheKey, JSON.stringify(result), 'EX', CACHE_TTL);
    return reply.send(result);
  });

  // ── GET /api/leaderboards/season ─────────────────────────────────────────
  fastify.get('/season', { preHandler: authenticate }, async (request, reply) => {
    const qs = request.query as { limit?: string; offset?: string };
    const limit = Math.min(parseInt(qs.limit ?? '50', 10) || 50, 100);
    const offset = parseInt(qs.offset ?? '0', 10) || 0;

    // Get current season
    const season = await queryOne<{ season_id: string; name: string }>(
      `SELECT season_id, name FROM seasons WHERE NOW() BETWEEN started_at AND ended_at LIMIT 1`,
    );
    if (!season) return reply.send({ type: 'season', season: null, entries: [] });

    const cacheKey = `lb:season:${season.season_id}:${limit}:${offset}`;
    const cached = await redis.get(cacheKey);
    if (cached) return reply.send(JSON.parse(cached));

    const rows = await query<{
      user_id: string; username: string; highest_tier: string;
      games_played: number; mu: number;
    }>(
      `SELECT sr.user_id, u.username, sr.highest_tier, sr.games_played,
              COALESCE(ur.mu, 1500) AS mu
       FROM season_rewards sr
       JOIN users u ON u.user_id = sr.user_id
       LEFT JOIN user_ratings ur ON ur.user_id = sr.user_id AND ur.rating_type = 'ranked'
       WHERE sr.season_id = $1
       ORDER BY ur.mu DESC NULLS LAST
       LIMIT $2 OFFSET $3`,
      [season.season_id, limit, offset],
    );

    const tierOrder: Record<string, number> = { diamond: 5, platinum: 4, gold: 3, silver: 2, bronze: 1 };

    const result = {
      type: 'season',
      season: { season_id: season.season_id, name: season.name },
      entries: rows
        .sort((a, b) => (tierOrder[b.highest_tier] ?? 0) - (tierOrder[a.highest_tier] ?? 0) || b.mu - a.mu)
        .map((r, i) => ({
          rank: offset + i + 1,
          user_id: r.user_id,
          username: r.username,
          highest_tier: r.highest_tier,
          tier_info: getTier(r.mu),
          games_played: r.games_played,
          rating: Math.round(r.mu),
        })),
    };

    await redis.set(cacheKey, JSON.stringify(result), 'EX', CACHE_TTL);
    return reply.send(result);
  });

  // ── GET /api/leaderboards/streaks ────────────────────────────────────────
  fastify.get('/streaks', { preHandler: authenticate }, async (request, reply) => {
    const qs = request.query as { limit?: string; offset?: string };
    const limit = Math.min(parseInt(qs.limit ?? '50', 10) || 50, 100);
    const offset = parseInt(qs.offset ?? '0', 10) || 0;

    const cacheKey = `lb:streaks:${limit}:${offset}`;
    const cached = await redis.get(cacheKey);
    if (cached) return reply.send(JSON.parse(cached));

    const rows = await query<{
      user_id: string; username: string; win_streak: number; daily_streak: number;
    }>(
      `SELECT user_id, username, win_streak, daily_streak
       FROM users
       WHERE is_guest = false AND (win_streak > 0 OR daily_streak > 0)
       ORDER BY win_streak DESC, daily_streak DESC
       LIMIT $1 OFFSET $2`,
      [limit, offset],
    );

    const result = {
      type: 'streaks',
      entries: rows.map((r, i) => ({
        rank: offset + i + 1,
        user_id: r.user_id,
        username: r.username,
        win_streak: r.win_streak,
        daily_streak: r.daily_streak,
      })),
    };

    await redis.set(cacheKey, JSON.stringify(result), 'EX', CACHE_TTL);
    return reply.send(result);
  });
}
