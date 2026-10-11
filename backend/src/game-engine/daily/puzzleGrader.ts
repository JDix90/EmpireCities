/**
 * The day's play-time grader (docs/DAILY_PUZZLE_V2.md §5.4): the exact solver
 * behind every verdict and every graded commit, and the only part of play
 * that searches.
 *
 * A grade costs milliseconds on a position the warm-up solved and up to a
 * second where play leaves the proven tree; the warm-up itself is seconds on
 * the hardest days. The server runs every live game on one thread, so
 * ThreadGrader keeps the solver, and the memo it builds up over the day, in a
 * worker thread (puzzleGraderWorker.ts), and the server only waits on the
 * answers. LocalGrader is the same solver on the calling thread: the worker
 * runs it, the tests read its solver, and the server falls back to it when no
 * worker can start.
 *
 * The socket handlers wait on a grade while they hold the game's lock, so a
 * grade still running after GRADE_TIMEOUT_MS is given up and the move goes
 * ungraded, as a move past the node budget always has. The worker finishes
 * the search all the same, and its memo is the warmer for it. A worker that
 * dies takes its pending grades with it, ungraded, and the next query starts
 * a new one, cold: a dead worker most likely ran out of memory on a wide day,
 * and searching again on the server thread would bring back the stall this
 * module removes.
 */
import { Worker } from 'worker_threads';
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import type { GameMap } from '../../types';
import type { DailyPuzzleSpec, StoredPuzzleAction } from './dailyPuzzleTypes';
import { contextFromSpec, stateFromSpec } from './puzzle/bridge';
import { coarseActionKey, serializeAction, type HumanAction } from './puzzle/actions';
import { HUMAN, PHASE_ATTACK, PHASE_DRAFT, PHASE_FORTIFY, cloneState, type PuzzleContext, type PuzzleState } from './puzzle/model';
import { obviousLine } from './puzzle/obvious';
import { compilePlan } from './puzzle/opponent';
import { BudgetExceeded, Solver, classifyPosition, DECISION_GAP, type PositionVerdict } from './puzzle/solver';

/** Play may wander off the proven tree; give it room before giving up on a grade. */
export const PLAY_NODE_BUDGET = 3_000_000;

/**
 * How long a socket handler waits on a grade. Under the 4 s the client holds
 * a move for its verdict and the 5 s game lock; far past the slowest grade
 * measured off the proven tree, about one second.
 */
export const GRADE_TIMEOUT_MS = 3_000;

/** A move as the client names it, by territory id. */
export type PuzzleProposal =
  | { kind: 'attack'; from: string; to: string }
  | { kind: 'draft'; to: string; split?: string }
  | { kind: 'fortify'; from: string; to: string; units: number }
  | { kind: 'end_attack' }
  | { kind: 'end_turn' };

/** A move graded at a decision. */
export interface Assessment {
  /** The best move at the position, as the record stores it. */
  best: StoredPuzzleAction;
  bestEquity: number;
  /** Win probability of the move graded, under best play afterwards. */
  equity: number;
}

export interface PuzzleGrader {
  /** Solve the opening, so the first grade is a memo hit. The nodes visited, or null when the search ran out. */
  warm(): Promise<number | null>;
  /**
   * Grade `proposal` at `s`. Null when `s` is not a decision, the move is
   * not legal there, or no answer came in time.
   */
  assess(s: PuzzleState, proposal: PuzzleProposal): Promise<Assessment | null>;
  /** Grade a whole draft: the position it left, `post`, against the decision at `pre`. */
  assessDraft(pre: PuzzleState, post: PuzzleState): Promise<Assessment | null>;
  /** Stop for good. Pending grades come back null. */
  close(): void;
}

/** One query, as it crosses to the worker. */
export type GraderQuery =
  | { op: 'warm' }
  | { op: 'assess'; s: PuzzleState; proposal: PuzzleProposal }
  | { op: 'draft'; pre: PuzzleState; post: PuzzleState };

// ── On this thread ───────────────────────────────────────────────────────────

/** The day's solver on the calling thread. */
export class LocalGrader implements PuzzleGrader {
  readonly solver: Solver;

  constructor(
    private readonly spec: DailyPuzzleSpec,
    private readonly ctx: PuzzleContext,
  ) {
    if (!spec.v2) throw new Error('[daily v2] a grader needs a v2 day');
    this.solver = new Solver({ ctx, plan: compilePlan(ctx, spec.v2.plan) }, PLAY_NODE_BUDGET);
  }

  /** The schedule proved the day within its budget, so this is bounded by the stored node count. */
  warmNow(): number | null {
    try {
      this.solver.value(stateFromSpec(this.ctx, this.spec));
      return this.solver.nodes;
    } catch (err) {
      if (err instanceof BudgetExceeded) return null;
      throw err;
    }
  }

