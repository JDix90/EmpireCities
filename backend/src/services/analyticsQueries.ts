/**
 * Funnel + retention queries over `analytics_events`. Shared by the CLI
 * (scripts/funnelReport.ts) and the admin endpoint (GET /api/admin/metrics/funnel)
 * so the SQL lives in exactly one place.
 *
 * Cohorts are defined by each user's first `guest_created`/`user_registered`
 * event, so everything here only covers signups AFTER analytics was enabled —
 * there's no retroactive history, by design.
 *
 * Admin and test accounts are left out (services/statsExclusion.ts): their
 * signups, starts and finishes never enter a cohort. Anonymous visitor events
 * have no account to judge, so the visitor funnel and the all-time event total
 * include everyone.
 */
import { query, queryOne } from '../db/postgres';
import { countedEventSql, countedGameSql } from './statsExclusion';
import {
  classifyAcquisitionSource,
  CHANNEL_ORDER,
  CHANNEL_LABELS,
  type AcquisitionChannel,
} from './acquisitionChannel';

export interface FunnelMetrics {
  signups: number;
  created_game: number;
  started_game: number;
  /** First-session activation steps (turn-clarity funnel). */
  map_rendered: number;
  first_attack: number;
  first_capture: number;
  finished_game: number;
  upgraded: number;
}

export interface RetentionMetrics {
  d1_cohort: number;
  d1: number;
  d7_cohort: number;
  d7: number;
}

/** Which side of the guest/account line a signup cohort sits on. */
export type RetentionCohort = 'account' | 'guest';

export interface RetentionCohortRow extends RetentionMetrics {
  cohort: RetentionCohort;
}

/**
 * Tutorial reach and completion for one signup cohort.
 *
 * `started` counts distinct users who began a tutorial in the window
 * (`tutorial_started`, emitted by `POST /games/tutorial/start`); `completed`
 * counts how many of those ever reached the end of one (`tutorial_completed`,
 * emitted server-side from `finalizeGame`). Both events are authoritative —
 * neither can be spoofed from the client — so `completed / started` is the
 * real first-session completion rate.
 */
export interface TutorialCohortRow {
  cohort: RetentionCohort;
  started: number;
  completed: number;
}

export interface CompletionStats {
  finishes: number;
  wins: number;
  tutorial_finishes: number;
  avg_minutes: number | null;
  avg_turns: number | null;
}

/**
 * First Quick Matches built while `first_match_easy_enabled` is on, read from
 * the `first_match` property on `game_created` and `game_finished`.
 */
export interface FirstMatchStats {
  started: number;
  finished: number;
  won: number;
  /** Finishers whose finish day is over, so a next-day return is possible. */
  next_day_cohort: number;
  /** Of those, how many had any event the following day (the D1 rule). */
  next_day: number;
}

/**
 * Where a solo game came from, read from its settings. `other` is a Quick
 * Match or a custom lobby.
 */
export type SoloGameMode = 'tutorial' | 'first_match' | 'campaign' | 'daily' | 'other';

/** Bot levels, lowest first: the order the solo table sorts and ranks them by. */
export const SOLO_LEVELS = ['tutorial', 'easy', 'medium', 'hard', 'expert'] as const;

/**
 * Games with one human and at least one bot, started in the window, by where
 * they came from and the game's bot level (its highest bot; a bot with no
 * level plays medium). Finished games are `completed`; `capped` is the part of
 * them the round cap decided, `surrendered` the part the human won by
 * accepting the bots' surrender, and `median_rounds` is over the finished games.
 * `bot_captures` are the territories the bots took from other players in the
 * finished games whose `game_finished` event counts them, and the three after
 * it are how many of those were the human's, the leading rival's and the
 * weakest rival's as the bot's turn began (services/botAimTelemetry.ts).
 */
