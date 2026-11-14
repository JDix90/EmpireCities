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

/**
 * The steps `first_turn_step` may name (first_turn_events_enabled; frontend
 * utils/firstTurnSteps.ts). A closed set, for the same reason as the survey's
 * answers: it is a dimension the First turn report groups by.
 */
export const FIRST_TURN_STEPS = new Set([
  'briefing_closed',
  'territory_opened',
  'units_placed',
  'draft_ended',
  // funnel_events_v2_enabled: one of the player's territories opened in the
  // attack phase (the attack picker on screen), and the first turn over.
  'attack_source_opened',
  'turn_ended',
]);

/**
 * Where a prompt appeared (funnel_events_v2_enabled; frontend
 * utils/funnelEvents.ts). Closed sets: they are what the Prompts report
 * groups by, shown against pressed.
 */
export const SAVE_PROMPT_SURFACES = new Set(['results', 'post_game', 'tutorial_end', 'tomorrow', 'lobby', 'guest_gate']);
export const PUSH_ASK_SURFACES = new Set(['results', 'after_turn', 'lobby_banner']);
export const DAILY_LINK_SURFACES = new Set(['tomorrow', 'today_panel', 'lobby']);
/** Where an offer to add the site to the home screen appeared (home_screen_install_enabled). */
export const INSTALL_OFFER_SURFACES = new Set(['lobby', 'results', 'settings', 'push_ask']);

/** The events whose `surface` must come from a closed set, and the set. */
const SURFACE_EVENTS: Record<string, Set<string>> = {
  save_prompt_shown: SAVE_PROMPT_SURFACES,
  save_prompt_clicked: SAVE_PROMPT_SURFACES,
  push_ask_shown: PUSH_ASK_SURFACES,
  push_ask_dismissed: PUSH_ASK_SURFACES,
  daily_link_clicked: DAILY_LINK_SURFACES,
  install_offer_shown: INSTALL_OFFER_SURFACES,
  install_offer_clicked: INSTALL_OFFER_SURFACES,
  install_offer_dismissed: INSTALL_OFFER_SURFACES,
  install_prompt_answered: INSTALL_OFFER_SURFACES,
};

/**
 * What a player pressed on the game-over screen (results_action_events_enabled;
 * frontend utils/resultsAction.ts). A closed set: it is the dimension the
 * question "what do players do after a game" groups by.
 */
export const RESULTS_ACTIONS = new Set(['rematch', 'lobby', 'share', 'replay', 'clip', 'challenge', 'save_account', 'play_on', 'next_battle']);

