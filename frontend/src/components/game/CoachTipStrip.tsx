import React from 'react';
import { isMobileViewport } from '../../utils/device';
import type { CoachTip } from '../../utils/coachTips';

/**
 * Coach tips (`coach_tips_enabled`, utils/coachTips.ts): the next thing to do,
 * in one line. A pill at the top of the map on a phone (under the top bar, so
 * the territory sheet and the bottom bar stay clear) and at the bottom of the
 * map on a desktop. It never covers more than its one line, and it leads with
 * the player's colour, which the old card never said. "Hide tips" turns tips
 * off for good.
 */
export default function CoachTipStrip({
  tip,
  playerColor,
  onHide,
}: {
  tip: CoachTip;
  playerColor?: string;
  onHide: () => void;
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
        data-testid="coach-tip-strip"
        data-tip={tip.id}
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
        <span className="text-xs text-bf-text leading-snug">{tip.text}</span>
        <button
          type="button"
          onClick={onHide}
          className="shrink-0 rounded-full px-2 py-1 text-[11px] text-bf-muted hover:text-bf-text underline-offset-2 hover:underline"
        >
          Hide tips
        </button>
      </div>
    </div>
  );
}
