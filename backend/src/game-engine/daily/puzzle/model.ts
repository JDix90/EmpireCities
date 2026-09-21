/**
 * The abstract puzzle model the solver searches.
 *
 * A daily is a handful of territories on an otherwise empty board, two seats,
 * and a clock. Searching the full GameState would drag the whole engine into
 * every node, so the solver works on this reduced shape and a bridge
 * (bridge.ts) maps a spec or a live game onto it. Every rule here mirrors a
 * specific engine rule, named in the comment beside it; puzzleDiceParity and
 * the sweep's parity test are what keep the two from drifting.
 *
 * Territories outside the set-piece are neutral and empty (clear_board), and
 * the engine refuses attacks on neutral tiles on a classic board, so the
 * in-play set is closed: nothing enters and nothing leaves.
 */
import { assaultRulesKey, type AssaultRules, type DiceDoctrine } from './dice';

export const NEUTRAL = 0;
export const HUMAN = 1;
export const AI = 2;
export type Owner = 0 | 1 | 2;

export const PHASE_DRAFT = 0;
export const PHASE_ATTACK = 1;
export const PHASE_FORTIFY = 2;
export type Phase = 0 | 1 | 2;

export const PENDING = 0;
export const SOLVED = 1;
export const FAILED = 2;
export type Outcome = 0 | 1 | 2;

export type ObjectiveKind = 'capture' | 'chain' | 'region' | 'hold';

export interface PuzzleRegion {
  id: string;
  members: number[];
  bonus: number;
}

/** Everything about a day that never changes while it is played. */
export interface PuzzleContext {
  /** In-play territory ids; every index in the model refers to this list. */
  ids: string[];
  index: Map<string, number>;
  /** Neighbours by index (both directions). */
  adj: number[][];
  /** Sea lanes as "lo-hi" index pairs. */
  seaEdges: Set<string>;
  /** Regions that lie entirely inside the in-play set (only these can ever pay a bonus). */
  regions: PuzzleRegion[];
  doctrine: DiceDoctrine;
  /** Attacker dice cap across a sea lane: 2 in the Discovery era (sea_lanes), 3 elsewhere. */
  seaCap: number;
  /** Flat defender dice bonus per territory (defense buildings); 0 on authored boards. */
  defenderBonus: number[];
  /** Fortify moves per turn: 1, or 2 under WW2's wartime_logistics. */
  fortifyMoves: number;
  /** Assaults the search lets the human launch in one turn (pruning, not a rule). */
  maxAssaults: number;
  objective: { kind: ObjectiveKind; targets: number[] };
  maxTurns: number;
  playerCount: number;
  /** 'attack': the first human turn opens mid-turn with no draft (authored tactical boards). */
  startingPhase: 'draft' | 'attack';
}

export interface PuzzleState {
  owner: Owner[];
  units: number[];
  side: 1 | 2;
  phase: Phase;
  turn: number;
  draftLeft: number;
  fortifyLeft: number;
  /** Assaults launched this human turn (pruning counter). */
  assaults: number;
  /** puzzle_objective_reached_turn: -1 when null. */
  reachedTurn: number;
  /** The human attacked an objective territory this round (a plan condition). */
  objectiveAttacked: boolean;
  /** AI turns completed so far (for `{ turn: n }` plan conditions, 1-based on the turn being played). */
  aiTurns: number;
  outcome: Outcome;
}

export function cloneState(s: PuzzleState): PuzzleState {
  return { ...s, owner: s.owner.slice(), units: s.units.slice() };
}

export function canonicalKey(s: PuzzleState): string {
  return `${s.side}${s.phase}|${s.turn}|${s.draftLeft}|${s.fortifyLeft}|${s.assaults}|${s.reachedTurn}|${s.objectiveAttacked ? 1 : 0}|${s.aiTurns}|${s.outcome}|${s.owner.join('')}|${s.units.join(',')}`;
}

export function territoriesOf(s: PuzzleState, who: Owner): number[] {
  const out: number[] = [];
  for (let i = 0; i < s.owner.length; i++) if (s.owner[i] === who) out.push(i);
  return out;
}

export function isSea(ctx: PuzzleContext, a: number, b: number): boolean {
  return ctx.seaEdges.has(a < b ? `${a}-${b}` : `${b}-${a}`);
}

/** The dice rules for one edge, mirroring computeLandCombatModifiers for a puzzle game. */
export function assaultRules(ctx: PuzzleContext, from: number, to: number): AssaultRules {
  return {
    attackerCap: isSea(ctx, from, to) ? ctx.seaCap : 3,
    defenderBonus: ctx.defenderBonus[to] ?? 0,
    doctrine: ctx.doctrine,
  };
}