  assessNow(s: PuzzleState, proposal: PuzzleProposal): Assessment | null {
    const verdict = this.classify(s);
    if (!verdict?.decision) return null;
    const equity = this.proposalEquity(s, verdict.values, proposal);
    return equity === null ? null : this.assessment(verdict, equity);
  }

  assessDraftNow(pre: PuzzleState, post: PuzzleState): Assessment | null {
    const verdict = this.classify(pre);
    if (!verdict?.decision) return null;
    const equity = this.value(post);
    return equity === null ? null : this.assessment(verdict, equity);
  }

  /** A query as the worker receives it. */
  answer(query: GraderQuery): number | Assessment | null {
    switch (query.op) {
      case 'warm': return this.warmNow();
      case 'assess': return this.assessNow(query.s, query.proposal);
      case 'draft': return this.assessDraftNow(query.pre, query.post);
    }
  }

  async warm(): Promise<number | null> {
    return this.warmNow();
  }

  async assess(s: PuzzleState, proposal: PuzzleProposal): Promise<Assessment | null> {
    return this.assessNow(s, proposal);
  }

  async assessDraft(pre: PuzzleState, post: PuzzleState): Promise<Assessment | null> {
    return this.assessDraftNow(pre, post);
  }

  close(): void {}

  private assessment(verdict: PositionVerdict, equity: number): Assessment {
    return { best: serializeAction(this.ctx, verdict.best.action), bestEquity: verdict.best.equity, equity };
  }

  private classify(s: PuzzleState): PositionVerdict | null {
    try {
      return classifyPosition(this.solver, s, obviousLine, DECISION_GAP);
    } catch (err) {
      if (err instanceof BudgetExceeded) return null;
      throw err;
    }
  }

  private value(s: PuzzleState): number | null {
    try {
      return this.solver.value(s);
    } catch (err) {
      if (err instanceof BudgetExceeded) return null;
      throw err;
    }
  }

  /** Win probability of a proposal from `s` under best play afterwards; null when it is not a legal move here. */
  private proposalEquity(s: PuzzleState, values: PositionVerdict['values'], p: PuzzleProposal): number | null {
    const { ctx, solver } = this;
    const idx = (id: string): number | undefined => ctx.index.get(id);
    try {
      switch (p.kind) {
        case 'attack': {
          const from = idx(p.from);
          const to = idx(p.to);
          if (from === undefined || to === undefined || s.phase !== PHASE_ATTACK) return null;
          if (s.owner[from] !== HUMAN || s.owner[to] === HUMAN || s.units[from] < 2 || !ctx.adj[from].includes(to)) return null;
          const key = `assault:${from}>${to}`;
          let best: number | null = null;
          for (const v of values) {
            if (coarseActionKey(v.action) === key && (best === null || v.equity > best)) best = v.equity;
          }
          if (best !== null) return best;
          // Pruned by the search (not near the objective): graded all the same.
          return solver.grade(s, { kind: 'assault', from, to, keep: 1 }).equity;
        }
        case 'draft': {
          const to = idx(p.to);
          const split = p.split !== undefined ? idx(p.split) : undefined;
          if (to === undefined || (p.split !== undefined && split === undefined)) return null;
          if (s.phase !== PHASE_DRAFT || s.draftLeft <= 0 || s.owner[to] !== HUMAN) return null;
          if (split !== undefined && (s.owner[split] !== HUMAN || split === to)) return null;
          const action: HumanAction = split !== undefined ? { kind: 'draft', to, split } : { kind: 'draft', to };
          return solver.grade(s, action).equity;
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
          return solver.value(ns);
        }
        case 'end_attack':
          if (s.phase !== PHASE_ATTACK && !(s.phase === PHASE_DRAFT && s.draftLeft <= 0)) return null;
          return solver.grade(s, { kind: 'end_attack' }).equity;
        case 'end_turn':
          if (s.phase !== PHASE_FORTIFY) return null;
          return solver.grade(s, { kind: 'end_turn' }).equity;
      }
    } catch (err) {
      if (err instanceof BudgetExceeded) return null;
      throw err;
    }
  }
}

// ── In a worker thread ───────────────────────────────────────────────────────

/** What the worker is built from: the day, and the map the server loaded for it. */
export interface GraderJob {
  spec: DailyPuzzleSpec;
  map: GameMap;
}

/** A query's answer, or the error the solver threw on it. */
export type GraderReply = { id: number; result: number | Assessment | null } | { id: number; error: string };

/** The part of a Worker used here, so a test can stand one in. */
export type GraderWorker = Pick<Worker, 'on' | 'postMessage' | 'terminate' | 'ref' | 'unref'>;

export type SpawnGraderWorker = (job: GraderJob) => GraderWorker;

/**
 * The build's compiled worker; from source (dev under tsx, and the tests),
 * the .ts entry through tsx's CommonJS hook, which a worker does not inherit.
 */
