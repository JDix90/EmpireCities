import { Worker } from 'worker_threads';
import fs from 'fs';
import path from 'path';
import { computeAiTurn } from './aiBot';
import type { GameState, GameMap, AiDifficulty } from '../../types';
import type { AiAction } from './aiBot';

const TIME_BUDGET_MS = 2000;

/**
 * Runs AI planning off the Socket.io thread with a time budget.
 * Falls back to easy heuristic on timeout or worker error.
 * In dev (tsx) if aiWorker.js is missing, runs synchronously on this thread.
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

  return new Promise((resolve) => {
    let resolved = false;

    const worker = new Worker(workerPath, {
      workerData: { state, map, difficulty },
    });

    const fallback = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        void worker.terminate().catch(() => {});
        console.warn(`[AI] Time budget exceeded for ${difficulty}, using easy fallback`);
        resolve(computeAiTurn(state, map, 'easy'));
      }
    }, TIME_BUDGET_MS);

    worker.on('message', (actions: AiAction[]) => {
      if (!resolved) {
        resolved = true;
        clearTimeout(fallback);
        void worker.terminate().catch(() => {});
        resolve(actions);
      }
    });

    worker.on('error', (err) => {
      if (!resolved) {
        resolved = true;
        clearTimeout(fallback);
        void worker.terminate().catch(() => {});
        console.error('[AI Worker] Error:', err);
        resolve(computeAiTurn(state, map, 'easy'));
      }
    });
  });
}
