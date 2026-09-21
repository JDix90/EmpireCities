/**
 * Public daily-challenge archive: the settled past, as data.
 *
 * Every day the Daily generates a fresh authored puzzle, a few dozen people
 * play it, and the result disappears at midnight. That is a permanent, dated,
 * genuinely-unique artifact being thrown away — so this module reads it back
 * out for a public page per day (`/daily/YYYY-MM-DD`).
 *
 * Two rules govern what may leave this module:
 *
 * 1. **Settled days only.** A day is archivable strictly BEFORE the current
 *    challenge date. Today's puzzle is live content: publishing its goal,
 *    target territory or par would hand an unearned advantage to anyone who
 *    read the archive before playing.
 * 2. **Display fields only.** The stored spec carries game-start inputs —
 *    `dice_queue_seed`, `starting_board`, `grants`, `settings_overrides`,
 *    `clear_board`, `seed` — that are not display data. `toArchiveSpec` is an
 *    allowlist rather than a delete-list, so a field added to
 *    `DailyPuzzleSpec` later is private here until someone deliberately names
 *    it.
 *
 * The leaderboard matches the policy the live board already uses (see
 * `/today` in daily.routes.ts): registered commanders only. A guest identity
 * is one unauthenticated POST away, so a public board admitting guests would
 * be farmable by anyone willing to clear their storage.
 */
import { query, queryOne } from '../../db/postgres';
import { dailyChallengeDate, territoryDisplayName } from '../../game-engine/daily/dailyPuzzleService';
import { getMapById } from '../maps/mapService';
import type { GameMap } from '../../types';
import type { DailyPuzzleSpec, DailyPuzzleV2, StoredPuzzleAction, StoredPuzzleDecision } from '../../game-engine/daily/dailyPuzzleTypes';
import { DAILY_LEADERBOARD_COLUMNS, DAILY_LEADERBOARD_ORDER_BY } from './dailyLeaderboardOrder';
import { humanizeEra } from '../share/replayOgData';

/** Display-safe subset of a day's spec. Allowlist — never spread the spec. */
export interface DailyArchiveSpec {
  archetype: string;
  title: string;
  intro: string;
  goal: string;
  era_id: string;
  era_label: string;
  map_id: string;
  player_count: number;
  max_turns: number;
  par_turns: number | null;
  ai_difficulty: string | null;
  /** A v2 day, once it is over: the lesson and the solution (docs/DAILY_PUZZLE_V2.md §5.5). */
  v2?: DailyArchiveV2;
}

/** The archive's reading of a v2 day. Past days only, so the solution is public here. */
export interface DailyArchiveV2 {
  theme: string;
  plan_prose: string[];
  decisions_target: number;
  verdicts: DailyPuzzleV2['verdicts'];
  /** Best-play and obvious-line win probability from the opening, 0–1. */
  equity: number;
  obvious_equity: number;
  decisions: StoredPuzzleDecision[];
  line: Array<{ turn: number; action: StoredPuzzleAction; equity: number }>;
  /** Display names for every territory the plan and the solution mention. */
  names: Record<string, string>;
}

export interface DailyArchiveLeader {
  username: string;
  won: boolean;
  puzzle_score: number | null;
  turn_count: number | null;
  territory_count: number | null;
  puzzle_version?: number;
  accuracy?: number | null;
  first_try?: boolean | null;
  attempts?: number | null;
}

export interface DailyArchiveResults {
  attempts: number;
  wins: number;
  /** Wins ÷ attempts, 0–100, one decimal. Null when nobody played. */
  win_rate: number | null;
  best_score: number | null;
  /** Median turns among winners — the "how long did solving it take" number. */
  median_winning_turns: number | null;
  leaderboard: DailyArchiveLeader[];
}

export interface DailyArchiveEntry {
  challenge_date: string;
  kind: string;
  spec: DailyArchiveSpec;
  results: DailyArchiveResults;
}

export interface DailyArchiveSummary {
  challenge_date: string;
  title: string;
  archetype: string;
  era_label: string;
  attempts: number;
  wins: number;
}

