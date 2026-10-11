/**
 * The worker thread that proves a v2 day (dailyProofThread.ts): it gets the
 * date and the set-piece's map, which the server loaded, and posts back what
 * the proof finds, the day or null to serve v1, or the error it threw.
 */
import { parentPort, workerData } from 'worker_threads';
import type { GameMap } from '../../types';
import type { ProofOutcome } from './dailyProofThread';
import { proveDayV2 } from './dailyScheduleV2';

const { date, map } = workerData as { date: string; map: GameMap | null };

proveDayV2(date, map).then(
  (day) => parentPort?.postMessage({ day } satisfies ProofOutcome),
  (err: unknown) => parentPort?.postMessage({ error: err instanceof Error ? err.stack ?? err.message : String(err) } satisfies ProofOutcome),
);
