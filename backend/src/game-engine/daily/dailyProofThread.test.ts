import { describe, it, expect, vi, afterEach } from 'vitest';
import { EventEmitter } from 'events';
import { readFileSync } from 'fs';
import { join } from 'path';
import type { GameMap } from '../../types';
import type { ScheduledDay } from './dailySchedule';
import { proveOffThread, type ProofWorker } from './dailyProofThread';
import { candidateForDateV2, proveDayV2 } from './dailyScheduleV2';

/**
 * The proof worker (dailyProofThread.ts). The first block runs the real
 * worker thread, from source through tsx as dev does, and holds it to the
 * proof on this thread; the rest stand in a worker to drive each way a
 * thread can fail.
 */

/** The map of the set-piece a date serves, as the server loads it before the proof. */
function mapFor(date: string): GameMap {
  const sp = candidateForDateV2(date)!.set_piece;
  const mapId = sp.kind === 'domination' ? sp.spec.map_id : sp.map_id;
  return JSON.parse(readFileSync(join(__dirname, `../../../../database/maps/${mapId}.json`), 'utf-8')) as GameMap;
}

describe('daily proof worker — a real thread', () => {
  // Graded days that prove in milliseconds (calendar landings), and a refused one.
  const cases: Array<[string, string]> = [
    ['2026-10-13', 'a capture'],
    ['2026-10-07', 'a hold'],
    ['2026-10-10', 'a date the calendar refuses'],
  ];

  for (const [date, what] of cases) {
    it(`finds what this thread finds on ${what} (${date})`, async () => {
      const map = mapFor(date);
      const onThisThread = vi.fn(() => proveDayV2(date, map));
      const there = await proveOffThread(date, map, onThisThread);
      expect(onThisThread).not.toHaveBeenCalled();
      expect(there).toEqual(await proveDayV2(date, map));
    }, 60_000);
  }

  it('leaves this thread free while it solves', async () => {
    // A three-second solve here (the_border_states, 2 October).
    const date = '2026-10-02';
    const map = mapFor(date);
    let last = Date.now();
    let longest = 0;
    const tick = setInterval(() => {
      const now = Date.now();
      longest = Math.max(longest, now - last);
      last = now;
    }, 25);
    const t0 = Date.now();
    let day: ScheduledDay | null;
    try {
      day = await proveOffThread(date, map, () => proveDayV2(date, map));
      // The stretch since the last tick: on a blocked thread no tick ever runs.
      longest = Math.max(longest, Date.now() - last);
    } finally {
      clearInterval(tick);
    }
    const wall = Date.now() - t0;
    expect(day?.spec.v2, 'the day is graded').toBeDefined();
    // Solved here, the whole solve would be one gap.
    expect(longest, `longest pause ${longest} ms in ${wall} ms`).toBeLessThan(1_000);
  }, 120_000);
});

/** A worker that does nothing until the test makes it. */
class FakeWorker extends EventEmitter {
  terminated = 0;
  async terminate(): Promise<number> {
    this.terminated += 1;
    return 0;
  }
}

describe('daily proof worker — when the thread fails', () => {
  const date = '2026-10-13';
  const day = { date, source: 'library', spec: {} } as unknown as ScheduledDay;
  const here = { date, source: 'library', set_piece_id: 'here', spec: {} } as unknown as ScheduledDay;

  function run(worker: FakeWorker, timeoutMs?: number) {
    const onThisThread = vi.fn(async () => here);
    const result = proveOffThread(date, null, onThisThread, {
      spawn: () => worker as unknown as ProofWorker,
      timeoutMs,
    });
    return { onThisThread, result };
  }

  afterEach(() => vi.restoreAllMocks());

  it('takes the worker\'s day, once, and stops the worker', async () => {
    const worker = new FakeWorker();
    const { onThisThread, result } = run(worker);
    worker.emit('message', { day });
    worker.emit('exit', 0);
    worker.emit('message', { day: null });
    expect(await result).toBe(day);
    expect(onThisThread).not.toHaveBeenCalled();
    expect(worker.terminated).toBe(1);
  });

  it('proves on this thread when the worker errors or stops before answering', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    for (const fail of [(w: FakeWorker) => w.emit('error', new Error('boom')), (w: FakeWorker) => w.emit('exit', 1)]) {
      const worker = new FakeWorker();
      const { onThisThread, result } = run(worker);
      fail(worker);
      expect(await result).toBe(here);
      expect(onThisThread).toHaveBeenCalledTimes(1);
      expect(worker.terminated).toBe(1);
    }
    expect(error.mock.calls.map((c) => String(c[0]))).toEqual([
      expect.stringContaining(`${date}: the proof worker failed; proving on the server thread`),
      expect.stringContaining(`${date}: the proof worker stopped with code 1 before answering`),
    ]);
  });

  it('proves on this thread when the worker cannot start', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const onThisThread = vi.fn(async () => here);
    const result = proveOffThread(date, null, onThisThread, {
      spawn: () => {
        throw new Error('no threads');
      },
    });
    expect(await result).toBe(here);
    expect(onThisThread).toHaveBeenCalledTimes(1);
  });

  it('passes on an error the proof threw, without proving again', async () => {
    const worker = new FakeWorker();
    const { onThisThread, result } = run(worker);
    worker.emit('message', { error: 'Error: no such territory' });
    await expect(result).rejects.toThrow(`${date}: the proof failed in its worker: Error: no such territory`);
    expect(onThisThread).not.toHaveBeenCalled();
  });

  it('stops a proof that runs past its time and serves the date as v1', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const worker = new FakeWorker();
    const { onThisThread, result } = run(worker, 20);
    expect(await result).toBeNull();
    expect(worker.terminated).toBe(1);
    expect(onThisThread).not.toHaveBeenCalled();
    expect(String(error.mock.calls[0]?.[0])).toContain(`${date}: the proof ran past 0.02 s and was stopped; serving the v1 day`);
    // A late answer changes nothing.
    worker.emit('message', { day });
    worker.emit('exit', 1);
    expect(onThisThread).not.toHaveBeenCalled();
  });
});
