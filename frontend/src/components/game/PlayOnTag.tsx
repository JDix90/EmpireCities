import React, { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';

interface PlayOnTagProps {
  /** Who won the game this continues, as the viewer reads it ("You", or names). */
  winnerLabel: string;
  /** The round it was won in. */
  wonTurn: number;
}

/**
 * The tag a play-on game carries in its top bar (play_on_enabled): the table
 * kept playing a won game for total domination. Tapping it says what that
 * means; it opens nothing on its own.
 */
export default function PlayOnTag({ winnerLabel, wonTurn }: PlayOnTagProps) {
  const [open, setOpen] = useState(false);
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
        aria-label="Playing on: what this means"
        className="tap-target whitespace-nowrap px-1.5 py-0.5 rounded border border-bf-gold/50 bg-bf-gold/10 text-bf-gold text-[10px] font-semibold tracking-wider hover:bg-bf-gold/20"
      >
        PLAY ON
      </button>
      {open && (
        <div
          role="dialog"
          aria-label="Playing on"
          style={{ top }}
          className="fixed left-1/2 -translate-x-1/2 z-50 w-[min(22rem,calc(100vw-2rem))] rounded-xl border border-bf-gold/40 bg-bf-surface shadow-2xl p-4 text-sm"
        >
          <div className="flex items-start justify-between gap-3">
            <p className="font-display text-bf-gold">Playing on</p>
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
            {`${winnerLabel} won this game on turn ${wonTurn}, and the table chose to keep playing. Now only total domination ends it: take every territory, or be the last one standing. It’s unranked and pays nothing, and the win stands.`}
          </p>
        </div>
      )}
    </div>
  );
}