export interface SoloLevelRow {
  mode: SoloGameMode;
  level: (typeof SOLO_LEVELS)[number];
  started: number;
  finished: number;
  /** Finished with the human as the winner. */
  won: number;
  abandoned: number;
  /** Still in progress. */
  running: number;
  capped: number;
  surrendered: number;
  median_rounds: number | null;
  bot_captures: number;
  bot_captures_from_human: number;
  bot_captures_from_leader: number;
  bot_captures_from_weakest: number;
}

export interface EventVolumeRow {
  event: string;
  n: number;
}

export interface AcquisitionRow {
  /** Which kind of place this source is — see services/acquisitionChannel.ts. */
  channel: AcquisitionChannel;
  /** First-touch utm_source, else referrer host, else 'direct'. */
  source: string;
  signups: number;
  /** Became a real account (registered directly or upgraded from guest). */
  accounts: number;
  /** Finished at least one game (activated). */
  activated: number;
}

/**
 * The same signups folded up by channel. Every signup lands in exactly one
 * source bucket (the query is DISTINCT ON user_id), so summing across the
 * sources in a channel double-counts nobody.
 */
export interface AcquisitionChannelRow {
  channel: AcquisitionChannel;
  label: string;
  signups: number;
  accounts: number;
  activated: number;
  /** The sources folded into this channel, biggest first — for "which assistant?". */
  sources: string[];
}

export interface VisitorFunnelMetrics {
  /** Distinct anonymous sessions that viewed the landing page. */
  landed: number;
  /** …that clicked a primary Play CTA. */
  clicked_play: number;
  /** …whose anon_session_id later appears on a guest_created/user_registered event. */
  signed_up: number;
}

