import { getMapById } from '../../modules/maps/mapService';
import { query, queryOne } from '../../db/postgres';
import { getEraTechTree } from '../eras';
import type { DailyPuzzleSpec } from './dailyPuzzleTypes';
import { buildDailyPuzzleBase, captureGoal, economySpecFromBase, regionGoal, territoryDisplayName } from './dailyGenerator';
import { featureFlags } from '../../config/featureFlags';
import { scheduleDay, type ScheduledDay } from './dailySchedule';
import { scheduleDayV2 } from './dailyScheduleV2';

export { territoryDisplayName, captureGoal, regionGoal };

/**
 * Rewrites goal (and related copy) using map/tech lookups so APIs never expose raw territory_id strings.
 */
export async function enrichDailyPuzzleSpecForDisplay(spec: DailyPuzzleSpec): Promise<DailyPuzzleSpec> {
  if (spec.archetype === 'military_capture' && spec.target_territory_id) {
    const map = await getMapById(spec.map_id);
    return { ...spec, goal: captureGoal(map, [spec.target_territory_id]) };
  }
  if (spec.archetype === 'capture_chain' && spec.target_territory_ids?.length) {
    const map = await getMapById(spec.map_id);
    return { ...spec, goal: captureGoal(map, spec.target_territory_ids) };
  }
  if (spec.archetype === 'control_region' && spec.region_id) {
    const map = await getMapById(spec.map_id);
    return { ...spec, goal: regionGoal(map, spec.region_id) };
  }
  if (spec.archetype === 'hold_territory' && spec.target_territory_id) {
    const map = await getMapById(spec.map_id);
    const label = territoryDisplayName(map, spec.target_territory_id);
    return {
      ...spec,
      goal: `Hold ${label} for ${spec.max_turns} turns.`,
    };
  }
  if (spec.archetype === 'tech_research' && spec.tech_id) {
    const tree = getEraTechTree(spec.era_id);
    const node = tree.find((n) => n.tech_id === spec.tech_id);
    const name = node?.name?.trim() ?? spec.tech_id.replace(/_/g, ' ');
    return {
      ...spec,
      goal: `Research “${name}”.`,
    };
  }
  return spec;
}

/**
 * Full spec for persistence and API. The schedule decides the day — dated
 * calendar first, then the set-piece library on its weekday cadence, then the
 * last-resort generator — and everything derives from the date, so every
 * process computes the identical day.
 */
export async function buildCompleteDailyPuzzleSpec(today: string): Promise<DailyPuzzleSpec> {
  return (await scheduleServedDay(today)).spec;
}

/**
 * The day as it is served: the v2 decision puzzle when the flag is on and the
 * date proved as one (docs/DAILY_PUZZLE_V2.md), else the v1 day. The flag is
 * read here, at the one seam, so both schedules stay pure in the date.
 */
export async function scheduleServedDay(date: string): Promise<ScheduledDay> {
  if (featureFlags.dailyPuzzleV2Enabled) {
    const v2 = await scheduleDayV2(date);
    if (v2) return v2;
  }
  return scheduleDay(date);
}

export interface DailyChallengeRow {
  challenge_date: string;
  era_id: string;
  map_id: string;
  seed: number;
  player_count: number;
  kind: string;
  spec: DailyPuzzleSpec;
}

const VALID_ARCHETYPES: ReadonlySet<string> = new Set([
  'domination',
  'military_capture',
  'hold_territory',
  'control_region',
  'capture_chain',
  'economy_build',
  'tech_research',
]);
const VALID_AI_DIFFICULTIES: ReadonlySet<string> = new Set(['easy', 'medium', 'hard', 'expert']);

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}
function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0;
}
function isOptionalString(v: unknown): boolean {
  return v === undefined || typeof v === 'string';
}

/**
 * Structural validation for a spec coming back from the JSONB round-trip.
 * The row is written by this process today, but it outlives deploys: a spec
 * authored against an older shape, or hand-edited in the DB, used to sail
 * through a bare cast and blow up somewhere deep in game start instead.
 * Returns null on anything unusable; the caller regenerates and logs.
 */
