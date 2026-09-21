/**
 * Daily Challenge v2: the day as a decision puzzle (docs/DAILY_PUZZLE_V2.md).
 *
 * Layered on the v1 schedule, not a replacement for it. The v1 schedule still
 * decides which set-piece a date gets and sizes its numbers from the date;
 * this file reads that day on a short clock against the set-piece's scripted
 * opponent, solves it exactly, and accepts it only when the solution has the
 * shape the brief asks for: winnable, the obvious line refuted, a key line
 * rather than a buffet, and the tier's number of real decisions along it.
 *
 * A day that fails the gate, whose set-piece carries no authored plan, or
 * whose weekday keeps its v1 form (Thursday, Sunday) is null here and is
 * served as v1. With the flag off nothing about the daily changes; with it on
 * the week migrates set-piece by set-piece. Tuesday is the one cadence change:
 * v1 serves a budget puzzle there, v2 a second capture (or chain) day, because
 * a budget puzzle has no dice and so no decision to grade.
 *
 * Everything is a pure function of the date plus the code, as in v1, so the
 * sweep test can prove every day of the horizon in advance. The only mutable
 * thing here is the memo: a v2 day costs seconds to solve and the read path
 * reconciles the stored row against the schedule on every request.
 */
import { getMapById } from '../../modules/maps/mapService';
import type { GameMap } from '../../types';
import { getAuthoredDailySpec } from '../../content/dailyCalendar';
import { planFor, plannedSetPieces, type SetPiecePlan } from '../../content/dailySetPiecePlans';
import type { DailySetPiece } from '../../content/dailySetPieces';
import type { DailyPuzzleSpec, DailyPuzzleV2, StoredPuzzleDecision } from './dailyPuzzleTypes';
import {
  GATE_ATTEMPTS,
  materialize,
  pickSetPieceForDate,
  shiftBand,
  verbForDate,
  weekdayOf,
  weekIndexOf,
  WEEKDAY_CADENCE,
  type DailyVerb,
  type ScheduleDeps,
  type ScheduledDay,
  type SizingBands,
} from './dailySchedule';
import { HOLD_BAND, TACTICAL_BAND_HARD, TACTICAL_BAND_STANDARD, territoryDisplayName } from './dailyGenerator';
import { coarseActionKey, serializeAction } from './puzzle/actions';
import { contextFromSpec, stateFromSpec } from './puzzle/bridge';
import { PHASE_ATTACK, PHASE_DRAFT, type PuzzleContext } from './puzzle/model';
import { obviousLine } from './puzzle/obvious';
import { compilePlan, describePlan } from './puzzle/opponent';
import { analyzePuzzle, BudgetExceeded, DECISION_GAP, type PuzzleAnalysis } from './puzzle/solver';

// ── Tiers ────────────────────────────────────────────────────────────────────

export interface V2Tier {
  /** Real decisions along the best line the day must carry. */
  decisions: number;
  /** The clock in human turns. Short on purpose: the search is exact. */
  clock: number;
  verdicts: DailyPuzzleV2['verdicts'];
  intent: DailyPuzzleV2['intent'];
}

const STANDARD_TIER: V2Tier = { decisions: 2, clock: 3, verdicts: 'before_dice', intent: 'arrows' };
/** Friday: three decisions, the plan in prose only, verdicts held until the end. */
const FRIDAY_TIER: V2Tier = { decisions: 3, clock: 4, verdicts: 'silent', intent: 'prose' };

/** The tier by UTC weekday (0 = Sunday); null keeps the day's v1 form. */
export const V2_TIERS: Readonly<Record<number, V2Tier | null>> = {
  1: STANDARD_TIER,
  2: STANDARD_TIER,
  3: STANDARD_TIER,
  4: null,
  5: FRIDAY_TIER,
  6: STANDARD_TIER,
  0: null,
};

export function tierForDate(date: string): V2Tier | null {
  return V2_TIERS[weekdayOf(date)] ?? null;
}

// ── The gate ─────────────────────────────────────────────────────────────────

export const V2_GATE = {
  /** Best-line equity floor: the day is winnable. */
  minEquity: 0.6,
  /**
   * The obvious line must trail the best by at least this: the natural move
   * is refuted. Fifteen points is the blunder grade (docs/DAILY_PUZZLE_V2.md
   * §4), so the day's lesson is that the natural move is a blunder. The brief
   * proposed twenty; measured on the library, hold days' pre-emptive strike is
   * worth 16–19 points, so twenty would have kept every Wednesday v1.
   */
  minGap: 0.15,
  /** Opening moves within nearBestWindow of the best, counting keep variants of one assault once. */
  maxNearBest: 2,
  nearBestWindow: 0.05,
  /** A human node is a decision when its alternative loses at least this. */
  decisionGap: DECISION_GAP,
  /** Positions one solve may visit before the attempt is abandoned. */
  nodeBudget: 600_000,
} as const;

