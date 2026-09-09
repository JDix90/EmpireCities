import { useEffect, useState } from 'react';
import clsx from 'clsx';
import { ChevronDown, Moon } from 'lucide-react';
import {
  getMoonInsetCollapsed,
  setMoonInsetCollapsed,
  subscribeUserPreferences,
} from '../../utils/userPreferences';

/**
 * Chrome around the Moon inset: the framed box when open, a small pill when
 * minimized.
 *
 * The Space Age board is two worlds, so both renderers park a second map in the
 * corner of the first. On a phone that costs real screen area from turn one,
 * long before a player has the Space Program tech to go there — so it folds
 * away, and the choice sticks across games.
 *
 * Shared by the 2D map and the globe rather than duplicated, so the two views
 * cannot drift apart. They size the box differently (the 2D inset is pinned to
 * exact canvas pixels, the globe to a percentage), which is why sizing comes in
 * as `className`/`style` instead of being decided here. Both controls are
 * absolutely positioned over the box: the 2D canvas is a real sized element, so
 * anything taking vertical space in the flow would clip the far side of the Moon.
 *
 * `children` is mounted only while open. Each inset is a whole second renderer
 * (PixiJS or three.js), so hiding one with CSS would leave its render loop and
 * GPU context alive for a map nobody is looking at — the exact cost minimizing
 * is meant to avoid.
 */
export default function MoonInsetFrame({
  className,
  style,
  children,
}: {
  className?: string;
  style?: React.CSSProperties;
  children: React.ReactNode;
}) {
  // Subscribe here rather than relying on the host: the 2D map already watches
  // user preferences, but the globe inset's host does not, so without this the
  // button would write the preference and nothing would repaint.
  const [collapsed, setCollapsed] = useState(getMoonInsetCollapsed);
  useEffect(
    () => subscribeUserPreferences(() => setCollapsed(getMoonInsetCollapsed())),
    [],
  );

  if (collapsed) {
    return (
      <button
        type="button"
        onClick={() => setMoonInsetCollapsed(false)}
        data-testid="moon-inset-expand"
        aria-label="Show the Moon map"
        aria-expanded={false}
        className="absolute bottom-3 right-3 z-20 flex items-center gap-1.5 rounded-full border border-bf-border
                   bg-[rgb(20,22,32)]/95 px-3 py-2 min-h-[36px] text-[11px] text-bf-gold shadow-2xl
                   hover:bg-bf-border/40 transition-colors"
      >
        <Moon className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
        Moon
      </button>
    );
  }

  return (
    <div
      className={clsx(
        'absolute bottom-3 right-3 z-20 rounded-xl border border-bf-border bg-[rgb(20,22,32)] shadow-2xl overflow-hidden',
        className,
      )}
      style={style}
      data-testid="moon-inset"
    >
      <div className="absolute top-2 left-2 z-10 text-[11px] px-2 py-1 rounded bg-black/55 border border-bf-border/70 text-bf-gold pointer-events-none">
        Moon
      </div>
      <button
        type="button"
        onClick={() => setMoonInsetCollapsed(true)}
        data-testid="moon-inset-minimize"
        aria-label="Minimize the Moon map"
        aria-expanded
        className="absolute top-2 right-2 z-10 w-9 h-9 flex items-center justify-center rounded-lg
                   border border-bf-border/70 bg-black/55 text-bf-gold hover:bg-bf-border/50 transition-colors"
      >
        <ChevronDown className="w-4 h-4" aria-hidden="true" />
      </button>
      {children}
    </div>
  );
}
