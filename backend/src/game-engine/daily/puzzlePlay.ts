/**
 * Daily Challenge v2 at play time (docs/DAILY_PUZZLE_V2.md §4, §5.4).
 *
 * The schedule proved the day and stored its solution; this grades what the
 * player actually does against the same exact solver, so "you threw away 12
 * points" is a fact about the position, not a heuristic.
 *
 * Three moments:
 *   - propose: the client asks what a move is worth before committing it
 *     (the verdict card). On a silent day nothing is answered.
 *   - commit: the socket handlers report what the player did, and the
 *     position is graded whether or not anything was proposed. The server is
 *     the source of truth: a client that skips proposals is still scored.
 *   - summarize: at game over, the run's accuracy, score, star and crown.
 *
 * A decision is recorded once per position (its canonical key). The first
 * proposal is what accuracy records; a takeback — proposing or committing a
 * different move at the same position — forfeits the star; a second takeback
 * on the same decision reveals the best move and records the decision at
 * full loss. Trivial positions (no rival within five points) are never
 * recorded, so the run is scored on its decisions alone.
 *
 * Grading is by the model's rule for every move shape: an assault is worth
 * the best of its keep variants (the target is the decision; how far to
 * press is the next one), a draft is graded as a whole when the phase
 * advances, a fortify by the position it leaves, ending a phase by the
 * model's own action.
 */
import type { GameMap, GameState } from '../../types';
import type { DailyPuzzleSpec, PuzzleDecisionRecord, PuzzleGrade, StoredPuzzleAction } from './dailyPuzzleTypes';
import { PUZZLE_ARCHETYPES, contextFromSpec, stateFromGame, stateFromSpec } from './puzzle/bridge';
import { coarseActionKey, serializeAction, type HumanAction } from './puzzle/actions';
import {
  HUMAN,
  PENDING,
  PHASE_ATTACK,
  PHASE_DRAFT,
  PHASE_FORTIFY,
  canonicalKey,
  cloneState,
  type PuzzleContext,
  type PuzzleState,
} from './puzzle/model';
import { obviousLine } from './puzzle/obvious';
import { compilePlan } from './puzzle/opponent';
import { BudgetExceeded, Solver, classifyPosition, DECISION_GAP, type PositionVerdict } from './puzzle/solver';

// ── The warmed solver ────────────────────────────────────────────────────────

/** Play may wander off the proven tree; give it room before giving up on a grade. */
export const PLAY_NODE_BUDGET = 3_000_000;
const WARM_LIMIT = 4;

export interface WarmedPuzzle {
  key: string;
  spec: DailyPuzzleSpec;
  ctx: PuzzleContext;
  solver: Solver;
}

const warmed = new Map<string, WarmedPuzzle>();

/** One solver per day per process; the seed pair is unique to a date's day. */
export function puzzleCacheKey(spec: DailyPuzzleSpec): string {
  return `${spec.map_id}:${spec.seed}:${spec.dice_queue_seed}:${spec.max_turns}`;
}

/** The day's solver, built on first use. Null when the spec is not a v2 puzzle. */
export function getWarmedPuzzle(spec: DailyPuzzleSpec, map: GameMap): WarmedPuzzle | null {
  if (!spec.v2 || !PUZZLE_ARCHETYPES.has(spec.archetype) || !spec.starting_board) return null;
  const key = puzzleCacheKey(spec);
  const hit = warmed.get(key);
  if (hit) return hit;
  const ctx = contextFromSpec(spec, map);
  const solver = new Solver({ ctx, plan: compilePlan(ctx, spec.v2.plan) }, PLAY_NODE_BUDGET);
  const entry: WarmedPuzzle = { key, spec, ctx, solver };
  warmed.set(key, entry);
  if (warmed.size > WARM_LIMIT) {
    const oldest = warmed.keys().next().value;
    if (oldest !== undefined) warmed.delete(oldest);
  }
  return entry;
}