/** How far each missed attempt moves the sizing band. Same step as the v1 gate. */
const BAND_STEP = 0.07;

export interface GateVerdict {
  ok: boolean;
  /** Why the attempt missed, for the log and the sweep. Empty when ok. */
  reasons: string[];
  /** Which way to move the sizing band for the next attempt (+ easier for the player). */
  shift: number;
}

/** Distinct opening moves within the window of the best, the best included. */
export function nearBestMoves(analysis: PuzzleAnalysis, window: number = V2_GATE.nearBestWindow): number {
  const top = analysis.rootActions[0]?.equity ?? 0;
  const keys = new Set<string>();
  for (const a of analysis.rootActions) {
    if (top - a.equity > window) break;
    keys.add(coarseActionKey(a.action));
  }
  return keys.size;
}

export function judgeAnalysis(analysis: PuzzleAnalysis, tier: V2Tier): GateVerdict {
  const reasons: string[] = [];
  const obvious = analysis.obviousEquity ?? analysis.equity;
  const gap = analysis.equity - obvious;
  const near = nearBestMoves(analysis);
  const decisions = analysis.decisions.length;
  if (analysis.equity < V2_GATE.minEquity) reasons.push(`equity ${pct(analysis.equity)} < ${pct(V2_GATE.minEquity)}`);
  if (gap < V2_GATE.minGap) reasons.push(`obvious line only ${pts(gap)} behind (needs ${pts(V2_GATE.minGap)})`);
  if (near > V2_GATE.maxNearBest) reasons.push(`${near} opening moves within ${pts(V2_GATE.nearBestWindow)} of the best`);
  if (decisions < tier.decisions || decisions > tier.decisions + 1) reasons.push(`${decisions} decision(s) on the best line (wants ${tier.decisions})`);
  if (reasons.length === 0) return { ok: true, reasons, shift: 0 };
  // Direction of the next re-roll. Unwinnable is the one miss that must move
  // the player's odds up; every other miss reads as a board that is too easy
  // for the natural line, or too loose to force a choice, so the odds go down.
  let shift = -BAND_STEP;
  if (analysis.equity < V2_GATE.minEquity) shift = BAND_STEP;
  else if (decisions > tier.decisions + 1) shift = BAND_STEP;
  return { ok: false, reasons, shift };
}

function pct(x: number): string {
  return `${(x * 100).toFixed(0)}%`;
}
function pts(x: number): string {
  return `${(x * 100).toFixed(0)} pts`;
}

// ── Which set-piece a date gets ──────────────────────────────────────────────

const DAY_MS = 86_400_000;
function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

/**
 * Tuesday's pick: a planned capture or chain, walked by week, avoiding what
 * the v1 cadence serves within six days either side so no front comes round
 * twice in a week. A pure function of the date.
 */
function tuesdayPick(date: string): DailySetPiece | null {
  const pool = [...plannedSetPieces('tactical'), ...plannedSetPieces('chain')].sort((a, b) => a.id.localeCompare(b.id));
  if (pool.length === 0) return null;
  const exclude = new Set<string>();
  for (let d = -6; d <= 6; d++) {
    if (d === 0) continue;
    const id = pickSetPieceForDate(addDays(date, d))?.id;
    if (id) exclude.add(id);
  }
  const ordinal = weekIndexOf(date);
  for (let i = 0; i < pool.length; i++) {
    const candidate = pool[(ordinal + i) % pool.length];
    if (!exclude.has(candidate.id)) return candidate;
  }
  return pool[ordinal % pool.length];
}

export interface V2Pick {
  set_piece: DailySetPiece;
  /** How the set-piece is read: 'hold' for Wednesday, else its own kind. */
  verb: DailyVerb;
  plan: SetPiecePlan;
  tier: V2Tier;
}

/**
 * What a date would be served as v2, before sizing: the set-piece, its
 * reading, its authored plan and the tier. Null when the day stays v1 — a
 * dated calendar entry, a weekday without a tier, a set-piece without a plan.
 */
