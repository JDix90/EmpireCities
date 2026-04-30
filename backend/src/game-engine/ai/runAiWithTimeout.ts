import { Worker } from 'worker_threads';
import fs from 'fs';
import path from 'path';
import { computeAiTurn } from './aiBot';
import type { GameState, GameMap, AiDifficulty } from '../../types';
import type { AiAction } from './aiBot';

// Per-difficulty time budgets. Hard/expert are intentionally generous because
// they search depth-3/4 minimax trees — cutting them off at 2s starves them
// down to easy heuristics on big maps. The hard-cap is a safety net the
// outer Promise.race uses if inner cleanup leaks.
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
  difficulty: AiDifficulty
): Promise<AiAction[]> {
  const workerPath = path.join(__dirname, 'aiWorker.js');
  if (!fs.existsSync(workerPath)) {
    return computeAiTurn(state, map, difficulty);
  }

  const timeBudgetMs = TIME_BUDGET_BY_DIFFICULTY[difficulty] ?? 2_000;
  const hardCapMs = timeBudgetMs + HARD_CAP_PADDING_MS;

  const workerPromise = new Promise<AiAction[]>((resolve) => {
    let resolved = false;
    const settle = (actions: AiAction[]) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(fallback);
      void worker.terminate().catch(() => {});
      resolve(actions);
    };

    const worker = new Worker(workerPath, {
      workerData: { state, map, difficulty },
    });

    const fallback = setTimeout(() => {
      if (!resolved) {
        console.warn(`[AI] Time budget exceeded for ${difficulty}, using easy fallback`);
        settle(computeAiTurn(state, map, 'easy'));
      }
    }, timeBudgetMs);

    worker.on('message', (actions: AiAction[]) => settle(actions));

    worker.on('error', (err) => {
      if (!resolved) {
        console.error('[AI Worker] Error:', err);
        settle(computeAiTurn(state, map, 'easy'));
      }
    });

    // Silent-crash defense: if the worker thread exits (OOM, uncaught throw
    // that wasn't relayed to 'error', etc.) before emitting a result, we still
    // need to resolve so the game loop can proceed.
    worker.on('exit', (code) => {
      if (!resolved) {
        console.error(`[AI Worker] Exited with code ${code} before producing a result; falling back.`);
        settle(computeAiTurn(state, map, 'easy'));
      }
    });
  });

  const hardCap = new Promise<AiAction[]>((resolve) => {
    setTimeout(() => {
      console.error('[AI] Hard-cap safety net engaged — inner cleanup leaked. Running easy fallback.');
      resolve(computeAiTurn(state, map, 'easy'));
    }, hardCapMs);
  });

  return Promise.race([workerPromise, hardCap]);
}
