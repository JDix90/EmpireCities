import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticate } from '../../middleware/authenticate';
import { queryOne } from '../../db/postgres';
import { featureFlags } from '../../config/featureFlags';
import { isGalacticAgeGame } from '../games/lobbyCapacity';
import { recordFeedback, FEEDBACK_COMMENT_MAX } from './feedback.service';

/**
 * POST /api/feedback — what a player thinks, in two forms:
 *
 * - `general`, from the Feedback entry in the lobby's menu (`menu`): a note
 *   about anything, with an optional category (bug, idea, other) and the page
 *   it was sent from. Open while `feedback_menu_enabled` is on.
 * - `galactic_age`, the Galactic Age beta's: the BETA panel's form
 *   (`beta_panel`) or the game-over thumbs (`game_over`). Open while the beta
 *   is (`galaxy_age_beta_enabled`). A game id must be a Galactic Age game the
 *   sender sat in, so nobody files feedback against someone else's game.
 *
 * Admins may always send either. Guests included. The turn, device and screen
 * size are context the client fills in. The comment is free text from a
 * player: length-capped here and in the table, and shown in Admin as text,
 * never as markup.
 */
const FeedbackSchema = z.object({
  topic: z.enum(['galactic_age', 'general']),
  source: z.enum(['beta_panel', 'game_over', 'menu']),
  rating: z.enum(['up', 'down']).optional(),
  category: z.enum(['bug', 'idea', 'other']).optional(),
  comment: z
    .string()
    .max(FEEDBACK_COMMENT_MAX * 2)
    // Postgres TEXT refuses a NUL byte; nothing a player types needs one.
    .transform((s) => s.split('\u0000').join('').trim())
    .pipe(z.string().max(FEEDBACK_COMMENT_MAX))
    .optional(),
  game_id: z.string().uuid().optional(),
  turn: z.number().int().min(0).max(100000).optional(),
  device: z.enum(['phone', 'tablet', 'desktop']).optional(),
  viewport: z.string().regex(/^\d{2,5}x\d{2,5}$/).optional(),
  page: z.string().regex(/^\/[A-Za-z0-9/_-]{0,63}$/).optional(),
}).superRefine((value, ctx) => {
  if (value.topic === 'general') {
    // A note is the point of the menu's form; a category alone says nothing.
    if (value.source !== 'menu') {
      ctx.addIssue({ code: 'custom', path: ['source'], message: 'General feedback comes from the menu' });
    }
    if (!value.comment) {
      ctx.addIssue({ code: 'custom', path: ['comment'], message: 'Write a note' });
    }
    if (value.game_id) {
      ctx.addIssue({ code: 'custom', path: ['game_id'], message: 'General feedback is not about one game' });
    }
    return;
  }
  if (value.source === 'menu') {
    ctx.addIssue({ code: 'custom', path: ['source'], message: 'The menu sends general feedback' });
  }
  if (!value.rating && !value.comment) {
    ctx.addIssue({ code: 'custom', path: ['comment'], message: 'Pick a rating or write a comment' });
  }
  if (value.source === 'game_over' && !value.game_id) {
    ctx.addIssue({ code: 'custom', path: ['game_id'], message: 'A game-over answer needs its game' });
  }
});

export async function feedbackRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.post('/', {
    preHandler: [authenticate],
    // A few a game is plenty; this stops a stuck button or a script, not a player.
    config: { rateLimit: { max: 10, timeWindow: '10 minutes' } },
  }, async (request, reply) => {
    const parsed = FeedbackSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.issues[0]?.message ?? 'Invalid feedback' });
    }
    const body = parsed.data;

    const open = body.topic === 'general' ? featureFlags.feedbackMenuEnabled : featureFlags.galaxyAgeBetaEnabled;
    if (!open && !request.isAdmin) {
      return reply.status(403).send({ error: 'Feedback is closed.' });
    }

    if (body.game_id) {
      const game = await queryOne<{ era_id: string | null; map_id: string | null }>(
        `SELECT g.era_id, g.map_id
         FROM games g
         JOIN game_players gp ON gp.game_id = g.game_id AND gp.user_id = $2
         WHERE g.game_id = $1`,
        [body.game_id, request.userId],
      );
      if (!game || !isGalacticAgeGame(game.era_id, game.map_id)) {
        return reply.status(403).send({ error: 'That is not a Galactic Age game you played.' });
      }
    }

    const feedbackId = await recordFeedback({
      userId: request.userId,
      topic: body.topic,
      source: body.source,
      rating: body.rating ?? null,
      category: body.category ?? null,
      comment: body.comment ? body.comment : null,
      gameId: body.game_id ?? null,
      turn: body.turn ?? null,
      device: body.device ?? null,
      viewport: body.viewport ?? null,
      page: body.page ?? null,
    });
    return reply.status(201).send({ ok: true, feedback_id: feedbackId });
  });
}
