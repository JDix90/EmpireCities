import { useEffect, useState } from 'react';
import type { GameState } from '../store/gameStore';

/**
 * The turn clock, in whole seconds left, shared by the desktop HUD and the
 * phone's bottom bar so the two can never disagree.
 *
 * Prefers the server-authoritative deadline (one per turn, running on through
 * its phases) and recomputes from the clock each tick so the display can't
 * drift or go stale at 0:00.
 *
 * Null-vs-undefined matters: a server that KNOWS the timer is off right now
 * (AI turns, choice-event pauses) sends phase_deadline_at: null — show no clock
 * rather than a ghost countdown ticking toward a timeout that will never fire.
 * Only `undefined` (a pre-deadline server) falls back to turn_started_at math,
 * and then only on a human's turn.
 *
 * `hold`: the first turn's clock starts when the game-start briefing closes
 * (the server honours that ready signal however late on turn 1), so it holds at
 * the full turn while the briefing is open.
 */
export function turnClockDeadline(
  gameState: Pick<GameState, 'settings' | 'players' | 'current_player_index' | 'phase' | 'phase_deadline_at' | 'turn_started_at'> | null | undefined,
): number | null {
  if (!gameState?.settings.turn_timer_seconds) return null;
  const currentPlayer = gameState.players[gameState.current_player_index];
  if (gameState.phase === 'game_over' || currentPlayer?.is_ai || gameState.phase_deadline_at === null) return null;
  return gameState.phase_deadline_at ?? gameState.turn_started_at + gameState.settings.turn_timer_seconds * 1000;
}

export function secondsUntil(deadline: number, now: number): number {
  return Math.max(0, Math.ceil((deadline - now) / 1000));
}

export function useTurnCountdown(gameState: GameState | null | undefined, hold: boolean): number | null {
  const [timeLeft, setTimeLeft] = useState<number | null>(null);
  const deadline = turnClockDeadline(gameState);
  const timerSeconds = gameState?.settings.turn_timer_seconds;

  useEffect(() => {
    if (deadline === null) {
      setTimeLeft(null);
      return;
    }
    if (hold) {
      setTimeLeft(timerSeconds ?? null);
      return;
    }
    const compute = () => secondsUntil(deadline, Date.now());
    setTimeLeft(compute());
    const interval = setInterval(() => setTimeLeft(compute()), 1000);
    return () => clearInterval(interval);
  }, [deadline, hold, timerSeconds]);

  return timeLeft;
}

/** The phone bar shows the clock for the turn's last minute only, red for the last 15 seconds. */
export const PHONE_COUNTDOWN_FROM_SECONDS = 60;
export const PHONE_COUNTDOWN_URGENT_SECONDS = 15;

export function phoneCountdownVisible(secondsLeft: number | null): secondsLeft is number {
  return secondsLeft !== null && secondsLeft <= PHONE_COUNTDOWN_FROM_SECONDS;
}

export function formatClock(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}
