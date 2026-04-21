import type { GameMap, GameState } from '../../types';
import { evaluateBoard } from '../ai/aiBot';
import type { DailyPuzzleSpec } from './dailyPuzzleTypes';
import { PUZZLE_FEEDBACK_THRESHOLDS, type PuzzleFeedbackTier } from './dailyPuzzleTypes';

export interface PuzzleMoveFeedback {
  tier: PuzzleFeedbackTier;
  delta_eval: number;
  message: string;
}

export function computePuzzleMoveFeedback(
  stateBefore: GameState,
  stateAfter: GameState,
  map: GameMap,
  humanPlayerId: string,
  spec: DailyPuzzleSpec,
): PuzzleMoveFeedback | null {
  if (spec.archetype === 'domination') return null;

  const before = evaluateBoard(stateBefore, map, humanPlayerId);
  const after = evaluateBoard(stateAfter, map, humanPlayerId);
  const delta = after - before;

  let tier: PuzzleFeedbackTier = 'ok';
  if (delta >= PUZZLE_FEEDBACK_THRESHOLDS.strong) tier = 'strong';
  else if (delta <= PUZZLE_FEEDBACK_THRESHOLDS.risky) tier = 'risky';

  const messages: Record<PuzzleFeedbackTier, string> = {
    strong: 'Strong — your position improved meaningfully.',
    ok: 'Solid — acceptable tradeoff for the situation.',
    risky: 'Risky — consider reinforcing or a safer line next time.',
  };

  return { tier, delta_eval: delta, message: messages[tier] };
}
