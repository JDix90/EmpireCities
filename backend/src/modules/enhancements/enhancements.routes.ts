import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticate } from '../../middleware/authenticate';
import { rejectGuest } from '../../middleware/rejectGuest';
import { query, queryOne } from '../../db/postgres';
import {
  generateAndStorePostMatchAnalysis,
  getInsights,
  getOrCreateWeeklyChallenge,
  getReplayHighlights,
} from '../../services/playerValueEnhancements';
import { formatZodError } from '../../utils/formatZodError';

const QolSettingsSchema = z.object({
  animation_speed_multiplier: z.number().min(0.5).max(3).optional(),
  quick_combat_enabled: z.boolean().optional(),
  confirm_end_turn: z.boolean().optional(),
  undo_window_seconds: z.number().int().min(0).max(30).optional(),
});

// NOTE: these values are CLIENT-REPORTED. The seeded weekly run is not recorded
// or replayed server-side today, so the leaderboard is only as trustworthy as
// the client. These bounds block absurd/injected values (e.g. a Number.MAX
// score or a 0-second completion) — they are a mitigation, NOT anti-cheat. A
// full fix requires recording + recomputing the run server-side (follow-up).
const WeeklySubmitSchema = z.object({
  score: z.number().int().min(0).max(1_000_000_000),
  efficiency_score: z.number().min(0).max(100),
  duration_seconds: z.number().int().min(1).max(86_400),
  details: z.record(z.unknown()).optional(),
});

