/**
 * Real-time turn timer worker — BullMQ-backed (Phase 7).
 * Survives process restarts unlike in-memory setTimeout.
 */

import { Queue, Worker } from 'bullmq';
import type { Job } from 'bullmq';
import { config } from '../config';

const QUEUE_NAME = 'game-turn-timer';

export interface TurnTimerPayload {
  gameId: string;
  /**
   * The `phase_deadline_at` this job was armed for. The processor acts only
   * while the game still carries that deadline (see isTurnTimerJobCurrent).
   * Absent on jobs queued before jobs carried it.
   */
  deadlineAt?: number;
}

const connection = {
  host: config.redis.host,
  port: config.redis.port,
  password: config.redis.password,
};

export const turnTimerQueue = new Queue<TurnTimerPayload>(QUEUE_NAME, {
  connection,
  defaultJobOptions: {
    attempts: 1,
    removeOnComplete: true,
    removeOnFail: 50,
  },
});

let processorFn: ((job: Job<TurnTimerPayload>) => Promise<void>) | null = null;

export function setTurnTimerProcessor(fn: (job: Job<TurnTimerPayload>) => Promise<void>): void {
  processorFn = fn;
}

/**
 * One job per armed clock, named by its deadline.
 *
 * Every clock of a game used to share the id `turn-<gameId>`. The processor
 * arms the next phase's clock while its own job is still active, and BullMQ
 * neither removes an active job nor adds a job whose id already exists, so
 * that re-arm was dropped: a timed game stopped timing out after one expiry.
 */
export function turnTimerJobId(gameId: string, deadlineAt: number): string {
  return `turn-${gameId}-${deadlineAt}`;
}

export async function scheduleTurnTimeout(gameId: string, deadlineAt: number): Promise<void> {
  const jobId = turnTimerJobId(gameId, deadlineAt);
  try {
    const existing = await turnTimerQueue.getJob(jobId);
    if (existing) await existing.remove();
  } catch {
    // ignore
  }
  await turnTimerQueue.add(
    'turn-expire',
    { gameId, deadlineAt },
    { jobId, delay: Math.max(0, deadlineAt - Date.now()) },
  );
}

export async function cancelTurnTimeout(gameId: string, deadlineAt: number | null | undefined): Promise<void> {
  if (typeof deadlineAt !== 'number') return;
  try {
    const job = await turnTimerQueue.getJob(turnTimerJobId(gameId, deadlineAt));
    if (job) await job.remove();
  } catch {
    // An active job cannot be removed. It is still harmless: the processor
    // ignores a job whose deadline the game no longer carries.
  }
}

let worker: Worker<TurnTimerPayload> | null = null;

export function startTurnTimerWorker(): void {
  worker = new Worker<TurnTimerPayload>(
    QUEUE_NAME,
    async (job) => {
      if (!processorFn) {
        console.error('[TurnTimer] No processor registered; skipping job', job.id);
        return;
      }
      await processorFn(job);
    },
    { connection, concurrency: 2 },
  );

  worker.on('failed', (job, err) => {
    console.error('[TurnTimer] Job failed:', job?.id, err);
  });

  console.log('[TurnTimer] Worker started');
}

export async function stopTurnTimerWorker(): Promise<void> {
  if (worker) {
    await worker.close();
    worker = null;
  }
}