export function validateDailyPuzzleSpec(raw: unknown): DailyPuzzleSpec | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const s = raw as Record<string, unknown>;

  if (!VALID_ARCHETYPES.has(s.archetype as string)) return null;
  if (!isNonEmptyString(s.title) || !isNonEmptyString(s.intro) || !isNonEmptyString(s.goal)) return null;
  if (!isNonEmptyString(s.era_id) || !isNonEmptyString(s.map_id)) return null;
  if (!isFiniteNumber(s.seed) || !isFiniteNumber(s.player_count)) return null;
  if (!isFiniteNumber(s.max_turns) || !isFiniteNumber(s.dice_queue_seed)) return null;
  if (!isOptionalString(s.target_territory_id) || !isOptionalString(s.anchor_territory_id)) return null;
  if (!isOptionalString(s.region_id)) return null;
  if (s.target_territory_ids !== undefined
      && (!Array.isArray(s.target_territory_ids) || s.target_territory_ids.some((t) => !isNonEmptyString(t)))) {
    return null;
  }
  if (!isOptionalString(s.building_type) || !isOptionalString(s.tech_id) || !isOptionalString(s.hint)) return null;

  if (s.ai_difficulty !== undefined && !VALID_AI_DIFFICULTIES.has(s.ai_difficulty as string)) return null;
  if (s.par_turns !== undefined && (!isFiniteNumber(s.par_turns) || s.par_turns < 1)) return null;
  if (s.starting_phase !== undefined && s.starting_phase !== 'attack') return null;
  if (s.clear_board !== undefined && typeof s.clear_board !== 'boolean') return null;
  if (s.settings_overrides !== undefined
      && (typeof s.settings_overrides !== 'object' || s.settings_overrides === null || Array.isArray(s.settings_overrides))) {
    return null;
  }
  if (s.grants !== undefined) {
    if (typeof s.grants !== 'object' || s.grants === null) return null;
    const g = s.grants as Record<string, unknown>;
    if (g.tech_points !== undefined && !isFiniteNumber(g.tech_points)) return null;
    if (g.gold !== undefined && !isFiniteNumber(g.gold)) return null;
  }
  if (s.starting_board !== undefined) {
    if (typeof s.starting_board !== 'object' || s.starting_board === null || Array.isArray(s.starting_board)) return null;
    for (const entry of Object.values(s.starting_board as Record<string, unknown>)) {
      if (!entry || typeof entry !== 'object') return null;
      const t = entry as Record<string, unknown>;
      if (t.owner !== 'human' && t.owner !== 'ai' && t.owner !== null) return null;
      if (!isFiniteNumber(t.unit_count) || t.unit_count < 0) return null;
      if (t.buildings !== undefined
          && (!Array.isArray(t.buildings) || t.buildings.some((b) => typeof b !== 'string'))) {
        return null;
      }
    }
  }

  if (s.v2 !== undefined && !isValidV2(s.v2)) return null;

  return raw as DailyPuzzleSpec;
}

const V2_VERDICTS: ReadonlySet<string> = new Set(['before_dice', 'silent']);
const V2_INTENTS: ReadonlySet<string> = new Set(['arrows', 'prose']);
const V2_ACTION_KINDS: ReadonlySet<string> = new Set(['draft', 'assault', 'end_attack', 'fortify', 'end_turn']);

function isStoredAction(v: unknown): boolean {
  if (!v || typeof v !== 'object') return false;
  const a = v as Record<string, unknown>;
  if (!V2_ACTION_KINDS.has(a.kind as string)) return false;
  if (a.kind === 'draft') return isNonEmptyString(a.to) && isOptionalString(a.split);
  if (a.kind === 'assault') return isNonEmptyString(a.from) && isNonEmptyString(a.to) && isFiniteNumber(a.keep);
  if (a.kind === 'fortify') return isNonEmptyString(a.from) && isNonEmptyString(a.to) && (a.units === 'all_but_1' || a.units === 'half');
  return true;
}

/**
 * The v2 block, structurally: the shape play and the archive read. Territory
 * ids inside actions are checked against the board when the day is played
 * (puzzle/actions.ts parseAction), not here.
 */
