import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticate } from '../../middleware/authenticate';
import { queryOne } from '../../db/postgres';
import { featureFlags } from '../../config/featureFlags';
import {
  CHAT_CHANNELS,
  CHAT_REPORT_REASONS,
  REPORT_DETAILS_MAX,
  REPORT_MESSAGE_MAX,
  blockPlayer,
  findChatMessage,
  listBlocks,
  recordChatReport,
  unblockPlayer,
} from './chatSafety.service';
import { announceOpenReports } from './reportAlerts';

/**
 * /api/safety: a player's blocks, and reports of chat messages
 * (`chat_safety_enabled`; admins always). Guests included: they chat too.
 *
 * - GET /blocks, POST /blocks { user_id }, DELETE /blocks/:userId
 * - POST /reports { game_id, channel, message_id?, reported_user_id, reason, details?, message? }
 *
 * A report quotes the server's copy of the message when the server still has
 * it (chatSafety.service.ts rememberChatMessage), and the reporter's otherwise,
 * marked unverified. Free text is length-capped and shown in Admin as text.
 */
const stripNul = (s: string) => s.split('\u0000').join('').trim();

const BlockSchema = z.object({ user_id: z.string().uuid() });
const UserIdParams = z.object({ userId: z.string().uuid() });

const ReportSchema = z.object({
  game_id: z.string().uuid(),
  channel: z.enum(CHAT_CHANNELS),
  message_id: z.string().uuid().optional(),
  reported_user_id: z.string().uuid(),
  reason: z.enum(CHAT_REPORT_REASONS),
  details: z.string().max(REPORT_DETAILS_MAX * 2).transform(stripNul).pipe(z.string().max(REPORT_DETAILS_MAX)).optional(),
  // The reporter's copy, used only when the server no longer has its own.
  message: z.string().max(REPORT_MESSAGE_MAX * 2).transform(stripNul).pipe(z.string().max(REPORT_MESSAGE_MAX)).optional(),
});

function closed(isAdmin: boolean | undefined): boolean {
  return !featureFlags.chatSafetyEnabled && !isAdmin;
}

export async function chatSafetyRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get('/blocks', { preHandler: [authenticate] }, async (request, reply) => {
    if (closed(request.isAdmin)) return reply.status(404).send({ error: 'Not found' });
    return reply.send({ blocks: await listBlocks(request.userId) });
  });

  fastify.post('/blocks', {
    preHandler: [authenticate],
    config: { rateLimit: { max: 30, timeWindow: '10 minutes' } },
  }, async (request, reply) => {
    if (closed(request.isAdmin)) return reply.status(404).send({ error: 'Not found' });
    const parsed = BlockSchema.safeParse(request.body ?? {});
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid player' });
    if (parsed.data.user_id === request.userId) return reply.status(400).send({ error: 'You cannot block yourself' });
    const result = await blockPlayer(request.userId, parsed.data.user_id);
    if (result === 'no_such_player') return reply.status(404).send({ error: 'No such player' });
    return reply.status(201).send({ ok: true });
  });

  fastify.delete<{ Params: { userId: string } }>('/blocks/:userId', {
    preHandler: [authenticate],
    config: { rateLimit: { max: 30, timeWindow: '10 minutes' } },
  }, async (request, reply) => {
    if (closed(request.isAdmin)) return reply.status(404).send({ error: 'Not found' });
    const parsed = UserIdParams.safeParse(request.params);
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid player' });
    await unblockPlayer(request.userId, parsed.data.userId);
    return reply.status(204).send();
  });

  fastify.post('/reports', {
    preHandler: [authenticate],
    // A few a game is plenty; this stops a script, not a player.
    config: { rateLimit: { max: 10, timeWindow: '10 minutes' } },
  }, async (request, reply) => {
    if (closed(request.isAdmin)) return reply.status(404).send({ error: 'Not found' });
    const parsed = ReportSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.issues[0]?.message ?? 'Invalid report' });
    }
    const body = parsed.data;
    if (body.reported_user_id === request.userId) {
      return reply.status(400).send({ error: 'You cannot report yourself' });
    }

    const kept = body.message_id ? await findChatMessage(body.game_id, body.message_id) : null;
    if (kept && kept.senderId !== body.reported_user_id) {
      return reply.status(400).send({ error: 'That message was sent by someone else' });
    }
    let reportedUsername = kept?.username ?? null;
    if (!reportedUsername) {
      const reported = await queryOne<{ username: string }>(
        'SELECT username FROM users WHERE user_id = $1',
        [body.reported_user_id],
      );
      if (!reported) return reply.status(404).send({ error: 'No such player' });
      reportedUsername = reported.username;
    }
    // The game must exist for the foreign key; a lobby is a games row too.
    const game = await queryOne<{ game_id: string }>('SELECT game_id FROM games WHERE game_id = $1', [body.game_id]);

    await recordChatReport({
      reporterId: request.userId,
      reportedId: body.reported_user_id,
      reportedUsername,
      gameId: game ? body.game_id : null,
      channel: kept?.channel ?? body.channel,
      messageId: body.message_id ?? null,
      message: kept ? kept.message : (body.message || null),
      messageVerified: !!kept,
      reason: body.reason,
      details: body.details || null,
    });
    // The admins' top bar shows the new count at once.
    void announceOpenReports();
    return reply.status(201).send({ ok: true });
  });
}
