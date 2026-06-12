import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticate } from '../../middleware/authenticate';
import { requireAdmin } from '../../middleware/requireAdmin';
import { query, queryOne, withTransaction } from '../../db/postgres';
import { removeFromAllLeaderboards } from '../../db/redis';
import { getActiveGameMetrics } from '../../sockets/gameSocket';
import { getMigrationMetrics } from '../../sockets/migrationMetrics';
import { getInitialRatings } from '../../game-engine/rating/ratingService';
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

const ResetUserStatsSchema = z
  .object({
    user_id: z.string().uuid(),
    scope: z.enum(['all', 'era', 'map', 'era_map']),
    era_id: z.string().trim().min(1).max(64).optional(),
    map_id: z.string().trim().min(1).max(128).optional(),
  })
  .superRefine((value, ctx) => {
    if ((value.scope === 'era' || value.scope === 'era_map') && !value.era_id) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['era_id'],
        message: 'era_id is required for this scope',
      });
    }
    if ((value.scope === 'map' || value.scope === 'era_map') && !value.map_id) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['map_id'],
        message: 'map_id is required for this scope',
      });
    }
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

const SETTING_TOGGLES = [
  { key: 'fog_of_war', label: 'Fog of War', defaultValue: false },
  { key: 'territory_selection', label: 'Territory Draft', defaultValue: false },
  { key: 'factions_enabled', label: 'Asymmetric Factions', defaultValue: false },
  { key: 'economy_enabled', label: 'Economy & Buildings', defaultValue: false },
  { key: 'tech_trees_enabled', label: 'Technology Trees', defaultValue: false },
  { key: 'events_enabled', label: 'Historical Events', defaultValue: false },
  { key: 'naval_enabled', label: 'Naval Warfare', defaultValue: false },
  { key: 'stability_enabled', label: 'Population & Stability', defaultValue: false },
  { key: 'async_mode', label: 'Async Mode', defaultValue: false },
] as const;

