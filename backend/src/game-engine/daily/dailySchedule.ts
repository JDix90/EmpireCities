/**
 * Which puzzle a date gets.
 *
 * Three layers, first match wins:
 *   1. the dated calendar (dailyCalendar.ts) — special days, written in full;
 *   2. the set-piece library (dailySetPieces.ts) on a weekday cadence, sized
 *      by the generator from the date;
 *   3. the last-resort generator, when a cadence slot's bucket is empty.
 *
 * Everything is a pure function of the date plus the code, so every process
 * computes the identical day and the CI sweep can prove any day in advance.
 * The only mutable thing in this file is a small memo of materialized days,
 * because the read path reconciles the stored row against the schedule on
 * every request.
 */
import { getMapById } from '../../modules/maps/mapService';
import type { GameMap } from '../../types';
import { getAuthoredDailySpec, DAILY_CALENDAR } from '../../content/dailyCalendar';
import {
  DAILY_SET_PIECES,
  setPiecesOfKind,
  type DailySetPiece,
  type TacticalSetPiece,
} from '../../content/dailySetPieces';
import type { DailyPuzzleSpec } from './dailyPuzzleTypes';
import {
  buildCalibratedMilitarySpec,
  buildDailyPuzzleBase,
  buildEconomyDay,
  buildTechDay,
  calibrateTactical,
  economySpecFromBase,
  findConnection,
  GENERATED_AI_DIFFICULTY,
  GENERATED_MAX_TURNS,
  GENERATED_PLAYER_COUNT,
  TACTICAL_BAND_HARD,
  TACTICAL_BAND_STANDARD,
  techSpecFromBase,
  territoryDisplayName,
  type TacticalBand,
} from './dailyGenerator';
import { createSeededRng, hashStringToSeed } from '../victory/missions';

export type DailyVerb = 'tactical' | 'economy' | 'tech' | 'domination';

export interface CadenceSlot {
  /** The verb for this weekday; 'any' walks every puzzle-shaped set-piece. */
  verb: DailyVerb | 'any';
  /** Tactical band. Friday is the harder fight. */
  band?: 'standard' | 'hard';
  /** What to do when the verb's bucket is empty. */
  fallback?: DailyVerb;
}

/**
 * The weekly rhythm, keyed by UTC weekday (0 = Sunday). Players learn the
 * shape of the week; the author knows Saturday is the only slot that ever
 * wants hand work, and even that runs unattended from the library.
 */
export const WEEKDAY_CADENCE: Readonly<Record<number, CadenceSlot>> = {
  1: { verb: 'tactical', band: 'standard' },
  2: { verb: 'economy' },
  3: { verb: 'tactical', band: 'standard' },
  4: { verb: 'tech' },
  5: { verb: 'tactical', band: 'hard' },
  // Any puzzle verb. Domination is Sunday's alone: two long days in one
  // weekend is not a rhythm, it is a wall.
  6: { verb: 'any' },
  0: { verb: 'domination', fallback: 'tactical' },
};

/** The set-pieces Saturday walks: every puzzle-shaped entry, in id order. */
function saturdayLibrary(): DailySetPiece[] {
  return DAILY_SET_PIECES.filter((sp) => sp.kind !== 'domination').sort((a, b) => a.id.localeCompare(b.id));
}

export type DailySource = 'calendar' | 'library' | 'generator';

export interface ScheduledDay {
  date: string;
  source: DailySource;
  /** Set when the day came from the library. */
  set_piece_id?: string;
  spec: DailyPuzzleSpec;
}

export interface ScheduleDeps {
  loadMap: (mapId: string) => Promise<GameMap | null>;
}

const defaultDeps: ScheduleDeps = { loadMap: getMapById };

// ── Date arithmetic ──────────────────────────────────────────────────────────

const DAY_MS = 86_400_000;

function dayNumber(date: string): number {
  return Math.floor(Date.parse(`${date}T00:00:00Z`) / DAY_MS);
}

/** UTC weekday, 0 = Sunday. */
export function weekdayOf(date: string): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

