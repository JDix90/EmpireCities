/**
 * Exact expectimax over the puzzle model.
 *
 * value(s) is the human's win probability from s under best play against the
 * scripted opponent, with every assault expanded to its exact outcome
 * distribution. Positions are memoised on their canonical key, which is what
 * makes boards this small solvable outright: the paths are many, the distinct
 * positions are few. A node budget guards the wide days; exceeding it throws
 * BudgetExceeded, and the caller decides whether to sample instead (the brief:
 * exact where small, sampled where wide, honest about which).
 *
 * The same machinery evaluates a fixed policy (the obvious line, for the
 * gate's freebie test) and grades a single action (for the play-time verdict).
 */
import { actionKey, applyHumanAction, humanActions, type HumanAction, type Puzzle } from './actions';
import { HUMAN, PENDING, SOLVED, canonicalKey, type PuzzleContext, type PuzzleState } from './model';
import type { Branch } from './opponent';

export class BudgetExceeded extends Error {
  constructor(public readonly nodes: number) {
    super(`puzzle solver exceeded its node budget (${nodes})`);
  }
}

export interface ActionValue {
  action: HumanAction;
  equity: number;
}

export type Policy = (ctx: PuzzleContext, s: PuzzleState) => HumanAction;

/**
 * Roughly four seconds of search. The v2 clocks (par + 2 or 3) keep every
 * authored board far below this; a v1-sized nine-turn clock on five
 * territories does not fit and is not meant to.
 */
export const DEFAULT_NODE_BUDGET = 400_000;

export class Solver {
  private readonly memo = new Map<string, number>();
  private readonly policyMemo = new Map<string, number>();
  nodes = 0;

  constructor(readonly puzzle: Puzzle, readonly nodeBudget: number = DEFAULT_NODE_BUDGET) {}

  /** Human win probability from `s` under best play. */
  value(s: PuzzleState): number {
    if (s.outcome !== PENDING) return s.outcome === SOLVED ? 1 : 0;
    const key = canonicalKey(s);
    const hit = this.memo.get(key);
    if (hit !== undefined) return hit;
    if (++this.nodes > this.nodeBudget) throw new BudgetExceeded(this.nodes);

    let best = 0;
    for (const a of humanActions(this.puzzle.ctx, s)) {
      const v = this.expect(applyHumanAction(this.puzzle, s, a));
      if (v > best) best = v;
      if (best >= 1) break;
    }
    this.memo.set(key, best);
    return best;
  }

  /** Every legal (abstract) action from `s` with its equity, best first. */
  actionValues(s: PuzzleState): ActionValue[] {
    const out = humanActions(this.puzzle.ctx, s).map((action) => ({
      action,
      equity: this.expect(applyHumanAction(this.puzzle, s, action)),
    }));
    out.sort((a, b) => b.equity - a.equity || actionKey(a.action).localeCompare(actionKey(b.action)));
    return out;
  }

  /** Equity of `action` from `s`, and what the best action would have been worth. */
  grade(s: PuzzleState, action: HumanAction): { equity: number; bestEquity: number; loss: number } {
    const equity = this.expect(applyHumanAction(this.puzzle, s, action));
    const bestEquity = this.value(s);
    return { equity, bestEquity, loss: Math.max(0, bestEquity - equity) };
  }

  /** Win probability from `s` when the human follows `policy` throughout. */
  policyValue(s: PuzzleState, policy: Policy): number {
    if (s.outcome !== PENDING) return s.outcome === SOLVED ? 1 : 0;
    const key = canonicalKey(s);
    const hit = this.policyMemo.get(key);
    if (hit !== undefined) return hit;
    if (++this.nodes > this.nodeBudget) throw new BudgetExceeded(this.nodes);
    const action = policy(this.puzzle.ctx, s);
    let v = 0;
    for (const b of applyHumanAction(this.puzzle, s, action)) v += b.p * this.policyValue(b.state, policy);
    this.policyMemo.set(key, v);
    return v;
  }

  private expect(branches: Branch[]): number {
    let v = 0;
    for (const b of branches) v += b.p * this.value(b.state);
    return v;
  }
}

