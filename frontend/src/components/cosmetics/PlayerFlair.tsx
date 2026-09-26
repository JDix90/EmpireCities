import React from 'react';
import { useStoreV2Enabled } from '../../store/featureFlagsStore';
import BannerTag from './BannerTag';
import FrameRing from './FrameRing';
import { usePlayerCosmetics } from './useCosmetics';

/**
 * A player's colour dot, ringed in their frame. With store_v2_enabled off it is
 * exactly the dot; on, every dot gets the ring's padding so rows stay aligned.
 */
export function FramedDot({ playerId, children }: { playerId: string; children: React.ReactElement }) {
  const enabled = useStoreV2Enabled();
  const cosmeticsOf = usePlayerCosmetics();
  if (!enabled) return children;
  return (
    <FrameRing frameId={cosmeticsOf(playerId)?.frame} className="p-0.5">
      {children}
    </FrameRing>
  );
}

/** The banner a player wears in this match, beside their name; nothing without one. */
export function PlayerBannerTag({ playerId, className }: { playerId: string | null | undefined; className?: string }) {
  const cosmeticsOf = usePlayerCosmetics();
  const banner = cosmeticsOf(playerId)?.banner;
  return banner ? <BannerTag bannerId={banner} className={className} /> : null;
}
