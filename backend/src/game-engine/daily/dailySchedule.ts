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
  holdCapableSetPieces,
  setPiecesOfKind,
  type DailySetPiece,
  type TacticalSetPiece,
} from '../../content/dailySetPieces';
import type { DailyPuzzleSpec } from './dailyPuzzleTypes';
import { SIMULATED_ARCHETYPES, simulatePuzzle, type PuzzleSimResult } from './puzzleSim';
import {
  buildCalibratedMilitarySpec,
  buildDailyPuzzleBase,
  buildEconomyDay,
  buildTechDay,
  calibrateHold,
  calibrateTactical,
  HOLD_BAND,
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

export type DailyVerb = 'tactical' | 'hold' | 'economy' | 'tech' | 'domination';

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
  // Wednesday is the defended front: the same set-pieces read the other way.
  3: { verb: 'hold' },
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
  /**
   * The solvability gate. Null skips it (structural tests). The default is the
   * headless simulator, seeded from the spec, so every process agrees.
   */
  simulate?: ((spec: DailyPuzzleSpec, map: GameMap) => Promise<PuzzleSimResult | null>) | null;
}

const defaultDeps: ScheduleDeps = {
  loadMap: getMapById,
  simulate: (spec, map) => simulatePuzzle(spec, map, { games: GATE_GAMES }),
};

// ── The solvability gate ─────────────────────────────────────────────────────
//
// A sized board is proven before it is served: the simulator plays the
// obvious line for the verb against the shipped bot, and the day is accepted
// only if that line lands inside a band — winnable, not free. Outside the
// band the numbers are re-rolled (a different garrison, stack and clock from
// the same front) up to GATE_ATTEMPTS times; if none lands, the closest is
// served with a warning rather than a silent fallback.
//
// The bands were set by running the simulator over the authored calendar and
// the first library quarter. Capture days play as a first-assault gamble with
// a reserve for a second try, so their line solves 70–100%; the band is a
// floor against an unwinnable board and a ceiling against a freebie. Hold
// days vary far more with the numbers, which is what re-rolling is for.

export const GATE_GAMES = 40;
export const GATE_ATTEMPTS = 8;
/** How far each missed attempt moves the sizing band toward the miss. */
const GATE_BAND_STEP = 0.07;
export const GATE_BANDS: Record<'military_capture' | 'hold_territory', { min: number; max: number }> = {
  // Calibrated: the authored calendar's captures score 92–100% on the obvious
  // line; the library's land at 85–98%. The ceiling is a freebie guard, the
  // floor the unwinnable-board guard.
  military_capture: { min: 0.5, max: 0.96 },
  // Calibrated: the library's holds land at 35–80% once the numbers re-roll.
  hold_territory: { min: 0.35, max: 0.8 },
};

/**
 * Distance from the band, with a below-floor miss always counting worse than
 * an above-ceiling one: a freebie is a dull day, an unwinnable board is a
 * broken one.
 */
function bandDistance(rate: number, band: { min: number; max: number }): number {
  if (rate < band.min) return 1 + (band.min - rate);
  if (rate > band.max) return rate - band.max;
  return 0;
}

/** The sizing bands one attempt uses; the gate shifts them attempt by attempt. */
interface SizingBands {
  tactical: TacticalBand;
  hold: TacticalBand;
}

function shiftBand(band: TacticalBand, by: number): TacticalBand {
  const min = Math.min(0.9, Math.max(0.2, band.min + by));
  return { min, max: Math.min(0.95, Math.max(min + 0.05, band.max + by)) };
}

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

/** The set-pieces a verb draws from. Hold days are tactical fronts read the other way. */
export function bucketForVerb(verb: DailyVerb): readonly DailySetPiece[] {
  return verb === 'hold' ? holdCapableSetPieces() : setPiecesOfKind(verb);
}

/**
 * A verb slot's plain pick: walk the bucket by ordinal. Used by the slots
 * whose buckets are disjoint from every other slot's (economy, tech,
 * domination, tactical), where lockstep is impossible.
 */
