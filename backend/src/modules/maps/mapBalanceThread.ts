/**
 * Playing a map's balance report off the server's thread.
 *
 * A report is several bot games — seconds of planning and dice — and the
 * server runs every live game on one thread, so played there every game
 * would stand still until it ended. The games run in a worker thread
 * (mapBalanceWorker.ts) on the map the route already loaded; the server
 * keeps serving while it waits. A worker that cannot start, dies, or runs
 * past the timeout is an error to the caller, never a run on this thread:
 * a balance report is a convenience, a live game is not.
 */
import { Worker } from 'worker_threads';
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import type { GameMap } from '../../types';
import type { BalanceSimOptions, BalanceSimReport } from './mapBalanceSim';

/** Well past the deadline the options carry; only a hang reaches it. */
export const BALANCE_TIMEOUT_MS = 60_000;

export type BalanceOutcome = { report: BalanceSimReport } | { error: string };

export type BalanceWorker = Pick<Worker, 'on' | 'terminate'>;
export type SpawnBalanceWorker = (job: { map: GameMap; options: BalanceSimOptions }) => BalanceWorker;

/**
 * The build's compiled worker; from source (dev under tsx, and the tests),
 * the .ts entry through tsx's CommonJS hook, which a worker does not inherit.
 */
export const spawnBalanceWorker: SpawnBalanceWorker = (workerData) => {
  const built = path.join(__dirname, 'mapBalanceWorker.js');
  if (fs.existsSync(built)) return new Worker(built, { workerData });
  const tsx = createRequire(__filename).resolve('tsx/cjs');
  const source = path.join(__dirname, 'mapBalanceWorker.ts');
  return new Worker(`require(${JSON.stringify(tsx)});\nrequire(${JSON.stringify(source)});`, { eval: true, workerData });
};

export function simulateBalanceOffThread(
  map: GameMap,
  options: BalanceSimOptions,
  { spawn = spawnBalanceWorker, timeoutMs = BALANCE_TIMEOUT_MS }: { spawn?: SpawnBalanceWorker; timeoutMs?: number } = {},
): Promise<BalanceSimReport> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let worker: BalanceWorker;
    try {
      worker = spawn({ map, options });
    } catch (err) {
      reject(err instanceof Error ? err : new Error(String(err)));
      return;
    }
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      void worker.terminate();
      fn();
    };
    const timer = setTimeout(
      () => finish(() => reject(new Error(`balance simulation exceeded ${timeoutMs} ms`))),
      timeoutMs,
    );
    worker.on('message', (outcome: BalanceOutcome) => {
      if ('report' in outcome) finish(() => resolve(outcome.report));
      else finish(() => reject(new Error(outcome.error)));
    });
    worker.on('error', (err) => finish(() => reject(err)));
    worker.on('exit', (code) => {
      if (!settled) finish(() => reject(new Error(`balance worker exited with code ${code} before answering`)));
    });
  });
}
