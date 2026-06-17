import os from 'os';

/**
 * Minimal FIFO async semaphore. `acquire()` resolves once a slot is free and
 * returns a one-shot `release`; callers MUST release (use try/finally).
 */
export class Semaphore {
  private active = 0;
  private readonly waiters: Array<() => void> = [];

  constructor(private readonly max: number) {}

  acquire(): Promise<() => void> {
    if (this.active < this.max) {
      this.active++;
      return Promise.resolve(this.makeRelease());
    }
    return new Promise<() => void>((resolve) => {
      this.waiters.push(() => {
        this.active++;
        resolve(this.makeRelease());
      });
    });
  }

  private makeRelease(): () => void {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.active--;
      const next = this.waiters.shift();
      if (next) next();
    };
  }

  /** For metrics: how many slots are in use right now. */
  get activeCount(): number {
    return this.active;
  }

  /** For metrics: how many turns are queued waiting for a slot. */
  get queuedCount(): number {
    return this.waiters.length;
  }
}

/**
 * Global cap on concurrent AI turn computations.
 *
 * Each AI turn spawns a worker THREAD running depth-3/4 minimax (see
 * runAiWithTimeout). With no cap, a burst of solo-vs-AI games (the default
 * new-player path) spins up hundreds of worker threads at once, oversubscribing
 * CPU, blowing AI time budgets, and stalling the main Socket.IO event loop —
 * which delays HUMAN broadcasts too. We bound concurrency to roughly the core
 * count (leave one core for the event loop); excess turns queue and run as slots
 * free. Tune with AI_MAX_CONCURRENCY.
 */
const DEFAULT_AI_CONCURRENCY = Math.max(1, (os.cpus()?.length ?? 2) - 1);
const AI_MAX_CONCURRENCY = Math.max(
  1,
  parseInt(process.env.AI_MAX_CONCURRENCY || String(DEFAULT_AI_CONCURRENCY), 10),
);

export const aiTurnLimiter = new Semaphore(AI_MAX_CONCURRENCY);
export const AI_MAX_CONCURRENCY_VALUE = AI_MAX_CONCURRENCY;
