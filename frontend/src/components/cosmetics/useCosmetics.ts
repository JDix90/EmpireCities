import { useCallback, useEffect, useState } from 'react';
import type { PlayerCosmetics } from '@borderfall/shared';
import { useGameStore } from '../../store/gameStore';
import { useStoreV2Enabled } from '../../store/featureFlagsStore';
import { isLiteMode, subscribeUserPreferences } from '../../utils/userPreferences';

/**
 * What each player in the current game wears, by player id. Null with
 * store_v2_enabled off, even in a game that took cosmetics when it started,
 * so the flag works as a kill switch mid-match too.
 */
export function usePlayerCosmetics(): (playerId: string | null | undefined) => PlayerCosmetics | null {
  const enabled = useStoreV2Enabled();
  const players = useGameStore((s) => s.gameState?.players);
  return useCallback(
    (playerId) => {
      if (!enabled || !playerId) return null;
      return players?.find((p) => p.player_id === playerId)?.cosmetics ?? null;
    },
    [enabled, players],
  );
}

/**
 * Whether cosmetic effects (a turning frame, rocking or shimmering dice) may
 * move: not with "Reduced animations" (lite mode) on. The operating system's
 * reduce-motion setting stills them in CSS (index.css).
 */
export function useCosmeticMotion(): boolean {
  const [lite, setLite] = useState(isLiteMode);
  useEffect(() => subscribeUserPreferences(() => setLite(isLiteMode())), []);
  return !lite;
}
