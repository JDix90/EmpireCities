import React, { useId } from 'react';
import clsx from 'clsx';
import type { GameState } from '../../store/gameStore';
import {
  formatClock,
  phoneCountdownVisible,
  PHONE_COUNTDOWN_URGENT_SECONDS,
  useTurnCountdown,
} from '../../hooks/useTurnCountdown';

/** Whether the phone bar should count down at all: a live, timed game on the viewer's own turn. */
export function phoneCountdownApplies(gameState: GameState, myTurn: boolean, enabled: boolean): boolean {
  return enabled && myTurn && !gameState.settings.async_mode && !!gameState.settings.turn_timer_seconds;
}

/**
 * The phone bar's phase button ("Begin Attack →"), carrying the last minute of
 * a live turn's clock as its second line (`phone_turn_countdown_enabled`).
 *
 * The phone showed the clock only inside the ☰ menu: a player's turn ran out
 * with nothing on screen saying it would, and then "Time's up — 4 units
 * auto-placed". The button is only there on the player's own turn — the one
 * time the clock is theirs — and a second line takes no width from a bar that
 * has none to spare. Red for the last 15 seconds.
 *
 * The ticking digits are hidden from assistive tech so the button's name stays
 * its label; the time left is the button's description instead. Without a
 * countdown the button is exactly the one the bar always had.
 */
export function PhonePhaseButton({
  label,
  onClick,
  gameState,
  countdown,
  holdClock,
}: {
  label: string;
  onClick: () => void;
  gameState: GameState;
  /** From phoneCountdownApplies. */
  countdown: boolean;
  /** The first turn's clock is held while the game-start briefing is open. */
  holdClock: boolean;
}) {
  const secondsLeft = useTurnCountdown(countdown ? gameState : null, holdClock);
  const descriptionId = useId();
  const shown = countdown && phoneCountdownVisible(secondsLeft);
  const urgent = shown && secondsLeft <= PHONE_COUNTDOWN_URGENT_SECONDS;
  return (
    <>
      <button
        onClick={onClick}
        className={clsx('btn-primary text-xs px-3 py-2 min-h-[40px]', urgent && 'ring-2 ring-red-500')}
        aria-describedby={shown ? descriptionId : undefined}
      >
        {shown ? (
          // A column, so the clock is a second line under the label: the
          // button is a row, and beside the label it widened the button and
          // squeezed the bar's "N to place".
          <span className="flex flex-col items-center leading-tight">
            <span>{label}</span>
            <span
              aria-hidden="true"
              data-testid="phone-turn-countdown"
              data-urgent={urgent ? 'true' : undefined}
              className={clsx(
                'font-mono text-[10px] leading-none mt-0.5 tabular-nums',
                urgent ? 'text-red-800 font-bold' : 'text-bf-dark/80',
              )}
            >
              ⏱ {formatClock(secondsLeft)}
            </span>
          </span>
        ) : (
          label
        )}
      </button>
      {shown && (
        <span id={descriptionId} className="sr-only">
          {secondsLeft === 1 ? '1 second' : `${secondsLeft} seconds`} left in your turn
        </span>
      )}
    </>
  );
}

export default PhonePhaseButton;