export async function adminRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get('/metrics/overview', { preHandler: [authenticate, requireAdmin] }, async (request, reply) => {
    const parsed = DateFilterSchema.safeParse(request.query ?? {});
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid query params' });
    const dw = dateWhere(parsed.data);

    const [users, games, completed, queue, byStatus, inProgress, waiting] = await Promise.all([
      // Audience split + activity in one pass. "Registered" excludes guests;
      // "upgraded" (subset of registered) measures the guest→account funnel
      // via users.upgraded_at (migration 034). active_24h/7d come from
      // last_login_at (migration 033), which refresh rotation keeps fresh.
      queryOne<{
        total: string; registered: string; guests: string; upgraded: string;
        active_24h: string; active_7d: string;
      }>(
        `SELECT COUNT(*)::text AS total,
                COUNT(*) FILTER (WHERE COALESCE(is_guest, false) = false)::text AS registered,
                COUNT(*) FILTER (WHERE COALESCE(is_guest, false) = true)::text AS guests,
                COUNT(*) FILTER (WHERE upgraded_at IS NOT NULL)::text AS upgraded,
                COUNT(*) FILTER (WHERE last_login_at > NOW() - INTERVAL '24 hours')::text AS active_24h,
                COUNT(*) FILTER (WHERE last_login_at > NOW() - INTERVAL '7 days')::text AS active_7d
         FROM users`,
      ),
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
      total_users: Number(users?.total ?? 0),
      user_breakdown: {
        registered: Number(users?.registered ?? 0),
        guests: Number(users?.guests ?? 0),
        upgraded: Number(users?.upgraded ?? 0),
        active_24h: Number(users?.active_24h ?? 0),
        active_7d: Number(users?.active_7d ?? 0),
      },
      // Live process signals (not range-filtered): the in_progress row count
      // above includes abandoned games awaiting the cleanup sweep, so it is
      // NOT "sessions currently running" — active_game_rooms is.
      ops: {
        active_game_rooms: getActiveGameMetrics().activeGameRooms,
        ...getMigrationMetrics(),
        rss_mb: Math.round(process.memoryUsage().rss / 1024 / 1024),
        uptime_seconds: Math.round(process.uptime()),
      },
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

  // Distinct stat dimensions used by admin reset tooling.
  fastify.get('/metrics/stat-options', { preHandler: [authenticate, requireAdmin] }, async (_request, reply) => {
    const [eraRows, mapRows] = await Promise.all([
      query<{ era_id: string }>(
        `SELECT DISTINCT g.era_id
         FROM games g
         WHERE g.era_id IS NOT NULL AND g.era_id <> ''
         ORDER BY g.era_id ASC`,
      ),
      query<{ map_id: string }>(
        `SELECT DISTINCT g.map_id
         FROM games g
         WHERE g.map_id IS NOT NULL AND g.map_id <> ''
         ORDER BY g.map_id ASC`,
      ),
    ]);
    return reply.send({
      era_ids: eraRows.map((r) => r.era_id),
      map_ids: mapRows.map((r) => r.map_id),
    });
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

  fastify.get('/metrics/settings-toggles', { preHandler: [authenticate, requireAdmin] }, async (_request, reply) => {
    const totals = await queryOne<{ total_games: string }>(
      `SELECT COUNT(*)::text AS total_games
       FROM games`,
    );
    const totalGames = Number(totals?.total_games ?? 0);

    if (totalGames === 0) {
      return reply.send({
        total_games: 0,
        rows: SETTING_TOGGLES.map((toggle) => ({
          setting_key: toggle.key,
          setting_label: toggle.label,
          enabled_count: 0,
          enabled_percent: 0,
        })),
      });
    }

    const usageBySetting = await Promise.all(
      SETTING_TOGGLES.map(async (toggle) => {
        const row = await queryOne<{ enabled_count: string }>(
          `SELECT COUNT(*)::text AS enabled_count
           FROM games g
           WHERE COALESCE((g.settings_json ->> $1)::boolean, $2::boolean) = TRUE`,
          [toggle.key, toggle.defaultValue],
        );
        const enabledCount = Number(row?.enabled_count ?? 0);
        const enabledPercent = Number(((enabledCount / totalGames) * 100).toFixed(1));
        return {
          setting_key: toggle.key,
          setting_label: toggle.label,
          enabled_count: enabledCount,
          enabled_percent: enabledPercent,
        };
      }),
    );

    return reply.send({
      total_games: totalGames,
      rows: usageBySetting.sort((a, b) => b.enabled_count - a.enabled_count),
    });
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

  fastify.post('/actions/reset-user-stats', { preHandler: [authenticate, requireAdmin] }, async (request, reply) => {
    const parsed = ResetUserStatsSchema.safeParse(request.body ?? {});
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid payload' });

    const { user_id, scope, era_id, map_id } = parsed.data;
    const initialRatings = getInitialRatings();

    const result = await withTransaction(async (client) => {
      const user = await client.query<{ user_id: string; username: string }>(
        'SELECT user_id, username FROM users WHERE user_id = $1',
        [user_id],
      );
      if (user.rows.length === 0) {
        return { code: 'not_found' as const };
      }

      const filters: string[] = [];
      const args: unknown[] = [user_id];
      if (scope === 'era' || scope === 'era_map') {
        args.push(era_id);
        filters.push(`g.era_id = $${args.length}`);
      }
      if (scope === 'map' || scope === 'era_map') {
        args.push(map_id);
        filters.push(`g.map_id = $${args.length}`);
      }
      const scopeSql = filters.length ? ` AND ${filters.join(' AND ')}` : '';

      const impacted = await client.query<{
        game_count: string;
        xp_sum: string;
        mmr_sum: string;
        wins: string;
      }>(
        `SELECT COUNT(*)::text AS game_count,
                COALESCE(SUM(gp.xp_earned), 0)::text AS xp_sum,
                COALESCE(SUM(gp.mmr_change), 0)::text AS mmr_sum,
                COALESCE(SUM(CASE WHEN gp.final_rank = 1 THEN 1 ELSE 0 END), 0)::text AS wins
         FROM game_players gp
         JOIN games g ON g.game_id = gp.game_id
         WHERE gp.user_id = $1
           AND g.status = 'completed'
           AND gp.final_rank IS NOT NULL
           ${scopeSql}`,
        args,
      );
      const gameCount = Number(impacted.rows[0]?.game_count ?? 0);
      if (gameCount === 0) {
        return {
          code: 'ok' as const,
          username: user.rows[0]!.username,
          gameCount: 0,
          xpRemoved: 0,
          mmrDeltaRemoved: 0,
          winsRemoved: 0,
        };
      }

      await client.query(
        `UPDATE game_players gp
         SET xp_earned = 0,
             mmr_change = 0,
             final_rank = NULL
         FROM games g
         WHERE gp.game_id = g.game_id
           AND gp.user_id = $1
           AND g.status = 'completed'
           AND gp.final_rank IS NOT NULL
           ${scopeSql}`,
        args,
      );

      const agg = await client.query<{ xp_sum: string; mmr_sum: string }>(
        `SELECT COALESCE(SUM(gp.xp_earned), 0)::text AS xp_sum,
                COALESCE(SUM(gp.mmr_change), 0)::text AS mmr_sum
         FROM game_players gp
         JOIN games g ON g.game_id = gp.game_id
         WHERE gp.user_id = $1
           AND g.status = 'completed'
           AND gp.final_rank IS NOT NULL`,
        [user_id],
      );
      const xp = Math.max(0, Number(agg.rows[0]?.xp_sum ?? 0));
      const mmr = Math.max(1000, 1000 + Number(agg.rows[0]?.mmr_sum ?? 0));
      const level = Math.floor(Math.sqrt(xp / 250)) + 1;
      await client.query(
        `UPDATE users
         SET xp = $1,
             mmr = $2,
             level = $3,
             win_streak = 0
         WHERE user_id = $4`,
        [xp, mmr, level, user_id],
      );

      // Ratings become inconsistent once we null-out historical result rows,
      // so reset them to configured defaults. This keeps matchmaking sane.
      await client.query(
        `INSERT INTO user_ratings (user_id, rating_type, mu, phi, sigma, last_rated)
         VALUES
           ($1, 'solo', $2, $3, 0.06, NULL),
           ($1, 'ranked', $2, $3, 0.06, NULL)
         ON CONFLICT (user_id, rating_type)
         DO UPDATE SET
           mu = EXCLUDED.mu,
           phi = EXCLUDED.phi,
           sigma = EXCLUDED.sigma,
           last_rated = NULL`,
        [user_id, initialRatings.mu, initialRatings.phi],
      );

      return {
        code: 'ok' as const,
        username: user.rows[0]!.username,
        gameCount,
        xpRemoved: Number(impacted.rows[0]?.xp_sum ?? 0),
        mmrDeltaRemoved: Number(impacted.rows[0]?.mmr_sum ?? 0),
        winsRemoved: Number(impacted.rows[0]?.wins ?? 0),
      };
    });

    if (result.code === 'not_found') {
      return reply.status(404).send({ error: 'User not found' });
    }

    await writeAuditLog(request.userId, 'user_stats_reset', {
      user_id,
      scope,
      era_id: era_id ?? null,
      map_id: map_id ?? null,
      games_affected: result.gameCount,
      xp_removed: result.xpRemoved,
      mmr_delta_removed: result.mmrDeltaRemoved,
      wins_removed: result.winsRemoved,
    });

    return reply.send({
      ok: true,
      user_id,
      username: result.username,
      scope,
      era_id: era_id ?? null,
      map_id: map_id ?? null,
      games_affected: result.gameCount,
      xp_removed: result.xpRemoved,
      mmr_delta_removed: result.mmrDeltaRemoved,
      wins_removed: result.winsRemoved,
    });
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
      `SELECT u.user_id, u.username, u.email, u.level, u.xp, u.mmr, u.is_banned, u.is_admin,
              COALESCE(u.is_guest, false) AS is_guest, u.created_at, u.last_login_at,
              COALESCE(gp.games_played, 0)::int AS games_played
       FROM users u
       LEFT JOIN (
         SELECT user_id, COUNT(*) AS games_played
         FROM game_players
         GROUP BY user_id
       ) gp ON gp.user_id = u.user_id
       WHERE ($1 = '%%' OR u.username ILIKE $1 OR u.email ILIKE $1)
       ORDER BY u.created_at DESC
       LIMIT $2`,
      [search, limit],
    );
    return reply.send(rows);
  });

  fastify.get<{ Params: { userId: string } }>('/users/:userId', { preHandler: [authenticate, requireAdmin] }, async (request, reply) => {
    const user = await queryOne(
      `SELECT u.user_id, u.username, u.email, u.level, u.xp, u.mmr, u.is_banned, u.is_admin,
              COALESCE(u.is_guest, false) AS is_guest, u.created_at, u.last_login_at,
              (SELECT COUNT(*)::int FROM game_players gp WHERE gp.user_id = u.user_id) AS games_played
       FROM users u WHERE u.user_id = $1`,
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

  /**
   * Permanently delete a user (cascades per migration 003; Redis leaderboard
   * entries purged separately). Guard rails: admins cannot be deleted through
   * this endpoint (demote first) and an admin cannot delete themselves — both
   * prevent fat-finger lockouts. The action is audit-logged with the deleted
   * identity so the log survives the row.
   */
  fastify.delete<{ Params: { userId: string } }>('/users/:userId', { preHandler: [authenticate, requireAdmin] }, async (request, reply) => {
    const { userId } = request.params;
    if (userId === request.userId) {
      return reply.status(400).send({ error: 'You cannot delete your own account from the admin panel' });
    }
    const target = await queryOne<{ user_id: string; username: string; email: string; is_admin: boolean }>(
      'SELECT user_id, username, email, COALESCE(is_admin, false) AS is_admin FROM users WHERE user_id = $1',
      [userId],
    );
    if (!target) return reply.status(404).send({ error: 'User not found' });
    if (target.is_admin) {
      return reply.status(403).send({ error: 'Admins cannot be deleted — remove admin status first' });
    }

    await query('DELETE FROM users WHERE user_id = $1', [userId]);

    // Non-critical cleanup: orphaned Redis leaderboard entries would otherwise
    // show the deleted user until manually purged (same pattern as self-delete).
    removeFromAllLeaderboards(userId).catch((err) => {
      console.error('[Admin] Failed to purge leaderboard entries on user delete:', err);
    });

    await writeAuditLog(request.userId!, 'user_delete', {
      user_id: target.user_id,
      username: target.username,
      email: target.email,
    });
    return reply.send({ ok: true });
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