export function rulesKey(ctx: PuzzleContext, from: number, to: number): string {
  return assaultRulesKey(assaultRules(ctx, from, to));
}

/**
 * combatResolver.calculateReinforcements: max(3, floor(territories / 3)) plus
 * floor(regionBonus × players / 6) for every region held in full. Tech,
 * faction and wonder bonuses are all off in a daily.
 */
export function reinforcements(ctx: PuzzleContext, s: PuzzleState, who: Owner): number {
  const owned = territoriesOf(s, who);
  if (owned.length === 0) return 0;
  let bonus = 0;
  for (const r of ctx.regions) {
    if (r.members.every((m) => s.owner[m] === who)) bonus += r.bonus;
  }
  const base = Math.max(3, Math.floor(owned.length / 3));
  const pc = Math.max(2, Math.min(ctx.playerCount, 12));
  return base + Math.floor((bonus * pc) / 6);
}

function conditionMet(ctx: PuzzleContext, s: PuzzleState): boolean {
  const { kind, targets } = ctx.objective;
  if (targets.length === 0) return false;
  if (kind === 'capture' || kind === 'hold') return s.owner[targets[0]] === HUMAN;
  return targets.every((t) => s.owner[t] === HUMAN);
}

/**
 * puzzleObjective.evaluatePuzzleObjective, on the model. Mutates `reachedTurn`
 * and `outcome` the way the engine mutates `puzzle_objective_reached_turn`.
 * Call after every human action and at every turn boundary, as the socket and
 * the simulator do.
 */
export function evaluateObjective(ctx: PuzzleContext, s: PuzzleState): void {
  if (s.outcome !== PENDING) return;
  if (territoriesOf(s, HUMAN).length === 0) {
    s.outcome = FAILED;
    return;
  }
  const met = conditionMet(ctx, s);
  if (ctx.objective.kind === 'hold') {
    if (!met) s.outcome = FAILED;
    return;
  }
  if (!met) {
    s.reachedTurn = -1;
    return;
  }
  if (s.reachedTurn < 0) s.reachedTurn = s.turn;
  if (s.turn > s.reachedTurn) s.outcome = SOLVED;
}

/** puzzleObjective.isPuzzleTimedOut + puzzleTimeoutOutcome, checked after a turn advance. */
export function applyTimeout(ctx: PuzzleContext, s: PuzzleState): void {
  if (s.outcome !== PENDING) return;
  if (s.turn > ctx.maxTurns) {
    s.outcome = ctx.objective.kind === 'hold' ? SOLVED : FAILED;
  }
}

/** Human-owned territories that border something not human-owned, or are objectives. */
export function frontline(ctx: PuzzleContext, s: PuzzleState): number[] {
  const out: number[] = [];
  for (let i = 0; i < s.owner.length; i++) {
    if (s.owner[i] !== HUMAN) continue;
    if (ctx.objective.targets.includes(i) || ctx.adj[i].some((n) => s.owner[n] !== HUMAN)) out.push(i);
  }
  return out;
}

/** Is there a path from `from` to `to` through territories owned by `who`? (gameSocket pathExists) */
export function connectedThrough(ctx: PuzzleContext, s: PuzzleState, who: Owner, from: number, to: number): boolean {
  if (from === to) return false;
  const seen = new Set<number>([from]);
  const stack = [from];
  while (stack.length) {
    const cur = stack.pop()!;
    for (const n of ctx.adj[cur]) {
      if (s.owner[n] !== who || seen.has(n)) continue;
      if (n === to) return true;
      seen.add(n);
      stack.push(n);
    }
  }
  return false;
}

/** Begin the human's turn: reinforcements, phase, counters (advanceToNextPlayer's start-of-turn work). */
export function beginHumanTurn(ctx: PuzzleContext, s: PuzzleState): void {
  s.side = HUMAN;
  s.assaults = 0;
  s.objectiveAttacked = false;
  s.fortifyLeft = ctx.fortifyMoves;
  if (s.turn === 1 && ctx.startingPhase === 'attack') {
    s.phase = PHASE_ATTACK;
    s.draftLeft = 0;
  } else {
    s.phase = PHASE_DRAFT;
    s.draftLeft = reinforcements(ctx, s, HUMAN);
  }
}

/**
 * Play returns to the human: the round counter advances, the timeout is
 * checked, and an achieve-and-hold objective that survived the reply is now
 * solved (evaluateObjective reads turn > reachedTurn).
 */
export function advanceToHuman(ctx: PuzzleContext, s: PuzzleState): void {
  s.turn += 1;
  evaluateObjective(ctx, s);
  applyTimeout(ctx, s);
  if (s.outcome === PENDING) beginHumanTurn(ctx, s);
}