const UiEventSchema = z.object({
  event: z.enum([
    'retention_notification_clicked',
    'signup_nudge_shown',
    'signup_nudge_clicked',
    // Coach tips (coach_tips_enabled, frontend utils/coachTips.ts): the answer a
    // first match's briefing got (choice: on | off), and tips hidden from the
    // strip. Whether most players hide them in round 1 says the tips are wrong.
    'coach_tips_choice',
    'coach_tips_hidden',
    'pwa_installed',
    // Browser push opt-in outcomes (frontend enableWebPush): the permission
    // prompt is a one-shot per origin, so how often it is granted vs refused
    // is the number that says whether the opt-in copy earns the click.
    // Property `result` carries the browser's answer ('granted' | 'denied' |
    // 'default' — the last is a dismissed prompt, which can be asked again).
    'push_optin_granted',
    'push_optin_refused',
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
    // Phone overlay budget (docs/MOBILE_UX_PLAN.md M-12): the taps a player
    // spent closing things in one round, by tier. Tier 1 had to be
    // acknowledged (game over, elimination, a lost capital, era advance);
    // tiers 2 and 3 are the budget's target of zero. Posted once per round,
    // from phone layouts only, zeros included so the quiet rounds count.
    // Properties: layout, turn, tier1, tier2, tier3, era, is_tutorial.
    'turn_dismiss_taps',
    // A signed-in player (guest or account) opening the game, posted at most
    // once a UTC day per player (frontend hooks/useDailyVisit.ts). Without it
    // a player who comes back without starting a game recorded nothing, so
    // the D1/D7 returns and the active-player counts missed them. Property:
    // device.
    'app_opened',
    // The map editor funnel (frontend pages/MapEditorPage.tsx, MapHubPage.tsx):
    // the editor opened (property: source — new or existing), a start-screen
    // template applied (template), a draft saved (map_id, territories), a
    // map submitted for review (map_id), a test game started on a draft
    // (map_id, era, opponents), a map link copied (map_id, source). Between
    // them: how many who open the editor ever save, and how many who save
    // ever publish.
    'editor_opened',
    'editor_template_applied',
    'editor_map_saved',
    'editor_submit_clicked',
    'editor_test_play_started',
    'map_shared',
    // A balance simulation asked for from the editor (map_id, seats, games).
    'editor_balance_run',
    // What a player does in the first turn of a real game (not the tutorial),
    // posted once per step per game while first_turn_events_enabled is on
    // (frontend utils/firstTurnSteps.ts): the briefing closed, a territory of
    // theirs opened, units placed, the reinforcement phase ended. Between
    // map_rendered and first_attack it says where a first turn stops.
    // Properties: step, game_id, era, first_match, layout, seconds (since the
    // map first showed).
    'first_turn_step',
    // What a player pressed on the game-over screen, once per press, while
    // results_action_events_enabled is on (frontend utils/resultsAction.ts;
    // next_battle is the first-win ladder's button):
    // there was no record of whether a finished game led to a second one, a
    // share or a saved account. Properties: action, outcome (won|lost),
    // game_id, first_match, is_tutorial, is_guest.
    'results_action',
    // funnel_events_v2_enabled (frontend utils/funnelEvents.ts). Each tutorial
    // step reached, once per step per game: tutorial_exited only sees players
    // who press a button, not those who close the tab. Properties: module,
    // step, step_index, step_count.
    'tutorial_step',
    // The denominators the come-back work needs. A save-account prompt shown
    // and pressed, and a reminder ask shown and dismissed, by `surface` (the
    // browser's own answer is push_optin_granted/refused); the results
    // screen's Tomorrow panel shown (is_guest, daily_streak, daily_open);
    // a Daily Challenge link pressed (surface).
    'save_prompt_shown',
    'save_prompt_clicked',
    'push_ask_shown',
    'push_ask_dismissed',
    'tomorrow_panel_shown',
    'daily_link_clicked',
    // home_screen_install_enabled (frontend services/homeScreenInstall.ts): an
    // offer to add the site to the home screen shown, pressed and dismissed,
    // by `surface`, with `path` (prompt | ios_share | ios_in_app | manual):
    // which browsers the offer reaches and where players give up. And the
    // answer the browser's own install dialog got (`result`: accepted |
    // dismissed). An iPhone install has no event of its own; it shows up as
    // pwa_installed with platform=ios on the first launch from the home screen.
    'install_offer_shown',
    'install_offer_clicked',
    'install_offer_dismissed',
    'install_prompt_answered',
  ]),
  properties: z.record(z.string().max(64), z.string().max(200)).optional(),
}).superRefine((value, ctx) => {
  if (value.event === 'results_action') {
    const action = value.properties?.action;
    if (!action || !RESULTS_ACTIONS.has(action)) {
      ctx.addIssue({ code: 'custom', path: ['properties', 'action'], message: 'Unknown action' });
    }
    return;
  }
  const surfaces = SURFACE_EVENTS[value.event];
  if (surfaces) {
    const surface = value.properties?.surface;
    if (!surface || !surfaces.has(surface)) {
      ctx.addIssue({ code: 'custom', path: ['properties', 'surface'], message: 'Unknown surface' });
    }
    return;
  }
  // A first-turn step is a closed set too: the First turn report groups by it.
  if (value.event === 'first_turn_step') {
    const step = value.properties?.step;
    if (!step || !FIRST_TURN_STEPS.has(step)) {
      ctx.addIssue({ code: 'custom', path: ['properties', 'step'], message: 'Unknown step' });
    }
    return;
  }
  // The coach tips choice is a closed set too.
  if (value.event === 'coach_tips_choice' || value.event === 'coach_tips_hidden') {
    const choice = value.properties?.choice;
    if (choice !== 'on' && choice !== 'off') {
      ctx.addIssue({ code: 'custom', path: ['properties', 'choice'], message: 'Unknown choice' });
    }
    return;
  }
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
