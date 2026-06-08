import React from 'react';
import { Sparkles } from 'lucide-react';
import type { GameState, PlayerState } from '../../store/gameStore';
import { ERA_LABELS } from '../../constants/gameLobbyLabels';
import { getAdvanceEraClientStatus } from '../../utils/eraAdvancement';

interface EraAdvancementBannerProps {
  gameState: GameState;
  myPlayer: PlayerState | null | undefined;
}

/** Persistent in-map reminder that Era Advancement mode is on. */
export default function EraAdvancementBanner({ gameState, myPlayer }: EraAdvancementBannerProps) {
  const status = getAdvanceEraClientStatus(gameState, myPlayer);
  if (!status || status.atMaxEra) return null;

  return (
    <div
      className="pointer-events-none absolute top-3 left-1/2 -translate-x-1/2 z-30 max-w-[min(92vw,520px)]"
      role="status"
      aria-live="polite"
    >
      <div className="flex items-center justify-center gap-2 px-3 py-2 rounded-lg border border-bf-gold/40 bg-bf-surface/95 backdrop-blur-sm shadow-lg text-xs sm:text-sm">
        <Sparkles className="w-4 h-4 text-bf-gold shrink-0" />
        <span className="text-bf-text">
          <span className="font-medium text-bf-gold">Era Advancement</span>
          {' · '}
          You are in {ERA_LABELS[status.currentEraId] ?? status.currentEraId}.
          {status.ready
            ? ' Requirements met — use Advance Era on your turn.'
            : ' Research tech, stabilize, and save gold to advance.'}
        </span>
      </div>
    </div>
  );
}
