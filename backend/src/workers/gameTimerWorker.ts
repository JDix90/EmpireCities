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

export async function scheduleTurnTimeout(gameId: string, delayMs: number): Promise<void> {
  const jobId = `turn-${gameId}`;
  try {
    const existing = await turnTimerQueue.getJob(jobId);
    if (existing) await existing.remove();
  } catch {
    // ignore
  }
  await turnTimerQueue.add('turn-expire', { gameId }, { jobId, delay: delayMs });
}

export async function cancelTurnTimeout(gameId: string): Promise<void> {
  const jobId = `turn-${gameId}`;
  try {
    const job = await turnTimerQueue.getJob(jobId);
    if (job) await job.remove();
  } catch {
    // ignore
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