/**
 * Solve the opening position now, so the first verdict is a memo hit. The
 * schedule proved the day within its budget, so this is bounded by the
 * stored node count. Returns the nodes visited, or null when there was
 * nothing to warm.
 */
export function warmPuzzle(spec: DailyPuzzleSpec, map: GameMap): number | null {
  const w = getWarmedPuzzle(spec, map);
  if (!w) return null;
  try {
    w.solver.value(stateFromSpec(w.ctx, spec));
    return w.solver.nodes;
  } catch (err) {
    if (err instanceof BudgetExceeded) return null;
    throw err;
  }
}

export function resetWarmedPuzzlesForTests(): void {
  warmed.clear();
}

// ── Vocabulary ───────────────────────────────────────────────────────────────

/** A move as the client names it, by territory id. */
export type PuzzleProposal =
  | { kind: 'attack'; from: string; to: string }
  | { kind: 'draft'; to: string; split?: string }
  | { kind: 'fortify'; from: string; to: string; units: number }
  | { kind: 'end_attack' }
  | { kind: 'end_turn' };

export interface PuzzleVerdict {
  /** True when the position is a decision and the proposal was graded. */
  decision: boolean;
  /** A silent day: nothing is answered before the dice. */
  silent: boolean;
  equity?: number;
  best_equity?: number;
  /** Points of win probability the proposal gives up. */
  loss?: number;
  grade?: PuzzleGrade;
  /** Takebacks spent on this decision so far. */
  takebacks?: number;
  /** Set after the second takeback: the best move is shown. */
  best?: StoredPuzzleAction;
}

export function gradeLoss(lossPoints: number): PuzzleGrade {
  if (lossPoints < 2) return 'best';
  if (lossPoints < 5) return 'good';
  if (lossPoints < 15) return 'inaccuracy';
  return 'blunder';
}

const round2 = (x: number): number => Math.round(x * 100) / 100;
const round4 = (x: number): number => Math.round(x * 10_000) / 10_000;
const points = (fraction: number): number => round2(Math.max(0, fraction) * 100);

/** A proposal from the wire, or null when it is not one. */
export function sanitizeProposal(raw: unknown): PuzzleProposal | null {
  if (!raw || typeof raw !== 'object') return null;
  const p = raw as Record<string, unknown>;
  const id = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 64;
  switch (p.kind) {
    case 'attack': return id(p.from) && id(p.to) ? { kind: 'attack', from: p.from, to: p.to } : null;
    case 'draft': {
      if (!id(p.to)) return null;
      if (p.split !== undefined && !id(p.split)) return null;
      return p.split !== undefined ? { kind: 'draft', to: p.to, split: p.split } : { kind: 'draft', to: p.to };
    }
    case 'fortify': return id(p.from) && id(p.to) && Number.isInteger(p.units) && (p.units as number) >= 1
      ? { kind: 'fortify', from: p.from, to: p.to, units: p.units as number }
      : null;
    case 'end_attack': return { kind: 'end_attack' };
    case 'end_turn': return { kind: 'end_turn' };
    default: return null;
  }
}

/** The proposal as a stored action, for the record and the review. */
function storedFromProposal(w: WarmedPuzzle, s: PuzzleState, p: PuzzleProposal): StoredPuzzleAction {
  switch (p.kind) {
    case 'attack': return { kind: 'assault', from: p.from, to: p.to, keep: 1 };
    case 'draft': return p.split !== undefined ? { kind: 'draft', to: p.to, split: p.split } : { kind: 'draft', to: p.to };
    case 'fortify': {
      const from = w.ctx.index.get(p.from);
      const avail = from === undefined ? 0 : s.units[from] - 1;
      return { kind: 'fortify', from: p.from, to: p.to, units: avail > 0 && p.units < avail ? 'half' : 'all_but_1' };
    }
    case 'end_attack': return { kind: 'end_attack' };
    case 'end_turn': return { kind: 'end_turn' };
  }
}