/** Weeks since the epoch, with weeks starting on Monday. */
export function weekIndexOf(date: string): number {
  // 1970-01-01 was a Thursday (day 0); +3 puts the boundary on Monday.
  return Math.floor((dayNumber(date) + 3) / 7);
}

/** Weekdays (Mon..Sun order) whose cadence slot carries this verb. */
function slotsForVerb(verb: DailyVerb | 'any'): number[] {
  const order = [1, 2, 3, 4, 5, 6, 0];
  return order.filter((wd) => WEEKDAY_CADENCE[wd].verb === verb);
}

/**
 * The rotation ordinal for a verb on a date: how many cadence slots of that
 * verb have occurred up to and including this one, counted from the epoch.
 * Walking a bucket by ordinal visits every entry before any repeats.
 */
export function rotationOrdinal(date: string, verb: DailyVerb | 'any'): number {
  const slots = slotsForVerb(verb);
  const slot = slots.indexOf(weekdayOf(date));
  if (slot < 0) return -1;
  return weekIndexOf(date) * slots.length + slot;
}

function pickFromBucket<T extends { id: string }>(
  bucket: readonly T[],
  ordinal: number,
  exclude: ReadonlySet<string> = new Set(),
): T | null {
  if (bucket.length === 0 || ordinal < 0) return null;
  const sorted = [...bucket].sort((a, b) => a.id.localeCompare(b.id));
  // Walk forward past excluded entries; give up on exclusion if it would
  // exclude everything (a library smaller than a week).
  for (let i = 0; i < sorted.length; i++) {
    const candidate = sorted[(ordinal + i) % sorted.length];
    if (!exclude.has(candidate.id)) return candidate;
  }
  return sorted[ordinal % sorted.length];
}

function addDays(date: string, days: number): string {
  return new Date((dayNumber(date) + days) * DAY_MS).toISOString().slice(0, 10);
}

/** The Monday that starts this date's week. */
export function mondayOf(date: string): string {
  return addDays(date, -((weekdayOf(date) + 6) % 7));
}

/** The set-pieces the verb slots (every day but Saturday) serve in a date's week. */
function servedByVerbSlots(date: string): Set<string> {
  const monday = mondayOf(date);
  const served = new Set<string>();
  for (let i = 0; i < 7; i++) {
    const d = addDays(monday, i);
    if (weekdayOf(d) === 6) continue;
    const id = pickSetPieceForDate(d)?.id;
    if (id) served.add(id);
  }
  return served;
}

/**
 * Saturday's cursor. Saturday walks the whole puzzle library, and a plain
 * ordinal walk would run in lockstep with the verb walks: with a dozen entries
 * and a seven-entry tactical bucket, one front landed on its Saturday only in
 * weeks it had already been served, so it never landed on a Saturday at all.
 *
 * Instead Saturday consumes the sorted library one entry per week, skips any
 * entry the other six days of that week serve, and keeps its place — so every
 * entry is consumed in turn, and a front never comes round twice in one week.
 * The cursor is a pure function of the date (it replays from a fixed origin
 * week) and is memoized per process.
 */
const SATURDAY_CURSOR_ORIGIN_WEEK = weekIndexOf('2026-09-14');
const saturdayCursorMemo = new Map<number, number>();

function saturdayDateOfWeek(week: number): string {
  // Week w starts on the Monday `w*7 - 3` days after the epoch; Saturday is +5.
  return new Date((week * 7 - 3 + 5) * DAY_MS).toISOString().slice(0, 10);
}

