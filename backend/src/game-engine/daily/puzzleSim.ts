/**
 * Headless daily-puzzle simulation: is this day solvable, and what is par?
 *
 * Builds the game exactly as the socket does — the route's settings,
 * initializeGameState, then applyDailyPuzzleScenario — and plays it out with
 * the pure engine. The AI seat runs the shipped production bot (grind, odds
 * targeting, decided-game press, the day's difficulty). The human seat plays
 * the OBVIOUS LINE for the verb: take the objectives one at a time from the
 * biggest adjacent stack, commit, then mass onto what was taken and wait out
 * the reply; or draft onto the target, fortify the reserve in, and never
 * attack. A player who finds a better line beats par; one who plays the
 * obvious line lands on it.
 *
 * Why not the bot in the human seat: the bot does not know the objective. It
 * would wander off to a juicier neighbour on a capture day, or strip the
 * target on a hold day, and its solve rate would measure the wrong thing.
 *
 * Dice are sampled per game from a seeded stream rather than taken from the
 * puzzle's fixed queue: a person's action order differs from the line's, so
 * the distribution is what matters, not one path through it. Everything is
 * seeded, so the same spec simulates identically on any process — the CI
 * sweep and the serving process agree on solve rate and par.
 *
 * Scope: the capture verbs (single, chain, region) and hold. Economy and
 * tech days keep the arithmetic check (dailyGenerator.sizeEarnable), which
 * is exact.
 */
import type { AiDifficulty, GameMap, GameSettings, GameState, MapConnection } from '../../types';
import type { DailyPuzzleSpec } from './dailyPuzzleTypes';
import { buildGameSettingsFromChallenge } from './dailySettings';
import { applyDailyPuzzleScenario } from './applyDailyPuzzleScenario';
import { evaluatePuzzleObjective, isPuzzleTimedOut, puzzleTimeoutOutcome, regionTerritoryIds } from './puzzleObjective';
import { advanceToNextPlayer, initializeGameState } from '../state/gameStateManager';
import { computeAiTurn, type AiAction } from '../ai/aiBot';
import { executeLandAttack } from '../combat/executeLandAttack';
import { aiAttackExchangeBudget, runAiAttackExchanges, shouldPressDecidedGame } from '../ai/aiAttackGrind';
import { createSeededRng, hashStringToSeed } from '../victory/missions';

export const SIMULATED_ARCHETYPES = new Set<DailyPuzzleSpec['archetype']>([
  'military_capture', 'hold_territory', 'control_region', 'capture_chain',
]);

export interface PuzzleSimOptions {
  /** Games to play. Default 24. */
  games?: number;
  /** Seed salt; the spec's own seeds are mixed in. */
  seed?: string;
}

export interface PuzzleSimResult {
  games: number;
  solved: number;
  /** Fraction of games the obvious line solved. */
  solve_rate: number;
  /** Turn number at which solved games ended: quartiles, null when none solved. */
  median_turns: number | null;
  p25_turns: number | null;
  p75_turns: number | null;
}

const HUMAN = 'sim_human';
const AI = 'ai_1';

function connectionBetween(map: GameMap, a: string, b: string): MapConnection | undefined {
  return map.connections.find(
    (c) => (c.from === a && c.to === b) || (c.from === b && c.to === a),
  );
}

function neighbours(map: GameMap, tid: string): string[] {
  const out: string[] = [];
  for (const c of map.connections) {
    if (c.from === tid) out.push(c.to);
    else if (c.to === tid) out.push(c.from);
  }
  return out;
}

function ownedBy(state: GameState, pid: string): string[] {
  return Object.keys(state.territories).filter((t) => state.territories[t].owner_id === pid).sort();
}

function placeDraft(state: GameState, tid: string): void {
  const n = state.draft_units_remaining ?? 0;
  if (n <= 0) return;
  state.territories[tid].unit_count += n;
  state.draft_units_remaining = 0;
}

function fortifyAll(state: GameState, pid: string, from: string, to: string): void {
  const f = state.territories[from];
  const t = state.territories[to];
  if (!f || !t || f.owner_id !== pid || t.owner_id !== pid) return;
  const move = f.unit_count - 1;
  if (move <= 0) return;
  f.unit_count -= move;
  t.unit_count += move;
}

/** Solved / failed / still going, read the way the socket resolver reads it. */
function resolution(state: GameState, map: GameMap, spec: DailyPuzzleSpec): 'solved' | 'failed' | null {
  const status = evaluatePuzzleObjective(state, map, spec, HUMAN);
  if (status === 'solved') return 'solved';
  if (status === 'failed') return 'failed';
  if (isPuzzleTimedOut(state, spec)) {
    return puzzleTimeoutOutcome(spec) === 'solve' ? 'solved' : 'failed';
  }
  return null;
}

