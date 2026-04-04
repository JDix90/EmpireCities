import { parentPort, workerData } from 'worker_threads';
import { computeAiTurn } from './aiBot';
import type { GameState, GameMap, AiDifficulty } from '../../types';

const { state, map, difficulty } = workerData as {
  state: GameState;
  map: GameMap;
  difficulty: AiDifficulty;
};

const actions = computeAiTurn(state, map, difficulty);
parentPort?.postMessage(actions);
