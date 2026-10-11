import { describe, it, expect, vi, afterEach } from 'vitest';
import { EventEmitter } from 'events';
import { readFileSync } from 'fs';
import { join } from 'path';
import type { GameMap } from '../../types';
import type { DailyPuzzleSpec } from './dailyPuzzleTypes';
import { scheduleDayV2 } from './dailyScheduleV2';
import { contextFromSpec, stateFromSpec } from './puzzle/bridge';
import { applyHumanAction, serializeAction, type HumanAction } from './puzzle/actions';
import { HUMAN, PENDING, type PuzzleContext, type PuzzleState } from './puzzle/model';
import {
  LocalGrader,
  ThreadGrader,
  type GraderQuery,
  type GraderReply,
  type GraderWorker,
  type PuzzleProposal,
} from './puzzleGrader';

/**
 * The play-time grader (puzzleGrader.ts). The first block runs the real
 * worker thread, from source through tsx as dev does, and holds it to the
 * solver on this thread; the rest stand in a worker to drive each way a
 * thread can fail.
 */

const readMap = (mapId: string): GameMap =>
  JSON.parse(readFileSync(join(__dirname, `../../../../database/maps/${mapId}.json`), 'utf-8')) as GameMap;

/** A graded day and its map, as the server holds them when a game starts. */
async function servedDay(date: string): Promise<{ spec: DailyPuzzleSpec; map: GameMap }> {
  const day = await scheduleDayV2(date, { loadMap: async (mapId) => readMap(mapId), simulate: null });
  if (!day?.spec.v2) throw new Error(`${date} is not a graded day`);
  return { spec: day.spec, map: readMap(day.spec.map_id) };
}

/** The move a player makes to play `a`, as the client names it. */
function proposalFor(ctx: PuzzleContext, s: PuzzleState, a: HumanAction): PuzzleProposal {
  const stored = serializeAction(ctx, a);
  switch (stored.kind) {
    case 'assault': return { kind: 'attack', from: stored.from, to: stored.to };
    case 'draft': return stored.split !== undefined ? { kind: 'draft', to: stored.to, split: stored.split } : { kind: 'draft', to: stored.to };
    case 'fortify': return { kind: 'fortify', from: stored.from, to: stored.to, units: s.units[ctx.index.get(stored.from)!] - 1 };
    case 'end_attack': return { kind: 'end_attack' };
    case 'end_turn': return { kind: 'end_turn' };
  }
}

describe('play-time grader — a real thread', () => {
  it("answers what this thread answers, move for move, along a day's best line", async () => {
    // savannah, 27 October: its opening is a decision, and it solves in milliseconds.
    const { spec, map } = await servedDay('2026-10-27');
    const ctx = contextFromSpec(spec, map);
    const here = new LocalGrader(spec, ctx);
    const there = new ThreadGrader({ spec, map });
    try {
      expect(await there.warm()).toBe(here.warmNow());
      let compared = 0;
      let graded = 0;
      let s = stateFromSpec(ctx, spec);
      for (let guard = 0; guard < 80 && s.outcome === PENDING && s.side === HUMAN; guard++) {
        const values = here.solver.actionValues(s);
        for (const { action } of values) {
          const proposal = proposalFor(ctx, s, action);
          const answer = here.assessNow(s, proposal);
          expect(await there.assess(s, proposal), JSON.stringify(proposal)).toEqual(answer);
          compared += 1;
          if (answer) graded += 1;
          if (action.kind === 'draft') {
            const post = applyHumanAction(here.solver.puzzle, s, action)[0].state;
            expect(await there.assessDraft(s, post)).toEqual(here.assessDraftNow(s, post));
          }
        }
        const branches = applyHumanAction(here.solver.puzzle, s, values[0].action);
        s = branches.reduce((m, b) => (b.p > m.p ? b : m), branches[0]).state;
      }
      expect(compared).toBeGreaterThan(10);
      expect(graded, 'a decision along the line').toBeGreaterThan(0);
    } finally {
      there.close();
    }
  }, 60_000);

  it('leaves this thread free while it warms a day', async () => {
    // A three-second warm-up here (the_border_states, 2 October).
    const { spec, map } = await servedDay('2026-10-02');
    const grader = new ThreadGrader({ spec, map });
    let last = Date.now();
    let longest = 0;
    const tick = setInterval(() => {
      const now = Date.now();
      longest = Math.max(longest, now - last);
      last = now;
    }, 25);
    const t0 = Date.now();
    let nodes: number | null;
    try {
      nodes = await grader.warm();
      // The stretch since the last tick: on a blocked thread no tick ever runs.
      longest = Math.max(longest, Date.now() - last);
    } finally {
      clearInterval(tick);
      grader.close();
    }
    const wall = Date.now() - t0;
    expect(nodes).toBeGreaterThan(100_000);
    // Warmed here, the whole warm-up would be one gap.
    expect(longest, `longest pause ${longest} ms in ${wall} ms`).toBeLessThan(1_000);
  }, 120_000);
});

/** A worker that answers only when the test makes it. */
class FakeWorker extends EventEmitter {
  readonly posted: Array<GraderQuery & { id: number }> = [];
  referenced = true;
  terminated = 0;
  postMessage(request: GraderQuery & { id: number }): void {
    this.posted.push(request);
  }
  ref(): void {
    this.referenced = true;
  }
  unref(): void {
    this.referenced = false;
  }
  async terminate(): Promise<number> {
    this.terminated += 1;
    return 0;
  }
  reply(reply: GraderReply): void {
    this.emit('message', reply);
  }
}

