import { parentPort, workerData } from 'worker_threads';
import { computeAiTurn } from './aiBot';
import type { AiTurnOptions } from './aiBot';
import type { GameState, GameMap } from '../../types';
import type { AiLevel } from './aiProfiles';

const { state, map, difficulty, options } = workerData as {
  state: GameState;
  map: GameMap;
  difficulty: AiLevel;
  options?: AiTurnOptions;
};

const actions = computeAiTurn(state, map, difficulty, options);
parentPort?.postMessage(actions);