function isValidV2(raw: unknown): boolean {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false;
  const v = raw as Record<string, unknown>;
  if (v.version !== 2) return false;
  if (!isNonEmptyString(v.theme)) return false;
  if (!v.plan || typeof v.plan !== 'object' || !Array.isArray((v.plan as Record<string, unknown>).steps)) return false;
  if (!Array.isArray(v.plan_prose) || v.plan_prose.some((l) => typeof l !== 'string')) return false;
  if (!isFiniteNumber(v.decisions_target) || v.decisions_target < 1) return false;
  if (!V2_VERDICTS.has(v.verdicts as string) || !V2_INTENTS.has(v.intent as string)) return false;
  const sol = v.solution as Record<string, unknown> | undefined;
  if (!sol || typeof sol !== 'object' || Array.isArray(sol)) return false;
  if (!isFiniteNumber(sol.equity) || !isFiniteNumber(sol.obvious_equity) || !isFiniteNumber(sol.near_best) || !isFiniteNumber(sol.nodes)) return false;
  if (!Array.isArray(sol.decisions) || !Array.isArray(sol.line)) return false;
  for (const d of sol.decisions as unknown[]) {
    if (!d || typeof d !== 'object') return false;
    const r = d as Record<string, unknown>;
    if (!isFiniteNumber(r.turn) || (r.phase !== 'draft' && r.phase !== 'attack' && r.phase !== 'fortify')) return false;
    if (!isStoredAction(r.best) || (r.alternative !== null && !isStoredAction(r.alternative))) return false;
    if (!isFiniteNumber(r.best_equity) || !isFiniteNumber(r.alternative_equity) || !isFiniteNumber(r.gap)) return false;
  }
  for (const step of sol.line as unknown[]) {
    if (!step || typeof step !== 'object') return false;
    const r = step as Record<string, unknown>;
    if (!isFiniteNumber(r.turn) || !isStoredAction(r.action) || !isFiniteNumber(r.equity)) return false;
  }
  return true;
}

function parseSpec(raw: unknown): DailyPuzzleSpec {
  const validated = validateDailyPuzzleSpec(raw);
  if (validated) return validated;
  console.error(
    '[daily] stored spec_json failed validation — regenerating a domination fallback for today',
    { raw_type: typeof raw },
  );
  return economySpecFromBase(buildDailyPuzzleBase(dailyChallengeDate()));
}

/** The calendar's date key: the daily rolls over at UTC midnight, everywhere. */
export function dailyChallengeDate(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

interface StoredChallengeRow {
  challenge_date: string;
  era_id: string;
  map_id: string;
  seed: number;
  player_count: number;
  kind: string;
  spec_json: unknown;
}

const STORED_ROW_COLUMNS = 'challenge_date, era_id, map_id, seed, player_count, kind, spec_json';

/** Key order survives neither a JSONB round-trip nor hand-authoring, so compare on sorted keys. */
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    return Object.fromEntries(Object.keys(obj).sort().map((k) => [k, canonicalize(obj[k])]));
  }
  return value;
}

/**
 * Whether a stored spec still matches what the calendar says for its date.
 *
 * Both sides are compared post-enrichment: the row is enriched before it is
 * written, and enrichment is idempotent, so the stored JSONB is directly
 * comparable to `enrichDailyPuzzleSpecForDisplay(authored)`.
 */
export function specsDiffer(a: DailyPuzzleSpec, b: DailyPuzzleSpec): boolean {
  return JSON.stringify(canonicalize(a)) !== JSON.stringify(canonicalize(b));
}

/** Dates whose in-play mismatch has been logged this process — once is loud enough. */
const warnedInPlay = new Set<string>();

/** Attempts recorded plus games still being played on a given date's challenge. */
async function countDailyPlay(date: string): Promise<number> {
  const row = await queryOne<{ n: number }>(
    `SELECT (
       (SELECT COUNT(*) FROM daily_challenge_entries WHERE challenge_date = $1::date)
       + (SELECT COUNT(*) FROM games
          WHERE (settings_json->>'daily_challenge_date')::date = $1::date
            AND status IN ('waiting', 'in_progress'))
     )::int AS n`,
    [date],
  );
  return row?.n ?? 0;
}

/**
 * Reconcile a stored row against the schedule.
 *
 * A scheduled day is content, not a frozen seed. The row is written the first
 * time a date is served, so a day authored, added to the library, or re-sized
 * by a generator fix after that point would otherwise never reach players —
 * the stored spec wins forever and nothing says so. When the schedule
 * disagrees with the stored copy, the stored copy is stale and is rewritten in
 * place. This applies to every day, not only dated ones: the whole schedule is
 * deterministic in the date, so "what the code says today" is well defined
 * for any date.
 *
 * The one case where it is not rewritten is a day already in play: swapping the
 * board under recorded scores would leave that date's leaderboard ranking two
 * different puzzles against each other. Then the stored spec stands and the
 * mismatch is logged — loudly, because a silent no-op is the exact failure this
 * function exists to end. `scripts/refreshTodayDailyChallenge.ts` is the
 * deliberate override.
 */