export function pickSetPieceForDateV2(date: string): V2Pick | null {
  if (getAuthoredDailySpec(date)) return null;
  const tier = tierForDate(date);
  if (!tier) return null;
  const weekday = weekdayOf(date);
  let sp: DailySetPiece | null;
  let verb: DailyVerb;
  if (weekday === 2) {
    sp = tuesdayPick(date);
    if (!sp) return null;
    verb = sp.kind as DailyVerb;
  } else {
    sp = pickSetPieceForDate(date);
    if (!sp) return null;
    const slotVerb = verbForDate(date);
    verb = slotVerb === 'any' ? (sp.kind as DailyVerb) : slotVerb;
  }
  if (verb !== 'tactical' && verb !== 'hold' && verb !== 'region' && verb !== 'chain') return null;
  const plan = planFor(sp, verb === 'hold');
  if (!plan) return null;
  return { set_piece: sp, verb, plan, tier };
}

// ── Sizing and proving a day ─────────────────────────────────────────────────

const defaultDeps: ScheduleDeps = { loadMap: getMapById, simulate: null };

/**
 * The v2 reading of a hold day deals the human reserve this much stronger
 * than v1 does. v1's hold numbers are sized for the shipped bot, which attacks
 * when it likes its odds; the scripted siege attacks every turn at any odds,
 * and against it the v1 reserve left every hold day a coin flip under best
 * play. Three more on the reserve puts the days at 60–75% with the timing of
 * that reserve as one of the decisions.
 */
export const HOLD_RESERVE_BONUS = 3;

/**
 * The v1-sized spec on the tier's clock. A hold day's goal names the clock,
 * so it is rewritten, and its reserve is dealt the v2 bonus.
 */
function onClock(spec: DailyPuzzleSpec, clock: number, map: GameMap, sp: DailySetPiece): DailyPuzzleSpec {
  const out: DailyPuzzleSpec = { ...spec, max_turns: clock };
  delete out.par_turns;
  if (spec.archetype === 'hold_territory' && spec.target_territory_id) {
    out.goal = `Hold ${territoryDisplayName(map, spec.target_territory_id)} for ${clock} turns.`;
    if (sp.kind === 'tactical' && sp.relief && spec.starting_board?.[sp.relief]?.owner === 'human') {
      const reserve = spec.starting_board[sp.relief];
      out.starting_board = { ...spec.starting_board, [sp.relief]: { ...reserve, unit_count: reserve.unit_count + HOLD_RESERVE_BONUS } };
    }
  }
  return out;
}

function phaseName(phase: number): StoredPuzzleDecision['phase'] {
  return phase === PHASE_DRAFT ? 'draft' : phase === PHASE_ATTACK ? 'attack' : 'fortify';
}

const round4 = (x: number): number => Math.round(x * 10_000) / 10_000;

function storeSolution(ctx: PuzzleContext, a: PuzzleAnalysis): DailyPuzzleV2['solution'] {
  return {
    equity: round4(a.equity),
    obvious_equity: round4(a.obviousEquity ?? a.equity),
    near_best: nearBestMoves(a),
    decisions: a.decisions.map((d) => ({
      turn: d.turn,
      phase: phaseName(d.phase),
      best: serializeAction(ctx, d.best),
      best_equity: round4(d.bestEquity),
      alternative: d.alternative ? serializeAction(ctx, d.alternative) : null,
      alternative_equity: round4(d.alternativeEquity),
      gap: round4(d.gap),
    })),
    line: a.line.map((s) => ({ turn: s.turn, action: serializeAction(ctx, s.action), equity: round4(s.equity) })),
    nodes: a.nodes,
  };
}

export interface V2Attempt {
  attempt: number;
  verdict: GateVerdict | null;
  /** Set when the solve ran out of budget. */
  nodes?: number;
}

export interface V2Result {
  /** The accepted day, or null when no sizing landed and the day is served as v1. */
  proven: { spec: DailyPuzzleSpec; analysis: PuzzleAnalysis } | null;
  attempts: V2Attempt[];
}

/**
 * Size the pick's set-piece for the date on the tier's clock and prove it,
 * re-rolling toward the gate up to GATE_ATTEMPTS times.
 */
