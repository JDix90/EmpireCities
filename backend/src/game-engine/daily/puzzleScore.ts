/**
 * The daily puzzle score.
 *
 * Before par, the score was 1000 minus a penalty per risky move, so every
 * winner of a capture day tied on 1000 and the turn count broke ties. With par
 * the score says how a run compares to the obvious line: solve a turn under
 * par and you are ahead of it, a turn over and you are behind. Risky moves
 * still cost. The leaderboard already sorts won, then score, then turns.
 */
export const PAR_BASE = 1000;
export const PAR_STEP = 50;
export const PAR_CEILING = 1250;
export const MISTAKE_PENALTY = 12;

export interface DailyScoreInput {
  won: boolean;
  /** state.turn_number when the game ended. */
  turns: number;
  /** The day's par, when it has one. */
  par?: number | null;
  mistakes: number;
}

export function computeDailyPuzzleScore(input: DailyScoreInput): number {
  const base =
    input.won && typeof input.par === 'number' && Number.isFinite(input.par)
      ? PAR_BASE + PAR_STEP * (input.par - input.turns)
      : PAR_BASE;
  return Math.max(0, Math.min(PAR_CEILING, base) - MISTAKE_PENALTY * Math.max(0, input.mistakes));
}
