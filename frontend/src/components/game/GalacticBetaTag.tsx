import React, { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';

/** What a player's first beta game adds to the Galactic Age welcome. */
export const GALACTIC_BETA_WELCOME_NOTE =
  'The Galactic Age is in beta: its rules and balance may change while we test and tune it. Tap BETA in the top bar any time to tell us what you think.';

interface GalacticBetaTagProps {
  /** When given, the panel offers "Send feedback" and this opens the form. */
  onSendFeedback?: () => void;
}

/**
 * The BETA tag a Galactic Age game carries in its top bar while the era is an
 * open beta (`galaxy_age_beta_enabled`). Tapping it says what that means;
 * nothing opens on its own mid-game. A player's first game says it once, in
 * the "Welcome to the Galactic Age" explainer, rather than in a pop-up of its
 * own stacked on the start briefing and that explainer.
 */
export default function GalacticBetaTag({ onSendFeedback }: GalacticBetaTagProps) {
  const [open, setOpen] = useState(false);
  // Under the tag: the top bar is one row on a phone but wraps to several on a
  // tablet, where a fixed offset left the panel over the map-view controls.
  const [top, setTop] = useState(48);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    const onPointer = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', onPointer);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerdown', onPointer);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="shrink-0">
      <button
        type="button"
        onClick={(e) => {
          setTop(Math.round(e.currentTarget.getBoundingClientRect().bottom) + 8);
          setOpen((o) => !o);
        }}
        aria-expanded={open}
        aria-label="Galactic Age beta: what this means"
        className="tap-target px-1.5 py-0.5 rounded border border-bf-gold/50 bg-bf-gold/10 text-bf-gold text-[10px] font-semibold tracking-wider hover:bg-bf-gold/20"
      >
        BETA
      </button>
      {open && (
        <div
          role="dialog"
          aria-label="Galactic Age beta"
          style={{ top }}
          className="fixed left-1/2 -translate-x-1/2 z-50 w-[min(22rem,calc(100vw-2rem))] rounded-xl border border-bf-gold/40 bg-bf-surface shadow-2xl p-4 text-sm"
        >
          <div className="flex items-start justify-between gap-3">
            <p className="font-display text-bf-gold">Galactic Age · Beta</p>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close"
              className="tap-target text-bf-muted hover:text-bf-text"
            >
              <X className="w-4 h-4" aria-hidden />
            </button>
          </div>
          <p className="mt-2 text-bf-muted leading-relaxed">
            You’re playing an early version of the Galactic Age. Its rules and balance may change between games
            while we test and tune it.
            {onSendFeedback && ' Tell us what works and what doesn’t: every note is read.'}
          </p>
          {onSendFeedback && (
            <button
              type="button"
              onClick={() => { setOpen(false); onSendFeedback(); }}
              className="btn-primary w-full mt-3 text-sm"
            >
              Send feedback
            </button>
          )}
        </div>
      )}
    </div>
  );
}