function saturdayPick(date: string): DailySetPiece | null {
  const sorted = saturdayLibrary();
  if (sorted.length === 0) return null;
  const week = weekIndexOf(date);
  if (week < SATURDAY_CURSOR_ORIGIN_WEEK) {
    return pickFromBucket(sorted, rotationOrdinal(date, 'any'), servedByVerbSlots(date));
  }
  // Replay the cursor from the origin (or the last memoized week).
  let w = SATURDAY_CURSOR_ORIGIN_WEEK;
  let cursor = 0;
  for (let k = week - 1; k >= SATURDAY_CURSOR_ORIGIN_WEEK; k--) {
    const known = saturdayCursorMemo.get(k);
    if (known !== undefined) {
      w = k + 1;
      cursor = known + 1;
      break;
    }
  }
  for (; w <= week; w++) {
    const excluded = servedByVerbSlots(saturdayDateOfWeek(w));
    for (let tries = 0; tries < sorted.length && excluded.has(sorted[cursor % sorted.length].id); tries++) {
      cursor++;
    }
    saturdayCursorMemo.set(w, cursor);
    if (w === week) return sorted[cursor % sorted.length];
    cursor++;
  }
  return null;
}

/**
 * Which set-piece a date's cadence slot would pick, before sizing. A pure
 * function of the date; the verb slots walk their bucket by ordinal, Saturday
 * walks the whole library with the cursor above.
 */
export function pickSetPieceForDate(date: string): DailySetPiece | null {
  if (getAuthoredDailySpec(date)) return null;
  const slot = WEEKDAY_CADENCE[weekdayOf(date)];
  if (slot.verb !== 'any') {
    return pickFromBucket(setPiecesOfKind(slot.verb), rotationOrdinal(date, slot.verb));
  }
  return saturdayPick(date);
}

// ── Seeds ────────────────────────────────────────────────────────────────────

function seedsFor(date: string, id: string): { seed: number; dice_queue_seed: number } {
  return {
    seed: hashStringToSeed(`daily:${date}:${id}`),
    dice_queue_seed: hashStringToSeed(`daily-dice:${date}:${id}`),
  };
}

// ── Materializing a set-piece ────────────────────────────────────────────────

async function materializeTactical(
  date: string,
  sp: TacticalSetPiece,
  band: TacticalBand,
  deps: ScheduleDeps,
): Promise<DailyPuzzleSpec | null> {
  const map = await deps.loadMap(sp.map_id);
  if (!map) {
    console.warn(`[daily] ${date}: set-piece "${sp.id}" needs map ${sp.map_id}, which did not load`);
    return null;
  }
  const edge = findConnection(map, sp.anchor, sp.target);
  if (!edge) {
    console.warn(`[daily] ${date}: set-piece "${sp.id}": ${sp.anchor} does not border ${sp.target}`);
    return null;
  }
  const seeds = seedsFor(date, sp.id);
  const calibrated = calibrateTactical({
    anchor: sp.anchor,
    target: sp.target,
    support: sp.support ?? null,
    relief: sp.relief ?? null,
    extraAi: sp.extra_ai,
    assaultIsSea: edge.type === 'sea',
    rng: createSeededRng((seeds.dice_queue_seed ^ 0x7ac71ca1) >>> 0),
    band,
    maxTurnsBase: GENERATED_MAX_TURNS,
  });
  if (!calibrated) return null;

  return {
    archetype: 'military_capture',
    title: sp.title,
    intro: sp.intro,
    goal: `Capture ${territoryDisplayName(map, sp.target)} before time runs out.`,
    era_id: sp.era_id,
    map_id: sp.map_id,
    seed: seeds.seed,
    player_count: GENERATED_PLAYER_COUNT,
    max_turns: calibrated.max_turns,
    dice_queue_seed: seeds.dice_queue_seed,
    target_territory_id: sp.target,
    anchor_territory_id: sp.anchor,
    ...(sp.hint ? { hint: sp.hint } : {}),
    ai_difficulty: sp.ai_difficulty ?? GENERATED_AI_DIFFICULTY,
    clear_board: true,
    starting_phase: 'attack',
    starting_board: calibrated.board,
  };
}

async function materialize(
  date: string,
  sp: DailySetPiece,
  band: TacticalBand,
  deps: ScheduleDeps,
): Promise<DailyPuzzleSpec | null> {
  const seeds = seedsFor(date, sp.id);
  switch (sp.kind) {
    case 'tactical':
      return materializeTactical(date, sp, band, deps);
    case 'economy':
      return buildEconomyDay({ ...sp, ...seeds });
    case 'tech':
      return buildTechDay({ ...sp, ...seeds });
    case 'domination':
      // The dealt board is the content, so the seed stays; only the dice move.
      return { ...sp.spec, dice_queue_seed: seeds.dice_queue_seed };
  }
}

