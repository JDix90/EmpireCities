/**
 * Proving a v2 day off the server's thread (docs/DAILY_PUZZLE_V2.md §5.3).
 *
 * Serving a graded day costs one solve, seconds on the hardest days, and the
 * server runs every live game on one thread: solved there, every game stands
 * still until the solve ends. Here the solve runs in a worker thread
 * (dailyProofWorker.ts) on the map the server already loaded, and the server
 * keeps serving while it waits. The worker runs the same code on the same
 * inputs, so it finds the same day.
 *
 * When the worker cannot do the job, failing to start or dying before it
 * answers, the proof runs on this thread as it always did: every game pauses
 * for it, but the day is served. An error the proof itself throws is passed
 * on as it would be here, without a second solve. A proof still running after
 * PROOF_TIMEOUT_MS is stopped and the date served as v1: a hang must hold
 * neither the read path nor this thread.
 */
import { Worker } from 'worker_threads';
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import type { GameMap } from '../../types';
import type { ScheduledDay } from './dailySchedule';

/** Far past the slowest full proof measured, about 80 s: only a hang reaches it. */
export const PROOF_TIMEOUT_MS = 5 * 60_000;

/** What the worker posts back: the day the proof found (null to serve v1), or the error it threw. */
export type ProofOutcome = { day: ScheduledDay | null } | { error: string };

/** The part of a Worker used here, so a test can stand one in. */
export type ProofWorker = Pick<Worker, 'on' | 'terminate'>;

export type SpawnProofWorker = (job: { date: string; map: GameMap | null }) => ProofWorker;

/**
 * The build's compiled worker; from source (dev under tsx, and the tests),
 * the .ts entry through tsx's CommonJS hook, which a worker does not inherit.
 */
export const spawnProofWorker: SpawnProofWorker = (workerData) => {
  const built = path.join(__dirname, 'dailyProofWorker.js');
  if (fs.existsSync(built)) return new Worker(built, { workerData });
  const tsx = createRequire(__filename).resolve('tsx/cjs');
  const source = path.join(__dirname, 'dailyProofWorker.ts');
  return new Worker(`require(${JSON.stringify(tsx)});\nrequire(${JSON.stringify(source)});`, { eval: true, workerData });
};

/**
 * Prove `date` on `map` in a worker thread. `onThisThread` is the same proof
 * run here, for when the worker cannot run it.
 */
export function proveOffThread(
  date: string,
  map: GameMap | null,
  onThisThread: () => Promise<ScheduledDay | null>,
  { spawn = spawnProofWorker, timeoutMs = PROOF_TIMEOUT_MS }: { spawn?: SpawnProofWorker; timeoutMs?: number } = {},
): Promise<ScheduledDay | null> {
  return new Promise((resolve, reject) => {
    const proveHere = (why: string, err?: unknown) => {
      console.error(`[daily v2] ${date}: the proof worker ${why}; proving on the server thread.`, err ?? '');
      onThisThread().then(resolve, reject);
    };
    let worker: ProofWorker;
    try {
      worker = spawn({ date, map });
    } catch (err) {
      proveHere('could not start', err);
      return;
    }
    let settled = false;
    // Only ever called from the worker's events and the timer below, after both exist.
    const settle = (then: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      void worker.terminate().catch(() => {});
      then();
    };
    const timer = setTimeout(() => settle(() => {
      console.error(`[daily v2] ${date}: the proof ran past ${timeoutMs / 1000} s and was stopped; serving the v1 day.`);
      resolve(null);
    }), timeoutMs);
    worker.on('message', (outcome: ProofOutcome) => settle(() => {
      if ('error' in outcome) reject(new Error(`[daily v2] ${date}: the proof failed in its worker: ${outcome.error}`));
      else resolve(outcome.day);
    }));
    worker.on('error', (err: Error) => settle(() => proveHere('failed', err)));
    worker.on('exit', (code: number) => settle(() => proveHere(`stopped with code ${code} before answering`)));
  });
}