function ordinalPick(date: string, verb: DailyVerb): DailySetPiece | null {
  return pickFromBucket(bucketForVerb(verb), rotationOrdinal(date, verb));
}

/** The fronts the capture slots (Mon, Fri) serve in a date's week. */
function capturesInWeek(date: string): Set<string> {
  const monday = mondayOf(date);
  const served = new Set<string>();
  for (let i = 0; i < 7; i++) {
    const d = addDays(monday, i);
    if (WEEKDAY_CADENCE[weekdayOf(d)].verb !== 'tactical') continue;
    const id = ordinalPick(d, 'tactical')?.id;
    if (id) served.add(id);
  }
  return served;
}

/** The set-pieces every slot but Saturday serves in a date's week. */
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
 * A place-keeping cursor over a bucket, one entry per week, skipping whatever
 * that week's other slots already serve.
 *
 * Why not a plain ordinal walk: two walks over overlapping buckets run in
 * lockstep. With fourteen entries and a seven-entry tactical bucket, one front
 * landed on its Saturday only in weeks it had already been served, so it
 * never landed on a Saturday at all; the hold slot, which reads the same
 * fronts the other way, collided with the capture slots the same way.
 * Consuming the bucket in order and keeping the place means every entry is
 * served in turn, and no front comes round twice in one week.
 *
 * Pure in the date: the cursor replays from a fixed origin week and is
 * memoized per process.
 */
const CURSOR_ORIGIN_WEEK = weekIndexOf('2026-09-14');
const cursorMemo = new Map<string, Map<number, number>>();

function dateOfWeekday(week: number, weekday: number): string {
  // Week w starts on the Monday `w*7 - 3` days after the epoch.
  const offset = (weekday + 6) % 7; // Mon=0 … Sun=6
  return new Date((week * 7 - 3 + offset) * DAY_MS).toISOString().slice(0, 10);
}

function cursorPick(
  key: string,
  sorted: readonly DailySetPiece[],
  weekday: number,
  date: string,
  excludeFor: (weekDate: string) => Set<string>,
): DailySetPiece | null {
  if (sorted.length === 0) return null;
  const week = weekIndexOf(date);
  if (week < CURSOR_ORIGIN_WEEK) {
    return pickFromBucket(sorted, week, excludeFor(date));
  }
  let memo = cursorMemo.get(key);
  if (!memo) {
    memo = new Map();
    cursorMemo.set(key, memo);
  }
  let w = CURSOR_ORIGIN_WEEK;
  let cursor = 0;
  for (let k = week - 1; k >= CURSOR_ORIGIN_WEEK; k--) {
    const known = memo.get(k);
    if (known !== undefined) {
      w = k + 1;
      cursor = known + 1;
      break;
    }
  }
  for (; w <= week; w++) {
    const excluded = excludeFor(dateOfWeekday(w, weekday));
    for (let tries = 0; tries < sorted.length && excluded.has(sorted[cursor % sorted.length].id); tries++) {
      cursor++;
    }
    memo.set(w, cursor);
    if (w === week) return sorted[cursor % sorted.length];
    cursor++;
  }
  return null;
}

const sortedById = (xs: readonly DailySetPiece[]): DailySetPiece[] =>
  [...xs].sort((a, b) => a.id.localeCompare(b.id));

/**
 * Which set-piece a date's cadence slot would pick, before sizing. A pure
 * function of the date. Disjoint-bucket verbs walk by ordinal; the hold slot
 * and Saturday, whose buckets overlap the capture slots', use the cursor.
 */
export function pickSetPieceForDate(date: string): DailySetPiece | null {
  if (getAuthoredDailySpec(date)) return null;
  const slot = WEEKDAY_CADENCE[weekdayOf(date)];
  if (slot.verb === 'any') {
    return cursorPick('saturday', sortedById(saturdayLibrary()), 6, date, servedByVerbSlots);
  }
  if (slot.verb === 'hold') {
    return cursorPick('hold', sortedById(bucketForVerb('hold')), weekdayOf(date), date, capturesInWeek);
  }
  return ordinalPick(date, slot.verb);
}

