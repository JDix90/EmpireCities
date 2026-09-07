import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticate } from '../../middleware/authenticate';
import { rejectGuest } from '../../middleware/rejectGuest';
import { query, queryOne } from '../../db/postgres';
import { claimDailyLogin, DAILY_STREAK_MILESTONES, purchaseStreakFreeze } from '../../game-engine/progression/progressionService';
import { getTier } from '../../game-engine/rating/ratingService';
import {
  ONBOARDING_QUESTS,
  NON_SEQUENTIAL_QUESTS,
  DAILY_LOGIN_REWARDS,
  dailyLoginRewardForStreak,
  STREAK_FREEZE_PRICE_GOLD,
  STREAK_FREEZE_MAX_HELD,
} from '@borderfall/shared';
import { featureFlags } from '../../config/featureFlags';
import { getMonthlyChallenges } from '../../game-engine/progression/challengeService';
import { redeemReferralCode, getReferralStats } from '../../game-engine/progression/referralService';
import { formatZodError } from '../../utils/formatZodError';

export async function progressionRoutes(fastify: FastifyInstance): Promise<void> {
  // ── POST /api/progression/daily-login ────────────────────────────────────
  fastify.post('/daily-login', { preHandler: [authenticate, rejectGuest], config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (request, reply) => {
    const claim = await claimDailyLogin(request.userId);
    const user = await queryOne<{ gold: number; daily_streak: number }>(
      'SELECT COALESCE(gold, 0) AS gold, daily_streak FROM users WHERE user_id = $1',
      [request.userId],
    );

    // Record login in history for calendar UI
    if (claim.claimed) {
      const today = new Date().toISOString().slice(0, 10);
      await query(
        `INSERT INTO user_login_history (user_id, login_date, gold_claimed)
         VALUES ($1, $2, $3) ON CONFLICT (user_id, login_date) DO NOTHING`,
        [request.userId, today, claim.gold_awarded],
      );
    }

    return reply.send({
      claimed: claim.claimed,
      gold_awarded: claim.gold_awarded,
      login_streak: claim.login_streak,
      gold: user?.gold ?? 0,
      daily_streak: user?.daily_streak ?? 0,
    });
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
      // Non-sequential quests (first_async) are always completable: never
      // locked, and they don't occupy the chain's "current" slot.
      if (NON_SEQUENTIAL_QUESTS.has(q.quest_id)) {
        return { ...q, completed_at: completedAt, is_current: false, is_locked: false };
      }
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

    const user = await queryOne<{ daily_streak: number; last_login_date: string | null; login_streak: number }>(
      `SELECT daily_streak, last_login_date::text AS last_login_date,
              COALESCE(login_streak, 0) AS login_streak
       FROM users WHERE user_id = $1`,
      [request.userId],
    );

    const today = now.toISOString().slice(0, 10);
    const yesterday = new Date(now.getTime() - 86_400_000).toISOString().slice(0, 10);
    const alreadyClaimed = user?.last_login_date === today;
    const loginStreak = user?.login_streak ?? 0;
    // Which consecutive-login day would today's claim be? Already claimed →
    // the recorded streak; last claim was yesterday → it continues; otherwise
    // the run restarts at day 1. Tomorrow's tease assumes today gets claimed.
    const todayDay = alreadyClaimed
      ? loginStreak
      : user?.last_login_date === yesterday
        ? loginStreak + 1
        : 1;
    const todayReward = dailyLoginRewardForStreak(todayDay);
    const tomorrowReward = dailyLoginRewardForStreak(todayDay + 1);

    return reply.send({
      month: monthStart,
      days_in_month: new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate(),
      logins: logins.map((l) => l.login_date),
      rewards_schedule: DAILY_LOGIN_REWARDS,
      login_streak: loginStreak,
      today_reward: todayReward,
      tomorrow_reward: tomorrowReward,
      daily_streak: user?.daily_streak ?? 0,
      already_claimed_today: alreadyClaimed,
    });
  });

  // ── GET /api/progression/comeback ────────────────────────────────────────
  /**
   * Everything the post-game "come back tomorrow" panel needs in one call.
   * Deliberately NO rejectGuest: guests get a degraded payload (their streak
   * plus nulls for the login-bonus fields, which sit behind rejectGuest) so
   * the panel can pitch "create an account to protect this streak".
   */
  fastify.get('/comeback', { preHandler: authenticate }, async (request, reply) => {
    const user = await queryOne<{
      is_guest: boolean; daily_streak: number; last_played_date: string | null;
      last_login_date: string | null; login_streak: number;
      streak_freezes: number; streak_freeze_used_on: string | null;
    }>(
      `SELECT COALESCE(is_guest, false) AS is_guest,
              COALESCE(daily_streak, 0) AS daily_streak,
              last_played_date::text AS last_played_date,
              last_login_date::text AS last_login_date,
              COALESCE(login_streak, 0) AS login_streak,
              COALESCE(streak_freezes, 0) AS streak_freezes,
              streak_freeze_used_on::text AS streak_freeze_used_on
       FROM users WHERE user_id = $1`,
      [request.userId],
    );
    if (!user) return reply.status(404).send({ error: 'User not found' });

    const nextMilestoneDay = Object.keys(DAILY_STREAK_MILESTONES)
      .map(Number)
      .sort((a, b) => a - b)
      .find((day) => day > user.daily_streak);
    const nextMilestone = nextMilestoneDay
      ? { day: nextMilestoneDay, gold: DAILY_STREAK_MILESTONES[nextMilestoneDay]!.gold }
      : null;

    const now = new Date();
    const today = now.toISOString().slice(0, 10);
    const yesterday = new Date(now.getTime() - 86_400_000).toISOString().slice(0, 10);
    const alreadyClaimed = user.last_login_date === today;
    // Tomorrow's claim continues today's run (see /login-calendar for the math).
    const todayDay = alreadyClaimed
      ? user.login_streak
      : user.last_login_date === yesterday
        ? user.login_streak + 1
        : 1;

    const dailyDone = await queryOne<{ entry_id: string }>(
      `SELECT entry_id FROM daily_challenge_entries
       WHERE user_id = $1 AND challenge_date = CURRENT_DATE`,
      [request.userId],
    );

    return reply.send({
      is_guest: user.is_guest,
      daily_streak: user.daily_streak,
      played_today: user.last_played_date === today,
      next_streak_milestone: nextMilestone,
      // Login bonus is a registered-only mechanic (rejectGuest on /daily-login).
      tomorrow_login_reward: user.is_guest ? null : dailyLoginRewardForStreak(todayDay + 1),
      today_login_reward: user.is_guest ? null : dailyLoginRewardForStreak(todayDay),
      login_streak: user.is_guest ? null : user.login_streak,
      already_claimed_today: user.is_guest ? null : alreadyClaimed,
      daily_challenge_done_today: Boolean(dailyDone),
      // Streak freezes are registered-only (rejectGuest on the buy endpoint).
      // Counts are returned even when sales are flagged off so a held freeze
      // stays visible; `purchasable` tells the client whether to offer the buy.
      streak_freezes: user.is_guest ? null : user.streak_freezes,
      streak_freeze_used_on: user.is_guest ? null : user.streak_freeze_used_on,
      streak_freeze_price: STREAK_FREEZE_PRICE_GOLD,
      streak_freeze_max: STREAK_FREEZE_MAX_HELD,
      streak_freezes_purchasable: !user.is_guest && featureFlags.streakFreezesEnabled,
    });
  });

  // ── POST /api/progression/streak-freeze ──────────────────────────────────
  fastify.post('/streak-freeze', { preHandler: [authenticate, rejectGuest], config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (request, reply) => {
    if (!featureFlags.streakFreezesEnabled) {
      return reply.status(404).send({ error: 'Streak freezes are not available' });
    }
    const result = await purchaseStreakFreeze(request.userId);
    if (result.code === 'at_cap') {
      return reply.status(409).send({ error: 'You already hold the maximum number of streak freezes', held: result.held });
    }
    if (result.code === 'insufficient_gold') {
      return reply.status(402).send({ error: 'Insufficient gold', required: STREAK_FREEZE_PRICE_GOLD, balance: result.balance });
    }
    return reply.send({ streak_freezes: result.streak_freezes, gold: result.gold });
  });

  // ── POST /api/progression/referral/redeem ────────────────────────────────
  fastify.post('/referral/redeem', { preHandler: [authenticate, rejectGuest], config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (request, reply) => {
    const schema = z.object({ code: z.string().min(1).max(16) });
    const parsed = schema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.status(400).send(formatZodError(parsed.error));
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

}
