/**
 * The worker thread that plays a map's balance report (mapBalanceThread.ts):
 * it gets the map and the options and posts back the report, or the error.
 */
import { parentPort, workerData } from 'worker_threads';
import type { GameMap } from '../../types';
import { simulateMapBalance, type BalanceSimOptions } from './mapBalanceSim';
import type { BalanceOutcome } from './mapBalanceThread';

const { map, options } = workerData as { map: GameMap; options: BalanceSimOptions };

simulateMapBalance(map, options).then(
  (report) => parentPort?.postMessage({ report } satisfies BalanceOutcome),
  (err: unknown) => parentPort?.postMessage({ error: err instanceof Error ? err.stack ?? err.message : String(err) } satisfies BalanceOutcome),
);
