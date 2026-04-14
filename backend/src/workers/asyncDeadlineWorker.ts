// ============================================================
// Async Deadline Worker — BullMQ-based persistent turn deadlines
// ============================================================
// For async games (12h / 24h / 72h turn limits), we schedule
// delayed BullMQ jobs backed by Redis. Unlike in-memory setTimeout,
// these survive server restarts and fire at the exact deadline.
// ============================================================

import { Queue, Worker } from 'bullmq';
import type { Job } from 'bullmq';
import { config } from '../config';

const QUEUE_NAME = 'async-deadlines';

export interface AsyncDeadlinePayload {
  gameId: string;
  turnNumber: number;
  playerIndex: number;
}

const connection = {
  host: config.redis.host,
  port: config.redis.port,
  password: config.redis.password,
};

// ── Queue (used by gameSocket to schedule / cancel jobs) ─────────────────────

export const asyncDeadlineQueue = new Queue<AsyncDeadlinePayload>(QUEUE_NAME, {
  connection,
  defaultJobOptions: {
    attempts: 1,
    removeOnComplete: true,
    removeOnFail: 100, // keep last 100 failed for debugging
  },
});

/**
 * Schedule a deadline job for the current turn of an async game.
 * Call this from startTurnTimer when async_mode is true.
 */
export async function scheduleAsyncDeadline(
  gameId: string,
  turnNumber: number,
  playerIndex: number,
  deadlineSeconds: number,
): Promise<void> {
  const jobId = `deadline:${gameId}:${turnNumber}`;
  const delayMs = deadlineSeconds * 1000;

  // Remove any stale job for this game+turn before scheduling
  try {
    const existing = await asyncDeadlineQueue.getJob(jobId);
    if (existing) await existing.remove();
  } catch {
    // Job may not exist — ignore
  }

  await asyncDeadlineQueue.add(
    'turn-deadline',
    { gameId, turnNumber, playerIndex },
    { jobId, delay: delayMs },
  );
}

/**
 * Cancel a pending deadline (e.g. player submitted their turn early).
 */
export async function cancelAsyncDeadline(gameId: string, turnNumber: number): Promise<void> {
  const jobId = `deadline:${gameId}:${turnNumber}`;
  try {
    const job = await asyncDeadlineQueue.getJob(jobId);
    if (job) await job.remove();
  } catch {
    // Job may already be processing or completed — ignore
  }
}

// ── Worker (processes deadline expirations) ──────────────────────────────────

// The actual processing logic is injected by gameSocket via setDeadlineProcessor()
// because the worker needs access to activeGames, broadcastState, etc.
let processorFn: ((job: Job<AsyncDeadlinePayload>) => Promise<void>) | null = null;

export function setDeadlineProcessor(fn: (job: Job<AsyncDeadlinePayload>) => Promise<void>): void {
  processorFn = fn;
}

let worker: Worker<AsyncDeadlinePayload> | null = null;

export function startAsyncDeadlineWorker(): void {
  worker = new Worker<AsyncDeadlinePayload>(
    QUEUE_NAME,
    async (job) => {
      if (!processorFn) {
        console.error('[AsyncDeadline] No processor registered; skipping job', job.id);
        return;
      }
      await processorFn(job);
    },
    {
      connection,
      concurrency: 1, // process one deadline at a time to avoid race conditions
    },
  );

  worker.on('completed', (job) => {
    console.log(`[AsyncDeadline] Deadline processed: ${job.id}`);
  });

  worker.on('failed', (job, err) => {
    console.error(`[AsyncDeadline] Deadline job failed: ${job?.id}`, err);
  });

  console.log('[AsyncDeadline] Worker started');
}

export async function stopAsyncDeadlineWorker(): Promise<void> {
  if (worker) {
    await worker.close();
    worker = null;
  }
  await asyncDeadlineQueue.close();
  console.log('[AsyncDeadline] Worker stopped');
}