/**
 * A graded decision along the best line: a position where the natural move —
 * the obvious line's, or the runner-up when no policy is given — loses real
 * win probability against the best one. "Attack all in" versus "attack and
 * stop at three" is usually not a decision; "attack now" versus "cut the
 * relief road first" is.
 */
export interface DecisionRecord {
  turn: number;
  phase: PuzzleState['phase'];
  best: HumanAction;
  bestEquity: number;
  /** The obvious line's action here, when a policy was given and it differs from the best. */
  natural: HumanAction | null;
  naturalEquity: number;
  /** Points of win probability between the best and the natural move. */
  gap: number;
}

export interface LineStep {
  turn: number;
  action: HumanAction;
  /** Equity of the position the action leads to (expectation over its outcomes). */
  equity: number;
  /** Probability of the outcome the line followed, when the action had several. */
  followed?: number;
}

export interface PuzzleAnalysis {
  /** Best-play win probability from the opening position. */
  equity: number;
  /** Win probability of the obvious line (null when no policy was given). */
  obviousEquity: number | null;
  /** Every opening action, best first. */
  rootActions: ActionValue[];
  /** Opening actions within `nearBestWindow` of the best. */
  nearBest: number;
  decisions: DecisionRecord[];
  line: LineStep[];
  nodes: number;
}

export interface AnalyzeOptions {
  policy?: Policy;
  /** A human node is a decision when best − second ≥ this. Default 0.05. */
  decisionGap?: number;
  /** Opening actions within this of the best count as near-best. Default 0.05. */
  nearBestWindow?: number;
  nodeBudget?: number;
}

/**
 * Solve a day: its equity, the obvious line's, the decisions along the best
 * line and the line itself (following the most probable outcome at every
 * chance node). This is what the gate reads and what the archive stores.
 */
export function analyzePuzzle(puzzle: Puzzle, root: PuzzleState, opts: AnalyzeOptions = {}): PuzzleAnalysis {
  const solver = new Solver(puzzle, opts.nodeBudget);
  const decisionGap = opts.decisionGap ?? 0.05;
  const nearBestWindow = opts.nearBestWindow ?? 0.05;

  const equity = solver.value(root);
  const rootActions = solver.actionValues(root);
  const nearBest = rootActions.filter((a) => rootActions[0].equity - a.equity <= nearBestWindow).length;
  const obviousEquity = opts.policy ? solver.policyValue(root, opts.policy) : null;

  const decisions: DecisionRecord[] = [];
  const line: LineStep[] = [];
  let s = root;
  for (let guard = 0; guard < 80 && s.outcome === PENDING && s.side === HUMAN; guard++) {
    const values = solver.actionValues(s);
    if (values.length === 0) break;
    const best = values[0];
    // The natural move: what the obvious line would do here (its equity under
    // best play afterwards), or the runner-up when there is no policy.
    let natural: HumanAction | null = null;
    let naturalEquity = values[1]?.equity ?? best.equity;
    if (opts.policy) {
      const n = opts.policy(puzzle.ctx, s);
      if (actionKey(n) !== actionKey(best.action)) {
        natural = n;
        const found = values.find((v) => actionKey(v.action) === actionKey(n));
        naturalEquity = found ? found.equity : solver.grade(s, n).equity;
      } else {
        naturalEquity = best.equity;
      }
    }
    if (best.equity - naturalEquity >= decisionGap) {
      decisions.push({ turn: s.turn, phase: s.phase, best: best.action, bestEquity: best.equity, natural, naturalEquity, gap: best.equity - naturalEquity });
    }
    const branches = applyHumanAction(puzzle, s, best.action);
    const followed = branches.reduce((m, b) => (b.p > m.p ? b : m), branches[0]);
    line.push({ turn: s.turn, action: best.action, equity: best.equity, followed: branches.length > 1 ? followed.p : undefined });
    s = followed.state;
  }

  return { equity, obviousEquity, rootActions, nearBest, decisions, line, nodes: solver.nodes };
}