/** "Attack B from A" whatever the stop; the same grouping the gate used. */
export function coarseStoredKey(a: StoredPuzzleAction): string {
  switch (a.kind) {
    case 'draft': return `draft:${a.to}${a.split !== undefined ? `+${a.split}` : ''}`;
    case 'assault': return `assault:${a.from}>${a.to}`;
    case 'fortify': return `fortify:${a.from}>${a.to}`;
    default: return a.kind;
  }
}

// ── Positions ────────────────────────────────────────────────────────────────

export interface PuzzleSeats {
  humanId: string;
  aiId: string;
}

export function puzzleSeats(state: GameState): PuzzleSeats | null {
  const human = state.players.find((p) => !p.is_ai);
  const ai = state.players.find((p) => p.is_ai);
  return human && ai ? { humanId: human.player_id, aiId: ai.player_id } : null;
}

/** The live game as a model position, when it is the human's to move. */
function livePosition(w: WarmedPuzzle, state: GameState): PuzzleState | null {
  const seats = puzzleSeats(state);
  if (!seats) return null;
  const s = stateFromGame(w.ctx, state, seats.humanId, seats.aiId);
  if (s.side !== HUMAN || s.outcome !== PENDING || s.turn > w.ctx.maxTurns) return null;
  return s;
}

function safeClassify(w: WarmedPuzzle, s: PuzzleState): PositionVerdict | null {
  try {
    return classifyPosition(w.solver, s, obviousLine, DECISION_GAP);
  } catch (err) {
    if (err instanceof BudgetExceeded) return null;
    throw err;
  }
}

function safeValue(w: WarmedPuzzle, s: PuzzleState): number | null {
  try {
    return w.solver.value(s);
  } catch (err) {
    if (err instanceof BudgetExceeded) return null;
    throw err;
  }
}

/** Win probability of a proposal from `s` under best play afterwards; null when it is not a legal move here. */
function proposalEquity(w: WarmedPuzzle, s: PuzzleState, values: PositionVerdict['values'], p: PuzzleProposal): number | null {
  const idx = (id: string): number | undefined => w.ctx.index.get(id);
  try {
    switch (p.kind) {
      case 'attack': {
        const from = idx(p.from);
        const to = idx(p.to);
        if (from === undefined || to === undefined || s.phase !== PHASE_ATTACK) return null;
        if (s.owner[from] !== HUMAN || s.owner[to] === HUMAN || s.units[from] < 2 || !w.ctx.adj[from].includes(to)) return null;
        const key = `assault:${from}>${to}`;
        let best: number | null = null;
        for (const v of values) {
          if (coarseActionKey(v.action) === key && (best === null || v.equity > best)) best = v.equity;
        }
        if (best !== null) return best;
        // Pruned by the search (not near the objective): graded all the same.
        return w.solver.grade(s, { kind: 'assault', from, to, keep: 1 }).equity;
      }
      case 'draft': {
        const to = idx(p.to);
        const split = p.split !== undefined ? idx(p.split) : undefined;
        if (to === undefined || (p.split !== undefined && split === undefined)) return null;
        if (s.phase !== PHASE_DRAFT || s.draftLeft <= 0 || s.owner[to] !== HUMAN) return null;
        if (split !== undefined && (s.owner[split] !== HUMAN || split === to)) return null;
        const action: HumanAction = split !== undefined ? { kind: 'draft', to, split } : { kind: 'draft', to };
        return w.solver.grade(s, action).equity;
      }
      case 'fortify': {
        const from = idx(p.from);
        const to = idx(p.to);
        if (from === undefined || to === undefined || s.phase !== PHASE_FORTIFY || s.fortifyLeft <= 0) return null;
        if (s.owner[from] !== HUMAN || s.owner[to] !== HUMAN || from === to || s.units[from] < 2) return null;
        const ns = cloneState(s);
        const move = Math.max(1, Math.min(p.units, ns.units[from] - 1));
        ns.units[from] -= move;
        ns.units[to] += move;
        ns.fortifyLeft -= 1;
        return w.solver.value(ns);
      }
      case 'end_attack':
        if (s.phase !== PHASE_ATTACK && !(s.phase === PHASE_DRAFT && s.draftLeft <= 0)) return null;
        return w.solver.grade(s, { kind: 'end_attack' }).equity;
      case 'end_turn':
        if (s.phase !== PHASE_FORTIFY) return null;
        return w.solver.grade(s, { kind: 'end_turn' }).equity;
    }
  } catch (err) {
    if (err instanceof BudgetExceeded) return null;
    throw err;
  }
}

