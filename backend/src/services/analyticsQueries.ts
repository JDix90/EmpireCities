/**
 * Funnel + retention queries over `analytics_events`. Shared by the CLI
 * (scripts/funnelReport.ts) and the admin endpoint (GET /api/admin/metrics/funnel)
 * so the SQL lives in exactly one place.
 *
 * Cohorts are defined by each user's first `guest_created`/`user_registered`
 * event, so everything here only covers signups AFTER analytics was enabled —
 * there's no retroactive history, by design.
 */
import { query, queryOne } from '../db/postgres';

export interface FunnelMetrics {
  signups: number;
  created_game: number;
  started_game: number;
  finished_game: number;
  upgraded: number;
}

export interface RetentionMetrics {
  d1_cohort: number;
  d1: number;
  d7_cohort: number;
  d7: number;
}

export interface CompletionStats {
  finishes: number;
  wins: number;
  tutorial_finishes: number;
  avg_minutes: number | null;
  avg_turns: number | null;
}

export interface EventVolumeRow {
  event: string;
  n: number;
}

export interface AcquisitionRow {
  /** First-touch utm_source, else referrer host, else 'direct'. */
  source: string;
  signups: number;
  /** Became a real account (registered directly or upgraded from guest). */
  accounts: number;
  /** Finished at least one game (activated). */
  activated: number;
}

export interface AnalyticsReport {
  window_days: number;
  total_events: number;
  funnel: FunnelMetrics;
  retention: RetentionMetrics;
  completion: CompletionStats;
  acquisition: AcquisitionRow[];
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
       GROUP BY user_id
     )
     SELECT
       COUNT(*)::int AS signups,
       COUNT(*) FILTER (WHERE EXISTS (
         SELECT 1 FROM analytics_events e WHERE e.user_id = s.user_id AND e.event = 'game_created'))::int AS created_game,
       COUNT(*) FILTER (WHERE EXISTS (
         SELECT 1 FROM analytics_events e WHERE e.user_id = s.user_id AND e.event = 'game_started'))::int AS started_game,
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
     WHERE event = 'game_finished' AND created_at >= NOW() - make_interval(days => $1::int)`,
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

/** Raw event histogram in the trailing window. */
export async function getEventVolume(days: number): Promise<EventVolumeRow[]> {
  const rows = await query<Record<string, unknown>>(
    `SELECT event, COUNT(*)::int AS n
     FROM analytics_events
     WHERE created_at >= NOW() - make_interval(days => $1::int)
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
    signups: num(r.signups),
    accounts: num(r.accounts),
    activated: num(r.activated),
  }));
}

/** Everything the funnel report / admin view needs, in one shot. */
export async function getAnalyticsReport(days: number): Promise<AnalyticsReport> {
  const [funnel, retention, completion, acquisition, volume, totalRow] = await Promise.all([
    getFunnelMetrics(days),
    getRetentionMetrics(),
    getCompletionStats(days),
    getAcquisitionBySource(days),
    getEventVolume(days),
    queryOne<{ total: number }>(`SELECT COUNT(*)::int AS total FROM analytics_events`),
  ]);
  return {
    window_days: days,
    total_events: num(totalRow?.total),
    funnel,
    retention,
    completion,
    acquisition,
    volume,
  };
}