export async function proveV2Day(date: string, pick: V2Pick, deps: ScheduleDeps = defaultDeps): Promise<V2Result> {
  const { set_piece: sp, verb, plan, tier } = pick;
  const slot = WEEKDAY_CADENCE[weekdayOf(date)];
  const band = slot.band === 'hard' ? TACTICAL_BAND_HARD : TACTICAL_BAND_STANDARD;
  const attempts: V2Attempt[] = [];
  const map = await deps.loadMap(sp.kind === 'domination' ? sp.spec.map_id : sp.map_id);
  if (!map) return { proven: null, attempts };

  let shift = 0;
  for (let attempt = 0; attempt < GATE_ATTEMPTS; attempt++) {
    // A solve is CPU-bound for seconds; let the event loop breathe between attempts.
    if (attempt > 0) await new Promise<void>((resolve) => setImmediate(resolve));
    const bands: SizingBands = { tactical: shiftBand(band, shift), hold: shiftBand(HOLD_BAND, -shift) };
    const sized = await materialize(date, sp, bands, deps, verb, attempt);
    if (!sized) continue;
    const spec = onClock(sized, tier.clock, map, sp);
    const ctx = contextFromSpec(spec, map);
    const root = stateFromSpec(ctx, spec);
    let analysis: PuzzleAnalysis;
    try {
      analysis = analyzePuzzle({ ctx, plan: compilePlan(ctx, plan.plan) }, root, {
        policy: obviousLine,
        decisionGap: V2_GATE.decisionGap,
        nearBestWindow: V2_GATE.nearBestWindow,
        nodeBudget: V2_GATE.nodeBudget,
      });
    } catch (err) {
      if (!(err instanceof BudgetExceeded)) throw err;
      // Width, not difficulty, is what blows the budget, and a re-roll of the
      // numbers keeps the width: the board is v1's until it is narrowed or
      // the budget raised. Stop here rather than spend seven more solves.
      attempts.push({ attempt, verdict: null, nodes: err.nodes });
      break;
    }
    const verdict = judgeAnalysis(analysis, tier);
    attempts.push({ attempt, verdict });
    if (verdict.ok) {
      const name = (id: string) => territoryDisplayName(map, id);
      const solution = storeSolution(ctx, analysis);
      const lastTurn = analysis.line.length ? analysis.line[analysis.line.length - 1].turn : 1;
      const v2: DailyPuzzleV2 = {
        version: 2,
        theme: plan.theme,
        plan: plan.plan,
        plan_prose: describePlan(ctx, plan.plan, name),
        decisions_target: tier.decisions,
        verdicts: tier.verdicts,
        intent: tier.intent,
        solution,
      };
      const proven: DailyPuzzleSpec = {
        ...spec,
        // Par on a capture day is the best line's solve turn along its most
        // likely outcomes; a hold day is solved at the clock (v1 rule).
        ...(spec.archetype === 'hold_territory' ? {} : { par_turns: Math.max(1, lastTurn) }),
        v2,
      };
      return { proven: { spec: proven, analysis }, attempts };
    }
    shift += verdict.shift;
  }
  return { proven: null, attempts };
}

// ── The schedule ─────────────────────────────────────────────────────────────

const memo = new Map<string, ScheduledDay | null>();
const MEMO_LIMIT = 8;

function remember(date: string, day: ScheduledDay | null): ScheduledDay | null {
  memo.set(date, day);
  if (memo.size > MEMO_LIMIT) {
    const oldest = memo.keys().next().value;
    if (oldest !== undefined) memo.delete(oldest);
  }
  return day;
}

/**
 * The v2 day for a date, or null when the date is served as v1. Pure in the
 * date apart from map loading; memoized per process (nulls too) because the
 * read path asks on every request and a solve costs seconds.
 */
export async function scheduleDayV2(date: string, deps: ScheduleDeps = defaultDeps): Promise<ScheduledDay | null> {
  if (deps === defaultDeps && memo.has(date)) return memo.get(date) ?? null;
  const day = await computeDayV2(date, deps);
  return deps === defaultDeps ? remember(date, day) : day;
}

async function computeDayV2(date: string, deps: ScheduleDeps): Promise<ScheduledDay | null> {
  const pick = pickSetPieceForDateV2(date);
  if (!pick) return null;
  const { proven, attempts } = await proveV2Day(date, pick, deps);
  if (!proven) {
    console.warn(
      `[daily v2] ${date}: no sizing of "${pick.set_piece.id}" (${pick.verb}) carried ${pick.tier.decisions} decisions `
        + `through the gate in ${GATE_ATTEMPTS} attempts — serving the v1 day. `
        + describeAttempts(attempts).join(' | '),
    );
    return null;
  }
  return { date, source: 'library', set_piece_id: pick.set_piece.id, spec: proven.spec };
}

/** One line per attempt, for the CLI and the sweep's log. */
export function describeAttempts(attempts: V2Attempt[]): string[] {
  return attempts.map((a) => {
    if (!a.verdict) return `attempt ${a.attempt}: budget exceeded after ${a.nodes} nodes`;
    return `attempt ${a.attempt}: ${a.verdict.ok ? 'accepted' : a.verdict.reasons.join('; ')}`;
  });
}
