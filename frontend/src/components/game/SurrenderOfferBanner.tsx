import React from 'react';
import { Flag, X } from 'lucide-react';

interface SurrenderOfferBannerProps {
  /** The server's offer for this viewer (GameState.surrender_offer). */
  offered: boolean;
  /** The round the offer stands in: "Play on" hides it until the next one. */
  turnNumber: number;
  /** Sit below the era-advancement banner, which takes the same spot. */
  belowEraBanner?: boolean;
  onAccept: () => void;
}

/**
 * The bots' surrender, offered on the player's own turn once they are clearly
 * winning a game against bots (backend victory/surrender.ts). Accepting ends
 * the game as a win; "Play on" hides the offer until the next round, when it
 * comes back if it still stands.
 */
export default function SurrenderOfferBanner({ offered, turnNumber, belowEraBanner, onAccept }: SurrenderOfferBannerProps) {
  const [dismissedTurn, setDismissedTurn] = React.useState<number | null>(null);
  const [accepting, setAccepting] = React.useState(false);
  // A new offer (a later round) can be accepted again.
  React.useEffect(() => { setAccepting(false); }, [turnNumber]);

  if (!offered || dismissedTurn === turnNumber) return null;

  return (
    <div
      className={`pointer-events-none absolute ${belowEraBanner ? 'top-14' : 'top-3'} left-1/2 -translate-x-1/2 z-30 max-w-[min(92vw,520px)]`}
      role="status"
      aria-live="polite"
    >
      <div className="pointer-events-auto flex items-center justify-center gap-2 pl-3 pr-1.5 py-2 rounded-lg border border-bf-gold/40 bg-bf-surface/95 backdrop-blur-sm shadow-lg text-xs sm:text-sm">
        <Flag className="w-4 h-4 text-bf-gold shrink-0" />
        <span className="text-bf-text">Your rivals offer their surrender.</span>
        <button
          type="button"
          disabled={accepting}
          onClick={() => {
            setAccepting(true);
            onAccept();
          }}
          className="shrink-0 px-2 py-1 rounded bg-bf-gold text-bf-dark font-medium hover:opacity-90 disabled:opacity-60 transition-opacity"
        >
          Accept and win
        </button>
        <button
          type="button"
          onClick={() => setDismissedTurn(turnNumber)}
          aria-label="Play on"
          title="Play on"
          className="shrink-0 p-1 rounded text-bf-muted hover:text-bf-text hover:bg-white/10 transition-colors"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}
