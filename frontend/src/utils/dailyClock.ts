/**
 * The in-game clock for a daily with a turn limit: "Turn 4 of 5".
 *
 * The intro modal says "Turn limit: 5" once and the game header says only
 * "Turn 4", so a player who closed the modal had no way to know that turn 5
 * was the last one. The server fails the day once `turn_number` passes
 * `max_turns` (puzzleObjective.isPuzzleTimedOut), so the last playable turn
 * is `max_turns` itself.
 *
 * Null when the day has no clock to run out of: a domination day plays to
 * conquest and is never timed out, and a day without `max_turns` has nothing
 * to count. On a hold day the clock is the win, and the label says so.
 */
export interface DailyClockSpec {
  archetype?: string;
  max_turns?: number;
}

export function dailyClockLabel(
  spec: DailyClockSpec | null | undefined,
  turnNumber: number | null | undefined,
): string | null {
  if (!spec || spec.archetype === 'domination') return null;
  const max = spec.max_turns;
  if (typeof max !== 'number' || !Number.isFinite(max) || max <= 0) return null;
  const turn = typeof turnNumber === 'number' && Number.isFinite(turnNumber)
    ? Math.max(1, Math.floor(turnNumber))
    : 1;
  // The server ends the day before a turn past the clock is played, so a
  // number beyond it is a stale frame, not a seventh turn of five.
  const shown = Math.min(turn, max);
  const base = `Turn ${shown} of ${max}`;
  if (spec.archetype === 'hold_territory') return `${base} \u00b7 hold to the end`;
  return shown >= max ? `${base} \u00b7 last turn` : base;
}
