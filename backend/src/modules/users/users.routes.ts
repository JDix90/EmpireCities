import type { FastifyInstance } from 'fastify';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { authenticate } from '../../middleware/authenticate';
import { rejectGuest } from '../../middleware/rejectGuest';
import { query, queryOne } from '../../db/postgres';
import { getLeaderboard } from '../../db/redis';

const DeleteAccountSchema = z.object({
  password: z.string().min(1, 'Password is required to delete your account'),
});

type RatingRow = { rating_type: string; mu: number; phi: number };

/** Canonical ordering for `friendships.user_id_a` / `user_id_b` (UUID string compare). */
function orderedPair(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a];
}

function buildRatingsMap(rows: RatingRow[]): Record<string, { mu: number; phi: number; display: number; provisional: boolean }> {
  const ratings: Record<string, { mu: number; phi: number; display: number; provisional: boolean }> = {};
  for (const r of rows) {
    ratings[r.rating_type] = {
      mu: r.mu,
      phi: r.phi,
      display: Math.round(r.mu),
      provisional: r.phi > 150,
    };
  }
  return ratings;
}

/** Works before migration 004 (no user_ratings table). */
async function fetchUserRatingsSafe(userId: string): Promise<Record<string, { mu: number; phi: number; display: number; provisional: boolean }>> {
  try {
    const ratingRows = await query<RatingRow>(
      'SELECT rating_type, mu, phi FROM user_ratings WHERE user_id = $1',
      [userId],
    );
    return buildRatingsMap(ratingRows);
  } catch {
    return {};
  }
}

