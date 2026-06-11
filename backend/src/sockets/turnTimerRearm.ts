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
