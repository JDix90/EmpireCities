import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticate } from '../../middleware/authenticate';
import { recordServerEvent } from '../../services/analyticsEvents';

/**
 * Client → server analytics ingestion. `recordServerEvent` is server-side
 * only, so UI-side moments (a nudge being shown, a notification deep-link
 * being opened) need this one endpoint. The event name is a strict allowlist
 * and property values are size-capped — this must never become a generic
 * write-anything channel.
 */
const UiEventSchema = z.object({
  event: z.enum([
    'retention_notification_clicked',
    'signup_nudge_shown',
    'signup_nudge_clicked',
    'pwa_installed',
    'today_panel_shown',
    'async_cta_clicked',
    'streak_freeze_buy_clicked',
    // First-session activation funnel (guests are authenticated, so they post
    // through this same endpoint). Each fires at most once per game client-side.
    // `tutorial_completed` is emitted server-side (authoritative) and is not here.
    'map_rendered',
    'first_attack',
    'first_territory_captured',
  ]),
  properties: z.record(z.string().max(64), z.string().max(200)).optional(),
});

export async function analyticsRoutes(fastify: FastifyInstance): Promise<void> {
  // ── POST /api/analytics/ui-event ─────────────────────────────────────────
  // Guests included on purpose: the signup nudge fires for guests by
  // definition, and their events carry the guest user_id so a later upgrade
  // (same user_id) keeps the cohort intact.
  fastify.post('/ui-event', {
    preHandler: [authenticate],
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    const parsed = UiEventSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid event' });
    }
    recordServerEvent(parsed.data.event, parsed.data.properties ?? {}, request.userId);
    return reply.send({ ok: true });
  });
}