// ── Records ──────────────────────────────────────────────────────────────────

function findRecord(state: GameState, key: string): PuzzleDecisionRecord | undefined {
  return state.puzzle_decisions?.find((d) => d.key === key);
}

function phaseName(s: PuzzleState): PuzzleDecisionRecord['phase'] {
  return s.phase === PHASE_DRAFT ? 'draft' : s.phase === PHASE_ATTACK ? 'attack' : 'fortify';
}

function openRecord(
  w: WarmedPuzzle,
  state: GameState,
  s: PuzzleState,
  key: string,
  verdict: PositionVerdict,
  first: StoredPuzzleAction | null,
  firstEquity: number,
): PuzzleDecisionRecord {
  const loss = points(verdict.best.equity - firstEquity);
  const record: PuzzleDecisionRecord = {
    key,
    turn: s.turn,
    phase: phaseName(s),
    best: serializeAction(w.ctx, verdict.best.action),
    best_equity: round4(verdict.best.equity),
    first,
    first_equity: round4(firstEquity),
    loss,
    grade: gradeLoss(loss),
    takebacks: 0,
    last: first,
  };
  state.puzzle_decisions = [...(state.puzzle_decisions ?? []), record];
  return record;
}

/** A different move at a decided position: the star goes; a second one reveals the best move at full loss. */
function noteTakeback(state: GameState, record: PuzzleDecisionRecord, next: StoredPuzzleAction | null): void {
  if (!record.last || !next || coarseStoredKey(record.last) === coarseStoredKey(next)) {
    record.last = next ?? record.last;
    return;
  }
  record.takebacks += 1;
  record.last = next;
  state.puzzle_takebacks = (state.puzzle_takebacks ?? 0) + 1;
  if (record.takebacks >= 2 && !record.revealed) {
    record.revealed = true;
    record.loss = 100;
    record.grade = 'blunder';
  }
}

const NOT_A_DECISION: PuzzleVerdict = { decision: false, silent: false };

/**
 * The turn's pre-draft position, captured before the first unit lands so the
 * draft can be graded as one decision when the phase advances (and so a
 * draft proposal is graded from the same position the commit will be).
 */
export function notePuzzleDraftOpen(w: WarmedPuzzle, state: GameState): void {
  if (state.puzzle_turn_open && state.puzzle_turn_open.turn === state.turn_number) return;
  const s = livePosition(w, state);
  if (!s || s.phase !== PHASE_DRAFT || s.draftLeft <= 0) return;
  state.puzzle_turn_open = { turn: state.turn_number, key: canonicalKey(s), units: s.units.slice(), draft_left: s.draftLeft };
}

/** The pre-draft position of this turn, rebuilt from the note. */
function openPosition(w: WarmedPuzzle, state: GameState): PuzzleState | null {
  const open = state.puzzle_turn_open;
  if (!open || open.turn !== state.turn_number) return null;
  const now = livePosition(w, state) ?? (() => {
    const seats = puzzleSeats(state);
    return seats ? stateFromGame(w.ctx, state, seats.humanId, seats.aiId) : null;
  })();
  if (!now) return null;
  const pre = cloneState(now);
  pre.side = HUMAN;
  pre.phase = PHASE_DRAFT;
  pre.draftLeft = open.draft_left;
  pre.units = open.units.slice();
  pre.outcome = PENDING;
  return pre;
}

