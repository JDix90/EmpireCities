import { Worker } from 'worker_threads';
import fs from 'fs';
import path from 'path';
import { computeAiTurn } from './aiBot';
import type { GameState, GameMap, AiDifficulty } from '../../types';
import type { AiAction } from './aiBot';

const TIME_BUDGET_MS = 2000;
// Outer-layer hard cap. If the worker's own timeout fires but cleanup hangs,
// or the worker exits silently without emitting 'error' or 'message', this
// safety net guarantees the caller gets a result and the game never stalls.
const HARD_CAP_MS = TIME_BUDGET_MS + 1500;

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
    }, TIME_BUDGET_MS);

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
    }, HARD_CAP_MS);
  });

  return Promise.race([workerPromise, hardCap]);
}
