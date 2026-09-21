import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import type { GameMap, GameState } from '../../types';
import type { DailyPuzzleSpec, PuzzleDecisionRecord } from './dailyPuzzleTypes';
import { pickSetPieceForDateV2, proveV2Day } from './dailyScheduleV2';
import { toPublicDailyPuzzleV2 } from './dailyPuzzlePublic';
import {
  beginPuzzleHumanTurn,
  commitPuzzleAttack,
  commitPuzzleDraft,
  commitPuzzleEndAttack,
  commitPuzzleEndTurn,
  commitPuzzleFortify,
  getWarmedPuzzle,
  gradeLoss,
  notePuzzleDraftOpen,
  proposePuzzleAction,
  resetWarmedPuzzlesForTests,
  sanitizeProposal,
  summarizePuzzleRun,
  warmPuzzle,
  type WarmedPuzzle,
} from './puzzlePlay';
import { stateFromGame, stateFromSpec } from './puzzle/bridge';
import { classifyPosition } from './puzzle/solver';
import { obviousLine } from './puzzle/obvious';
import { coarseActionKey, serializeAction, describeAction } from './puzzle/actions';
import { HUMAN, PENDING } from './puzzle/model';

/**
 * Play-time grading against real proven days. The days come from the v2
 * schedule itself (the first accepted capture day whose opening is a
 * decision, and the first accepted hold day), so these tests hold for
 * whatever the library serves rather than for one pinned board.
 */

const mapCache = new Map<string, GameMap>();
async function loadMap(mapId: string): Promise<GameMap | null> {
  const cached = mapCache.get(mapId);
  if (cached) return cached;
  const doc = JSON.parse(readFileSync(join(__dirname, `../../../../database/maps/${mapId}.json`), 'utf-8')) as GameMap;
  mapCache.set(mapId, doc);
  return doc;
}
const deps = { loadMap, simulate: null };

const H = 'human-1';
const A = 'ai-1';

/** A live game at the spec's opening, the way applyDailyPuzzleScenario deals it. */
function gameFromSpec(spec: DailyPuzzleSpec, draftUnits: number): GameState {
  const territories: Record<string, { owner_id: string | null; unit_count: number }> = {};
  for (const [id, t] of Object.entries(spec.starting_board!)) {
    territories[id] = { owner_id: t.owner === 'human' ? H : t.owner === 'ai' ? A : null, unit_count: t.unit_count };
  }
  const attackOpen = spec.starting_phase === 'attack';
  return {
    phase: attackOpen ? 'attack' : 'draft',
    turn_number: 1,
    current_player_index: 0,
    draft_units_remaining: attackOpen ? 0 : draftUnits,
    fortify_moves_used: 0,
    players: [
      { player_id: H, is_ai: false, is_eliminated: false, territory_count: 0 },
      { player_id: A, is_ai: true, is_eliminated: false, territory_count: 0 },
    ],
    territories,
    settings: { daily_challenge_spec: spec },
  } as unknown as GameState;
}

function* datesFrom(start: string, days: number): Generator<string> {
  const d = new Date(`${start}T00:00:00Z`);
  for (let i = 0; i < days; i++) {
    yield d.toISOString().slice(0, 10);
    d.setUTCDate(d.getUTCDate() + 1);
  }
}

interface Day { date: string; spec: DailyPuzzleSpec; map: GameMap; puzzle: WarmedPuzzle }

let captureDay: Day | null = null;
let holdDay: Day | null = null;