/**
 * What a move is worth before it is made. Records the decision on the first
 * proposal; a later, different proposal at the same position is a takeback.
 */
export function proposePuzzleAction(w: WarmedPuzzle, state: GameState, proposal: PuzzleProposal): PuzzleVerdict {
  if (w.spec.v2?.verdicts === 'silent') return { decision: false, silent: true };
  let s: PuzzleState | null;
  if (proposal.kind === 'draft') {
    notePuzzleDraftOpen(w, state);
    s = openPosition(w, state);
  } else {
    s = livePosition(w, state);
  }
  if (!s) return NOT_A_DECISION;
  const verdict = safeClassify(w, s);
  if (!verdict || !verdict.decision) return NOT_A_DECISION;
  const equity = proposalEquity(w, s, verdict.values, proposal);
  if (equity === null) return NOT_A_DECISION;
  const stored = storedFromProposal(w, s, proposal);
  const key = canonicalKey(s);
  let record = findRecord(state, key);
  if (!record) record = openRecord(w, state, s, key, verdict, stored, equity);
  else noteTakeback(state, record, stored);
  const loss = points(verdict.best.equity - equity);
  return {
    decision: true,
    silent: false,
    equity: round4(equity),
    best_equity: round4(verdict.best.equity),
    loss,
    grade: gradeLoss(loss),
    takebacks: record.takebacks,
    ...(record.revealed ? { best: record.best } : {}),
  };
}

/** Grade a committed move at a position; the record's `chosen`. Null when the position is not a decision. */
function commitAt(w: WarmedPuzzle, state: GameState, s: PuzzleState, key: string, proposal: PuzzleProposal): PuzzleDecisionRecord | null {
  const verdict = safeClassify(w, s);
  if (!verdict || !verdict.decision) return null;
  const equity = proposalEquity(w, s, verdict.values, proposal);
  if (equity === null) return null;
  const stored = storedFromProposal(w, s, proposal);
  let record = findRecord(state, key);
  if (!record) record = openRecord(w, state, s, key, verdict, stored, equity);
  else noteTakeback(state, record, stored);
  record.chosen = stored;
  record.chosen_equity = round4(equity);
  record.chosen_loss = points(verdict.best.equity - equity);
  return record;
}

/**
 * The player attacks: the first exchange on an edge this turn is the
 * decision (which target); the exchanges that follow are the same assault
 * pressed. Also raises the plan condition "the human attacked the objective".
 * Call before the exchange resolves.
 */
export function commitPuzzleAttack(w: WarmedPuzzle, state: GameState, from: string, to: string): PuzzleDecisionRecord | null {
  const edge = `${state.turn_number}:${from}>${to}`;
  const continuing = state.puzzle_assault_edge === edge;
  state.puzzle_assault_edge = edge;
  const toIdx = w.ctx.index.get(to);
  if (toIdx !== undefined && w.ctx.objective.targets.includes(toIdx)) state.puzzle_objective_attacked = true;
  if (continuing) return null;
  const s = livePosition(w, state);
  if (!s) return null;
  return commitAt(w, state, s, canonicalKey(s), { kind: 'attack', from, to });
}

/** The player moves units: graded by the position it leaves. Call before the move is applied. */
export function commitPuzzleFortify(w: WarmedPuzzle, state: GameState, from: string, to: string, units: number): PuzzleDecisionRecord | null {
  const s = livePosition(w, state);
  if (!s) return null;
  return commitAt(w, state, s, canonicalKey(s), { kind: 'fortify', from, to, units });
}

/** The player stops attacking. Call before the phase flips. */
export function commitPuzzleEndAttack(w: WarmedPuzzle, state: GameState): PuzzleDecisionRecord | null {
  state.puzzle_assault_edge = undefined;
  const s = livePosition(w, state);
  if (!s) return null;
  return commitAt(w, state, s, canonicalKey(s), { kind: 'end_attack' });
}