// ── Seeds ────────────────────────────────────────────────────────────────────

function seedsFor(date: string, id: string, attempt = 0): { seed: number; dice_queue_seed: number } {
  // Attempt 0 is unsalted, so a day that passes the gate first time is the
  // same day it was before the gate existed.
  const key = attempt === 0 ? id : `${id}#${attempt}`;
  return {
    seed: hashStringToSeed(`daily:${date}:${key}`),
    dice_queue_seed: hashStringToSeed(`daily-dice:${date}:${key}`),
  };
}

// ── Materializing a set-piece ────────────────────────────────────────────────

async function materializeTactical(
  date: string,
  sp: TacticalSetPiece,
  band: TacticalBand,
  deps: ScheduleDeps,
  attempt = 0,
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
  const seeds = seedsFor(date, sp.id, attempt);
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

async function materializeHold(
  date: string,
  sp: TacticalSetPiece,
  deps: ScheduleDeps,
  attempt = 0,
  band: TacticalBand = HOLD_BAND,
): Promise<DailyPuzzleSpec | null> {
  if (!sp.hold) return null;
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
  const seeds = seedsFor(date, `${sp.id}:hold`, attempt);
  const calibrated = calibrateHold({
    anchor: sp.anchor,
    target: sp.target,
    reserve: sp.relief ?? null,
    extraAi: [sp.support, ...(sp.extra_ai ?? [])].filter((x): x is string => typeof x === 'string'),
    assaultIsSea: edge.type === 'sea',
    rng: createSeededRng((seeds.dice_queue_seed ^ 0x7ac71ca1) >>> 0),
    band,
  });
  if (!calibrated) return null;

  return {
    archetype: 'hold_territory',
    title: sp.hold.title,
    intro: sp.hold.intro,
    goal: `Hold ${territoryDisplayName(map, sp.target)} for ${calibrated.max_turns} turns.`,
    era_id: sp.era_id,
    map_id: sp.map_id,
    seed: seeds.seed,
    player_count: GENERATED_PLAYER_COUNT,
    max_turns: calibrated.max_turns,
    dice_queue_seed: seeds.dice_queue_seed,
    target_territory_id: sp.target,
    anchor_territory_id: sp.anchor,
    ...(sp.hold.hint ? { hint: sp.hold.hint } : {}),
    // Always medium. A set-piece's 'hard' describes the garrison the player
    // has to crack on a capture day; on a hold day the AI is the attacker, and
    // hard's eight exchanges a turn roll straight through the obvious defence
    // (the simulator put those days at 4–17% solvable).
    ai_difficulty: GENERATED_AI_DIFFICULTY,
    clear_board: true,
    // A normal draft open: the player reinforces before the AI moves. That
    // first draft is what the assault stack was sized against.
    starting_board: calibrated.board,
  };
}

async function materialize(
  date: string,
  sp: DailySetPiece,
  bands: SizingBands,
  deps: ScheduleDeps,
  verb: DailyVerb | 'any',
  attempt = 0,
): Promise<DailyPuzzleSpec | null> {
  const seeds = seedsFor(date, sp.id);
  if (verb === 'hold' && sp.kind === 'tactical') return materializeHold(date, sp, deps, attempt, bands.hold);
  switch (sp.kind) {
    case 'tactical':
      return materializeTactical(date, sp, bands.tactical, deps, attempt);
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

/** Test seam: forget memoized days and the cursors. */
export function resetDailyScheduleMemo(): void {
  memo.clear();
  cursorMemo.clear();
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

/**
 * Size a set-piece and prove it: re-roll until the obvious line's solve rate
 * lands in the verb's band, then attach par (capture days only — a hold day
 * is solved at the clock, so its turn count carries no information).
 */
async function gatedMaterialize(
  date: string,
  sp: DailySetPiece,
  band: TacticalBand,
  deps: ScheduleDeps,
  verb: DailyVerb | 'any',
): Promise<DailyPuzzleSpec | null> {
  const simulate = deps.simulate === undefined ? defaultDeps.simulate : deps.simulate;
  let closest: { spec: DailyPuzzleSpec; sim: PuzzleSimResult; distance: number } | null = null;
  // A directed search, not a blind re-roll: a miss moves the sizing band
  // toward it. First-assault odds are the attacker's, so "easier for the
  // player" is a higher band on a capture day and a lower one on a hold day.
  let shift = 0;
  for (let attempt = 0; attempt < GATE_ATTEMPTS; attempt++) {
    const bands: SizingBands = {
      tactical: shiftBand(band, shift),
      hold: shiftBand(HOLD_BAND, -shift),
    };
    const spec = await materialize(date, sp, bands, deps, verb, attempt);
    if (!spec) continue;
    if (!simulate || !SIMULATED_ARCHETYPES.has(spec.archetype)) return spec;
    const map = await deps.loadMap(spec.map_id);
    if (!map) return spec;
    const sim = await simulate(spec, map);
    if (!sim) return spec;
    const gateBand = GATE_BANDS[spec.archetype as keyof typeof GATE_BANDS];
    const distance = bandDistance(sim.solve_rate, gateBand);
    if (!closest || distance < closest.distance) closest = { spec, sim, distance };
    if (distance === 0) return withPar(spec, sim);
    // Too hard for the player: raise the player's odds next time; too easy: lower them.
    shift += sim.solve_rate < gateBand.min ? GATE_BAND_STEP : -GATE_BAND_STEP;
  }
  if (!closest) return null;
  console.warn(
    `[daily] ${date}: no sizing of "${sp.id}" landed in the solvability band after ${GATE_ATTEMPTS} attempts `
      + `(closest: ${(closest.sim.solve_rate * 100).toFixed(0)}% solvable) — serving the closest.`,
  );
  return withPar(closest.spec, closest.sim);
}

function withPar(spec: DailyPuzzleSpec, sim: PuzzleSimResult): DailyPuzzleSpec {
  if (spec.archetype !== 'military_capture' || sim.median_turns === null) return spec;
  return { ...spec, par_turns: sim.median_turns };
}

async function computeDay(date: string, deps: ScheduleDeps): Promise<ScheduledDay> {
  const authored = getAuthoredDailySpec(date);
  if (authored) return { date, source: 'calendar', spec: authored };

  const slot = WEEKDAY_CADENCE[weekdayOf(date)];
  const band = slot.band === 'hard' ? TACTICAL_BAND_HARD : TACTICAL_BAND_STANDARD;

  const picked = pickSetPieceForDate(date);
  if (picked) {
    const spec = await gatedMaterialize(date, picked, band, deps, slot.verb);
    if (spec) return { date, source: 'library', set_piece_id: picked.id, spec };
    console.warn(`[daily] ${date}: set-piece "${picked.id}" could not be sized — using the generator.`);
  }

  const verb: DailyVerb =
    slot.verb === 'any' || slot.verb === 'hold'
      ? 'tactical'
      : slot.verb === 'domination' ? (slot.fallback ?? 'tactical') : slot.verb;
  return { date, source: 'generator', spec: await generateFallback(date, verb, deps) };
}

/** One line for the startup log: what the library holds and how far the dated calendar reaches. */
export function describeDailySchedule(): string {
  const counts: Record<DailyVerb, number> = { tactical: 0, hold: 0, economy: 0, tech: 0, domination: 0 };
  for (const sp of DAILY_SET_PIECES) counts[sp.kind] += 1;
  counts.hold = holdCapableSetPieces().length;
  const dated = Object.keys(DAILY_CALENDAR).sort();
  const last = dated.length ? dated[dated.length - 1] : 'none';
  return (
    `[daily] library: ${DAILY_SET_PIECES.length} set-pieces `
    + `(${counts.tactical} tactical of which ${counts.hold} hold, ${counts.economy} economy, ${counts.tech} tech, ${counts.domination} domination); `
    + `dated calendar: ${dated.length} day(s), last ${last}`
  );
}