describe('play-time grader — when the thread fails', () => {
  // Nothing here reaches a solver but the fallback, which builds its own from a real day.
  const job = { spec: { title: 'Stand-in' } as DailyPuzzleSpec, map: {} as GameMap };
  const s = {} as PuzzleState;
  const move: PuzzleProposal = { kind: 'end_attack' };
  const graded = { best: { kind: 'end_attack' as const }, bestEquity: 0.75, equity: 0.5 };

  function start(timeoutMs?: number) {
    const workers: FakeWorker[] = [];
    const spawn = vi.fn(() => {
      const w = new FakeWorker();
      workers.push(w);
      return w as unknown as GraderWorker;
    });
    return { grader: new ThreadGrader(job, { spawn, timeoutMs }), spawn, workers };
  }

  afterEach(() => vi.restoreAllMocks());

  it('starts its worker at once, asks in order, and settles each grade by its id', async () => {
    const { grader, spawn, workers } = start();
    expect(spawn).toHaveBeenCalledTimes(1);
    const [w] = workers;
    expect(w.referenced, 'idle, the worker does not hold the process').toBe(false);
    const first = grader.assess(s, move);
    const second = grader.assessDraft(s, s);
    expect(w.posted.map((r) => [r.id, r.op])).toEqual([[1, 'assess'], [2, 'draft']]);
    expect(w.referenced, 'owed an answer, it does').toBe(true);
    w.reply({ id: 2, result: null });
    w.reply({ id: 1, result: graded });
    // A stray or repeated answer changes nothing.
    w.reply({ id: 1, result: null });
    w.reply({ id: 7, result: graded });
    expect(await first).toEqual(graded);
    expect(await second).toBeNull();
    expect(w.referenced).toBe(false);
    expect(w.terminated).toBe(0);
  });

  it('gives a grade up after its time, ungraded, and keeps the worker for the next', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { grader, spawn, workers } = start(20);
    const [w] = workers;
    expect(await grader.assess(s, move)).toBeNull();
    expect(String(warn.mock.calls[0]?.[0])).toContain('"Stand-in": a grade ran past 20 ms; the move goes ungraded');
    expect(w.referenced).toBe(false);
    // Its late answer changes nothing; the next query goes to the same worker.
    w.reply({ id: 1, result: graded });
    const next = grader.assess(s, move);
    w.reply({ id: 2, result: graded });
    expect(await next).toEqual(graded);
    expect(spawn).toHaveBeenCalledTimes(1);
    expect(w.terminated).toBe(0);
  });

  it('waits on the warm-up without a clock', async () => {
    const { grader, workers } = start(20);
    const [w] = workers;
    let nodes: number | null | undefined;
    const warming = grader.warm().then((n) => {
      nodes = n;
    });
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(nodes).toBeUndefined();
    w.reply({ id: 1, result: 474_281 });
    await warming;
    expect(nodes).toBe(474_281);
  });

  it('passes on an error the solver threw, and keeps the worker', async () => {
    const { grader, spawn, workers } = start();
    const [w] = workers;
    const failing = grader.assess(s, move);
    w.reply({ id: 1, error: 'Error: no such territory' });
    await expect(failing).rejects.toThrow('"Stand-in": the grade failed in its worker: Error: no such territory');
    const next = grader.assess(s, move);
    w.reply({ id: 2, result: graded });
    expect(await next).toEqual(graded);
    expect(spawn).toHaveBeenCalledTimes(1);
  });

  it('loses the pending grades with a worker that dies, and starts another for the next query', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { grader, spawn, workers } = start();
    const [w] = workers;
    const pending = [grader.assess(s, move), grader.warm()];
    w.emit('error', new Error('ERR_WORKER_OUT_OF_MEMORY'));
    w.emit('exit', 1);
    expect(await Promise.all(pending)).toEqual([null, null]);
    expect(error.mock.calls.map((c) => String(c[0]))).toEqual([
      expect.stringContaining('"Stand-in": the grader worker failed'),
      expect.stringContaining('"Stand-in": the grader worker stopped with code 1; 2 pending grade(s) go ungraded'),
    ]);
    const next = grader.assess(s, move);
    expect(spawn).toHaveBeenCalledTimes(2);
    workers[1].reply({ id: 3, result: graded });
    expect(await next).toEqual(graded);
  });

  it('grades on this thread when no worker can start', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { spec, map } = await servedDay('2026-10-27');
    const spawn = vi.fn((): GraderWorker => {
      throw new Error('no threads');
    });
    const grader = new ThreadGrader({ spec, map }, { spawn });
    expect(String(error.mock.calls[0]?.[0])).toContain(`"${spec.title}": the grader worker could not start; grading on the server thread`);
    const ctx = contextFromSpec(spec, map);
    const here = new LocalGrader(spec, ctx);
    const warmed = here.warmNow();
    const s0 = stateFromSpec(ctx, spec);
    const best = proposalFor(ctx, s0, here.solver.actionValues(s0)[0].action);
    expect(await grader.warm()).toBe(warmed);
    const answer = await grader.assess(s0, best);
    expect(answer, 'the opening is a decision').not.toBeNull();
    expect(answer).toEqual(here.assessNow(s0, best));
    expect(spawn).toHaveBeenCalledTimes(1);
  }, 60_000);

  it('once closed, answers what was pending with null, stops the worker and asks nothing more', async () => {
    const { grader, spawn, workers } = start();
    const [w] = workers;
    const pending = grader.assess(s, move);
    grader.close();
    expect(await pending).toBeNull();
    expect(w.terminated).toBe(1);
    w.emit('exit', 1);
    expect(await grader.assess(s, move)).toBeNull();
    expect(await grader.warm()).toBeNull();
    expect(spawn).toHaveBeenCalledTimes(1);
    expect(w.posted).toHaveLength(1);
  });
});
