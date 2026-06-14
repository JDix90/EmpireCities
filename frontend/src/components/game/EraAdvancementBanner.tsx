import React from 'react';
import { Sparkles, X } from 'lucide-react';
import type { GameState, PlayerState } from '../../store/gameStore';
import { ERA_LABELS } from '../../constants/gameLobbyLabels';
import { getAdvanceEraClientStatus } from '../../utils/eraAdvancement';

interface EraAdvancementBannerProps {
  gameState: GameState;
  myPlayer: PlayerState | null | undefined;
}

/** In-map reminder that Era Advancement mode is on; dismissible per era. */
export default function EraAdvancementBanner({ gameState, myPlayer }: EraAdvancementBannerProps) {
  const status = getAdvanceEraClientStatus(gameState, myPlayer);
  const eraId = status?.currentEraId ?? null;
  // Dismiss hides the banner until the player reaches a NEW era (fresh, relevant
  // info), at which point it returns and can be dismissed again.
  const [dismissedEra, setDismissedEra] = React.useState<string | null>(null);
  React.useEffect(() => { setDismissedEra(null); }, [eraId]);

  if (!status || status.atMaxEra) return null;
  if (dismissedEra === status.currentEraId) return null;

  return (
    <div
      className="pointer-events-none absolute top-3 left-1/2 -translate-x-1/2 z-30 max-w-[min(92vw,520px)]"
      role="status"
      aria-live="polite"
    >
      <div className="pointer-events-auto flex items-center justify-center gap-2 pl-3 pr-1.5 py-2 rounded-lg border border-bf-gold/40 bg-bf-surface/95 backdrop-blur-sm shadow-lg text-xs sm:text-sm">
        <Sparkles className="w-4 h-4 text-bf-gold shrink-0" />
        <span className="text-bf-text">
          <span className="font-medium text-bf-gold">Era Advancement</span>
          {' · '}
          You are in {ERA_LABELS[status.currentEraId] ?? status.currentEraId}.
          {status.ready
            ? ' Requirements met — use Advance Era on your turn.'
            : ' Research tech, stabilize, and save gold to advance.'}
        </span>
        <button
          type="button"
          onClick={() => setDismissedEra(status.currentEraId)}
          aria-label="Dismiss"
          className="shrink-0 p-1 rounded text-bf-muted hover:text-bf-text hover:bg-white/10 transition-colors"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}
