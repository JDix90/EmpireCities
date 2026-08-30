import { parentPort, workerData } from 'worker_threads';
import { computeAiTurn } from './aiBot';
import type { AiTurnOptions } from './aiBot';
import type { GameState, GameMap, AiDifficulty } from '../../types';

const { state, map, difficulty, options } = workerData as {
  state: GameState;
  map: GameMap;
  difficulty: AiDifficulty;
  options?: AiTurnOptions;
};

const actions = computeAiTurn(state, map, difficulty, options);
parentPort?.postMessage(actions);
