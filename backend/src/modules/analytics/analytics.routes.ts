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
 *
 * REFERRAL_SURVEY_ANSWERS below mirrors REFERRAL_SURVEY_OPTIONS in
 * frontend/src/utils/referralSurvey.ts — adding an option there means adding
 * its id here, or the answer is rejected.
 */
const REFERRAL_SURVEY_ANSWERS = new Set(['ai_assistant', 'search', 'social', 'friend', 'other']);

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
    // Where a player LEFT the guided tutorial. `tutorial_started` and
    // `tutorial_completed` are both server-side and authoritative, so the
    // funnel could read the completion RATE but never the drop-off POINT —
    // and the drop-off point is the number that says whether a given step is
    // confusing, too long, or (on a short viewport) hidden behind its own
    // coaching card. Only the client knows which step was on screen, so this
    // one has to come through here. Properties: via, module, step,
    // step_index, step_count.
    'tutorial_exited',
    // Self-reported acquisition. The only signal that sees assistants which
    // send no referrer — those visits are indistinguishable from a typed URL
    // and otherwise count as 'direct'. See services/acquisitionChannel.ts.
    'referral_survey_answered',
  ]),
  properties: z.record(z.string().max(64), z.string().max(200)).optional(),
}).superRefine((value, ctx) => {
  // The survey's `answer` is a dimension we group by, so it is a closed set,
  // not free text. The generic `properties` schema would happily accept 200
  // characters of anything — which would both pollute the grouping and turn a
  // measurement field into an unmoderated user-content channel.
  if (value.event !== 'referral_survey_answered') return;
  const answer = value.properties?.answer;
  if (!answer || !REFERRAL_SURVEY_ANSWERS.has(answer)) {
    ctx.addIssue({ code: 'custom', path: ['properties', 'answer'], message: 'Unknown answer' });
  }
});


/**
 * Pre-auth visitor beacons. Deliberately UNAUTHENTICATED — landing_viewed /
 * hero_play_clicked fire before any token exists — so this schema is even
 * stricter than ui-event: two event names only, a UUID-shaped anonymous
 * session id (random, first-party, no PII), and a tiny property budget.
 * Rate limiting falls back to per-IP for anonymous requests.
 */
const VisitEventSchema = z.object({
  event: z.enum(['landing_viewed', 'hero_play_clicked']),
  anon_session_id: z.string().uuid(),
  properties: z.record(z.string().max(32), z.string().max(120)).optional(),
});
/** Cap the anonymous property budget harder than ui-event's. */
const VISIT_MAX_PROPERTIES = 4;

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

  // ── POST /api/analytics/visit (unauthenticated) ─────────────────────────
  // The one pre-signup ingestion path: lets the funnel see landing→click→signup
  // instead of starting at guest_created. The anon_session_id is echoed into
  // the event properties; the same id later rides the signup attribution
  // payload, which is what stitches a visitor to their eventual account.
  // recordServerEvent still drops everything when analytics_events_enabled is
  // off, so this endpoint is inert until the flag is flipped.
  fastify.post('/visit', {
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    const parsed = VisitEventSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid event' });
    }
    const props = parsed.data.properties ?? {};
    if (Object.keys(props).length > VISIT_MAX_PROPERTIES) {
      return reply.status(400).send({ error: 'Invalid event' });
    }
    recordServerEvent(
      parsed.data.event,
      { ...props, anon_session_id: parsed.data.anon_session_id },
      null,
    );
    return reply.send({ ok: true });
  });
}
