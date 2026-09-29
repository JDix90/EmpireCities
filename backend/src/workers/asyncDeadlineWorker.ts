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
  /**
   * The `phase_deadline_at` this job was armed for. The processor acts only
   * while the game still carries that deadline (see isAsyncDeadlineJobCurrent).
   * Absent on jobs queued before jobs carried it.
   */
  deadlineAt?: number;
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
 * One job per armed deadline, named by it, as `turnTimerJobId` names the
 * real-time clock's.
 *
 * Every deadline of a turn used to share the id `deadline-<gameId>-<turn>`,
 * and the turn number holds for a whole round, and from a Territory Draft
 * into turn one. A lapse arms the next seat's deadline while its own job is
 * still active, and BullMQ neither removes an active job nor adds a job whose
 * id already exists, so that deadline could be dropped: the next seat's turn
 * never lapsed. A seat in the id would not be enough either, since turn one
 * can open on the seat whose last draft pick lapsed.
 */
export function asyncDeadlineJobId(gameId: string, deadlineAt: number): string {
  return `deadline-${gameId}-${deadlineAt}`;
}

/**
 * Schedule the deadline armed for the seat to move in an async game: the
 * game's `phase_deadline_at`. Called from startTurnTimer when async_mode is
 * true. `minDelayMs` holds off a deadline that has already passed.
 */
export async function scheduleAsyncDeadline(
  gameId: string,
  turnNumber: number,
  playerIndex: number,
  deadlineAt: number,
  opts: { minDelayMs?: number } = {},
): Promise<void> {
  const jobId = asyncDeadlineJobId(gameId, deadlineAt);

  // Replace a job already queued for this deadline.
  try {
    const existing = await asyncDeadlineQueue.getJob(jobId);
    if (existing) await existing.remove();
  } catch {
    // Job may not exist — ignore
  }

  await asyncDeadlineQueue.add(
    'turn-deadline',
    { gameId, turnNumber, playerIndex, deadlineAt },
    { jobId, delay: Math.max(opts.minDelayMs ?? 0, deadlineAt - Date.now()) },
  );
}

/**
 * Cancel the job for a deadline the game no longer runs (e.g. the player
 * ended their turn early).
 */
export async function cancelAsyncDeadline(gameId: string, deadlineAt: number | null | undefined): Promise<void> {
  if (typeof deadlineAt !== 'number') return;
  try {
    const job = await asyncDeadlineQueue.getJob(asyncDeadlineJobId(gameId, deadlineAt));
    if (job) await job.remove();
  } catch {
    // An active job cannot be removed. It is still harmless: the processor
    // ignores a job whose deadline the game no longer carries.
  }
}

// ── Worker (processes deadline expirations) ──────────────────────────────────

// The actual processing logic is injected by gameSocket via setDeadlineProcessor()
// The actual processing logic is injected by gameSocket via setDeadlineProcessor()
// because the worker needs access to broadcast/finalize helpers in gameSocket.
let processorFn: ((job: Job<AsyncDeadlinePayload>) => Promise<void>) | null = null;

/** Register the processor. Returns the one it replaced, so a test can restore it. */
export function setDeadlineProcessor(
  fn: (job: Job<AsyncDeadlinePayload>) => Promise<void>,
): ((job: Job<AsyncDeadlinePayload>) => Promise<void>) | null {
  const previous = processorFn;
  processorFn = fn;
  return previous;
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
