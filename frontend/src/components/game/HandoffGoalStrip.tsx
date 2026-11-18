import React from 'react';
import { isMobileViewport } from '../../utils/device';

/**
 * The goal of the match the tutorial hands a player to
 * (`tutorial_handoff_enabled`, utils/tutorialHandoff.ts), in the one line that
 * stands in for "The battle begins". Where the coach tip strip sits (under the
 * top bar on a phone, at the bottom of the map on a desktop) and styled like
 * it, led by the player's colour. It shows until the player opens one of
 * their territories, when the tips take over; "Got it" closes it sooner, and
 * turns nothing off.
 */
export default function HandoffGoalStrip({
  text,
  playerColor,
  onClose,
}: {
  text: string;
  playerColor?: string;
  onClose: () => void;
}) {
  const phone = isMobileViewport();
  return (
    <div
      className={
        phone
          ? 'fixed inset-x-0 z-30 flex justify-center px-3 pointer-events-none top-[calc(env(safe-area-inset-top,0px)+3.25rem)]'
          : 'fixed inset-x-0 z-30 flex justify-center px-3 pointer-events-none bottom-6'
      }
    >
      <div
        role="status"
        aria-live="polite"
        data-testid="handoff-goal-strip"
        className="pointer-events-auto flex items-center gap-2 max-w-md rounded-full border border-bf-gold/40 bg-bf-surface/95 pl-3 pr-2 py-1.5 shadow-lg"
      >
        {playerColor && (
          <span
            className="w-2.5 h-2.5 rounded-full shrink-0 ring-1 ring-white/30"
            style={{ backgroundColor: playerColor }}
            title="Your colour"
            aria-hidden
          />
        )}
        <span className="text-xs text-bf-text leading-snug">{text}</span>
        <button
          type="button"
          onClick={onClose}
          className="shrink-0 rounded-full px-2 py-1 text-[11px] text-bf-muted hover:text-bf-text underline-offset-2 hover:underline"
        >
          Got it
        </button>
      </div>
    </div>
  );
}
