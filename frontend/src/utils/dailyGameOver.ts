import type { GameOverModalData } from '../components/game/ActionModal';

/** The server's read of a daily run, sent with `game:over` on a daily game. */
export interface DailyRunResult {
  won: boolean;
  outcome: 'solved' | 'unmet' | 'failed' | null;
}

/**
 * Who won, as the result screen should say it. On an objective day the
 * challenge decides, not the game: a player who takes the whole board before
 * meeting the goal won the game and lost the challenge, and the server scores
 * the run a loss. Reading the winner ids alone put "Victory!" over a run the
 * daily page records as a defeat.
 */
export function resolveGameOverResult(
  dailyResult: DailyRunResult | undefined,
  myId: string | undefined,
  winnerIds: string[],
  goal: unknown,
): Pick<GameOverModalData, 'isWinner' | 'daily_challenge'> {
  const outcome = dailyResult?.outcome ?? null;
  if (!dailyResult || !outcome) {
    return { isWinner: !!myId && winnerIds.includes(myId), daily_challenge: undefined };
  }
  return {
    isWinner: dailyResult.won,
    daily_challenge: { outcome, goal: typeof goal === 'string' && goal ? goal : undefined },
  };
}

/**
 * A daily served as v1 while grading is on (docs/DAILY_PUZZLE_V2.md §5.6):
 * Thursday, Sunday, or a set-piece without an opponent's plan. No decision
 * review is coming, and the result screen says why.
 */
export function isClassicDaily(
  settings: { daily_challenge_date?: unknown; daily_challenge_spec?: { v2?: unknown } | null } | null | undefined,
  gradingOn: boolean,
): boolean {
  return gradingOn && !!settings?.daily_challenge_date && !settings.daily_challenge_spec?.v2;
}
