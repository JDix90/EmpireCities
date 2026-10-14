import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useGameLoadingLabelEnabled } from '../../store/featureFlagsStore';
import { APP_NAME_NAV } from '../../constants/brand';

/** After this long the wait is a slow connection, and the screen says so. */
export const SLOW_LOAD_MS = 6_000;

/** Location state the tutorial passes on its way to the game page. */
export interface PracticeMatchState {
  practiceMatch?: boolean;
}

/**
 * Which labelled wait the route skeleton should show, or null for the plain
 * skeleton. `game_loading_label_enabled`: Play Free Now goes to /tutorial,
 * then /game/:id, and each page's code downloads first; on a phone line that
 * was 8 seconds of grey boxes and the wordmark.
 */
export function useGameLoadingKind(): 'practice' | 'match' | null {
  const enabled = useGameLoadingLabelEnabled();
  const location = useLocation();
  if (!enabled) return null;
  if (location.pathname.startsWith('/tutorial')) return 'practice';
  if (!location.pathname.startsWith('/game/')) return null;
  return (location.state as PracticeMatchState | null)?.practiceMatch ? 'practice' : 'match';
}

/** The route skeleton for a game on its way: what is loading, and that it is. */
export default function GameLoadingFallback({ practice }: { practice: boolean }) {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setSlow(true), SLOW_LOAD_MS);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div className="min-h-screen bg-bf-dark px-4 pt-safe-6 pb-safe-6 flex flex-col" data-testid="game-loading-fallback">
      <div className="h-12 bg-bf-surface border-b border-bf-border -mx-4 px-4 flex items-center">
        <p className="text-bf-gold/80 text-sm font-display tracking-widest">{APP_NAME_NAV}</p>
      </div>
      <div className="flex-1 flex flex-col items-center justify-center text-center gap-4" role="status" aria-live="polite">
        <p className="font-display text-xl sm:text-2xl text-bf-gold">
          {practice ? 'Setting up your practice match' : 'Setting up your match'}
        </p>
        <div className="w-56 max-w-[70vw] h-1.5 rounded-full bg-bf-border/60 overflow-hidden" aria-hidden>
          <div className="h-full w-1/3 rounded-full bg-bf-gold/80 animate-loading-slide" />
        </div>
        <p className="text-bf-muted text-sm max-w-xs">
          {slow
            ? 'Still loading the board. A slow connection can take a few more seconds.'
            : 'Loading the board and your opponents.'}
        </p>
      </div>
    </div>
  );
}