/** The player ends the turn. Call before the turn advances. */
export function commitPuzzleEndTurn(w: WarmedPuzzle, state: GameState): PuzzleDecisionRecord | null {
  const s = livePosition(w, state);
  if (!s) return null;
  return commitAt(w, state, s, canonicalKey(s), { kind: 'end_turn' });
}

/**
 * The draft as a whole, once the phase has advanced to attack: graded by the
 * position the placements left against the pre-draft position noted at the
 * turn's first placement (or draft proposal). The chosen move is the
 * placement pattern read back as the model's draft: all onto one territory,
 * or split between two.
 */
export function commitPuzzleDraft(w: WarmedPuzzle, state: GameState): PuzzleDecisionRecord | null {
  const open = state.puzzle_turn_open;
  if (!open || open.turn !== state.turn_number) return null;
  const pre = openPosition(w, state);
  const post = livePosition(w, state);
  if (!pre || !post || post.phase !== PHASE_ATTACK) return null;
  const verdict = safeClassify(w, pre);
  if (!verdict || !verdict.decision) return null;
  const equity = safeValue(w, post);
  if (equity === null) return null;

  const placed = w.ctx.ids
    .map((id, i) => ({ id, n: post.units[i] - open.units[i] }))
    .filter((x) => x.n > 0)
    .sort((a, b) => b.n - a.n);
  const chosen: StoredPuzzleAction | null = placed.length === 0
    ? null
    : placed.length === 1 ? { kind: 'draft', to: placed[0].id } : { kind: 'draft', to: placed[0].id, split: placed[1].id };

  let record = findRecord(state, open.key);
  if (!record) record = openRecord(w, state, pre, open.key, verdict, chosen, equity);
  else noteTakeback(state, record, chosen);
  record.chosen = chosen;
  record.chosen_equity = round4(equity);
  record.chosen_loss = points(verdict.best.equity - equity);
  return record;
}

/** Start-of-turn housekeeping for the human's turn on a v2 day. */
export function beginPuzzleHumanTurn(state: GameState): void {
  state.puzzle_objective_attacked = false;
  state.puzzle_assault_edge = undefined;
  state.puzzle_turn_open = null;
}

// ── The run ──────────────────────────────────────────────────────────────────

export interface PuzzleRunSummary {
  /** 100 − mean loss over the run's graded decisions, 0–100. */
  accuracy: number;
  /** round(10 × accuracy), 0–1000. */
  score: number;
  /** No blunder, at most one inaccuracy, no takeback. */
  star: boolean;
  /** Every decision graded best on the first attempt. */
  crown: boolean;
  first_try: boolean;
  /** 1 + takebacks. */
  attempts: number;
  takebacks: number;
  decisions: PuzzleDecisionRecord[];
}

/** The run's outcome from its recorded decisions (docs/DAILY_PUZZLE_V2.md §4). */
export function summarizePuzzleRun(state: GameState, won: boolean): PuzzleRunSummary {
  const decisions = state.puzzle_decisions ?? [];
  const takebacks = state.puzzle_takebacks ?? 0;
  const accuracy = decisions.length === 0
    ? (won ? 100 : 0)
    : round2(Math.max(0, Math.min(100, 100 - decisions.reduce((sum, d) => sum + d.loss, 0) / decisions.length)));
  const blunders = decisions.filter((d) => d.grade === 'blunder').length;
  const inaccuracies = decisions.filter((d) => d.grade === 'inaccuracy').length;
  return {
    accuracy,
    score: Math.round(10 * accuracy),
    star: blunders === 0 && inaccuracies <= 1 && takebacks === 0,
    crown: takebacks === 0 && decisions.every((d) => d.grade === 'best'),
    first_try: takebacks === 0,
    attempts: 1 + takebacks,
    takebacks,
    decisions,
  };
}
