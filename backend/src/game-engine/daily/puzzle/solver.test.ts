/**
 * The exact solver on hand-built positions: values that can be checked by
 * reasoning, and the invariants a verdict engine must never break
 * (determinism, monotonicity, the obvious line never beating best play).
 */
import { describe, it, expect } from 'vitest';
import { captureChance } from './dice';
import { AI, HUMAN, PENDING, PHASE_DRAFT, beginHumanTurn, evaluateObjective, type PuzzleContext, type PuzzleState } from './model';
import { compilePlan, type OpponentPlan } from './opponent';
import { obviousLine } from './obvious';
import { Solver, analyzePuzzle } from './solver';

/** A tiny front: A (human) borders B (AI target); C (AI relief) borders B only. */
function frontContext(over: Partial<PuzzleContext> = {}): PuzzleContext {
  const ids = ['a', 'b', 'c'];
  return {
    ids,
    index: new Map(ids.map((id, i) => [id, i])),
    adj: [[1], [0, 2], [1]],
    seaEdges: new Set(),
    regions: [],
    doctrine: { legionReroll: false, rifleDoctrine: false },
    seaCap: 3,
    defenderBonus: [0, 0, 0],
    fortifyMoves: 1,
    maxAssaults: 3,
    objective: { kind: 'capture', targets: [1] },
    maxTurns: 2,
    playerCount: 2,
    startingPhase: 'attack',
    ...over,
  };
}

function state(ctx: PuzzleContext, owner: number[], units: number[]): PuzzleState {
  const s: PuzzleState = {
    owner: owner as PuzzleState['owner'],
    units,
    side: HUMAN,
    phase: PHASE_DRAFT,
    turn: 1,
    draftLeft: 0,
    fortifyLeft: ctx.fortifyMoves,
    assaults: 0,
    reachedTurn: -1,
    objectiveAttacked: false,
    aiTurns: 0,
    outcome: PENDING,
  };
  beginHumanTurn(ctx, s);
  evaluateObjective(ctx, s);
  return s;
}

const LAND = { attackerCap: 3, defenderBonus: 0, doctrine: { legionReroll: false, rifleDoctrine: false } };

describe('solver — capture with a passive opponent', () => {
  const ctx = frontContext({ maxTurns: 1 });
  const passive: OpponentPlan = { steps: [{ kind: 'draft', to: 'c' }] };
  const puzzle = { ctx, plan: compilePlan(ctx, passive) };

  it('one turn, all in, nobody counterattacks: equity is exactly the capture chance', () => {
    // 8 vs 4 with a 1-turn clock: capture it now and hold through a reply that
    // never comes. The best line is the all-in assault.
    const root = state(ctx, [HUMAN, AI, AI], [8, 4, 2]);
    const solver = new Solver(puzzle);
    expect(solver.value(root)).toBeCloseTo(captureChance(8, 4, LAND), 9);
  });

  it("is deterministic and monotone in the attacker's strength", () => {
    const values = [6, 8, 10, 12].map((n) => new Solver(puzzle).value(state(ctx, [HUMAN, AI, AI], [n, 4, 2])));
    for (let i = 1; i < values.length; i++) expect(values[i]).toBeGreaterThanOrEqual(values[i - 1]);
    const again = new Solver(puzzle).value(state(ctx, [HUMAN, AI, AI], [8, 4, 2]));
    expect(again).toBe(values[1]);
  });
});

describe('solver — the relief column makes the obvious line a gamble', () => {
  // C counterattacks B the turn the human takes it. A player who attacks all
  // in leaves a thin garrison; the better line keeps the stack for a second
  // turn or masses first.
  const ctx = frontContext({ maxTurns: 3 });
  const relief: OpponentPlan = {
    steps: [
      { kind: 'draft', to: 'c' },
      { kind: 'assault', from: 'c', to: 'b', keep: 1, when: 'objective_human' },
    ],
  };
  const puzzle = { ctx, plan: compilePlan(ctx, relief) };

  it('best play beats the obvious line, and the gate can see the gap', () => {
    const root = state(ctx, [HUMAN, AI, AI], [7, 3, 6]);
    const r = analyzePuzzle(puzzle, root, { policy: obviousLine });
    expect(r.equity).toBeGreaterThan(0);
    expect(r.equity).toBeLessThan(1);
    expect(r.obviousEquity).not.toBeNull();
    expect(r.obviousEquity!).toBeLessThanOrEqual(r.equity + 1e-9);
    expect(r.rootActions[0].equity).toBeCloseTo(r.equity, 9);
    expect(r.line.length).toBeGreaterThan(0);
  });

  it('grades an action against the best one', () => {
    const root = state(ctx, [HUMAN, AI, AI], [7, 3, 6]);
    const solver = new Solver(puzzle);
    const best = solver.actionValues(root)[0];
    const g = solver.grade(root, best.action);
    expect(g.loss).toBeCloseTo(0, 9);
    const worst = solver.actionValues(root).at(-1)!;
    const gw = solver.grade(root, worst.action);
    expect(gw.loss).toBeGreaterThanOrEqual(0);
    expect(gw.bestEquity).toBeCloseTo(solver.value(root), 9);
  });
});

describe('solver — hold', () => {
  const ctx = frontContext({
    objective: { kind: 'hold', targets: [1] },
    maxTurns: 1,
    startingPhase: 'draft',
  });
  const assault: OpponentPlan = { steps: [{ kind: 'draft', to: 'c' }, { kind: 'assault', from: 'c', to: 'b', keep: 1 }] };
  const puzzle = { ctx, plan: compilePlan(ctx, assault) };

  it('drafting onto the target and bringing the reserve in beats standing still', () => {
    // Human holds B with 4 and A with 5 behind it; C masses 9 (+3 draft).
    const root = state(ctx, [HUMAN, HUMAN, AI], [5, 4, 9]);
    const solver = new Solver(puzzle);
    const v = solver.value(root);
    // Standing still: C (12 after its draft) hits B (4).
    const standStill = 1 - captureChance(12, 4, LAND);
    expect(v).toBeGreaterThan(standStill);
    // Draft 3 onto B (7) and fortify A's 4 in (11): C's 12 vs 11.
    const massed = 1 - captureChance(12, 11, LAND);
    expect(v).toBeGreaterThanOrEqual(massed - 1e-9);
    expect(v).toBeLessThan(1);
  });
});