beforeAll(async () => {
  resetWarmedPuzzlesForTests();
  for (const date of datesFrom('2026-09-21', 21)) {
    if (captureDay && holdDay) break;
    const pick = pickSetPieceForDateV2(date);
    if (!pick) continue;
    if (pick.verb === 'hold' ? holdDay : captureDay) continue;
    const { proven } = await proveV2Day(date, pick, deps);
    if (!proven) continue;
    const map = (await loadMap(proven.spec.map_id))!;
    const puzzle = getWarmedPuzzle(proven.spec, map)!;
    const day: Day = { date, spec: proven.spec, map, puzzle };
    if (pick.verb === 'hold') {
      holdDay = day;
    } else if (proven.spec.starting_phase === 'attack' && pick.tier.verdicts === 'before_dice') {
      // The opening must itself be a decision for the takeback tests, and the
      // day must answer proposals (Friday is silent).
      const s0 = stateFromSpec(puzzle.ctx, proven.spec);
      if (classifyPosition(puzzle.solver, s0, obviousLine)?.decision) captureDay = day;
    }
  }
}, 600_000);

describe('puzzlePlay — pure pieces', () => {
  it('grades loss in points by the brief\'s bands', () => {
    expect(gradeLoss(0)).toBe('best');
    expect(gradeLoss(1.99)).toBe('best');
    expect(gradeLoss(2)).toBe('good');
    expect(gradeLoss(4.99)).toBe('good');
    expect(gradeLoss(5)).toBe('inaccuracy');
    expect(gradeLoss(14.99)).toBe('inaccuracy');
    expect(gradeLoss(15)).toBe('blunder');
    expect(gradeLoss(100)).toBe('blunder');
  });

  it('accepts only well-formed proposals from the wire', () => {
    expect(sanitizeProposal({ kind: 'attack', from: 'a', to: 'b' })).toEqual({ kind: 'attack', from: 'a', to: 'b' });
    expect(sanitizeProposal({ kind: 'draft', to: 'a' })).toEqual({ kind: 'draft', to: 'a' });
    expect(sanitizeProposal({ kind: 'draft', to: 'a', split: 'b' })).toEqual({ kind: 'draft', to: 'a', split: 'b' });
    expect(sanitizeProposal({ kind: 'fortify', from: 'a', to: 'b', units: 3 })).toEqual({ kind: 'fortify', from: 'a', to: 'b', units: 3 });
    expect(sanitizeProposal({ kind: 'end_attack' })).toEqual({ kind: 'end_attack' });
    expect(sanitizeProposal({ kind: 'end_turn' })).toEqual({ kind: 'end_turn' });
    expect(sanitizeProposal(null)).toBeNull();
    expect(sanitizeProposal({ kind: 'charge' })).toBeNull();
    expect(sanitizeProposal({ kind: 'attack', from: 'a' })).toBeNull();
    expect(sanitizeProposal({ kind: 'fortify', from: 'a', to: 'b', units: 1.5 })).toBeNull();
    expect(sanitizeProposal({ kind: 'fortify', from: 'a', to: 'b', units: 0 })).toBeNull();
    expect(sanitizeProposal({ kind: 'draft', to: 42 })).toBeNull();
  });

  it('summarizes a run by the brief\'s rules', () => {
    const rec = (loss: number, takebacks = 0): PuzzleDecisionRecord => ({
      key: `k${loss}`, turn: 1, phase: 'attack', best: { kind: 'end_attack' }, best_equity: 0.7,
      first: { kind: 'end_attack' }, first_equity: 0.7 - loss / 100, loss, grade: gradeLoss(loss), takebacks,
    });
    const state = (decisions: PuzzleDecisionRecord[], takebacks = 0) =>
      ({ puzzle_decisions: decisions, puzzle_takebacks: takebacks } as unknown as GameState);

    // A perfect run: every decision best on the first attempt.
    let s = summarizePuzzleRun(state([rec(0), rec(1.5)]), true);
    expect(s.accuracy).toBe(99.25);
    expect(s.score).toBe(993);
    expect(s.star).toBe(true);
    expect(s.crown).toBe(true);
    expect(s.first_try).toBe(true);
    expect(s.attempts).toBe(1);

    // One inaccuracy keeps the star, loses the crown.
    s = summarizePuzzleRun(state([rec(0), rec(8)]), true);
    expect(s.accuracy).toBe(96);
    expect(s.star).toBe(true);
    expect(s.crown).toBe(false);

    // Two inaccuracies, or one blunder, lose the star.
    expect(summarizePuzzleRun(state([rec(6), rec(8)]), true).star).toBe(false);
    expect(summarizePuzzleRun(state([rec(0), rec(20)]), true).star).toBe(false);

    // A takeback loses the star even on a run graded best throughout.
    s = summarizePuzzleRun(state([rec(0, 1), rec(0)], 1), true);
    expect(s.star).toBe(false);
    expect(s.crown).toBe(false);
    expect(s.first_try).toBe(false);
    expect(s.attempts).toBe(2);

    // Accuracy is what luck cannot climb: a lost run keeps its accuracy.
    expect(summarizePuzzleRun(state([rec(0), rec(3)]), false).accuracy).toBe(98.5);
    // No graded decision at all: the outcome stands in.
    expect(summarizePuzzleRun(state([]), true).accuracy).toBe(100);
    expect(summarizePuzzleRun(state([]), false).accuracy).toBe(0);
    // Clamped at zero.
    expect(summarizePuzzleRun(state([rec(100), rec(100)]), false).score).toBe(0);
  });

  it('the public reading of a v2 block never carries the solution, and the plan only on an arrows day', () => {
    const v2 = {
      version: 2 as const, theme: 't', plan: { steps: [{ kind: 'draft' as const, to: 'x' }] }, plan_prose: ['It reinforces X.'],
      decisions_target: 2, verdicts: 'before_dice' as const, intent: 'arrows' as const,
      solution: { equity: 0.7, obvious_equity: 0.4, near_best: 1, decisions: [{ turn: 1 }, { turn: 2 }, { turn: 2 }] as never, line: [], nodes: 10 },
    };
    const arrows = toPublicDailyPuzzleV2(v2);
    expect((arrows as Record<string, unknown>).solution).toBeUndefined();
    expect(arrows.plan).toEqual(v2.plan);
    expect(arrows.decisions).toBe(3);
    expect(arrows.theme).toBe('t');
    const prose = toPublicDailyPuzzleV2({ ...v2, intent: 'prose', verdicts: 'silent' });
    expect(prose.plan).toBeUndefined();
    expect(prose.plan_prose).toEqual(['It reinforces X.']);
  });
});