// ── The last-resort generator ────────────────────────────────────────────────

async function generateFallback(
  date: string,
  verb: DailyVerb,
  deps: ScheduleDeps,
): Promise<DailyPuzzleSpec> {
  const b = buildDailyPuzzleBase(date);
  if (verb === 'tactical' || verb === 'domination') {
    const map = await deps.loadMap(b.map_id);
    const calibrated = map ? buildCalibratedMilitarySpec(b, map, GENERATED_MAX_TURNS) : null;
    if (calibrated) return calibrated;
    console.warn(
      `[daily] ${date}: could not calibrate a tactical board on ${b.map_id} `
        + `(map ${map ? 'loaded' : 'MISSING'}) — serving the economy puzzle instead.`,
    );
    return economySpecFromBase(b);
  }
  if (verb === 'tech') {
    const tech = techSpecFromBase(b);
    if (tech) return tech;
    console.warn(`[daily] ${date}: era ${b.era_id} has no root tech — serving the economy puzzle instead.`);
  }
  return economySpecFromBase(b);
}

// ── The schedule ─────────────────────────────────────────────────────────────

const memo = new Map<string, ScheduledDay>();
const MEMO_LIMIT = 8;

function remember(day: ScheduledDay): ScheduledDay {
  memo.set(day.date, day);
  if (memo.size > MEMO_LIMIT) {
    const oldest = memo.keys().next().value;
    if (oldest !== undefined) memo.delete(oldest);
  }
  return day;
}

/** Test seam: forget memoized days and the Saturday cursor. */
export function resetDailyScheduleMemo(): void {
  memo.clear();
  saturdayCursorMemo.clear();
}

/**
 * The puzzle for a date (YYYY-MM-DD, UTC). Pure in the date apart from map
 * loading; memoized per process because the read path calls it on every
 * request to reconcile the stored row.
 */
export async function scheduleDay(date: string, deps: ScheduleDeps = defaultDeps): Promise<ScheduledDay> {
  const cached = deps === defaultDeps ? memo.get(date) : undefined;
  if (cached) return cached;
  const day = await computeDay(date, deps);
  return deps === defaultDeps ? remember(day) : day;
}

async function computeDay(date: string, deps: ScheduleDeps): Promise<ScheduledDay> {
  const authored = getAuthoredDailySpec(date);
  if (authored) return { date, source: 'calendar', spec: authored };

  const slot = WEEKDAY_CADENCE[weekdayOf(date)];
  const band = slot.band === 'hard' ? TACTICAL_BAND_HARD : TACTICAL_BAND_STANDARD;

  const picked = pickSetPieceForDate(date);
  if (picked) {
    const spec = await materialize(date, picked, band, deps);
    if (spec) return { date, source: 'library', set_piece_id: picked.id, spec };
    console.warn(`[daily] ${date}: set-piece "${picked.id}" could not be sized — using the generator.`);
  }

  const verb: DailyVerb =
    slot.verb === 'any' ? 'tactical' : slot.verb === 'domination' ? (slot.fallback ?? 'tactical') : slot.verb;
  return { date, source: 'generator', spec: await generateFallback(date, verb, deps) };
}

/** One line for the startup log: what the library holds and how far the dated calendar reaches. */
export function describeDailySchedule(): string {
  const counts: Record<DailyVerb, number> = { tactical: 0, economy: 0, tech: 0, domination: 0 };
  for (const sp of DAILY_SET_PIECES) counts[sp.kind] += 1;
  const dated = Object.keys(DAILY_CALENDAR).sort();
  const last = dated.length ? dated[dated.length - 1] : 'none';
  return (
    `[daily] library: ${DAILY_SET_PIECES.length} set-pieces `
    + `(${counts.tactical} tactical, ${counts.economy} economy, ${counts.tech} tech, ${counts.domination} domination); `
    + `dated calendar: ${dated.length} day(s), last ${last}`
  );
}