export async function enhancementsRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get<{ Params: { gameId: string } }>('/matches/:gameId/insights', { preHandler: authenticate }, async (request, reply) => {
    const { gameId } = request.params;
    const participant = await queryOne<{ c: number }>(
      'SELECT 1 AS c FROM game_players WHERE game_id = $1 AND user_id = $2',
      [gameId, request.userId],
    );
    if (!participant) return reply.code(403).send({ error: 'Not a participant' });

    let insights = await getInsights(gameId);
    if (insights.length === 0) {
      await generateAndStorePostMatchAnalysis(gameId);
      insights = await getInsights(gameId);
    }
    return reply.send({ insights });
  });

  fastify.get<{ Params: { gameId: string } }>('/replays/:gameId/highlights', { preHandler: authenticate }, async (request, reply) => {
    const { gameId } = request.params;
    const participant = await queryOne<{ c: number }>(
      'SELECT 1 AS c FROM game_players WHERE game_id = $1 AND user_id = $2',
      [gameId, request.userId],
    );
    if (!participant) return reply.code(403).send({ error: 'Not a participant' });

    let highlights = await getReplayHighlights(gameId);
    if (highlights.length === 0) {
      await generateAndStorePostMatchAnalysis(gameId);
      highlights = await getReplayHighlights(gameId);
    }
    return reply.send({ highlights });
  });

  fastify.get('/players/me/learning-path', { preHandler: authenticate }, async (request) => {
    const profileRow = await queryOne<{ profile_json: Record<string, unknown> }>(
      'SELECT profile_json FROM player_skill_profiles WHERE user_id = $1',
      [request.userId],
    );
    const profile = profileRow?.profile_json ?? {};
    const weaknesses = Array.isArray(profile.weaknesses) ? profile.weaknesses : [];
    const recs = weaknesses.slice(0, 3).map((w, idx) => ({
      challenge_id: `adaptive_${idx + 1}`,
      focus: w,
      difficulty: idx === 0 ? 'medium' : 'easy',
      rationale: `Recommended because your recent games show lower performance in ${String(w)}.`,
    }));
    return { profile, recommendations: recs };
  });

  fastify.get('/players/me/qol-settings', { preHandler: authenticate }, async (request) => {
    const row = await queryOne<{
      animation_speed_multiplier: number;
      quick_combat_enabled: boolean;
      confirm_end_turn: boolean;
      undo_window_seconds: number;
    }>(
      `SELECT animation_speed_multiplier, quick_combat_enabled, confirm_end_turn, undo_window_seconds
       FROM player_qol_settings WHERE user_id = $1`,
      [request.userId],
    );
    return row ?? {
      animation_speed_multiplier: 1,
      quick_combat_enabled: false,
      confirm_end_turn: true,
      undo_window_seconds: 5,
    };
  });

  fastify.put('/players/me/qol-settings', { preHandler: [authenticate, rejectGuest] }, async (request, reply) => {
    const parsed = QolSettingsSchema.safeParse(request.body ?? {});
    if (!parsed.success) return reply.code(400).send(formatZodError(parsed.error, 'Invalid settings'));

    const incoming = parsed.data;
    const current = await queryOne<{
      animation_speed_multiplier: number;
      quick_combat_enabled: boolean;
      confirm_end_turn: boolean;
      undo_window_seconds: number;
    }>(
      `SELECT animation_speed_multiplier, quick_combat_enabled, confirm_end_turn, undo_window_seconds
       FROM player_qol_settings WHERE user_id = $1`,
      [request.userId],
    );

    const next = {
      animation_speed_multiplier: incoming.animation_speed_multiplier ?? current?.animation_speed_multiplier ?? 1,
      quick_combat_enabled: incoming.quick_combat_enabled ?? current?.quick_combat_enabled ?? false,
      confirm_end_turn: incoming.confirm_end_turn ?? current?.confirm_end_turn ?? true,
      undo_window_seconds: incoming.undo_window_seconds ?? current?.undo_window_seconds ?? 5,
    };

    await query(
      `INSERT INTO player_qol_settings (
         user_id, animation_speed_multiplier, quick_combat_enabled, confirm_end_turn, undo_window_seconds, updated_at
       ) VALUES ($1, $2, $3, $4, $5, NOW())
       ON CONFLICT (user_id) DO UPDATE
       SET animation_speed_multiplier = EXCLUDED.animation_speed_multiplier,
           quick_combat_enabled = EXCLUDED.quick_combat_enabled,
           confirm_end_turn = EXCLUDED.confirm_end_turn,
           undo_window_seconds = EXCLUDED.undo_window_seconds,
           updated_at = NOW()`,
      [
        request.userId,
        next.animation_speed_multiplier,
        next.quick_combat_enabled,
        next.confirm_end_turn,
        next.undo_window_seconds,
      ],
    );

    return reply.send(next);
  });

  fastify.get('/ranked/me/profile', { preHandler: authenticate }, async (request) => {
    const rating = await queryOne<{ mu: number; phi: number }>(
      `SELECT mu, phi FROM user_ratings WHERE user_id = $1 AND rating_type = 'ranked'`,
      [request.userId],
    );
    const placement = await queryOne<{
      season_id: string;
      placement_matches_played: number;
      provisional: boolean;
      smurf_risk_score: number;
      stall_penalties: number;
    }>(
      `SELECT season_id, placement_matches_played, provisional, smurf_risk_score, stall_penalties
       FROM ranked_placement_progress WHERE user_id = $1`,
      [request.userId],
    );
    return {
      rating: rating ?? { mu: 1500, phi: 350 },
      placement: placement ?? {
        season_id: '2026_Q2',
        placement_matches_played: 0,
        provisional: true,
        smurf_risk_score: 0,
        stall_penalties: 0,
      },
    };
  });

  fastify.get('/weekly/current', { preHandler: authenticate }, async () => {
    const challenge = await getOrCreateWeeklyChallenge();
    return { challenge };
  });

  fastify.post<{ Params: { challengeId: string } }>('/weekly/:challengeId/submit', { preHandler: [authenticate, rejectGuest], config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (request, reply) => {
    const parsed = WeeklySubmitSchema.safeParse(request.body ?? {});
    if (!parsed.success) return reply.code(400).send(formatZodError(parsed.error, 'Invalid submission'));
    const { challengeId } = request.params;
    const payload = parsed.data;

    await query(
      `INSERT INTO weekly_seeded_submissions (
         challenge_id, user_id, score, efficiency_score, duration_seconds, details_json
       ) VALUES ($1, $2, $3, $4, $5, $6::jsonb)
       ON CONFLICT (challenge_id, user_id) DO UPDATE
       SET score = GREATEST(weekly_seeded_submissions.score, EXCLUDED.score),
           efficiency_score = CASE
             WHEN EXCLUDED.score > weekly_seeded_submissions.score THEN EXCLUDED.efficiency_score
             WHEN EXCLUDED.score = weekly_seeded_submissions.score
               THEN GREATEST(weekly_seeded_submissions.efficiency_score, EXCLUDED.efficiency_score)
             ELSE weekly_seeded_submissions.efficiency_score
           END,
           duration_seconds = LEAST(weekly_seeded_submissions.duration_seconds, EXCLUDED.duration_seconds),
           details_json = EXCLUDED.details_json`,
      [
        challengeId,
        request.userId,
        payload.score,
        payload.efficiency_score,
        payload.duration_seconds,
        JSON.stringify(payload.details ?? {}),
      ],
    );

    return reply.send({ ok: true });
  });

  fastify.get<{ Params: { challengeId: string } }>('/weekly/:challengeId/leaderboard', { preHandler: authenticate }, async (request) => {
    const rows = await query<{
      user_id: string;
      username: string;
      score: number;
      efficiency_score: number;
      duration_seconds: number;
      created_at: string;
    }>(
      `SELECT s.user_id, u.username, s.score, s.efficiency_score, s.duration_seconds, s.created_at::text
       FROM weekly_seeded_submissions s
       JOIN users u ON u.user_id = s.user_id
       WHERE s.challenge_id = $1
       ORDER BY s.score DESC, s.efficiency_score DESC, s.duration_seconds ASC
       LIMIT 100`,
      [request.params.challengeId],
    );
    return { leaderboard: rows };
  });
}