describe('puzzlePlay — a capture day whose opening is a decision', { timeout: 120_000 }, () => {
  it('found one in the horizon', () => {
    expect(captureDay, 'no accepted capture day with a decision at the opening in the first three weeks').not.toBeNull();
  });

  it('warms one solver per day and reuses it', () => {
    const { spec, map, puzzle } = captureDay!;
    const nodes = warmPuzzle(spec, map);
    expect(nodes).toBeGreaterThan(0);
    expect(getWarmedPuzzle(spec, map)).toBe(puzzle);
    expect(getWarmedPuzzle({ ...spec, v2: undefined }, map)).toBeNull();
  });

  it('answers a proposal with the solver\'s own numbers: best is a zero-loss best, the rival loses its gap', () => {
    const { spec, puzzle } = captureDay!;
    const game = gameFromSpec(spec, 0);
    const s0 = stateFromGame(puzzle.ctx, game, H, A);
    expect(s0.side).toBe(HUMAN);
    expect(s0.outcome).toBe(PENDING);
    const expected = classifyPosition(puzzle.solver, s0, obviousLine)!;
    expect(expected.decision).toBe(true);

    const toProposal = (a: ReturnType<typeof serializeAction>) => {
      if (a.kind === 'assault') return { kind: 'attack' as const, from: a.from, to: a.to };
      if (a.kind === 'end_attack') return { kind: 'end_attack' as const };
      throw new Error(`unexpected opening action ${a.kind}`);
    };
    const bestProposal = toProposal(serializeAction(puzzle.ctx, expected.best.action));
    const v = proposePuzzleAction(puzzle, game, bestProposal);
    expect(v.decision).toBe(true);
    expect(v.silent).toBe(false);
    expect(v.best_equity).toBeCloseTo(expected.best.equity, 3);
    expect(v.equity).toBeCloseTo(expected.best.equity, 3);
    expect(v.loss).toBeLessThan(0.01);
    expect(v.grade).toBe('best');
    expect(v.takebacks).toBe(0);
    expect(game.puzzle_decisions).toHaveLength(1);
    expect(game.puzzle_decisions![0].first).toEqual(expect.objectContaining({ kind: bestProposal.kind === 'attack' ? 'assault' : 'end_attack' }));

    // The rival, when it is a move the client can name, loses at least the decision gap.
    const alt = expected.alternative ? serializeAction(puzzle.ctx, expected.alternative) : null;
    if (alt && (alt.kind === 'assault' || alt.kind === 'end_attack')) {
      const fresh = gameFromSpec(spec, 0);
      const rival = proposePuzzleAction(puzzle, fresh, toProposal(alt));
      expect(rival.decision).toBe(true);
      expect(rival.loss).toBeGreaterThanOrEqual(5);
      expect(['inaccuracy', 'blunder']).toContain(rival.grade);
      // Keep variants of one assault grade as one move: the coarse move's best.
      if (alt.kind === 'assault') {
        const bestOfKind = Math.max(...expected.values
          .filter((x) => coarseActionKey(x.action) === coarseActionKey(expected.alternative!))
          .map((x) => x.equity));
        expect(rival.equity).toBeCloseTo(bestOfKind, 3);
      }
    }
  });

  it('first attempt counts: a takeback keeps the first loss, costs the star; a second reveals the best move at full loss', () => {
    const { spec, puzzle } = captureDay!;
    const game = gameFromSpec(spec, 0);
    const s0 = stateFromGame(puzzle.ctx, game, H, A);
    const expected = classifyPosition(puzzle.solver, s0, obviousLine)!;
    const openings = expected.values.map((v) => v.action);
    const assaults = openings.filter((a) => a.kind === 'assault');
    // Three distinct moves to propose in turn: two different assault targets or an assault and stopping.
    const moves: Array<{ kind: 'attack'; from: string; to: string } | { kind: 'end_attack' }> = [];
    const seen = new Set<string>();
    for (const a of assaults) {
      const key = coarseActionKey(a);
      if (seen.has(key)) continue;
      seen.add(key);
      moves.push({ kind: 'attack', from: puzzle.ctx.ids[a.from], to: puzzle.ctx.ids[a.to] });
    }
    moves.push({ kind: 'end_attack' });
    expect(moves.length, `openings: ${openings.map((a) => describeAction(puzzle.ctx, a)).join(', ')}`).toBeGreaterThanOrEqual(2);

    const first = proposePuzzleAction(puzzle, game, moves[0]);
    expect(first.decision).toBe(true);
    const record = game.puzzle_decisions![0];
    const firstLoss = record.loss;

    // Proposing the same move again is not a takeback.
    const again = proposePuzzleAction(puzzle, game, moves[0]);
    expect(again.takebacks).toBe(0);
    expect(game.puzzle_takebacks ?? 0).toBe(0);

    // A different move at the same position: one takeback, the record keeps the first loss.
    const second = proposePuzzleAction(puzzle, game, moves[1]);
    expect(second.decision).toBe(true);
    expect(second.takebacks).toBe(1);
    expect(second.best).toBeUndefined();
    expect(game.puzzle_takebacks).toBe(1);
    expect(record.loss).toBe(firstLoss);
    expect(game.puzzle_decisions).toHaveLength(1);
    expect(summarizePuzzleRun(game, true).star).toBe(false);

    // A second takeback: the best move is revealed and the decision is recorded at full loss.
    const third = proposePuzzleAction(puzzle, game, moves.length > 2 ? moves[2] : moves[0]);
    expect(third.takebacks).toBe(2);
    expect(third.best).toEqual(record.best);
    expect(record.revealed).toBe(true);
    expect(record.loss).toBe(100);
    expect(record.grade).toBe('blunder');
    expect(game.puzzle_takebacks).toBe(2);
    expect(summarizePuzzleRun(game, true).attempts).toBe(3);
  });

  it('a committed move is graded whether or not it was proposed, and pressing the same edge is not a second decision', () => {
    const { spec, puzzle } = captureDay!;
    const game = gameFromSpec(spec, 0);
    const s0 = stateFromGame(puzzle.ctx, game, H, A);
    const expected = classifyPosition(puzzle.solver, s0, obviousLine)!;
    const anAssault = expected.values.map((v) => v.action).find((a) => a.kind === 'assault');
    expect(anAssault).toBeDefined();
    if (!anAssault || anAssault.kind !== 'assault') return;
    const from = puzzle.ctx.ids[anAssault.from];
    const to = puzzle.ctx.ids[anAssault.to];

    const record = commitPuzzleAttack(puzzle, game, from, to);
    expect(record).not.toBeNull();
    expect(record!.first).toEqual({ kind: 'assault', from, to, keep: 1 });
    expect(record!.chosen).toEqual({ kind: 'assault', from, to, keep: 1 });
    expect(record!.chosen_equity).toBeLessThanOrEqual(record!.best_equity + 1e-9);
    expect(game.puzzle_decisions).toHaveLength(1);
    expect(game.puzzle_assault_edge).toBe(`1:${from}>${to}`);
    const objective = puzzle.ctx.objective.targets.map((t) => puzzle.ctx.ids[t]);
    expect(!!game.puzzle_objective_attacked).toBe(objective.includes(to));

    // The next exchange on the same edge (units changed by the dice) is the same assault.
    game.territories[from].unit_count -= 1;
    expect(commitPuzzleAttack(puzzle, game, from, to)).toBeNull();
    expect(game.puzzle_decisions).toHaveLength(1);

    // A proposal that matches the committed move is not a takeback.
    expect(game.puzzle_takebacks ?? 0).toBe(0);

    beginPuzzleHumanTurn(game);
    expect(game.puzzle_objective_attacked).toBe(false);
    expect(game.puzzle_assault_edge).toBeUndefined();
  });

  it('stopping and ending the turn are graded like any other move, and both are silent on a silent day', () => {
    const { spec, puzzle, map } = captureDay!;
    const game = gameFromSpec(spec, 0);
    const endAttack = commitPuzzleEndAttack(puzzle, game);
    const s0 = stateFromGame(puzzle.ctx, game, H, A);
    const expected = classifyPosition(puzzle.solver, s0, obviousLine)!;
    expect(endAttack !== null).toBe(expected.decision);
    if (endAttack) {
      expect(endAttack.chosen).toEqual({ kind: 'end_attack' });
      expect(endAttack.chosen_loss).toBeCloseTo(Math.max(0, expected.best.equity - puzzle.solver.grade(s0, { kind: 'end_attack' }).equity) * 100, 1);
    }

    // Fortify and end-turn from the fortify phase.
    game.phase = 'fortify';
    game.puzzle_decisions = [];
    const sF = stateFromGame(puzzle.ctx, game, H, A);
    const fortifyVerdict = classifyPosition(puzzle.solver, sF, obviousLine);
    const move = fortifyVerdict?.values.map((v) => v.action).find((a) => a.kind === 'fortify');
    if (move && move.kind === 'fortify') {
      const from = puzzle.ctx.ids[move.from];
      const to = puzzle.ctx.ids[move.to];
      const rec = commitPuzzleFortify(puzzle, game, from, to, game.territories[from].unit_count - 1);
      expect(rec !== null).toBe(!!fortifyVerdict?.decision);
      if (rec) expect(rec.chosen).toEqual({ kind: 'fortify', from, to, units: 'all_but_1' });
    }
    const endTurn = commitPuzzleEndTurn(puzzle, game);
    expect(endTurn !== null).toBe(!!fortifyVerdict?.decision);

    // A silent day: nothing is answered before the dice, and nothing is recorded by a proposal.
    resetWarmedPuzzlesForTests();
    const silentSpec: DailyPuzzleSpec = { ...spec, v2: { ...spec.v2!, verdicts: 'silent', intent: 'prose' } };
    const silent = getWarmedPuzzle(silentSpec, map)!;
    const silentGame = gameFromSpec(silentSpec, 0);
    expect(proposePuzzleAction(silent, silentGame, { kind: 'end_attack' })).toEqual({ decision: false, silent: true });
    expect(silentGame.puzzle_decisions).toBeUndefined();
    // Commits are still graded.
    const committed = commitPuzzleEndAttack(silent, silentGame);
    expect(committed !== null).toBe(expected.decision);
    resetWarmedPuzzlesForTests();
  });
});

