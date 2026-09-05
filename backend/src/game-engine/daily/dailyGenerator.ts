/**
 * The daily puzzle generator: pure sizing functions with no database access.
 *
 * Two callers: the schedule (dailySchedule.ts), which hands a set-piece's
 * territories to the sizers and gets a complete spec back, and the last-resort
 * generator path, which picks its own edge on the era map when the library has
 * nothing for a slot. Everything derives from a seeded PRNG, so every process
 * computes the identical day for a date, and the CI sweep can check any day
 * before it is served.
 *
 * Why the split exists: hand-authoring a day was mostly a manual search for the
 * numbers — garrison, stack, clock, grant — around a place someone had already
 * chosen. The search is what this file holds. The place, the title and the
 * reason it is hard live in the set-piece library, written once and reused.
 */
import { getEraTechTree } from '../eras';
import type { BuildingType, EraId, GameMap } from '../../types';
import type { DailyPuzzleArchetype, DailyPuzzleSpec } from './dailyPuzzleTypes';
import { captureProbability } from '../combat/combatOdds';
import { createSeededRng } from '../victory/missions';
import { DEFAULT_BUILDING_COSTS } from '../state/economyManager';

/** Human-readable territory label for puzzle copy (prefers map data, else softens ids). */
export function territoryDisplayName(map: GameMap | null, territoryId: string): string {
  const t = map?.territories?.find((x) => x.territory_id === territoryId);
  if (t?.name?.trim()) return t.name.trim();
  return territoryId.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Building label for economy goals, matching the authored calendar's wording. */
export function buildingDisplayName(building: BuildingType): string {
  const tier = (n: string) => `(tier ${n})`;
  const m = /^(production|defense|tech_gen)_(\d)$/.exec(building);
  if (m) {
    const family = m[1] === 'production' ? 'Production' : m[1] === 'defense' ? 'Defense' : 'Tech Generator';
    return `${family} ${tier(m[2])}`;
  }
  return building.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export const ERA_MAP_IDS: Record<string, string> = {
  ancient: 'era_ancient',
  medieval: 'era_medieval',
  discovery: 'era_discovery',
  ww2: 'era_ww2',
  coldwar: 'era_coldwar',
  modern: 'era_modern',
  acw: 'era_acw',
  risorgimento: 'era_risorgimento',
};

const ROTATING_ERAS: EraId[] = ['ancient', 'medieval', 'discovery', 'ww2', 'coldwar', 'modern', 'acw'];

/**
 * Archetypes the last-resort generator rotates through.
 *
 * `domination` is deliberately absent. A generated domination day was the
 * pre-calendar daily: four players, a 200-turn cap and no designed board — a
 * full match, not a daily challenge. The archetype exists for the *library*,
 * where a domination day is a tuned 1v1 with a stated reason to be hard.
 */
const ARCHETYPES: DailyPuzzleArchetype[] = [
  'military_capture',
  'economy_build',
  'tech_research',
];

/** Every generated day is a two-player puzzle on a tight clock. */
export const GENERATED_PLAYER_COUNT = 2;
export const GENERATED_MAX_TURNS = 18;
/**
 * Generated days match the library's difficulty rather than the route's
 * `?? 'medium'` backstop; a day that omitted the field once meant 'hard'.
 */
export const GENERATED_AI_DIFFICULTY = 'medium' as const;

function dateHash(today: string): number {
  return today
    .replace(/-/g, '')
    .split('')
    .reduce((acc: number, c: string) => acc + c.charCodeAt(0), 0);
}

/**
 * Pure numeric picks from a calendar date (deterministic across processes).
 * The last-resort path only: the schedule derives its own seeds from the date
 * and the set-piece id.
 */
export function buildDailyPuzzleBase(today: string): {
  era_id: EraId;
  map_id: string;
  seed: number;
  player_count: number;
  archetype: DailyPuzzleArchetype;
  dice_queue_seed: number;
  edge_pick: number;
  tech_pick: number;
} {
  const h = dateHash(today);
  const era_id = ROTATING_ERAS[h % ROTATING_ERAS.length];
  const map_id = ERA_MAP_IDS[era_id] ?? 'era_ancient';
  const seed = h * 31337;
  const archetype = ARCHETYPES[h % ARCHETYPES.length];
  const player_count = GENERATED_PLAYER_COUNT;
  const dice_queue_seed = (h * 7919 + 1337) >>> 0;
  const edge_pick = h % 997;
  const tech_pick = (h >> 3) % 97;
  return {
    era_id,
    map_id,
    seed,
    player_count,
    archetype,
    dice_queue_seed,
    edge_pick,
    tech_pick,
  };
}

function pickFirstRootTech(era: EraId, pick: number): { tech_id: string; name: string } | null {
  const tree = getEraTechTree(era);
  const roots = tree.filter((n) => !n.prerequisite);
  if (roots.length === 0) return null;
  const node = roots[pick % roots.length];
  return { tech_id: node.tech_id, name: node.name };
}

// ── Tactical calibration ─────────────────────────────────────────────────────
//
// The authored calendar showed what a good tactical day looks like: a small
// designed front (main force + support vs garrison + relief), first-assault
// capture odds in a winnable-but-not-free band, an attack-phase open and a
// tight clock. The calibration builds exactly that shape around whatever
// anchor and target it is given, using the same odds engine the CI review
// board checks days with.

/** The standard band: winnable but never free (mirrors dailyCalendar.test.ts). */
export const TACTICAL_BAND_STANDARD = { min: 0.7, max: 0.86 } as const;
/** The Friday band: the same shape, a harder fight. */
export const TACTICAL_BAND_HARD = { min: 0.55, max: 0.7 } as const;

export interface TacticalBand {
  min: number;
  max: number;
}

const TACTICAL_TITLES = [
  'Daily Tactical — Breakthrough',
  'Daily Tactical — The Salient',
  'Daily Tactical — Forced March',
  'Daily Tactical — The Garrison',
  'Daily Tactical — High Water Mark',
];
const TACTICAL_INTROS = [
  'One front, one objective. The garrison is dug in and relief is a border away.',
  'Your main force is assembled; the enemy knows where. Take the objective before the relief column matters.',
  'The line bends here or it does not bend at all. Commit where the odds are yours.',
  'Scouts report the objective reinforced overnight. The clock, not the garrison, is the second enemy.',
  'A narrow front rewards patience: grind the defense down, then take the ground with enough left to hold it.',
];
const TACTICAL_HINTS = [
  'Favor favorable exchanges and consolidate before committing to the final push.',
  'A split assault gives the defender two cheap rounds — mass before you march.',
  'Win the fight with enough left to hold the prize; the relief force attacks back.',
  'Near-even fights favor the defender. Thin the garrison before the killing blow.',
];

export interface TacticalCalibrationInput {
  anchor: string;
  target: string;
  /** Human reserve behind the anchor. Omitted: none. */
  support?: string | null;
  /** AI relief garrison beside the target. Omitted: none. */
  relief?: string | null;
  /** Other AI holdings that neither reinforce nor border the fight. */
  extraAi?: readonly string[];
  /** A sea crossing rolls capped dice, so the stack is sized up on its own. */
  assaultIsSea: boolean;
  rng: () => number;
  band: TacticalBand;
  maxTurnsBase: number;
}

export interface TacticalCalibration {
  board: NonNullable<DailyPuzzleSpec['starting_board']>;
  max_turns: number;
  /** First-assault capture probability the search landed on. */
  p: number;
}

/**
 * Size a tactical front: pick the garrison and a target win probability, then
 * search the smallest attacking stack whose first-assault capture odds reach
 * it. Returns null when no stack in range lands inside the band.
 */
export function calibrateTactical(input: TacticalCalibrationInput): TacticalCalibration | null {
  const { rng, band } = input;
  const int = (lo: number, hi: number): number => lo + Math.floor(rng() * (hi - lo + 1));

  const garrison = int(5, 8);
  const targetP = band.min + rng() * (band.max - band.min);
  const attackerBaseCap = input.assaultIsSea ? 2 : 3;
  let attackers = garrison + 1;
  let p = 0;
  for (; attackers <= garrison + 14; attackers++) {
    p = captureProbability(attackers, garrison, { attackerBaseCap });
    if (p >= targetP) break;
  }
  if (p < band.min || p > 0.97) return null;

  const board: NonNullable<DailyPuzzleSpec['starting_board']> = {
    [input.anchor]: { owner: 'human', unit_count: attackers },
    [input.target]: { owner: 'ai', unit_count: garrison },
  };
  // The supporting cast: the reserve behind the anchor and the relief beside
  // the target — the counterplay that makes "hold it" real. Sized in a fixed
  // order so the draw is stable whether or not each one is present.
  const supportUnits = int(3, 5);
  const reliefUnits = int(3, 6);
  if (input.support && !board[input.support]) {
    board[input.support] = { owner: 'human', unit_count: supportUnits };
  }
  if (input.relief && !board[input.relief]) {
    board[input.relief] = { owner: 'ai', unit_count: reliefUnits };
  }
  for (const tid of input.extraAi ?? []) {
    if (!board[tid]) board[tid] = { owner: 'ai', unit_count: int(3, 6) };
  }

  return {
    board,
    // Tight, honest clock in the authored range; a sea crossing gets slack
    // for its capped dice. maxTurnsBase is kept as a ceiling.
    max_turns: Math.min(input.maxTurnsBase, (input.assaultIsSea ? 10 : 8) + int(0, 1)),
    p,
  };
}

/** The connection between two territories, if any. */
export function findConnection(
  map: GameMap,
  a: string,
  b: string,
): { from: string; to: string; type: string } | undefined {
  return map.connections.find(
    (c) => (c.from === a && c.to === b) || (c.from === b && c.to === a),
  ) as { from: string; to: string; type: string } | undefined;
}

function neighborsOf(map: GameMap, tid: string): Array<{ id: string; type: string }> {
  const out: Array<{ id: string; type: string }> = [];
  for (const c of map.connections) {
    if (c.from === tid) out.push({ id: c.to, type: c.type });
    else if (c.to === tid) out.push({ id: c.from, type: c.type });
  }
  return out.sort((x, y) => x.id.localeCompare(y.id));
}

/**
 * The last-resort tactical day: pick an edge on the era map by date hash and
 * calibrate a front around it. Returns null when the map has no usable edge —
 * the caller falls back to the economy day.
 */
export function buildCalibratedMilitarySpec(
  b: ReturnType<typeof buildDailyPuzzleBase>,
  map: GameMap,
  maxTurnsBase: number,
): DailyPuzzleSpec | null {
  if (!map.connections || map.connections.length === 0) return null;

  // Stable edge order, then hash-picked — the same target for a given date
  // regardless of connection order in the map document.
  const sorted = [...map.connections].sort((a, c) => {
    const k1 = `${a.from}\0${a.to}`;
    const k2 = `${c.from}\0${c.to}`;
    return k1.localeCompare(k2);
  });
  const edge = sorted[b.edge_pick % sorted.length];
  const anchorId = edge.from;
  const targetId = edge.to;

  const rng = createSeededRng((b.dice_queue_seed ^ 0x7ac71ca1) >>> 0);
  const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(rng() * xs.length)];

  const support = neighborsOf(map, anchorId).find((n) => n.id !== targetId)?.id ?? null;
  const relief = neighborsOf(map, targetId).find((n) => n.id !== anchorId && n.id !== support)?.id ?? null;

  const calibrated = calibrateTactical({
    anchor: anchorId,
    target: targetId,
    support,
    relief,
    assaultIsSea: edge.type === 'sea',
    rng,
    band: TACTICAL_BAND_STANDARD,
    maxTurnsBase,
  });
  if (!calibrated) return null;

  const targetLabel = territoryDisplayName(map, targetId);
  return {
    archetype: 'military_capture',
    title: pick(TACTICAL_TITLES),
    intro: pick(TACTICAL_INTROS),
    goal: `Capture ${targetLabel} before time runs out.`,
    era_id: b.era_id,
    map_id: b.map_id,
    seed: b.seed,
    player_count: b.player_count,
    max_turns: calibrated.max_turns,
    dice_queue_seed: b.dice_queue_seed,
    target_territory_id: targetId,
    anchor_territory_id: anchorId,
    hint: pick(TACTICAL_HINTS),
    ai_difficulty: GENERATED_AI_DIFFICULTY,
    clear_board: true,
    starting_phase: 'attack',
    starting_board: calibrated.board,
  };
}

// ── Economy / tech sizing ────────────────────────────────────────────────────
//
// For these two archetypes the goal IS the win condition, so a grant that
// covers the cost makes the day complete before the player touches the board.
// The sizer leaves a shortfall the player earns by holding ground, and sets a
// clock long enough to earn it: the review board's band, inverted into numbers.
// Income keys off owned territories (economyManager: 1 gold per 3 owned,
// 1 tech point per 5, both floored at 1) and lands on each turn after the first.

/** Turns of income the player has to hold ground for before the goal is affordable. */
const EARN_TURNS = 2;
/** Slack on top of the turns needed to earn the shortfall. */
const CLOCK_SLACK = 3;

export const goldPerTurn = (territories: number): number => Math.max(1, Math.floor(territories / 3));
export const techPerTurn = (territories: number): number => Math.max(1, Math.floor(territories / 5));

export interface HoldingsInput {
  human: readonly string[];
  ai: readonly string[];
  rng: () => number;
}

/** Deal the set-piece's territories: modest human stacks, a heavier AI presence. */
export function dealHoldings(input: HoldingsInput): NonNullable<DailyPuzzleSpec['starting_board']> {
  const int = (lo: number, hi: number): number => lo + Math.floor(input.rng() * (hi - lo + 1));
  const board: NonNullable<DailyPuzzleSpec['starting_board']> = {};
  for (const tid of input.human) board[tid] = { owner: 'human', unit_count: int(4, 6) };
  for (const tid of input.ai) if (!board[tid]) board[tid] = { owner: 'ai', unit_count: int(6, 8) };
  return board;
}

export interface EarnableSizing {
  grant: number;
  max_turns: number;
}

/** Grant and clock for a goal of `cost` at `perTurn` income: a shortfall, and time to earn it. */
export function sizeEarnable(cost: number, perTurn: number): EarnableSizing {
  const grant = Math.max(0, cost - EARN_TURNS * perTurn);
  const shortfall = cost - grant;
  return { grant, max_turns: Math.ceil(shortfall / perTurn) + CLOCK_SLACK };
}

export interface EconomyDayInput {
  era_id: EraId;
  map_id: string;
  title: string;
  intro: string;
  hint?: string;
  human: readonly string[];
  ai: readonly string[];
  building_type: BuildingType;
  seed: number;
  dice_queue_seed: number;
  ai_difficulty?: DailyPuzzleSpec['ai_difficulty'];
}

export function buildEconomyDay(input: EconomyDayInput): DailyPuzzleSpec {
  const rng = createSeededRng((input.dice_queue_seed ^ 0x7ac71ca1) >>> 0);
  const cost = DEFAULT_BUILDING_COSTS[input.building_type];
  const sizing = sizeEarnable(cost, goldPerTurn(input.human.length));
  return {
    archetype: 'economy_build',
    title: input.title,
    intro: input.intro,
    goal: `Construct a ${buildingDisplayName(input.building_type)} building in any territory you control.`,
    era_id: input.era_id,
    map_id: input.map_id,
    seed: input.seed,
    player_count: GENERATED_PLAYER_COUNT,
    max_turns: sizing.max_turns,
    dice_queue_seed: input.dice_queue_seed,
    building_type: input.building_type,
    ...(input.hint ? { hint: input.hint } : {}),
    ai_difficulty: input.ai_difficulty ?? GENERATED_AI_DIFFICULTY,
    clear_board: true,
    starting_board: dealHoldings({ human: input.human, ai: input.ai, rng }),
    grants: { gold: sizing.grant },
  };
}

export interface TechDayInput {
  era_id: EraId;
  map_id: string;
  title: string;
  intro: string;
  hint?: string;
  human: readonly string[];
  ai: readonly string[];
  tech_id: string;
  seed: number;
  dice_queue_seed: number;
  ai_difficulty?: DailyPuzzleSpec['ai_difficulty'];
}

/** Returns null when the tech is not in the era's tree — a library error the review board catches first. */
export function buildTechDay(input: TechDayInput): DailyPuzzleSpec | null {
  const node = getEraTechTree(input.era_id).find((n) => n.tech_id === input.tech_id);
  if (!node) return null;
  const rng = createSeededRng((input.dice_queue_seed ^ 0x7ac71ca1) >>> 0);
  const sizing = sizeEarnable(node.cost, techPerTurn(input.human.length));
  return {
    archetype: 'tech_research',
    title: input.title,
    intro: input.intro,
    goal: `Research “${node.name}”.`,
    era_id: input.era_id,
    map_id: input.map_id,
    seed: input.seed,
    player_count: GENERATED_PLAYER_COUNT,
    max_turns: sizing.max_turns,
    dice_queue_seed: input.dice_queue_seed,
    tech_id: input.tech_id,
    ...(input.hint ? { hint: input.hint } : {}),
    ai_difficulty: input.ai_difficulty ?? GENERATED_AI_DIFFICULTY,
    clear_board: true,
    starting_board: dealHoldings({ human: input.human, ai: input.ai, rng }),
    grants: { tech_points: sizing.grant },
    // The bootstrap is pinned off so the grant really is the opening budget;
    // the rest comes from holding ground.
    settings_overrides: { economy_tech_starting_tech_points: 0 },
  };
}

// ── Last-resort days ─────────────────────────────────────────────────────────

/**
 * The always-valid day, and the fallback when a richer one cannot be built:
 * raise one production building on a dealt board. It needs no map graph and
 * no tech tree, so it can never itself fail.
 */
export function economySpecFromBase(b: ReturnType<typeof buildDailyPuzzleBase>): DailyPuzzleSpec {
  return {
    archetype: 'economy_build',
    title: 'Daily Economy — Foundations',
    intro: 'Industry wins wars. Accumulate production and raise a core facility.',
    goal: 'Construct a Production (tier 1) building in any territory you control.',
    era_id: b.era_id,
    map_id: b.map_id,
    seed: b.seed,
    player_count: GENERATED_PLAYER_COUNT,
    max_turns: GENERATED_MAX_TURNS,
    dice_queue_seed: b.dice_queue_seed,
    building_type: 'production_1',
    ai_difficulty: GENERATED_AI_DIFFICULTY,
  };
}

/** The last-resort tech day: a root node of the era's tree on a dealt board. */
export function techSpecFromBase(b: ReturnType<typeof buildDailyPuzzleBase>): DailyPuzzleSpec | null {
  const tech = pickFirstRootTech(b.era_id, b.tech_pick);
  if (!tech) return null;
  return {
    archetype: 'tech_research',
    title: 'Daily Research — First Principles',
    intro: 'Your advisors await a breakthrough. Invest tech points into a foundational advance.',
    goal: `Research “${tech.name}”.`,
    era_id: b.era_id,
    map_id: b.map_id,
    seed: b.seed,
    player_count: GENERATED_PLAYER_COUNT,
    max_turns: GENERATED_MAX_TURNS,
    dice_queue_seed: b.dice_queue_seed,
    tech_id: tech.tech_id,
    ai_difficulty: GENERATED_AI_DIFFICULTY,
  };
}
