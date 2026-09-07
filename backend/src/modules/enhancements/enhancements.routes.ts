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
import { recordServerEvent } from '../../services/analyticsEvents';

// NOTE: score/efficiency/duration are CLIENT-REPORTED. The seeded weekly run is
// not yet recorded or recomputed server-side, so the score itself cannot be
// trusted — the real fix is to replay the run server-side (tracked follow-up),
// and until then the UI presents this board as unverified. What we DO enforce
// here reduces the blast radius: the schema bounds block absurd/injected values,
// submissions are accepted ONLY for the current active challenge (so past/future
// or arbitrary challenge ids can't be seeded), and every submission is logged
// for anomaly detection.
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

  fastify.get('/weekly/current', { preHandler: authenticate }, async () => {
    const challenge = await getOrCreateWeeklyChallenge();
    return { challenge };
  });

  fastify.post<{ Params: { challengeId: string } }>('/weekly/:challengeId/submit', { preHandler: [authenticate, rejectGuest], config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (request, reply) => {
    const parsed = WeeklySubmitSchema.safeParse(request.body ?? {});
    if (!parsed.success) return reply.code(400).send(formatZodError(parsed.error, 'Invalid submission'));
    const { challengeId } = request.params;
    const payload = parsed.data;

    // Only the current active challenge accepts submissions. Without this a
    // client could write scores to any (past, future, or fabricated) challenge
    // id it names in the URL. The active id is server-derived, never trusted
    // from the request.
    const active = await getOrCreateWeeklyChallenge();
    if (challengeId !== active.challenge_id) {
      return reply.code(409).send({ error: 'Submissions are only accepted for the current weekly challenge' });
    }

    // Audit every submission so a client-reported score that later looks bogus
    // is attributable. (The score is still client-trusted until the run is
    // recomputed server-side — see WeeklySubmitSchema.)
    recordServerEvent(
      'weekly_challenge_submitted',
      {
        challenge_id: challengeId,
        score: payload.score,
        efficiency_score: payload.efficiency_score,
        duration_seconds: payload.duration_seconds,
      },
      request.userId,
    );

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