describe('puzzlePlay — a hold day opens with a draft', { timeout: 120_000 }, () => {
  it('found one in the horizon', () => {
    expect(holdDay, 'no accepted hold day in the first three weeks').not.toBeNull();
  });

  it('grades the draft as one decision from the pre-draft position when the phase advances', () => {
    const { spec, map } = holdDay!;
    resetWarmedPuzzlesForTests();
    const puzzle = getWarmedPuzzle(spec, map)!;
    const draftUnits = stateFromSpec(puzzle.ctx, spec).draftLeft;
    expect(draftUnits).toBeGreaterThan(0);
    const game = gameFromSpec(spec, draftUnits);
    expect(game.phase).toBe('draft');

    // The turn's pre-draft position, as the first placement (or a draft proposal) notes it.
    notePuzzleDraftOpen(puzzle, game);
    expect(game.puzzle_turn_open?.turn).toBe(1);
    expect(game.puzzle_turn_open?.draft_left).toBe(draftUnits);
    const pre = stateFromGame(puzzle.ctx, game, H, A);
    const expected = classifyPosition(puzzle.solver, pre, obviousLine)!;

    // Propose "everything onto the target": graded from the same position.
    const target = spec.target_territory_id!;
    const verdict = proposePuzzleAction(puzzle, game, { kind: 'draft', to: target });
    expect(verdict.decision).toBe(expected.decision);
    if (expected.decision) {
      expect(verdict.best_equity).toBeCloseTo(expected.best.equity, 3);
      expect(verdict.equity).toBeCloseTo(puzzle.solver.grade(pre, { kind: 'draft', to: puzzle.ctx.index.get(target)! }).equity, 3);
    }

    // The player places the units on the target, unit by unit, then advances.
    for (let i = 0; i < draftUnits; i++) {
      notePuzzleDraftOpen(puzzle, game); // idempotent within the turn
      game.territories[target].unit_count += 1;
      game.draft_units_remaining -= 1;
    }
    game.phase = 'attack';
    const record = commitPuzzleDraft(puzzle, game);
    expect(record !== null).toBe(expected.decision);
    if (record) {
      expect(record.phase).toBe('draft');
      expect(record.chosen).toEqual({ kind: 'draft', to: target });
      expect(record.first).toEqual({ kind: 'draft', to: target });
      // One record for the whole draft, and no takeback: the proposal matched the placement.
      expect(game.puzzle_decisions).toHaveLength(1);
      expect(game.puzzle_takebacks ?? 0).toBe(0);
      const post = stateFromGame(puzzle.ctx, game, H, A);
      expect(record.chosen_equity).toBeCloseTo(puzzle.solver.value(post), 3);
    }
    resetWarmedPuzzlesForTests();
  });
});
