/**
 * Decides whether a (re)joining player's game needs its real-time turn
 * timeout re-armed. An eviction race or process restart can cancel the
 * BullMQ job while clients keep an armed `phase_deadline_at` — the HUD
 * clock then dies at 0:00 and the phase never advances.
 *
 * Rules:
 * - Only real-time games with a positive timer, mid-game, on a human's turn.
 * - A deadline still in the future is KEPT (schedule the remaining time):
 *   reconnecting must never grant extra clock, or disconnect/rejoin becomes
 *   a stalling exploit.
 * - A missing or expired deadline gets a fresh full timer — the fair option
 *   after the server demonstrably lost track of the turn.
 */

export type TimerRearmDecision =
  | { kind: 'none' }
  | { kind: 'remaining'; delayMs: number }
  | { kind: 'fresh' };

export function decideTurnTimerRearm(opts: {
  hasScheduledJob: boolean;
  phase: string;
  asyncMode: boolean;
  turnTimerSeconds: number | null | undefined;
  currentPlayerIsAi: boolean;
  deadlineAt: number | null | undefined;
  now: number;
}): TimerRearmDecision {
  if (opts.hasScheduledJob) return { kind: 'none' };
  if (opts.asyncMode) return { kind: 'none' };
  if (!opts.turnTimerSeconds || opts.turnTimerSeconds <= 0) return { kind: 'none' };
  if (opts.phase === 'game_over') return { kind: 'none' };
  if (opts.currentPlayerIsAi) return { kind: 'none' };

  const deadline = opts.deadlineAt;
  // Keep >1s margin: re-scheduling a nearly-expired deadline as "remaining"
  // would fire the timeout before the broadcast even lands.
  if (typeof deadline === 'number' && deadline > opts.now + 1_000) {
    return { kind: 'remaining', delayMs: deadline - opts.now };
  }
  return { kind: 'fresh' };
}

/**
 * Whether a fired turn-timer job still speaks for the game's armed clock.
 *
 * A job carries the `phase_deadline_at` it was armed for, and every re-arm or
 * clear changes that field. A job for any other deadline is stale: it fired
 * while the player's own end-turn held the room lock, or it could not be
 * removed because it was already running. Acting on it would time out a phase
 * the game has since moved on to — the next player's draft, say.
 */
export function isTurnTimerJobCurrent(opts: {
  jobDeadlineAt: number | undefined;
  armedDeadlineAt: number | null | undefined;
  now: number;
}): boolean {
  if (typeof opts.jobDeadlineAt === 'number') return opts.jobDeadlineAt === opts.armedDeadlineAt;
  // A job queued before jobs carried their deadline: act only once the armed
  // deadline has passed, so it cannot cut short a clock armed after it.
  return typeof opts.armedDeadlineAt === 'number' && opts.armedDeadlineAt <= opts.now + 1_000;
}

/**
 * Whether a fired async deadline job still speaks for the seat to move.
 *
 * The turn and seat it was armed for must still be the game's. Past that, a
 * job carries the `phase_deadline_at` it was armed for, and while the game
 * carries a deadline the two must match. A job for any other deadline is
 * stale: its seat ended the turn while it waited on the room lock, or it could
 * not be removed because it was already running. Turn and seat alone would let
 * it act again, because a seat can move twice under one turn number: the
 * Territory Draft's picks and turn one all run as turn 1.
 *
 * A game with no deadline on record leaves it to the turn and seat, as before.
 * The join restore rebuilds such a turn's job from the deadline stored in
 * Postgres.
 */
export function isAsyncDeadlineJobCurrent(opts: {
  job: { turnNumber: number; playerIndex: number; deadlineAt?: number };
  turnNumber: number;
  playerIndex: number;
  armedDeadlineAt: number | null | undefined;
  now: number;
}): boolean {
  if (opts.job.turnNumber !== opts.turnNumber || opts.job.playerIndex !== opts.playerIndex) return false;
  if (typeof opts.armedDeadlineAt !== 'number') return true;
  if (typeof opts.job.deadlineAt === 'number') return opts.job.deadlineAt === opts.armedDeadlineAt;
  // A job queued before jobs carried their deadline: act only once the armed
  // deadline has passed, so it cannot cut short a deadline armed after it.
  return opts.armedDeadlineAt <= opts.now + 1_000;
}