export async function usersRoutes(fastify: FastifyInstance): Promise<void> {
  // ── GET /api/users/me ────────────────────────────────────────────────────
  fastify.get('/me', { preHandler: authenticate }, async (request, reply) => {
    type UserRow = {
      user_id: string;
      username: string;
      level: number;
      xp: number;
      mmr: number;
      avatar_url: string | null;
      created_at: Date;
      equipped_frame?: string | null;
      equipped_marker?: string | null;
      gold: number;
    };

    let user: UserRow | null = null;
    try {
      user = await queryOne<UserRow>(
        `SELECT user_id, username, level, xp, mmr, avatar_url, created_at,
                equipped_frame, equipped_marker, COALESCE(gold, 0) AS gold
         FROM users WHERE user_id = $1`,
        [request.userId],
      );
    } catch {
      user = await queryOne<UserRow>(
        `SELECT user_id, username, level, xp, mmr, avatar_url, created_at,
                COALESCE(gold, 0) AS gold
         FROM users WHERE user_id = $1`,
        [request.userId],
      );
    }
    if (!user) return reply.status(404).send({ error: 'User not found' });

    const ratings = await fetchUserRatingsSafe(request.userId);
    const tutorialRow = await queryOne<{ cnt: string }>(
      `SELECT COUNT(*) AS cnt FROM user_achievements
       WHERE user_id = $1 AND achievement_id = 'tutorial_complete'`,
      [request.userId],
    );
    const has_completed_tutorial = parseInt(tutorialRow?.cnt ?? '0', 10) > 0;
    return reply.send({ ...user, ratings, has_completed_tutorial });
  });

  // ── DELETE /api/users/me (account deletion — run migration 003 first) ───
  fastify.delete('/me', { preHandler: [authenticate, rejectGuest] }, async (request, reply) => {
    const parsed = DeleteAccountSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid input', details: parsed.error.flatten() });
    }
    const row = await queryOne<{ password_hash: string }>(
      'SELECT password_hash FROM users WHERE user_id = $1',
      [request.userId],
    );
    if (!row) return reply.status(404).send({ error: 'User not found' });
    const ok = await bcrypt.compare(parsed.data.password, row.password_hash);
    if (!ok) return reply.status(401).send({ error: 'Incorrect password' });

    await query('DELETE FROM users WHERE user_id = $1', [request.userId]);

    reply.clearCookie('refreshToken', { path: '/api/auth' });
    return reply.send({ message: 'Account deleted' });
  });

  // ── GET /api/users/me/active-games ──────────────────────────────────────
  fastify.get('/me/active-games', { preHandler: authenticate }, async (request, reply) => {
    const games = await query<{
      game_id: string; era_id: string; game_type: string; created_at: Date;
      started_at: Date | null; turn_number: number | null; saved_at: Date | null;
      async_mode: boolean; async_turn_deadline: Date | null;
      current_player_id: string | null;
    }>(
      `SELECT g.game_id, g.era_id, g.game_type, g.created_at, g.started_at,
              (gs.state_json::jsonb->>'turn_number')::int AS turn_number,
              gs.saved_at,
              g.async_mode,
              g.async_turn_deadline,
              (gs.state_json::jsonb->'players'->((gs.state_json::jsonb->>'current_player_index')::int)->>'player_id') AS current_player_id
       FROM games g
       JOIN game_players gp ON gp.game_id = g.game_id
       LEFT JOIN LATERAL (
         SELECT state_json::text::jsonb AS state_json, saved_at FROM game_states
         WHERE game_id = g.game_id ORDER BY turn_number DESC LIMIT 1
       ) gs ON true
       WHERE gp.user_id = $1 AND g.status = 'in_progress'
         AND COALESCE(g.settings_json::jsonb->>'tutorial', 'false') <> 'true'
       ORDER BY COALESCE(gs.saved_at, g.started_at, g.created_at) DESC`,
      [request.userId],
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
      [request.userId],
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

    const recentGames = await query<{ won: boolean; ended_at: Date }>(
      `SELECT (gp.final_rank = 1) AS won, g.ended_at
       FROM game_players gp
       JOIN games g ON g.game_id = gp.game_id
       WHERE gp.user_id = $1 AND g.status = 'completed'
       ORDER BY g.ended_at DESC
       LIMIT 100`,
      [request.userId],
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

    const ratings = await fetchUserRatingsSafe(request.userId);

    return reply.send({
      overall,
      solo,
      multi,
      hybrid,
      by_era: byEra,
      streaks: { current_win: currentWinStreak, best_win: bestWinStreak },
      favorite_era: favoriteEra,
      ratings,
    });
  });

  // ── GET /api/users/me/achievements ──────────────────────────────────────
  fastify.get('/me/achievements', { preHandler: [authenticate, rejectGuest] }, async (request, reply) => {
    const achievements = await query(
      `SELECT a.achievement_id, a.name, a.description, a.xp_reward, a.icon_url, ua.unlocked_at
       FROM user_achievements ua
       JOIN achievements a ON a.achievement_id = ua.achievement_id
       WHERE ua.user_id = $1
       ORDER BY ua.unlocked_at DESC`,
      [request.userId],
    );
    return reply.send(achievements);
  });

  // ── GET /api/users/me/games ──────────────────────────────────────────────
  fastify.get('/me/games', { preHandler: authenticate }, async (request, reply) => {
    try {
      const games = await query(
        `SELECT g.game_id, g.era_id, g.status, g.created_at, g.ended_at,
                g.is_ranked, gp.player_color, gp.final_rank, gp.xp_earned, gp.mmr_change
         FROM game_players gp
         JOIN games g ON g.game_id = gp.game_id
         WHERE gp.user_id = $1
           AND COALESCE(g.settings_json::jsonb->>'tutorial', 'false') <> 'true'
         ORDER BY g.created_at DESC
         LIMIT 20`,
        [request.userId],
      );
      return reply.send(games);
    } catch {
      const games = await query(
        `SELECT g.game_id, g.era_id, g.status, g.created_at, g.ended_at,
                gp.player_color, gp.final_rank, gp.xp_earned, gp.mmr_change
         FROM game_players gp
         JOIN games g ON g.game_id = gp.game_id
         WHERE gp.user_id = $1
           AND COALESCE(g.settings_json::jsonb->>'tutorial', 'false') <> 'true'
         ORDER BY g.created_at DESC
         LIMIT 20`,
        [request.userId],
      );
      return reply.send(games);
    }
  });

  // ── GET /api/users/achievements (all definitions) — before /:userId ─────
  fastify.get('/achievements', async (_request, reply) => {
    const rows = await query(
      'SELECT achievement_id, name, description, xp_reward, icon_url FROM achievements ORDER BY name',
    );
    return reply.send(rows);
  });

  // ── GET /api/users/me/cosmetics ──────────────────────────────────────────
  fastify.get('/me/cosmetics', { preHandler: [authenticate, rejectGuest] }, async (request, reply) => {
    try {
      const owned = await query(
        `SELECT c.cosmetic_id, c.type, c.name, c.description, c.asset_url,
                (c.cosmetic_id = u.equipped_frame) AS is_equipped_frame,
                (c.cosmetic_id = u.equipped_marker) AS is_equipped_marker
         FROM user_cosmetics uc
         JOIN cosmetics c ON c.cosmetic_id = uc.cosmetic_id
         CROSS JOIN users u
         WHERE u.user_id = $1 AND uc.user_id = $1`,
        [request.userId],
      );
      return reply.send(owned);
    } catch {
      const owned = await query(
        `SELECT c.cosmetic_id, c.type, c.name, c.description, c.asset_url,
                FALSE AS is_equipped_frame, FALSE AS is_equipped_marker
         FROM user_cosmetics uc
         JOIN cosmetics c ON c.cosmetic_id = uc.cosmetic_id
         WHERE uc.user_id = $1`,
        [request.userId],
      );
      return reply.send(owned);
    }
  });

  // ── PUT /api/users/me/cosmetics/equip ────────────────────────────────────
  fastify.put('/me/cosmetics/equip', { preHandler: [authenticate, rejectGuest] }, async (request, reply) => {
    const body = request.body as { frame_id?: string; marker_id?: string } | undefined;
    if (!body) return reply.status(400).send({ error: 'Missing body' });

    if (body.frame_id) {
      const owns = await queryOne(
        `SELECT 1 FROM user_cosmetics uc JOIN cosmetics c ON c.cosmetic_id = uc.cosmetic_id
         WHERE uc.user_id = $1 AND uc.cosmetic_id = $2 AND c.type IN ('profile_frame', 'profile_banner')`,
        [request.userId, body.frame_id],
      );
      if (!owns) return reply.status(403).send({ error: 'Cosmetic not owned or wrong type' });
    }
    if (body.marker_id) {
      const owns = await queryOne(
        `SELECT 1 FROM user_cosmetics uc JOIN cosmetics c ON c.cosmetic_id = uc.cosmetic_id
         WHERE uc.user_id = $1 AND uc.cosmetic_id = $2 AND c.type = 'map_marker'`,
        [request.userId, body.marker_id],
      );
      if (!owns) return reply.status(403).send({ error: 'Cosmetic not owned or wrong type' });
    }

    try {
      await query(
        `UPDATE users SET equipped_frame = COALESCE($1, equipped_frame),
                          equipped_marker = COALESCE($2, equipped_marker)
         WHERE user_id = $3`,
        [body.frame_id ?? null, body.marker_id ?? null, request.userId],
      );
    } catch {
      return reply.status(503).send({ error: 'Cosmetic equip requires database migration (equipped_frame columns).' });
    }
    return reply.send({ ok: true });
  });

  // ── GET /api/users/leaderboard/:era ─────────────────────────────────────
  fastify.get<{ Params: { era: string } }>('/leaderboard/:era', async (request, reply) => {
    const { era } = request.params;
        const validEras = ['ancient', 'medieval', 'discovery', 'ww2', 'coldwar', 'modern', 'acw', 'risorgimento', 'custom', 'global'];
    if (!validEras.includes(era)) {
      return reply.status(400).send({ error: 'Invalid era' });
    }

    const leaderboard = await getLeaderboard(era, 100);
    if (leaderboard.length === 0) {
      const rows = await query<{ user_id: string; username: string; mmr: number; level: number }>(
        'SELECT user_id, username, mmr, level FROM users ORDER BY mmr DESC LIMIT 100',
      );
      return reply.send(rows);
    }

    const userIds = leaderboard.map((e) => e.userId);
    const users = await query<{ user_id: string; username: string; level: number }>(
      `SELECT user_id, username, level FROM users WHERE user_id = ANY($1)`,
      [userIds],
    );
    const userMap = Object.fromEntries(users.map((u) => [u.user_id, u]));
    const enriched = leaderboard.map((e, i) => ({
      rank: i + 1,
      ...userMap[e.userId],
      mmr: e.mmr,
    }));

    return reply.send(enriched);
  });

  const FriendUsernameSchema = z.object({
    username: z.string().min(1).max(32),
  });
  const FriendOtherSchema = z.object({
    other_user_id: z.string().uuid(),
  });

  // ── GET /api/users/me/game-invites (pending, waiting games only) ─────────
  fastify.get('/me/game-invites', { preHandler: [authenticate, rejectGuest] }, async (request, reply) => {
    const rows = await query<{
      id: string;
      game_id: string;
      created_at: Date;
      era_id: string;
      join_code: string | null;
      status: string;
      inviter_id: string;
      inviter_username: string;
    }>(
      `SELECT gi.id, gi.game_id, gi.created_at, g.era_id, g.join_code, g.status,
              u.user_id AS inviter_id, u.username AS inviter_username
       FROM game_invites gi
       JOIN games g ON g.game_id = gi.game_id
       JOIN users u ON u.user_id = gi.inviter_id
       WHERE gi.invitee_id = $1 AND gi.consumed_at IS NULL AND g.status = 'waiting'
       ORDER BY gi.created_at DESC`,
      [request.userId],
    );
    return reply.send(rows);
  });

  // ── GET /api/users/me/friends/pending ─────────────────────────────────────
  fastify.get('/me/friends/pending', { preHandler: [authenticate, rejectGuest] }, async (request, reply) => {
    const rows = await query<{
      id: string;
      initiated_by: string | null;
      created_at: Date;
      other_user_id: string;
      other_username: string;
    }>(
      `SELECT f.id, f.initiated_by, f.created_at,
              CASE WHEN f.user_id_a = $1 THEN f.user_id_b ELSE f.user_id_a END AS other_user_id,
              ou.username AS other_username
       FROM friendships f
       JOIN users ou ON ou.user_id = (CASE WHEN f.user_id_a = $1 THEN f.user_id_b ELSE f.user_id_a END)
       WHERE (f.user_id_a = $1 OR f.user_id_b = $1) AND f.status = 'pending'`,
      [request.userId],
    );
    return reply.send(
      rows.map((r) => ({
        ...r,
        direction: r.initiated_by === request.userId ? 'outgoing' : 'incoming',
      })),
    );
  });

  // ── POST /api/users/me/friends/request ──────────────────────────────────
  fastify.post('/me/friends/request', { preHandler: [authenticate, rejectGuest] }, async (request, reply) => {
    const parsed = FriendUsernameSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid input', details: parsed.error.flatten() });
    }
    const uname = parsed.data.username.trim();
    const target = await queryOne<{ user_id: string }>(
      'SELECT user_id FROM users WHERE LOWER(username) = LOWER($1)',
      [uname],
    );
    if (!target) return reply.status(404).send({ error: 'User not found' });
    if (target.user_id === request.userId) {
      return reply.status(400).send({ error: 'Cannot send a friend request to yourself' });
    }

    const [a, b] = orderedPair(request.userId, target.user_id);
    const existing = await queryOne<{ status: string }>(
      'SELECT status FROM friendships WHERE user_id_a = $1 AND user_id_b = $2',
      [a, b],
    );
    if (existing) {
      if (existing.status === 'accepted') return reply.status(409).send({ error: 'Already friends' });
      if (existing.status === 'pending') return reply.status(409).send({ error: 'Friend request already pending' });
      return reply.status(403).send({ error: 'Cannot send friend request' });
    }

    await query(
      `INSERT INTO friendships (user_id_a, user_id_b, status, initiated_by)
       VALUES ($1, $2, 'pending', $3)`,
      [a, b, request.userId],
    );
    return reply.status(201).send({ ok: true });
  });

  // ── POST /api/users/me/friends/accept ───────────────────────────────────
  fastify.post('/me/friends/accept', { preHandler: [authenticate, rejectGuest] }, async (request, reply) => {
    const parsed = FriendOtherSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid input', details: parsed.error.flatten() });
    }
    const [a, b] = orderedPair(request.userId, parsed.data.other_user_id);
    const row = await queryOne<{ id: string; initiated_by: string | null }>(
      `SELECT id, initiated_by FROM friendships
       WHERE user_id_a = $1 AND user_id_b = $2 AND status = 'pending'`,
      [a, b],
    );
    if (!row) return reply.status(404).send({ error: 'No pending friend request' });
    if (row.initiated_by === request.userId) {
      return reply.status(400).send({ error: 'You cannot accept your own outgoing request' });
    }
    await query(`UPDATE friendships SET status = 'accepted' WHERE id = $1`, [row.id]);
    return reply.send({ ok: true });
  });

  // ── POST /api/users/me/friends/decline ──────────────────────────────────
  fastify.post('/me/friends/decline', { preHandler: [authenticate, rejectGuest] }, async (request, reply) => {
    const parsed = FriendOtherSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid input', details: parsed.error.flatten() });
    }
    const [a, b] = orderedPair(request.userId, parsed.data.other_user_id);
    const row = await queryOne<{ id: string }>(
      `SELECT id FROM friendships WHERE user_id_a = $1 AND user_id_b = $2 AND status = 'pending'`,
      [a, b],
    );
    if (!row) return reply.status(404).send({ error: 'No pending friend request' });
    await query('DELETE FROM friendships WHERE id = $1', [row.id]);
    return reply.send({ ok: true });
  });

  // ── DELETE /api/users/me/friends/:otherUserId ───────────────────────────
  fastify.delete<{ Params: { otherUserId: string } }>(
    '/me/friends/:otherUserId',
    { preHandler: [authenticate, rejectGuest] },
    async (request, reply) => {
      const [a, b] = orderedPair(request.userId, request.params.otherUserId);
      const r = await query(
        'DELETE FROM friendships WHERE user_id_a = $1 AND user_id_b = $2 RETURNING id',
        [a, b],
      );
      if (r.length === 0) return reply.status(404).send({ error: 'Friendship not found' });
      return reply.send({ ok: true });
    },
  );

  // ── GET /api/users/me/friends ────────────────────────────────────────────
  fastify.get('/me/friends', { preHandler: [authenticate, rejectGuest] }, async (request, reply) => {
    const friends = await query(
      `SELECT u.user_id, u.username, u.level, u.mmr, u.avatar_url, f.status, f.created_at
       FROM friendships f
       JOIN users u ON (
         CASE WHEN f.user_id_a = $1 THEN f.user_id_b ELSE f.user_id_a END = u.user_id
       )
       WHERE (f.user_id_a = $1 OR f.user_id_b = $1)
         AND f.status = 'accepted'`,
      [request.userId],
    );
    return reply.send(friends);
  });

  // ── GET /api/users/:userId (public profile) — must be after /achievements etc ─
  fastify.get<{ Params: { userId: string } }>('/:userId', async (request, reply) => {
    const user = await queryOne<{
      user_id: string; username: string; level: number; mmr: number; avatar_url: string | null;
    }>(
      'SELECT user_id, username, level, mmr, avatar_url FROM users WHERE user_id = $1',
      [request.params.userId],
    );
    if (!user) return reply.status(404).send({ error: 'User not found' });
    return reply.send(user);
  });

  // ── GET /api/users/me/preferences ──────────────────────────────────────
  fastify.get('/me/preferences', { preHandler: [authenticate, rejectGuest] }, async (request, reply) => {
    // UPSERT default row if missing
    const prefs = await queryOne<{ push_enabled: boolean; email_notifications: boolean }>(
      `INSERT INTO user_preferences (user_id) VALUES ($1)
       ON CONFLICT (user_id) DO NOTHING
       RETURNING push_enabled, email_notifications`,
      [request.userId],
    );
    if (prefs) return reply.send(prefs);

    // Row already existed — fetch it
    const existing = await queryOne<{ push_enabled: boolean; email_notifications: boolean }>(
      'SELECT push_enabled, email_notifications FROM user_preferences WHERE user_id = $1',
      [request.userId],
    );
    return reply.send(existing ?? { push_enabled: true, email_notifications: false });
  });

  // ── PUT /api/users/me/preferences ──────────────────────────────────────
  const UpdatePreferencesSchema = z.object({
    push_enabled: z.boolean().optional(),
    email_notifications: z.boolean().optional(),
  });

  fastify.put('/me/preferences', { preHandler: [authenticate, rejectGuest] }, async (request, reply) => {
    const body = UpdatePreferencesSchema.parse(request.body);
    const updates: string[] = [];
    const values: unknown[] = [];
    let idx = 2; // $1 = user_id

    if (body.push_enabled !== undefined) {
      updates.push(`push_enabled = $${idx++}`);
      values.push(body.push_enabled);
    }
    if (body.email_notifications !== undefined) {
      updates.push(`email_notifications = $${idx++}`);
      values.push(body.email_notifications);
    }

    if (updates.length === 0) {
      return reply.send({ ok: true });
    }

    updates.push(`updated_at = NOW()`);

    await query(
      `INSERT INTO user_preferences (user_id, ${body.push_enabled !== undefined ? 'push_enabled,' : ''} ${body.email_notifications !== undefined ? 'email_notifications,' : ''} updated_at)
       VALUES ($1, ${values.map((_, i) => `$${i + 2}`).join(', ')}, NOW())
       ON CONFLICT (user_id) DO UPDATE SET ${updates.join(', ')}`,
      [request.userId, ...values],
    );

    return reply.send({ ok: true });
  });

  // ── POST /api/users/me/push-tokens ─────────────────────────────────────
  const RegisterPushTokenSchema = z.object({
    token: z.string().min(1).max(512),
    platform: z.enum(['web', 'ios', 'android']).default('web'),
  });

  fastify.post('/me/push-tokens', { preHandler: [authenticate, rejectGuest] }, async (request, reply) => {
    const body = RegisterPushTokenSchema.parse(request.body);
    await query(
      `INSERT INTO push_tokens (user_id, token, platform)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id, token) DO UPDATE SET platform = $3, created_at = NOW()`,
      [request.userId, body.token, body.platform],
    );
    return reply.send({ ok: true });
  });

  // ── DELETE /api/users/me/push-tokens/:tokenId ──────────────────────────
  fastify.delete<{ Params: { tokenId: string } }>(
    '/me/push-tokens/:tokenId',
    { preHandler: [authenticate, rejectGuest] },
    async (request, reply) => {
      await query(
        'DELETE FROM push_tokens WHERE token_id = $1 AND user_id = $2',
        [request.params.tokenId, request.userId],
      );
      return reply.send({ ok: true });
    },
  );
}
