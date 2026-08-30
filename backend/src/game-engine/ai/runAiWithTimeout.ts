import { Worker } from 'worker_threads';
import fs from 'fs';
import path from 'path';
import { computeAiTurn } from './aiBot';
import { aiTurnLimiter } from './aiConcurrency';
import type { GameState, GameMap, AiDifficulty } from '../../types';
import type { AiAction, AiTurnOptions } from './aiBot';

// Per-difficulty time budgets. There is no tree search: computeAiTurn is a
// single-ply greedy planner (see aiBot), so these are generous ceilings, not
// measured needs — planning itself costs microseconds. What they actually bound
// is worker startup plus the structured-clone of state+map, which scales with
// map size (up to 500 territories). Hard/expert get more room because they also
// run the build/research ladders. Blowing the budget is not graceful: the
// fallback substitutes an 'easy' plan (2 attacks, no build/research), so any
// future search must check its own deadline rather than rely on the timeout.
// The hard-cap is a safety net the outer Promise.race uses if inner cleanup leaks.
const TIME_BUDGET_BY_DIFFICULTY: Record<AiDifficulty, number> = {
  tutorial: 750,
  easy: 1_000,
  medium: 1_500,
  hard: 3_000,
  expert: 5_000,
};
const HARD_CAP_PADDING_MS = 1_500;

/**
 * Runs AI planning off the Socket.io thread with a time budget.
 * Falls back to easy heuristic on timeout, worker error, or silent crash.
 * In dev (tsx) if aiWorker.js is missing, runs synchronously on this thread.
 *
 * Safety guarantees:
 *  - resolves exactly once (never hangs the game loop)
 *  - terminates the worker on any exit path
 *  - treats silent `exit` (non-zero code without an error) as a hard failure
 *  - outer `Promise.race` is a tripwire: if we ever hit it, something in the
 *    inner cleanup leaked — logged so it's visible in ops.
 */
export async function runAiWithTimeout(
  state: GameState,
  map: GameMap,
  difficulty: AiDifficulty,
  options?: AiTurnOptions
): Promise<AiAction[]> {
  const workerPath = path.join(__dirname, 'aiWorker.js');
  if (!fs.existsSync(workerPath)) {
    return computeAiTurn(state, map, difficulty, options);
  }

  // Bound global AI concurrency: acquire a slot BEFORE spawning the worker and
  // starting the time budget (so a turn isn't charged the wall-clock it spent
  // queued). Excess turns wait here instead of oversubscribing CPU during a
  // burst of solo-vs-AI games.
  const release = await aiTurnLimiter.acquire();
  try {
    return await runAiTurnInWorker(state, map, difficulty, workerPath, options);
  } finally {
    release();
  }
}

async function runAiTurnInWorker(
  state: GameState,
  map: GameMap,
  difficulty: AiDifficulty,
  workerPath: string,
  options?: AiTurnOptions,
): Promise<AiAction[]> {
  const timeBudgetMs = TIME_BUDGET_BY_DIFFICULTY[difficulty] ?? 2_000;
  const hardCapMs = timeBudgetMs + HARD_CAP_PADDING_MS;

  // Hold onto the soft-fallback timer so the hard-cap branch can clear it on
  // its way out — otherwise the timer keeps Node alive past the resolve and
  // shows up as a lingering handle in process-monitoring tools.
  let softFallbackTimer: NodeJS.Timeout | null = null;
  let workerRef: Worker | null = null;

  const workerPromise = new Promise<AiAction[]>((resolve) => {
    let resolved = false;
    const settle = (actions: AiAction[]) => {
      if (resolved) return;
      resolved = true;
      if (softFallbackTimer) clearTimeout(softFallbackTimer);
      softFallbackTimer = null;
      void worker.terminate().catch(() => {});
      resolve(actions);
    };

    const worker = new Worker(workerPath, {
      workerData: { state, map, difficulty, options },
    });
    workerRef = worker;

    softFallbackTimer = setTimeout(() => {
      if (!resolved) {
        console.warn(`[AI] Time budget exceeded for ${difficulty}, using easy fallback`);
        settle(computeAiTurn(state, map, 'easy', options));
      }
    }, timeBudgetMs);

    worker.on('message', (actions: AiAction[]) => settle(actions));

    worker.on('error', (err) => {
      if (!resolved) {
        console.error('[AI Worker] Error:', err);
        settle(computeAiTurn(state, map, 'easy', options));
      }
    });

    // Silent-crash defense: if the worker thread exits (OOM, uncaught throw
    // that wasn't relayed to 'error', etc.) before emitting a result, we still
    // need to resolve so the game loop can proceed.
    worker.on('exit', (code) => {
      if (!resolved) {
        console.error(`[AI Worker] Exited with code ${code} before producing a result; falling back.`);
        settle(computeAiTurn(state, map, 'easy', options));
      }
    });
  });

  // Hard-cap is a tripwire: if `workerPromise` hasn't settled in time we treat
  // the inner promise as leaked, force-clear its timers, and tear down the
  // worker. Without this cleanup the soft-fallback setTimeout and the orphaned
  // Worker could outlive their useful lifetime.
  let hardCapTimer: NodeJS.Timeout | null = null;
  const hardCap = new Promise<AiAction[]>((resolve) => {
    hardCapTimer = setTimeout(() => {
      console.error('[AI] Hard-cap safety net engaged — inner cleanup leaked. Running easy fallback.');
      if (softFallbackTimer) {
        clearTimeout(softFallbackTimer);
        softFallbackTimer = null;
      }
      if (workerRef) {
        void workerRef.terminate().catch(() => {});
      }
      resolve(computeAiTurn(state, map, 'easy', options));
    }, hardCapMs);
  });

  try {
    return await Promise.race([workerPromise, hardCap]);
  } finally {
    if (hardCapTimer) clearTimeout(hardCapTimer);
  }
}
