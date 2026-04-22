import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticate } from '../../middleware/authenticate';
import { requireAdmin } from '../../middleware/requireAdmin';
import { query, queryOne } from '../../db/postgres';
import {
  getAdminConfigSnapshot,
  refreshAdminConfigCache,
  upsertAdminConfig,
  type AdminConfigState,
} from '../../services/adminConfig';
import {
  isMatchmakingPaused,
  setMatchmakingPaused,
} from '../matchmaking/matchmaking.routes';
import { ensureDailyChallengeForToday } from '../../game-engine/daily/dailyPuzzleService';

const DateFilterSchema = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
});

const ConfigPatchSchema = z.object({
  value: z.unknown(),
});

const UserActionSchema = z.object({
  user_id: z.string().uuid(),
});

const UserSearchSchema = z.object({
  search: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

async function writeAuditLog(adminUserId: string, action: string, payload: unknown): Promise<void> {
  await query(
    `INSERT INTO admin_audit_log (admin_user_id, action, payload)
     VALUES ($1, $2, $3::jsonb)`,
    [adminUserId, action, JSON.stringify(payload ?? {})],
  );
}

function dateWhere(queryParams: { from?: string; to?: string }) {
  const clauses: string[] = [];
  const values: unknown[] = [];
  if (queryParams.from) {
    values.push(queryParams.from);
    clauses.push(`g.created_at >= $${values.length}::timestamptz`);
  }
  if (queryParams.to) {
    values.push(queryParams.to);
    clauses.push(`g.created_at <= $${values.length}::timestamptz`);
  }
  return { clause: clauses.length > 0 ? `AND ${clauses.join(' AND ')}` : '', values };
}

export async function adminRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get('/metrics/overview', { preHandler: [authenticate, requireAdmin] }, async (request, reply) => {
    const parsed = DateFilterSchema.safeParse(request.query ?? {});
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid query params' });
    const dw = dateWhere(parsed.data);

    const [users, games, completed, queue, byStatus, inProgress, waiting] = await Promise.all([
      queryOne<{ c: string }>('SELECT COUNT(*)::text AS c FROM users'),
      queryOne<{ c: string }>(`SELECT COUNT(*)::text AS c FROM games g WHERE 1=1 ${dw.clause}`, dw.values),
      queryOne<{ c: string }>(
        `SELECT COUNT(*)::text AS c FROM games g WHERE g.status = 'completed' ${dw.clause}`,
        dw.values,
      ),
      queryOne<{ c: string }>('SELECT COUNT(*)::text AS c FROM ranked_queue'),
      query<{ status: string; n: string }>(
        `SELECT g.status, COUNT(*)::text AS n FROM games g WHERE 1=1 ${dw.clause} GROUP BY g.status`,
        dw.values,
      ),
      queryOne<{ c: string }>(
        `SELECT COUNT(*)::text AS c FROM games g WHERE g.status = 'in_progress' ${dw.clause}`,
        dw.values,
      ),
      queryOne<{ c: string }>(
        `SELECT COUNT(*)::text AS c FROM games g WHERE g.status = 'waiting' ${dw.clause}`,
        dw.values,
      ),
    ]);

    const gamesByStatus: Record<string, number> = {};
    for (const row of byStatus) {
      gamesByStatus[row.status] = Number(row.n);
    }

    const completedForAvg = await queryOne<{ avg_sec: string | null }>(
      `SELECT ROUND(AVG(EXTRACT(EPOCH FROM (g.ended_at - g.started_at))))::text AS avg_sec
       FROM games g
       WHERE g.status = 'completed'
         AND g.started_at IS NOT NULL
         AND g.ended_at IS NOT NULL
         ${dw.clause}`,
      dw.values,
    );

    return reply.send({
      total_users: Number(users?.c ?? 0),
      games_created: Number(games?.c ?? 0),
      games_completed: Number(completed?.c ?? 0),
      games_in_progress: Number(inProgress?.c ?? 0),
      games_waiting: Number(waiting?.c ?? 0),
      games_by_status: gamesByStatus,
      avg_completed_duration_seconds:
        completedForAvg?.avg_sec != null ? Number(completedForAvg.avg_sec) : null,
      ranked_queue_depth: Number(queue?.c ?? 0),
      matchmaking_paused: isMatchmakingPaused(),
    });
  });

  /** Daily completed vs created game counts for trend charts (ended_at / created_at day in UTC). */
  fastify.get('/metrics/timeseries', { preHandler: [authenticate, requireAdmin] }, async (request, reply) => {
    const daysRaw = (request.query as { days?: string }).days;
    const days = Math.min(90, Math.max(7, parseInt(daysRaw ?? '30', 10) || 30));

    const completed = await query<{ day: string; n: number }>(
      `SELECT (g.ended_at AT TIME ZONE 'UTC')::date::text AS day, COUNT(*)::int AS n
       FROM games g
       WHERE g.status = 'completed'
         AND g.ended_at IS NOT NULL
         AND g.ended_at >= NOW() - make_interval(days => $1)
       GROUP BY (g.ended_at AT TIME ZONE 'UTC')::date
       ORDER BY 1`,
      [days],
    );

    const created = await query<{ day: string; n: number }>(
      `SELECT (g.created_at AT TIME ZONE 'UTC')::date::text AS day, COUNT(*)::int AS n
       FROM games g
       WHERE g.created_at >= NOW() - make_interval(days => $1)
       GROUP BY (g.created_at AT TIME ZONE 'UTC')::date
       ORDER BY 1`,
      [days],
    );

    const byType = await query<{ game_type: string; n: number }>(
      `SELECT g.game_type, COUNT(*)::int AS n
       FROM games g
       WHERE g.status = 'completed'
         AND g.ended_at >= NOW() - make_interval(days => $1)
       GROUP BY g.game_type
       ORDER BY n DESC`,
      [days],
    );

    return reply.send({ days, completed_by_day: completed, created_by_day: created, completed_by_type: byType });
  });

  fastify.get('/metrics/factions', { preHandler: [authenticate, requireAdmin] }, async (_request, reply) => {
    const rows = await query(
      `SELECT gp.faction_id,
              COUNT(*)::int AS games_played,
              SUM(CASE WHEN gp.final_rank = 1 THEN 1 ELSE 0 END)::int AS wins,
              ROUND(
                100.0 * SUM(CASE WHEN gp.final_rank = 1 THEN 1 ELSE 0 END) / NULLIF(COUNT(*), 0),
                2
              ) AS win_rate
       FROM game_players gp
       JOIN games g ON g.game_id = gp.game_id
       WHERE g.status = 'completed' AND gp.faction_id IS NOT NULL
       GROUP BY gp.faction_id
       ORDER BY win_rate DESC NULLS LAST, games_played DESC`,
    );
    return reply.send(rows);
  });

  fastify.get('/metrics/eras', { preHandler: [authenticate, requireAdmin] }, async (_request, reply) => {
    const rows = await query(
      `SELECT g.era_id,
              COUNT(*)::int AS games_completed,
              ROUND(AVG(EXTRACT(EPOCH FROM (g.ended_at - g.started_at))), 2) AS avg_duration_seconds
       FROM games g
       WHERE g.status = 'completed' AND g.started_at IS NOT NULL AND g.ended_at IS NOT NULL
       GROUP BY g.era_id
       ORDER BY games_completed DESC`,
    );
    return reply.send(rows);
  });

  fastify.get('/metrics/maps', { preHandler: [authenticate, requireAdmin] }, async (_request, reply) => {
    const rows = await query(
      `SELECT g.map_id,
              COUNT(*)::int AS games_completed,
              ROUND(AVG(EXTRACT(EPOCH FROM (g.ended_at - g.started_at))), 2) AS avg_duration_seconds
       FROM games g
       WHERE g.status = 'completed' AND g.started_at IS NOT NULL AND g.ended_at IS NOT NULL
       GROUP BY g.map_id
       ORDER BY games_completed DESC
       LIMIT 30`,
    );
    return reply.send(rows);
  });

  fastify.get('/metrics/duration', { preHandler: [authenticate, requireAdmin] }, async (_request, reply) => {
    const rows = await query(
      `SELECT g.game_id,
              g.era_id,
              g.map_id,
              EXTRACT(EPOCH FROM (g.ended_at - g.started_at))::int AS duration_seconds
       FROM games g
       WHERE g.status = 'completed' AND g.started_at IS NOT NULL AND g.ended_at IS NOT NULL
       ORDER BY g.ended_at DESC
       LIMIT 200`,
    );
    return reply.send(rows);
  });

  fastify.get('/metrics/ranked-distribution', { preHandler: [authenticate, requireAdmin] }, async (_request, reply) => {
    const rows = await query(
      `SELECT WIDTH_BUCKET(mu, 800, 2400, 8) AS bucket, COUNT(*)::int AS count
       FROM user_ratings
       WHERE rating_type = 'ranked'
       GROUP BY bucket
       ORDER BY bucket`,
    );
    return reply.send(rows);
  });

  fastify.get('/config', { preHandler: [authenticate, requireAdmin] }, async (_request, reply) => {
    return reply.send({
      config: getAdminConfigSnapshot(),
      matchmaking_paused: isMatchmakingPaused(),
    });
  });

  fastify.patch<{ Params: { key: string } }>('/config/:key', { preHandler: [authenticate, requireAdmin] }, async (request, reply) => {
    const parsed = ConfigPatchSchema.safeParse(request.body ?? {});
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid payload' });
    const allowed = new Set<keyof AdminConfigState>([
      'economy',
      'xp',
      'glicko',
      'matchmaking',
      'default_game_settings',
      'feature_flags',
    ]);
    const key = request.params.key as keyof AdminConfigState;
    if (!allowed.has(key)) {
      return reply.status(400).send({ error: 'Unsupported config key' });
    }

    await upsertAdminConfig(key, parsed.data.value, request.userId);
    await writeAuditLog(request.userId, 'admin_config_updated', {
      key,
      value: parsed.data.value,
    });
    return reply.send({ ok: true });
  });

  fastify.post('/actions/ban', { preHandler: [authenticate, requireAdmin] }, async (request, reply) => {
    const parsed = UserActionSchema.safeParse(request.body ?? {});
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid payload' });
    await query('UPDATE users SET is_banned = TRUE WHERE user_id = $1', [parsed.data.user_id]);
    await writeAuditLog(request.userId, 'user_banned', parsed.data);
    return reply.send({ ok: true });
  });

  fastify.post('/actions/unban', { preHandler: [authenticate, requireAdmin] }, async (request, reply) => {
    const parsed = UserActionSchema.safeParse(request.body ?? {});
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid payload' });
    await query('UPDATE users SET is_banned = FALSE WHERE user_id = $1', [parsed.data.user_id]);
    await writeAuditLog(request.userId, 'user_unbanned', parsed.data);
    return reply.send({ ok: true });
  });

  fastify.post('/actions/regen-daily', { preHandler: [authenticate, requireAdmin] }, async (request, reply) => {
    const today = new Date().toISOString().slice(0, 10);
    await query('DELETE FROM daily_challenges WHERE challenge_date = $1', [today]);
    const next = await ensureDailyChallengeForToday();
    await writeAuditLog(request.userId, 'daily_regenerated', { challenge_date: today });
    return reply.send({ ok: true, challenge_date: next.challenge_date, seed: next.seed });
  });

  fastify.post('/actions/matchmaking-pause', { preHandler: [authenticate, requireAdmin] }, async (request, reply) => {
    setMatchmakingPaused(true);
    await writeAuditLog(request.userId, 'matchmaking_paused', {});
    return reply.send({ ok: true, paused: true });
  });

  fastify.post('/actions/matchmaking-resume', { preHandler: [authenticate, requireAdmin] }, async (request, reply) => {
    setMatchmakingPaused(false);
    await writeAuditLog(request.userId, 'matchmaking_resumed', {});
    return reply.send({ ok: true, paused: false });
  });

  fastify.get('/users', { preHandler: [authenticate, requireAdmin] }, async (request, reply) => {
    const parsed = UserSearchSchema.safeParse(request.query ?? {});
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid query params' });
    const limit = parsed.data.limit ?? 25;
    const search = `%${(parsed.data.search ?? '').trim()}%`;
    const rows = await query(
      `SELECT user_id, username, email, level, xp, mmr, is_banned, is_admin, created_at
       FROM users
       WHERE ($1 = '%%' OR username ILIKE $1 OR email ILIKE $1)
       ORDER BY created_at DESC
       LIMIT $2`,
      [search, limit],
    );
    return reply.send(rows);
  });

  fastify.get<{ Params: { userId: string } }>('/users/:userId', { preHandler: [authenticate, requireAdmin] }, async (request, reply) => {
    const user = await queryOne(
      `SELECT user_id, username, email, level, xp, mmr, is_banned, is_admin, created_at
       FROM users WHERE user_id = $1`,
      [request.params.userId],
    );
    if (!user) return reply.status(404).send({ error: 'User not found' });

    const [recentGames, goldTransactions] = await Promise.all([
      query(
        `SELECT g.game_id, g.era_id, g.status, g.created_at, g.ended_at, gp.final_rank, gp.xp_earned, gp.mmr_change
         FROM game_players gp
         JOIN games g ON g.game_id = gp.game_id
         WHERE gp.user_id = $1
         ORDER BY g.created_at DESC
         LIMIT 20`,
        [request.params.userId],
      ),
      query(
        `SELECT amount, reason, created_at
         FROM gold_transactions
         WHERE user_id = $1
         ORDER BY created_at DESC
         LIMIT 20`,
        [request.params.userId],
      ),
    ]);

    return reply.send({ user, recent_games: recentGames, gold_transactions: goldTransactions });
  });

  fastify.get('/audit-log', { preHandler: [authenticate, requireAdmin] }, async (request, reply) => {
    const q = request.query as { limit?: string };
    const limit = Math.min(Math.max(Number(q.limit ?? 50), 1), 200);
    const rows = await query(
      `SELECT l.id, l.action, l.payload, l.created_at, l.admin_user_id, u.username AS admin_username
       FROM admin_audit_log l
       JOIN users u ON u.user_id = l.admin_user_id
       ORDER BY l.created_at DESC
       LIMIT $1`,
      [limit],
    );
    return reply.send(rows);
  });

  // Ensure cache gets populated in long-running servers even before first PATCH.
  await refreshAdminConfigCache().catch(() => {});
}