export const spawnGraderWorker: SpawnGraderWorker = (workerData) => {
  const built = path.join(__dirname, 'puzzleGraderWorker.js');
  if (fs.existsSync(built)) return new Worker(built, { workerData });
  const tsx = createRequire(__filename).resolve('tsx/cjs');
  const source = path.join(__dirname, 'puzzleGraderWorker.ts');
  return new Worker(`require(${JSON.stringify(tsx)});\nrequire(${JSON.stringify(source)});`, { eval: true, workerData });
};

/**
 * The day's solver in a worker thread, started now so it has loaded by the
 * first query. The worker answers in order, one query at a time; it keeps the
 * process alive only while it owes an answer.
 */
export class ThreadGrader implements PuzzleGrader {
  private worker: GraderWorker | null = null;
  /** Set when no worker could start: the day is graded on this thread from then on. */
  private local: LocalGrader | null = null;
  private closed = false;
  private nextId = 1;
  private readonly pending = new Map<number, { settle: (result: unknown) => void; fail: (err: Error) => void }>();
  private readonly spawn: SpawnGraderWorker;
  private readonly timeoutMs: number;

  constructor(
    private readonly job: GraderJob,
    { spawn = spawnGraderWorker, timeoutMs = GRADE_TIMEOUT_MS }: { spawn?: SpawnGraderWorker; timeoutMs?: number } = {},
  ) {
    this.spawn = spawn;
    this.timeoutMs = timeoutMs;
    this.start();
  }

  /** No short clock: nothing waits on the warm-up but the memo. */
  warm(): Promise<number | null> {
    return this.ask({ op: 'warm' }, null) as Promise<number | null>;
  }

  assess(s: PuzzleState, proposal: PuzzleProposal): Promise<Assessment | null> {
    return this.ask({ op: 'assess', s, proposal }, this.timeoutMs) as Promise<Assessment | null>;
  }

  assessDraft(pre: PuzzleState, post: PuzzleState): Promise<Assessment | null> {
    return this.ask({ op: 'draft', pre, post }, this.timeoutMs) as Promise<Assessment | null>;
  }

  close(): void {
    this.closed = true;
    const worker = this.worker;
    this.worker = null;
    this.drop();
    if (worker) void worker.terminate().catch(() => {});
  }

  /** The day, for the logs. */
  private get day(): string {
    return `"${this.job.spec.title}"`;
  }

  /** The running worker, a new one, or this thread's solver when none can start. */
  private start(): GraderWorker | LocalGrader {
    if (this.local) return this.local;
    if (this.worker) return this.worker;
    let worker: GraderWorker;
    try {
      worker = this.spawn(this.job);
    } catch (err) {
      console.error(`[daily v2] ${this.day}: the grader worker could not start; grading on the server thread.`, err);
      this.local = new LocalGrader(this.job.spec, contextFromSpec(this.job.spec, this.job.map));
      return this.local;
    }
    worker.unref();
    worker.on('message', (reply: GraderReply) => {
      const waiting = this.pending.get(reply.id);
      if (!waiting) return;
      this.pending.delete(reply.id);
      this.idle(worker);
      if ('error' in reply) waiting.fail(new Error(`[daily v2] ${this.day}: the grade failed in its worker: ${reply.error}`));
      else waiting.settle(reply.result);
    });
    // An 'error' is followed by the 'exit', which clears the worker and its pending grades.
    worker.on('error', (err: Error) => console.error(`[daily v2] ${this.day}: the grader worker failed.`, err));
    worker.on('exit', (code: number) => {
      if (this.worker !== worker) return;
      this.worker = null;
      if (this.pending.size > 0) {
        console.error(`[daily v2] ${this.day}: the grader worker stopped with code ${code}; ${this.pending.size} pending grade(s) go ungraded.`);
      }
      this.drop();
    });
    this.worker = worker;
    return worker;
  }

  private async ask(query: GraderQuery, timeoutMs: number | null): Promise<unknown> {
    if (this.closed) return null;
    const runner = this.start();
    if (runner instanceof LocalGrader) return runner.answer(query);
    const worker = runner;
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = timeoutMs === null ? null : setTimeout(() => {
        if (!this.pending.delete(id)) return;
        this.idle(worker);
        console.warn(`[daily v2] ${this.day}: a grade ran past ${timeoutMs} ms; the move goes ungraded.`);
        resolve(null);
      }, timeoutMs);
      const stop = () => {
        if (timer) clearTimeout(timer);
      };
      if (this.pending.size === 0) worker.ref();
      this.pending.set(id, {
        settle: (result) => {
          stop();
          resolve(result);
        },
        fail: (err) => {
          stop();
          reject(err);
        },
      });
      worker.postMessage({ id, ...query });
    });
  }

  /** Answer every pending grade with null. */
  private drop(): void {
    const waiting = [...this.pending.values()];
    this.pending.clear();
    for (const w of waiting) w.settle(null);
  }

  /** Let the process exit once nothing is owed. */
  private idle(worker: GraderWorker): void {
    if (this.pending.size === 0) worker.unref();
  }
}