export interface AnalyticsReport {
  window_days: number;
  total_events: number;
  visitors: VisitorFunnelMetrics;
  funnel: FunnelMetrics;
  retention: RetentionMetrics;
  /** The same D1/D7 measure, split by whether the signup ever became an account. */
  retention_by_cohort: RetentionCohortRow[];
  /** Did they finish the tutorial — split the same way. */
  tutorial: TutorialCohortRow[];
  completion: CompletionStats;
  first_match: FirstMatchStats;
  /** Solo games by mode and bot level: how often each level is finished, won and capped. */
  solo_by_level: SoloLevelRow[];
  acquisition: AcquisitionRow[];
  acquisition_channels: AcquisitionChannelRow[];
  volume: EventVolumeRow[];
}

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function numOrNull(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Acquisition → activation funnel for signups in the trailing window. */
export async function getFunnelMetrics(days: number): Promise<FunnelMetrics> {
  const [row] = await query<Record<string, unknown>>(
    `WITH signups AS (
       SELECT user_id, MIN(created_at) AS signed_up_at
       FROM analytics_events
       WHERE event IN ('guest_created', 'user_registered') AND user_id IS NOT NULL
         AND created_at >= NOW() - make_interval(days => $1::int)
         AND ${countedEventSql('analytics_events')}
       GROUP BY user_id
     )
     SELECT
       COUNT(*)::int AS signups,
       COUNT(*) FILTER (WHERE EXISTS (
         SELECT 1 FROM analytics_events e WHERE e.user_id = s.user_id AND e.event = 'game_created'))::int AS created_game,
       COUNT(*) FILTER (WHERE EXISTS (
         SELECT 1 FROM analytics_events e WHERE e.user_id = s.user_id AND e.event = 'game_started'))::int AS started_game,
       COUNT(*) FILTER (WHERE EXISTS (
         SELECT 1 FROM analytics_events e WHERE e.user_id = s.user_id AND e.event = 'map_rendered'))::int AS map_rendered,
       COUNT(*) FILTER (WHERE EXISTS (
         SELECT 1 FROM analytics_events e WHERE e.user_id = s.user_id AND e.event = 'first_attack'))::int AS first_attack,
       COUNT(*) FILTER (WHERE EXISTS (
         SELECT 1 FROM analytics_events e WHERE e.user_id = s.user_id AND e.event = 'first_territory_captured'))::int AS first_capture,
       COUNT(*) FILTER (WHERE EXISTS (
         SELECT 1 FROM analytics_events e WHERE e.user_id = s.user_id AND e.event = 'game_finished'))::int AS finished_game,
       COUNT(*) FILTER (WHERE EXISTS (
         SELECT 1 FROM analytics_events e WHERE e.user_id = s.user_id AND e.event = 'guest_upgraded'))::int AS upgraded
     FROM signups s`,
    [days],
  );
  return {
    signups: num(row?.signups),
    created_game: num(row?.created_game),
    started_game: num(row?.started_game),
    map_rendered: num(row?.map_rendered),
    first_attack: num(row?.first_attack),
    first_capture: num(row?.first_capture),
    finished_game: num(row?.finished_game),
    upgraded: num(row?.upgraded),
  };
}

/** D1 / D7 return: did a signup cohort show any activity a day / week later. */
export async function getRetentionMetrics(): Promise<RetentionMetrics> {
  const [row] = await query<Record<string, unknown>>(
    `WITH signups AS (
       SELECT user_id, MIN(created_at)::date AS d0
       FROM analytics_events
       WHERE event IN ('guest_created', 'user_registered') AND user_id IS NOT NULL
         AND ${countedEventSql('analytics_events')}
       GROUP BY user_id
     )
     SELECT
       COUNT(*) FILTER (WHERE d0 <= CURRENT_DATE - 1)::int AS d1_cohort,
       COUNT(*) FILTER (WHERE d0 <= CURRENT_DATE - 1 AND EXISTS (
         SELECT 1 FROM analytics_events e WHERE e.user_id = s.user_id AND e.created_at::date = s.d0 + 1))::int AS d1,
       COUNT(*) FILTER (WHERE d0 <= CURRENT_DATE - 7)::int AS d7_cohort,
       COUNT(*) FILTER (WHERE d0 <= CURRENT_DATE - 7 AND EXISTS (
         SELECT 1 FROM analytics_events e WHERE e.user_id = s.user_id AND e.created_at::date = s.d0 + 7))::int AS d7
     FROM signups s`,
  );
  return {
    d1_cohort: num(row?.d1_cohort),
    d1: num(row?.d1),
    d7_cohort: num(row?.d7_cohort),
    d7: num(row?.d7),
  };
}

/**
 * D1 / D7 split by whether the signup ever became a real account.
 *
 * `getRetentionMetrics` pools guests and accounts into one number, and the two
 * behave nothing alike, so the pooled rate mostly reports the guest/account mix
 * rather than whether anyone came back. "Account" here is the SAME test the
 * acquisition table uses for its `accounts` column — a `user_registered` or
 * `guest_upgraded` event — so the two readouts cannot disagree.
 *
 * Reading the guest row needs two caveats, neither of which applies to accounts:
 *
 * 1. A guest has no way to sign back in (no email, no password they know; login
 *    and password reset both exclude the `@guest.local` domain). Returning on
 *    another device or browser creates a NEW guest row with a new `user_id`,
 *    counted as a fresh signup and never as a return. Cross-device returns are
 *    therefore invisible for guests and visible for accounts.
 * 2. `deleteStaleGuestUsers` removes guests older than 48h who never joined a
 *    game, and `analytics_events.user_id` is ON DELETE SET NULL — so their
 *    `guest_created` event leaves the `signups` CTE entirely. The fastest
 *    bouncers drop out of BOTH the numerator and the denominator, which nudges
 *    the surviving guest rate UP rather than down. Guests who did play are kept
 *    indefinitely and stay counted.
 *
 * Always returns both cohorts, account first, zero-filled when a cohort has no
 * rows yet, so callers can render a stable two-row table.
 */
export async function getRetentionByCohort(): Promise<RetentionCohortRow[]> {
  const rows = await query<Record<string, unknown>>(
    `WITH signups AS (
       SELECT user_id, MIN(created_at)::date AS d0
       FROM analytics_events
       WHERE event IN ('guest_created', 'user_registered') AND user_id IS NOT NULL
         AND ${countedEventSql('analytics_events')}
       GROUP BY user_id
     ),
     classified AS (
       SELECT s.user_id, s.d0,
              EXISTS (
                SELECT 1 FROM analytics_events e
                WHERE e.user_id = s.user_id
                  AND e.event IN ('user_registered', 'guest_upgraded')
              ) AS is_account
       FROM signups s
     )
     SELECT
       c.is_account,
       COUNT(*) FILTER (WHERE c.d0 <= CURRENT_DATE - 1)::int AS d1_cohort,
       COUNT(*) FILTER (WHERE c.d0 <= CURRENT_DATE - 1 AND EXISTS (
         SELECT 1 FROM analytics_events e
         WHERE e.user_id = c.user_id AND e.created_at::date = c.d0 + 1))::int AS d1,
       COUNT(*) FILTER (WHERE c.d0 <= CURRENT_DATE - 7)::int AS d7_cohort,
       COUNT(*) FILTER (WHERE c.d0 <= CURRENT_DATE - 7 AND EXISTS (
         SELECT 1 FROM analytics_events e
         WHERE e.user_id = c.user_id AND e.created_at::date = c.d0 + 7))::int AS d7
     FROM classified c
     GROUP BY c.is_account`,
  );

  const byCohort = new Map<RetentionCohort, RetentionCohortRow>();
  for (const r of rows) {
    const cohort: RetentionCohort = r.is_account ? 'account' : 'guest';
    byCohort.set(cohort, {
      cohort,
      d1_cohort: num(r.d1_cohort),
      d1: num(r.d1),
      d7_cohort: num(r.d7_cohort),
      d7: num(r.d7),
    });
  }
  const empty = (cohort: RetentionCohort): RetentionCohortRow =>
    ({ cohort, d1_cohort: 0, d1: 0, d7_cohort: 0, d7: 0 });
  return [
    byCohort.get('account') ?? empty('account'),
    byCohort.get('guest') ?? empty('guest'),
  ];
}

/**
 * Did they finish the tutorial — guests and full accounts side by side.
 *
 * The cohort test is the one `getRetentionByCohort` and the acquisition table
 * use (ever emitted `user_registered` or `guest_upgraded`), so "guest" means
 * the same thing on every panel: never became an account, not merely
 * "was a guest at the time". Both rows are always returned, zeroed when a
 * cohort has nobody in it, so the panel never renders a gap.
 */
export async function getTutorialFunnel(days: number): Promise<TutorialCohortRow[]> {
  const rows = await query<Record<string, unknown>>(
    `WITH starters AS (
       SELECT user_id
       FROM analytics_events
       WHERE event = 'tutorial_started' AND user_id IS NOT NULL
         AND created_at >= NOW() - make_interval(days => $1::int)
         AND ${countedEventSql('analytics_events')}
       GROUP BY user_id
     ),
     classified AS (
       SELECT s.user_id,
              EXISTS (
                SELECT 1 FROM analytics_events e
                WHERE e.user_id = s.user_id
                  AND e.event IN ('user_registered', 'guest_upgraded')
              ) AS is_account
       FROM starters s
     )
     SELECT
       c.is_account,
       COUNT(*)::int AS started,
       COUNT(*) FILTER (WHERE EXISTS (
         SELECT 1 FROM analytics_events e
         WHERE e.user_id = c.user_id AND e.event = 'tutorial_completed'))::int AS completed
     FROM classified c
     GROUP BY c.is_account`,
    [days],
  );

  const byCohort = new Map<RetentionCohort, TutorialCohortRow>();
  for (const r of rows) {
    const cohort: RetentionCohort = r.is_account ? 'account' : 'guest';
    byCohort.set(cohort, {
      cohort,
      started: num(r.started),
      completed: num(r.completed),
    });
  }
  const empty = (cohort: RetentionCohort): TutorialCohortRow =>
    ({ cohort, started: 0, completed: 0 });
  return [
    byCohort.get('account') ?? empty('account'),
    byCohort.get('guest') ?? empty('guest'),
  ];
}

/** Game-completion stats (per human) in the trailing window. */
export async function getCompletionStats(days: number): Promise<CompletionStats> {
  const [row] = await query<Record<string, unknown>>(
    `SELECT
       COUNT(*)::int AS finishes,
       COUNT(*) FILTER (WHERE (properties->>'won')::boolean)::int AS wins,
       COUNT(*) FILTER (WHERE (properties->>'is_tutorial')::boolean)::int AS tutorial_finishes,
       ROUND(AVG((properties->>'duration_ms')::numeric) / 60000, 1) AS avg_minutes,
       ROUND(AVG((properties->>'turn_count')::numeric), 1) AS avg_turns
     FROM analytics_events
     WHERE event = 'game_finished' AND created_at >= NOW() - make_interval(days => $1::int)
       AND ${countedEventSql('analytics_events')}`,
    [days],
  );
  return {
    finishes: num(row?.finishes),
    wins: num(row?.wins),
    tutorial_finishes: num(row?.tutorial_finishes),
    avg_minutes: numOrNull(row?.avg_minutes),
    avg_turns: numOrNull(row?.avg_turns),
  };
}

/** First-match games started, finished and won in the window, and next-day returns. */
export async function getFirstMatchStats(days: number): Promise<FirstMatchStats> {
  const [row] = await query<Record<string, unknown>>(
    `WITH finished AS (
       SELECT user_id, created_at::date AS d0, (properties->>'won')::boolean AS won
       FROM analytics_events
       WHERE event = 'game_finished'
         AND (properties->>'first_match')::boolean
         AND created_at >= NOW() - make_interval(days => $1::int)
         AND ${countedEventSql('analytics_events')}
     )
     SELECT
       (SELECT COUNT(*) FROM analytics_events
         WHERE event = 'game_created'
           AND (properties->>'first_match')::boolean
           AND created_at >= NOW() - make_interval(days => $1::int)
           AND ${countedEventSql('analytics_events')})::int AS started,
       COUNT(*)::int AS finished,
       COUNT(*) FILTER (WHERE won)::int AS won,
       COUNT(*) FILTER (WHERE d0 <= CURRENT_DATE - 1)::int AS next_day_cohort,
       COUNT(*) FILTER (WHERE d0 <= CURRENT_DATE - 1 AND EXISTS (
         SELECT 1 FROM analytics_events e WHERE e.user_id = f.user_id AND e.created_at::date = f.d0 + 1))::int AS next_day
     FROM finished f`,
    [days],
  );
  return {
    started: num(row?.started),
    finished: num(row?.finished),
    won: num(row?.won),
    next_day_cohort: num(row?.next_day_cohort),
    next_day: num(row?.next_day),
  };
}

const SOLO_MODE_ORDER: readonly SoloGameMode[] = ['tutorial', 'first_match', 'campaign', 'daily', 'other'];

/**
 * Solo games started in the window by mode and bot level. The games table
 * gives the seats, status and winner for every game, history included; the
 * round count and the ending come from the game's `game_finished` event.
 * `onlyGameIds` limits it to those games, for a test on a shared database.
 */
export async function getSoloGamesByLevel(
  days: number,
  onlyGameIds?: readonly string[],
): Promise<SoloLevelRow[]> {
  const rank = SOLO_LEVELS.map((level, i) => `WHEN '${level}' THEN ${i}`).join(' ');
  const rows = await query<Record<string, unknown>>(
    `WITH solo AS (
       SELECT g.game_id, g.status, g.winner_id, seats.human_id, seats.level_rank,
         CASE
           WHEN COALESCE((g.settings_json->>'tutorial')::boolean, false) THEN 'tutorial'
           WHEN COALESCE((g.settings_json->>'first_match')::boolean, false) THEN 'first_match'
           WHEN COALESCE((g.settings_json->>'is_campaign')::boolean, false) THEN 'campaign'
           WHEN COALESCE(g.settings_json->>'daily_challenge_date', '') <> '' THEN 'daily'
           ELSE 'other'
         END AS mode
       FROM games g
       JOIN LATERAL (
         SELECT
           MAX(gp.user_id::text) FILTER (WHERE NOT gp.is_ai) AS human_id,
           MAX(CASE gp.ai_difficulty ${rank} ELSE ${SOLO_LEVELS.indexOf('medium')} END) FILTER (WHERE gp.is_ai) AS level_rank,
           COUNT(*) FILTER (WHERE NOT gp.is_ai) AS humans,
           COUNT(*) FILTER (WHERE gp.is_ai) AS bots
         FROM game_players gp
         WHERE gp.game_id = g.game_id
       ) seats ON seats.humans = 1 AND seats.bots > 0
       WHERE g.started_at >= NOW() - make_interval(days => $1::int)
         AND ${countedGameSql('g')}
         ${onlyGameIds ? 'AND g.game_id = ANY($2::uuid[])' : ''}
     ),
     finished AS (
       SELECT DISTINCT ON (properties->>'game_id')
         properties->>'game_id' AS game_id,
         properties->>'victory_type' AS victory_type,
         (properties->>'turn_count')::int AS rounds,
         (properties->>'ai_captures_from_players')::int AS bot_captures,
         (properties->>'ai_captures_from_humans')::int AS bot_captures_from_human,
         (properties->>'ai_captures_from_leader')::int AS bot_captures_from_leader,
         (properties->>'ai_captures_from_weakest')::int AS bot_captures_from_weakest
       FROM analytics_events
       WHERE event = 'game_finished' AND created_at >= NOW() - make_interval(days => $1::int)
       ORDER BY properties->>'game_id', created_at
     )
     SELECT s.mode, s.level_rank,
       COUNT(*)::int AS started,
       COUNT(*) FILTER (WHERE s.status = 'completed')::int AS finished,
       COUNT(*) FILTER (WHERE s.status = 'completed' AND s.winner_id::text = s.human_id)::int AS won,
       COUNT(*) FILTER (WHERE s.status = 'abandoned')::int AS abandoned,
       COUNT(*) FILTER (WHERE s.status = 'in_progress')::int AS running,
       COUNT(*) FILTER (WHERE s.status = 'completed' AND f.victory_type = 'turn_limit')::int AS capped,
       COUNT(*) FILTER (WHERE s.status = 'completed' AND f.victory_type = 'surrender')::int AS surrendered,
       percentile_disc(0.5) WITHIN GROUP (ORDER BY f.rounds) FILTER (WHERE s.status = 'completed') AS median_rounds,
       COALESCE(SUM(f.bot_captures) FILTER (WHERE s.status = 'completed'), 0)::int AS bot_captures,
       COALESCE(SUM(f.bot_captures_from_human) FILTER (WHERE s.status = 'completed'), 0)::int AS bot_captures_from_human,
       COALESCE(SUM(f.bot_captures_from_leader) FILTER (WHERE s.status = 'completed'), 0)::int AS bot_captures_from_leader,
       COALESCE(SUM(f.bot_captures_from_weakest) FILTER (WHERE s.status = 'completed'), 0)::int AS bot_captures_from_weakest
     FROM solo s
     LEFT JOIN finished f ON f.game_id = s.game_id::text
     GROUP BY s.mode, s.level_rank`,
    onlyGameIds ? [days, onlyGameIds] : [days],
  );
  return rows
    .map((r) => ({
      mode: (SOLO_MODE_ORDER as readonly string[]).includes(String(r.mode)) ? (r.mode as SoloGameMode) : 'other',
      level: SOLO_LEVELS[num(r.level_rank)] ?? 'medium',
      started: num(r.started),
      finished: num(r.finished),
      won: num(r.won),
      abandoned: num(r.abandoned),
      running: num(r.running),
      capped: num(r.capped),
      surrendered: num(r.surrendered),
      median_rounds: numOrNull(r.median_rounds),
      bot_captures: num(r.bot_captures),
      bot_captures_from_human: num(r.bot_captures_from_human),
      bot_captures_from_leader: num(r.bot_captures_from_leader),
      bot_captures_from_weakest: num(r.bot_captures_from_weakest),
    }))
    .sort((a, b) =>
      SOLO_MODE_ORDER.indexOf(a.mode) - SOLO_MODE_ORDER.indexOf(b.mode)
      || SOLO_LEVELS.indexOf(a.level) - SOLO_LEVELS.indexOf(b.level));
}

/** Raw event histogram in the trailing window. */
export async function getEventVolume(days: number): Promise<EventVolumeRow[]> {
  const rows = await query<Record<string, unknown>>(
    `SELECT event, COUNT(*)::int AS n
     FROM analytics_events
     WHERE created_at >= NOW() - make_interval(days => $1::int)
       AND ${countedEventSql('analytics_events')}
     GROUP BY event ORDER BY n DESC`,
    [days],
  );
  return rows.map((r) => ({ event: String(r.event), n: num(r.n) }));
}

/**
 * Signups grouped by first-touch acquisition source (utm_source → referrer host
 * → 'direct'), with how many became real accounts and how many activated. This
 * is the per-channel scoreboard for paid/organic spend: it only populates for
 * signups whose `guest_created`/`user_registered` event carried attribution
 * (see modules/auth/attribution.ts).
 */
export async function getAcquisitionBySource(days: number): Promise<AcquisitionRow[]> {
  const rows = await query<Record<string, unknown>>(
    `WITH signups AS (
       SELECT DISTINCT ON (user_id)
         user_id,
         COALESCE(NULLIF(properties->>'utm_source', ''),
                  NULLIF(properties->>'referrer', ''),
                  'direct') AS source
       FROM analytics_events
       WHERE event IN ('guest_created', 'user_registered') AND user_id IS NOT NULL
         AND created_at >= NOW() - make_interval(days => $1::int)
         AND ${countedEventSql('analytics_events')}
       ORDER BY user_id, created_at ASC
     )
     SELECT
       source,
       COUNT(*)::int AS signups,
       COUNT(*) FILTER (WHERE EXISTS (
         SELECT 1 FROM analytics_events e
         WHERE e.user_id = s.user_id AND e.event IN ('user_registered', 'guest_upgraded')))::int AS accounts,
       COUNT(*) FILTER (WHERE EXISTS (
         SELECT 1 FROM analytics_events e
         WHERE e.user_id = s.user_id AND e.event = 'game_finished'))::int AS activated
     FROM signups s
     GROUP BY source
     ORDER BY signups DESC, source ASC`,
    [days],
  );
  return rows.map((r) => ({
    source: String(r.source),
    channel: classifyAcquisitionSource(String(r.source)),
    signups: num(r.signups),
    accounts: num(r.accounts),
    activated: num(r.activated),
  }));
}

/**
 * Fold per-source signups into channels. Derived from the rows we already have
 * rather than a second query — the source grain answers "which campaign?", this
 * one answers "is the assistant-referral channel growing?", and that second
 * question is the one the current acquisition mix makes urgent.
 *
 * Read `llm` and `direct` together: assistants that send no referrer land in
 * `direct`, so `llm` is a floor. See services/acquisitionChannel.ts.
 */
export function foldAcquisitionByChannel(rows: AcquisitionRow[]): AcquisitionChannelRow[] {
  const byChannel = new Map<AcquisitionChannel, AcquisitionChannelRow>();
  for (const channel of CHANNEL_ORDER) {
    byChannel.set(channel, {
      channel,
      label: CHANNEL_LABELS[channel],
      signups: 0,
      accounts: 0,
      activated: 0,
      sources: [],
    });
  }
  // Biggest source first so `sources` reads as a ranking.
  for (const row of [...rows].sort((a, b) => b.signups - a.signups || a.source.localeCompare(b.source))) {
    const bucket = byChannel.get(row.channel);
    if (!bucket) continue;
    bucket.signups += row.signups;
    bucket.accounts += row.accounts;
    bucket.activated += row.activated;
    bucket.sources.push(row.source);
  }
  return CHANNEL_ORDER.map((c) => byChannel.get(c)!).filter((r) => r.signups > 0);
}

/**
 * Pre-signup visitor funnel: landed → clicked Play → signed up, counted by
 * DISTINCT anonymous session id. Signup linkage works because the same
 * anon_session_id the /analytics/visit beacons carry also rides the signup
 * attribution payload into guest_created / user_registered properties
 * (see modules/auth/attribution.ts). Sessions without the id (blocked storage)
 * simply never enter this funnel — the authenticated funnel still counts them.
 */
export async function getVisitorFunnel(days: number): Promise<VisitorFunnelMetrics> {
  const [row] = await query<Record<string, unknown>>(
    `WITH visitors AS (
       SELECT DISTINCT properties->>'anon_session_id' AS anon_id
       FROM analytics_events
       WHERE event = 'landing_viewed' AND properties->>'anon_session_id' IS NOT NULL
         AND created_at >= NOW() - make_interval(days => $1::int)
     )
     SELECT
       COUNT(*)::int AS landed,
       COUNT(*) FILTER (WHERE EXISTS (
         SELECT 1 FROM analytics_events e
         WHERE e.event = 'hero_play_clicked' AND e.properties->>'anon_session_id' = v.anon_id))::int AS clicked_play,
       COUNT(*) FILTER (WHERE EXISTS (
         SELECT 1 FROM analytics_events e
         WHERE e.event IN ('guest_created', 'user_registered')
           AND e.properties->>'anon_session_id' = v.anon_id))::int AS signed_up
     FROM visitors v`,
    [days],
  );
  return {
    landed: num(row?.landed),
    clicked_play: num(row?.clicked_play),
    signed_up: num(row?.signed_up),
  };
}

/** Everything the funnel report / admin view needs, in one shot. */
export async function getAnalyticsReport(days: number): Promise<AnalyticsReport> {
  // NOTE: the section queries share one mocked `query` in the unit test, which
  // matches them positionally — a new section goes on the END of this list so
  // it cannot shift the mocks of the ones above it.
  const [visitors, funnel, retention, retentionByCohort, completion, acquisition, volume, tutorial, totalRow, firstMatch, soloByLevel] = await Promise.all([
    getVisitorFunnel(days),
    getFunnelMetrics(days),
    getRetentionMetrics(),
    getRetentionByCohort(),
    getCompletionStats(days),
    getAcquisitionBySource(days),
    getEventVolume(days),
    getTutorialFunnel(days),
    queryOne<{ total: number }>(`SELECT COUNT(*)::int AS total FROM analytics_events`),
    getFirstMatchStats(days),
    getSoloGamesByLevel(days),
  ]);
  return {
    window_days: days,
    total_events: num(totalRow?.total),
    visitors,
    funnel,
    retention,
    retention_by_cohort: retentionByCohort,
    tutorial,
    completion,
    first_match: firstMatch,
    solo_by_level: soloByLevel,
    acquisition,
    acquisition_channels: foldAcquisitionByChannel(acquisition),
    volume,
  };
}