// ── The human seat: the obvious line ─────────────────────────────────────────

/** The territories a capture-shaped verb has to take. */
function objectiveTargets(map: GameMap, spec: DailyPuzzleSpec): string[] {
  if (spec.archetype === 'capture_chain') return [...(spec.target_territory_ids ?? [])];
  if (spec.archetype === 'control_region') return spec.region_id ? regionTerritoryIds(map, spec.region_id) : [];
  return spec.target_territory_id ? [spec.target_territory_id] : [];
}

function captureLine(state: GameState, map: GameMap, spec: DailyPuzzleSpec, dieRoll: () => number): void {
  const targets = objectiveTargets(map, spec);
  const held = (t: string) => state.territories[t]?.owner_id === HUMAN;
  const mine = () => ownedBy(state, HUMAN);
  const biggestNeighbourOf = (t: string): string | null => {
    const stacks = mine().filter((h) => neighbours(map, h).includes(t));
    if (stacks.length === 0) return null;
    return stacks.reduce((best, h) =>
      state.territories[h].unit_count > state.territories[best].unit_count ? h : best,
    );
  };

  // The next objective: the first not yet held that we can reach.
  const next = targets.find((t) => !held(t) && biggestNeighbourOf(t) !== null);

  if (!next) {
    // Everything is taken (or unreachable): mass on the thinnest holding and
    // wait out the enemy's reply.
    const holdings = targets.filter(held);
    state.phase = 'draft';
    if (holdings.length > 0) {
      const thinnest = holdings.reduce((a, b) =>
        state.territories[b].unit_count < state.territories[a].unit_count ? b : a,
      );
      placeDraft(state, thinnest);
      state.phase = 'fortify';
      const feeder = mine().find((h) => !targets.includes(h) && neighbours(map, h).includes(thinnest));
      if (feeder) fortifyAll(state, HUMAN, feeder, thinnest);
    } else {
      state.draft_units_remaining = 0;
    }
    return;
  }

  const anchor = biggestNeighbourOf(next)!;
  state.phase = 'draft';
  placeDraft(state, anchor);

  // Commit: keep rolling from the anchor until the objective falls or the
  // stack cannot attack. The engine refuses an attack from a single unit.
  state.phase = 'attack';
  const connection = connectionBetween(map, anchor, next);
  for (let guard = 0; guard < 64; guard++) {
    if (held(next)) break;
    if (state.territories[anchor].unit_count <= 1) break;
    const outcome = executeLandAttack(state, HUMAN, anchor, next, { dieRoll, connection });
    if (!outcome) break;
    if (outcome.captured) break;
  }

  state.phase = 'fortify';
  if (held(next)) {
    // Win with enough left to hold it: bring the rest of the stack forward.
    fortifyAll(state, HUMAN, anchor, next);
  } else {
    // Mass before the next march: pull the reserve up behind the anchor.
    const reserve = mine().find((t) => t !== anchor && !targets.includes(t) && neighbours(map, t).includes(anchor));
    if (reserve) fortifyAll(state, HUMAN, reserve, anchor);
  }
}

function holdLine(state: GameState, map: GameMap, spec: DailyPuzzleSpec): void {
  const target = spec.target_territory_id!;
  if (state.territories[target].owner_id !== HUMAN) {
    state.draft_units_remaining = 0;
    return;
  }
  state.phase = 'draft';
  placeDraft(state, target);
  // Never attack; bring the reserve in.
  state.phase = 'fortify';
  const reserve = ownedBy(state, HUMAN).find(
    (t) => t !== target && neighbours(map, t).includes(target),
  );
  if (reserve) fortifyAll(state, HUMAN, reserve, target);
}

// ── The AI seat: the shipped bot ─────────────────────────────────────────────