/** `YYYY-MM-DD`, the only shape any archive route accepts. */
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Normalize a date that may arrive as a pg `Date` (the driver maps DATE) or as
 * text, to `YYYY-MM-DD`. Using toISOString on a pg Date would shift it by the
 * local UTC offset and silently publish the wrong day's results.
 */
export function toDateString(value: unknown): string {
  if (value instanceof Date) {
    const y = value.getFullYear();
    const m = String(value.getMonth() + 1).padStart(2, '0');
    const d = String(value.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  return String(value).slice(0, 10);
}

/** True when `date` is well-formed AND strictly before today's live challenge. */
export function isArchivableDate(date: string, now: Date = new Date()): boolean {
  if (!DATE_RE.test(date)) return false;
  return date < dailyChallengeDate(now);
}

export function toArchiveSpec(
  spec: DailyPuzzleSpec,
  fallbackEra: string,
  fallbackMap: string,
  fallbackPlayers: number,
  map: GameMap | null = null,
): DailyArchiveSpec {
  const eraId = spec?.era_id ?? fallbackEra;
  return {
    archetype: String(spec?.archetype ?? 'domination'),
    title: String(spec?.title ?? 'Daily Challenge'),
    intro: String(spec?.intro ?? ''),
    goal: String(spec?.goal ?? ''),
    era_id: eraId,
    era_label: humanizeEra(eraId),
    map_id: spec?.map_id ?? fallbackMap,
    player_count: Number(spec?.player_count ?? fallbackPlayers),
    max_turns: Number(spec?.max_turns ?? 0),
    par_turns: spec?.par_turns ?? null,
    ai_difficulty: spec?.ai_difficulty ?? null,
    ...(spec?.v2 ? { v2: toArchiveV2(spec.v2, map) } : {}),
  };
}

function mentionedIds(v2: DailyPuzzleV2): string[] {
  const ids = new Set<string>();
  const add = (a: StoredPuzzleAction | null | undefined) => {
    if (!a) return;
    if (a.kind === 'draft') { ids.add(a.to); if (a.split) ids.add(a.split); }
    if (a.kind === 'assault' || a.kind === 'fortify') { ids.add(a.from); ids.add(a.to); }
  };
  for (const step of v2.plan?.steps ?? []) {
    if (step.kind === 'draft') ids.add(step.to);
    else { ids.add(step.from); ids.add(step.to); }
  }
  for (const d of v2.solution?.decisions ?? []) { add(d.best); add(d.alternative); }
  for (const s of v2.solution?.line ?? []) add(s.action);
  return [...ids];
}

function toArchiveV2(v2: DailyPuzzleV2, map: GameMap | null): DailyArchiveV2 {
  const names: Record<string, string> = {};
  for (const id of mentionedIds(v2)) names[id] = territoryDisplayName(map, id);
  return {
    names,
    theme: v2.theme,
    plan_prose: Array.isArray(v2.plan_prose) ? v2.plan_prose : [],
    decisions_target: v2.decisions_target,
    verdicts: v2.verdicts,
    equity: v2.solution?.equity ?? 0,
    obvious_equity: v2.solution?.obvious_equity ?? 0,
    decisions: Array.isArray(v2.solution?.decisions) ? v2.solution.decisions : [],
    line: Array.isArray(v2.solution?.line) ? v2.solution.line : [],
  };
}

interface ChallengeRow {
  challenge_date: unknown;
  era_id: string;
  map_id: string;
  player_count: number;
  kind: string;
  spec_json: DailyPuzzleSpec;
}

/**
 * One settled day, or null when the date is malformed, still live/future, or
 * was never generated. Callers 404 on null — the distinction between "not yet
 * settled" and "never existed" is deliberately not leaked.
 */
export async function getDailyArchiveEntry(
  date: string,
  now: Date = new Date(),
): Promise<DailyArchiveEntry | null> {
  if (!isArchivableDate(date, now)) return null;

  const row = await queryOne<ChallengeRow>(
    `SELECT challenge_date, era_id, map_id, player_count, kind, spec_json
     FROM daily_challenges WHERE challenge_date = $1::date`,
    [date],
  );
  if (!row) return null;

  const stats = await queryOne<{
    attempts: string;
    wins: string;
    best_score: number | null;
    median_winning_turns: string | null;
  }>(
    `SELECT COUNT(*)::int                                   AS attempts,
            COUNT(*) FILTER (WHERE dce.won)::int            AS wins,
            MAX(dce.puzzle_score) FILTER (WHERE dce.won)    AS best_score,
            PERCENTILE_CONT(0.5) WITHIN GROUP (
              ORDER BY dce.turn_count
            ) FILTER (WHERE dce.won AND dce.turn_count IS NOT NULL) AS median_winning_turns
     FROM daily_challenge_entries dce
     JOIN users u ON u.user_id = dce.user_id
     WHERE dce.challenge_date = $1::date AND u.is_guest = false`,
    [date],
  );

  const leaderboard = await query<DailyArchiveLeader>(
    `SELECT u.username, ${DAILY_LEADERBOARD_COLUMNS}
     FROM daily_challenge_entries dce
     JOIN users u ON u.user_id = dce.user_id
     WHERE dce.challenge_date = $1::date AND u.is_guest = false
     ORDER BY ${DAILY_LEADERBOARD_ORDER_BY}
     LIMIT 10`,
    [date],
  );

  // A v2 day's solution names territories; the map turns ids into names.
  const archiveMap: GameMap | null = row.spec_json?.v2 ? await getMapById(row.map_id).catch(() => null) : null;
  const attempts = Number(stats?.attempts ?? 0);
  const wins = Number(stats?.wins ?? 0);
  const medianTurns = stats?.median_winning_turns == null ? null : Number(stats.median_winning_turns);

  return {
    challenge_date: toDateString(row.challenge_date),
    kind: row.kind,
    spec: toArchiveSpec(row.spec_json, row.era_id, row.map_id, row.player_count, archiveMap),
    results: {
      attempts,
      wins,
      win_rate: attempts > 0 ? Math.round((wins / attempts) * 1000) / 10 : null,
      best_score: stats?.best_score ?? null,
      median_winning_turns: medianTurns == null ? null : Math.round(medianTurns * 10) / 10,
      leaderboard,
    },
  };
}

/**
 * Recent settled days, newest first. Powers the archive index page and the
 * sitemap, so it returns only days that actually have a stored challenge.
 */
export async function listDailyArchive(
  limit = 60,
  now: Date = new Date(),
): Promise<DailyArchiveSummary[]> {
  const capped = Math.max(1, Math.min(Math.trunc(limit) || 0, 366));
  const rows = await query<{
    challenge_date: unknown;
    era_id: string;
    spec_json: DailyPuzzleSpec;
    attempts: string;
    wins: string;
  }>(
    `SELECT dc.challenge_date, dc.era_id, dc.spec_json,
            COALESCE(s.attempts, 0) AS attempts,
            COALESCE(s.wins, 0)     AS wins
     FROM daily_challenges dc
     LEFT JOIN LATERAL (
       SELECT COUNT(*)::int AS attempts, COUNT(*) FILTER (WHERE dce.won)::int AS wins
       FROM daily_challenge_entries dce
       JOIN users u ON u.user_id = dce.user_id
       WHERE dce.challenge_date = dc.challenge_date AND u.is_guest = false
     ) s ON true
     WHERE dc.challenge_date < $1::date
     ORDER BY dc.challenge_date DESC
     LIMIT $2`,
    [dailyChallengeDate(now), capped],
  );

  return rows.map((r) => ({
    challenge_date: toDateString(r.challenge_date),
    title: String(r.spec_json?.title ?? 'Daily Challenge'),
    archetype: String(r.spec_json?.archetype ?? 'domination'),
    era_label: humanizeEra(r.spec_json?.era_id ?? r.era_id),
    attempts: Number(r.attempts ?? 0),
    wins: Number(r.wins ?? 0),
  }));
}
