import React, { useLayoutEffect, useState } from 'react';
import { X } from 'lucide-react';

/** Set once a player has been shown where the Galactic Age's views are. */
export const GALAXY_VIEWS_TIP_KEY = 'cc-galaxy-views-tip';

const TIP_WIDTH = 288;
const MARGIN = 8;

interface GalaxyViewsTipProps {
  /**
   * The world tabs, as many as the layouts render: a phone has its strip
   * under the top bar, a desktop its tabs in the bar. The first one on
   * screen is the one pointed at.
   */
  anchors: Array<React.RefObject<HTMLElement>>;
  onDismiss: () => void;
}

interface Placement {
  top: number;
  left: number;
  /** The arrow's distance from the tip's left edge, under the tabs' middle. */
  arrow: number;
}

function place(anchors: GalaxyViewsTipProps['anchors']): Placement | null {
  const el = anchors.map((a) => a.current).find((a) => a && a.getBoundingClientRect().width > 0);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  const width = Math.min(TIP_WIDTH, window.innerWidth - MARGIN * 2);
  const centre = r.left + r.width / 2;
  const left = Math.min(Math.max(centre - width / 2, MARGIN), window.innerWidth - width - MARGIN);
  return { top: r.bottom + 10, left, arrow: Math.min(Math.max(centre - left, 16), width - 16) };
}

/**
 * Points at the Galactic Age's views (the galaxy chart and each world's map)
 * the first time a player is in the era. A playtester said they "didn't
 * immediately know how to switch to the world view": the tabs sit in the
 * top bar, and the only other mention is a line of small print under the
 * galaxy, or a double-tap nobody guesses. Shown once, after the start
 * briefing and the welcome have closed; it goes away on "Got it" or as soon
 * as the player switches view themselves.
 */
export default function GalaxyViewsTip({ anchors, onDismiss }: GalaxyViewsTipProps) {
  const [at, setAt] = useState<Placement | null>(null);

  useLayoutEffect(() => {
    const update = () => setAt(place(anchors));
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, [anchors]);

  if (!at) return null;
  return (
    <div
      role="dialog"
      aria-label="Switching views"
      data-testid="galaxy-views-tip"
      style={{ top: at.top, left: at.left, width: Math.min(TIP_WIDTH, window.innerWidth - MARGIN * 2) }}
      className="fixed z-40 rounded-xl border border-bf-gold/50 bg-bf-surface shadow-2xl p-3 text-sm animate-modal-in"
    >
      <span
        aria-hidden
        style={{ left: at.arrow - 6 }}
        className="absolute -top-1.5 w-3 h-3 rotate-45 bg-bf-surface border-l border-t border-bf-gold/50"
      />
      <div className="flex items-start justify-between gap-2">
        <p className="font-display text-bf-gold">Switch views here</p>
        <button type="button" onClick={onDismiss} aria-label="Close" className="tap-target -mt-1 -mr-1 text-bf-muted hover:text-bf-text">
          <X className="w-4 h-4" aria-hidden />
        </button>
      </div>
      <p className="mt-1 text-bf-muted leading-relaxed">
        Pick a world to play on its map up close, or Galaxy chart to see every world and the lanes between them.
      </p>
      <button
        type="button"
        onClick={onDismiss}
        className="mt-2 w-full py-2 rounded-lg bg-bf-gold/20 border border-bf-gold/30 text-bf-gold text-sm font-medium hover:bg-bf-gold/30 transition-colors"
      >
        Got it
      </button>
    </div>
  );
}