async function aiTurn(
  state: GameState,
  map: GameMap,
  difficulty: AiDifficulty,
  dieRoll: () => number,
  rng: () => number,
): Promise<void> {
  // Same order as the socket: decidedness before planning, on the full state.
  const decidedPress = shouldPressDecidedGame(state, AI, difficulty);
  state.phase = 'draft';
  const plan: AiAction[] = computeAiTurn(state, map, difficulty, {
    captureOddsScoring: true,
    decidedGamePress: decidedPress,
    // The planner's heuristic jitter, seeded: the whole game is a function of the seed.
    rng,
  });
  const owned = ownedBy(state, AI);
  if (owned.length === 0) {
    state.draft_units_remaining = 0;
    return;
  }
  const planned = plan.find((a) => a.type === 'draft' && a.to && state.territories[a.to]?.owner_id === AI)?.to;
  placeDraft(state, planned ?? owned[0]);

  state.phase = 'attack';
  const budget = { left: aiAttackExchangeBudget(difficulty, decidedPress) };
  for (const a of plan) {
    if (a.type !== 'attack' || !a.from || !a.to || a.from === '__influence__') continue;
    const fromId = a.from;
    const toId = a.to;
    const connection = connectionBetween(map, fromId, toId);
    await runAiAttackExchanges({
      state,
      attackerId: AI,
      fromId,
      toId,
      budget,
      canGrind: connection?.type !== 'sea',
      exchange: () => (executeLandAttack(state, AI, fromId, toId, { dieRoll, connection }) ? 'ok' : 'stop'),
    });
    if (budget.left <= 0) break;
  }

  state.phase = 'fortify';
  for (const a of plan) {
    if (a.type !== 'fortify' || !a.from || !a.to) continue;
    const f = state.territories[a.from];
    const t = state.territories[a.to];
    if (!f || !t || f.owner_id !== AI || t.owner_id !== AI) continue;
    const move = Math.min(a.units ?? f.unit_count - 1, f.unit_count - 1);
    if (move <= 0) continue;
    f.unit_count -= move;
    t.unit_count += move;
  }
}

// ── One game ─────────────────────────────────────────────────────────────────

function buildState(spec: DailyPuzzleSpec, map: GameMap): GameState {
  const settings = buildGameSettingsFromChallenge({
    challenge_date: '2000-01-01',
    seed: spec.seed,
    player_count: spec.player_count,
    spec,
  }) as unknown as GameSettings;
  const difficulty = (spec.ai_difficulty ?? 'medium') as AiDifficulty;
  const players = [
    {
      player_id: HUMAN, player_index: 0, username: 'Sim', color: '#3498db',
      is_ai: false, is_eliminated: false, mmr: 1000,
    },
    {
      player_id: AI, player_index: 1, username: 'AI', color: '#e74c3c',
      is_ai: true, ai_difficulty: difficulty, is_eliminated: false, mmr: 1000,
    },
  ];
  const state = initializeGameState('daily_sim', spec.era_id, map, players, settings);
  applyDailyPuzzleScenario(state, map, spec, HUMAN, AI);
  return state;
}

async function playOne(spec: DailyPuzzleSpec, map: GameMap, seed: number): Promise<{ solved: boolean; turns: number }> {
  const rng = createSeededRng(seed);
  const dieRoll = () => Math.floor(rng() * 6) + 1;
  const state = buildState(spec, map);
  const difficulty = (spec.ai_difficulty ?? 'medium') as AiDifficulty;

  // A board can already be decided at the open (the review boards forbid it,
  // but the sim must not loop on it).
  let outcome = resolution(state, map, spec);
  let guard = 0;
  while (!outcome && guard < (spec.max_turns + 2) * 2 + 4) {
    guard += 1;
    const player = state.players[state.current_player_index];
    if (!player.is_eliminated) {
      if (player.player_id === HUMAN) {
        if (spec.archetype === 'hold_territory') holdLine(state, map, spec);
        else captureLine(state, map, spec, dieRoll);
      } else {
        await aiTurn(state, map, difficulty, dieRoll, rng);
      }
    }
    outcome = resolution(state, map, spec);
    if (outcome) break;
    advanceToNextPlayer(state, map);
    outcome = resolution(state, map, spec);
  }
  return { solved: outcome === 'solved', turns: state.turn_number };
}

function quantile(sorted: number[], q: number): number {
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

/**
 * Play the day `games` times. Returns null for verbs the sim does not cover.
 */
export async function simulatePuzzle(
  spec: DailyPuzzleSpec,
  map: GameMap,
  opts: PuzzleSimOptions = {},
): Promise<PuzzleSimResult | null> {
  if (!SIMULATED_ARCHETYPES.has(spec.archetype)) return null;
  const games = opts.games ?? 24;
  const salt = opts.seed ?? 'daily-sim';
  const solvedTurns: number[] = [];
  for (let i = 0; i < games; i++) {
    const seed = hashStringToSeed(`${salt}:${spec.seed}:${spec.dice_queue_seed}:${i}`);
    const r = await playOne(spec, map, seed);
    if (r.solved) solvedTurns.push(r.turns);
  }
  solvedTurns.sort((a, b) => a - b);
  const q = (p: number) => (solvedTurns.length ? Math.round(quantile(solvedTurns, p)) : null);
  return {
    games,
    solved: solvedTurns.length,
    solve_rate: solvedTurns.length / games,
    median_turns: q(0.5),
    p25_turns: q(0.25),
    p75_turns: q(0.75),
  };
}