async function reconcileScheduledRow(
  date: string,
  existing: StoredChallengeRow,
): Promise<DailyChallengeRow> {
  const scheduled = (await scheduleServedDay(date)).spec;

  const spec = await enrichDailyPuzzleSpecForDisplay(scheduled);
  const stored = parseSpec(existing.spec_json);
  const rowFrom = (s: DailyPuzzleSpec): DailyChallengeRow => ({
    challenge_date: existing.challenge_date,
    era_id: s.era_id,
    map_id: s.map_id,
    seed: s.seed,
    player_count: s.player_count,
    kind: existing.kind,
    spec: s,
  });
  if (!specsDiffer(stored, spec)) return rowFrom(spec);

  const inPlay = await countDailyPlay(date);
  if (inPlay > 0) {
    if (!warnedInPlay.has(date)) warnedInPlay.add(date);
    else return rowFrom(stored);
    console.warn(
      `[daily] ${date} is scheduled as "${spec.title}" but the stored challenge is "${stored.title}". `
        + `Keeping the stored one: ${inPlay} attempt(s)/active game(s) already exist for that date. `
        + 'Reset it deliberately with scripts/refreshTodayDailyChallenge.ts.',
    );
    return rowFrom(stored);
  }

  await query(
    `UPDATE daily_challenges
     SET era_id = $2, map_id = $3, seed = $4, player_count = $5, kind = 'puzzle', spec_json = $6::jsonb
     WHERE challenge_date = $1`,
    [date, spec.era_id, spec.map_id, spec.seed, spec.player_count, JSON.stringify(spec)],
  );
  console.log(`[daily] ${date}: stored challenge "${stored.title}" replaced by the scheduled "${spec.title}"`);
  return { ...rowFrom(spec), kind: 'puzzle' };
}

/**
 * Idempotent: ensures the date's row exists with a spec, returns the row for API/game start.
 */
export async function ensureDailyChallengeForToday(): Promise<DailyChallengeRow> {
  return ensureDailyChallengeForDate(dailyChallengeDate());
}

/**
 * The deliberate override for the one case the read path refuses to reconcile
 * on its own: a day already in play. Deletes the date's row and regenerates it
 * from the schedule.
 *
 * Unfinished games for the date go first, on purpose. A daily game carries a
 * copy of the spec in its settings, so one left standing would resume the OLD
 * puzzle and then be scored against the new row. ON DELETE CASCADE removes the
 * date's entries with the row, so the day reopens for everyone.
 */
export async function regenerateDailyChallengeForDate(
  date: string,
): Promise<{ row: DailyChallengeRow; deleted_games: number; deleted_rows: number }> {
  const games = await query<{ game_id: string }>(
    `DELETE FROM games
     WHERE (settings_json->>'daily_challenge_date')::date = $1::date
       AND status IN ('waiting', 'in_progress')
     RETURNING game_id`,
    [date],
  );
  const rows = await query<{ challenge_date: string }>(
    'DELETE FROM daily_challenges WHERE challenge_date = $1::date RETURNING challenge_date',
    [date],
  );
  const row = await ensureDailyChallengeForDate(date);
  return { row, deleted_games: games.length, deleted_rows: rows.length };
}

export async function regenerateDailyChallengeForToday(): ReturnType<typeof regenerateDailyChallengeForDate> {
  return regenerateDailyChallengeForDate(dailyChallengeDate());
}

export async function ensureDailyChallengeForDate(today: string): Promise<DailyChallengeRow> {
  const existing = await queryOne<StoredChallengeRow>(
    `SELECT ${STORED_ROW_COLUMNS}
     FROM daily_challenges WHERE challenge_date = $1`,
    [today],
  );
  if (existing) return reconcileScheduledRow(today, existing);

  const spec = await enrichDailyPuzzleSpecForDisplay(await buildCompleteDailyPuzzleSpec(today));
  await query(
    `INSERT INTO daily_challenges (challenge_date, era_id, map_id, seed, player_count, kind, spec_json)
     VALUES ($1, $2, $3, $4, $5, 'puzzle', $6::jsonb)
     ON CONFLICT (challenge_date) DO NOTHING`,
    [today, spec.era_id, spec.map_id, spec.seed, spec.player_count, JSON.stringify(spec)],
  );

  const again = await queryOne<StoredChallengeRow>(
    `SELECT ${STORED_ROW_COLUMNS}
     FROM daily_challenges WHERE challenge_date = $1`,
    [today],
  );
  if (!again) {
    throw new Error('Failed to create daily challenge row');
  }
  const parsed = await enrichDailyPuzzleSpecForDisplay(parseSpec(again.spec_json));
  return {
    challenge_date: again.challenge_date,
    era_id: again.era_id,
    map_id: again.map_id,
    seed: again.seed,
    player_count: again.player_count,
    kind: again.kind,
    spec: parsed,
  };
}
