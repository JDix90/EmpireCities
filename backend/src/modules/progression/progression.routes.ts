import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticate } from '../../middleware/authenticate';
import { rejectGuest } from '../../middleware/rejectGuest';
import { query, queryOne } from '../../db/postgres';
import { claimDailyLogin, checkOnboardingQuests } from '../../game-engine/progression/progressionService';
import { getTier } from '../../game-engine/rating/ratingService';
import { ONBOARDING_QUESTS } from '@erasofempire/shared';
import { getMonthlyChallenges } from '../../game-engine/progression/challengeService';
import { getSeasonHistory } from '../../game-engine/progression/seasonService';
import { redeemReferralCode, getReferralStats, ensureReferralCode } from '../../game-engine/progression/referralService';

export async function progressionRoutes(fastify: FastifyInstance): Promise<void> {
  // ── POST /api/progression/daily-login ────────────────────────────────────
  fastify.post('/daily-login', { preHandler: [authenticate, rejectGuest] }, async (request, reply) => {
    const claimed = await claimDailyLogin(request.userId);
    const user = await queryOne<{ gold: number; daily_streak: number }>(
      'SELECT COALESCE(gold, 0) AS gold, daily_streak FROM users WHERE user_id = $1',
      [request.userId],
    );

    // Record login in history for calendar UI
    if (claimed) {
      const today = new Date().toISOString().slice(0, 10);
      await query(
        `INSERT INTO user_login_history (user_id, login_date, gold_claimed)
         VALUES ($1, $2, 10) ON CONFLICT (user_id, login_date) DO NOTHING`,
        [request.userId, today],
      );
    }

    return reply.send({ claimed, gold: user?.gold ?? 0, daily_streak: user?.daily_streak ?? 0 });
  });

  // ── GET /api/progression/quests ──────────────────────────────────────────
  fastify.get('/quests', { preHandler: authenticate }, async (request, reply) => {
    const completed = await query<{ quest_id: string; completed_at: string }>(
      'SELECT quest_id, completed_at FROM user_quests WHERE user_id = $1',
      [request.userId],
    );
    const completedMap = new Map(completed.map((r) => [r.quest_id, r.completed_at]));

    let foundCurrent = false;
    const quests = ONBOARDING_QUESTS.map((q) => {
      const completedAt = completedMap.get(q.quest_id) ?? null;
      const isCurrent = !completedAt && !foundCurrent;
      if (isCurrent) foundCurrent = true;
      return {
        ...q,
        completed_at: completedAt,
        is_current: isCurrent,
        is_locked: !completedAt && !isCurrent,
      };
    });

    return reply.send({ quests });
  });

  // ── POST /api/progression/onboarding/advance ─────────────────────────────
  fastify.post('/onboarding/advance', { preHandler: [authenticate, rejectGuest] }, async (request, reply) => {
    const user = await queryOne<{ onboarding_stage: number; has_completed_tutorial: boolean }>(
      'SELECT onboarding_stage, COALESCE(has_completed_tutorial, false) AS has_completed_tutorial FROM users WHERE user_id = $1',
      [request.userId],
    );
    if (!user) return reply.status(404).send({ error: 'User not found' });
    if (user.onboarding_stage >= 3) return reply.send({ onboarding_stage: 3 });

    let newStage = user.onboarding_stage;
    if (user.onboarding_stage === 0 && user.has_completed_tutorial) {
      newStage = 1;
    } else if (user.onboarding_stage === 1) {
      // Check if user completed a guided game
      const guided = await queryOne<{ game_id: string }>(
        `SELECT g.game_id FROM games g
         JOIN game_players gp ON gp.game_id = g.game_id
         WHERE gp.user_id = $1 AND g.status = 'completed'
           AND g.settings_json->>'onboarding_game' = 'true'`,
        [request.userId],
      );
      if (guided) newStage = 2;
    } else if (user.onboarding_stage === 2) {
      newStage = 3;
    }

    if (newStage !== user.onboarding_stage) {
      await query('UPDATE users SET onboarding_stage = $1 WHERE user_id = $2', [newStage, request.userId]);
    }
    return reply.send({ onboarding_stage: newStage });
  });

  // ── POST /api/progression/onboarding/skip ────────────────────────────────
  fastify.post('/onboarding/skip', { preHandler: [authenticate, rejectGuest] }, async (request, reply) => {
    const user = await queryOne<{ onboarding_stage: number }>(
      'SELECT onboarding_stage FROM users WHERE user_id = $1',
      [request.userId],
    );
    if (!user) return reply.status(404).send({ error: 'User not found' });
    if (user.onboarding_stage < 1) {
      return reply.status(400).send({ error: 'Complete the tutorial before skipping' });
    }
    await query('UPDATE users SET onboarding_stage = 3 WHERE user_id = $1', [request.userId]);
    return reply.send({ onboarding_stage: 3 });
  });

  // ── GET /api/progression/season ──────────────────────────────────────────
  fastify.get('/season', { preHandler: authenticate }, async (request, reply) => {
    const season = await queryOne<{ season_id: string; name: string; featured_eras: string[]; started_at: string; ended_at: string }>(
      `SELECT season_id, name, featured_eras, started_at, ended_at FROM seasons
       WHERE NOW() BETWEEN started_at AND ended_at LIMIT 1`,
    );
    if (!season) return reply.send({ season: null });

    const daysRemaining = Math.max(0, Math.ceil((new Date(season.ended_at).getTime() - Date.now()) / 86_400_000));

    // User's tier in this season
    const reward = await queryOne<{ highest_tier: string }>(
      'SELECT highest_tier FROM season_rewards WHERE season_id = $1 AND user_id = $2',
      [season.season_id, request.userId],
    );

    // Current rating for tier calc
    const rating = await queryOne<{ mu: number }>(
      "SELECT mu FROM user_ratings WHERE user_id = $1 AND rating_type = 'ranked'",
      [request.userId],
    );
    const currentTier = getTier(rating?.mu ?? 0);

    return reply.send({
      season: {
        ...season,
        days_remaining: daysRemaining,
        current_tier: currentTier,
        highest_tier: reward?.highest_tier ?? currentTier,
      },
    });
  });

  // ── GET /api/progression/streaks ─────────────────────────────────────────
  fastify.get('/streaks', { preHandler: authenticate }, async (request, reply) => {
    const user = await queryOne<{ win_streak: number; daily_streak: number; last_played_date: string | null }>(
      'SELECT win_streak, daily_streak, last_played_date FROM users WHERE user_id = $1',
      [request.userId],
    );
    return reply.send({
      win_streak: user?.win_streak ?? 0,
      daily_streak: user?.daily_streak ?? 0,
      last_played_date: user?.last_played_date ?? null,
    });
  });

  // ── GET /api/progression/gold-history ────────────────────────────────────
  fastify.get('/gold-history', { preHandler: [authenticate, rejectGuest] }, async (request, reply) => {
    const rows = await query<{ reason: string; total: string }>(
      `SELECT reason, SUM(amount) AS total
       FROM gold_transactions
       WHERE user_id = $1 AND created_at >= date_trunc('month', NOW())
       GROUP BY reason ORDER BY total DESC`,
      [request.userId],
    );
    const total = await queryOne<{ gold: number }>(
      'SELECT COALESCE(gold, 0) AS gold FROM users WHERE user_id = $1',
      [request.userId],
    );
    return reply.send({
      balance: total?.gold ?? 0,
      month_breakdown: rows.map((r) => ({ reason: r.reason, amount: parseInt(r.total, 10) })),
    });
  });

  // ── GET /api/progression/challenges ──────────────────────────────────────
  fastify.get('/challenges', { preHandler: authenticate }, async (request, reply) => {
    const challenges = await getMonthlyChallenges(request.userId);
    const now = new Date();
    const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    const daysRemaining = Math.max(0, Math.ceil((endOfMonth.getTime() - now.getTime()) / 86_400_000));

    return reply.send({
      month: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`,
      days_remaining: daysRemaining,
      challenges,
    });
  });

  // ── GET /api/progression/season/history ──────────────────────────────────
  fastify.get('/season/history', { preHandler: authenticate }, async (request, reply) => {
    const history = await getSeasonHistory(request.userId);
    return reply.send({ seasons: history });
  });

  // ── GET /api/progression/login-calendar ──────────────────────────────────
  fastify.get('/login-calendar', { preHandler: [authenticate, rejectGuest] }, async (request, reply) => {
    const now = new Date();
    const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
    const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    const monthEnd = nextMonth.toISOString().slice(0, 10);

    const logins = await query<{ login_date: string; gold_claimed: number }>(
      `SELECT login_date, gold_claimed FROM user_login_history
       WHERE user_id = $1 AND login_date >= $2 AND login_date < $3
       ORDER BY login_date`,
      [request.userId, monthStart, monthEnd],
    );

    const user = await queryOne<{ daily_streak: number; last_login_date: string | null }>(
      'SELECT daily_streak, last_login_date::text AS last_login_date FROM users WHERE user_id = $1',
      [request.userId],
    );

    const today = now.toISOString().slice(0, 10);
    const alreadyClaimed = user?.last_login_date === today;

    return reply.send({
      month: monthStart,
      days_in_month: new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate(),
      logins: logins.map((l) => l.login_date),
      gold_per_day: 10,
      daily_streak: user?.daily_streak ?? 0,
      already_claimed_today: alreadyClaimed,
    });
  });

  // ── POST /api/progression/referral/redeem ────────────────────────────────
  fastify.post('/referral/redeem', { preHandler: [authenticate, rejectGuest] }, async (request, reply) => {
    const schema = z.object({ code: z.string().min(1).max(16) });
    const parsed = schema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid input', details: parsed.error.flatten() });
    }
    const result = await redeemReferralCode(request.userId, parsed.data.code);
    if (!result.success) {
      return reply.status(400).send({ error: result.error });
    }
    return reply.send({ ok: true, message: 'Referral code redeemed! You received 25 gold.' });
  });

  // ── GET /api/progression/referral ────────────────────────────────────────
  fastify.get('/referral', { preHandler: [authenticate, rejectGuest] }, async (request, reply) => {
    const stats = await getReferralStats(request.userId);
    return reply.send(stats);
  });

  // ── GET /api/progression/referral/code ───────────────────────────────────
  fastify.get('/referral/code', { preHandler: [authenticate, rejectGuest] }, async (request, reply) => {
    const code = await ensureReferralCode(request.userId);
    return reply.send({ referral_code: code });
  });

  // ── GET /api/progression/streak-bonus ────────────────────────────────────
  fastify.get('/streak-bonus', { preHandler: authenticate }, async (request, reply) => {
    const user = await queryOne<{ win_streak: number }>(
      'SELECT win_streak FROM users WHERE user_id = $1',
      [request.userId],
    );
    const streak = user?.win_streak ?? 0;
    const multiplier = getStreakMultiplier(streak);
    return reply.send({
      win_streak: streak,
      gold_multiplier: multiplier,
      next_milestone: getNextStreakMilestone(streak),
    });
  });
}

// ── Streak multiplier helpers ──────────────────────────────────────────

function getStreakMultiplier(winStreak: number): number {
  if (winStreak >= 10) return 2.0;
  if (winStreak >= 7) return 1.75;
  if (winStreak >= 5) return 1.5;
  if (winStreak >= 3) return 1.25;
  return 1.0;
}

function getNextStreakMilestone(winStreak: number): { streak: number; multiplier: number } | null {
  if (winStreak < 3) return { streak: 3, multiplier: 1.25 };
  if (winStreak < 5) return { streak: 5, multiplier: 1.5 };
  if (winStreak < 7) return { streak: 7, multiplier: 1.75 };
  if (winStreak < 10) return { streak: 10, multiplier: 2.0 };
  return null; // Max achieved
}
