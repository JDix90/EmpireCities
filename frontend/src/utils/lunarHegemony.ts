/**
 * The Lunar Hegemony clock, phrased for the people who have to answer it
 * (Space Age Moon Race, Phase 3).
 *
 * Shown to EVERY player, not just the holder. A victory clock nobody can see is
 * a victory nobody can contest, and the whole phase rests on the clock being
 * breakable — one lunar tile taken anywhere resets it outright.
 */

import type { GameState } from '../store/gameStore';

/**
 * Own-turns of unbroken control the Hegemony needs. Mirrors `HEGEMONY_TURNS` in
 * `backend/src/game-engine/state/lunarHegemony.ts`, which is authoritative; this
 * copy only decides what the banner counts down from.
 */
export const HEGEMONY_TURNS = 7;

export interface HegemonyBanner {
  holderName: string;
  isMe: boolean;
  turnsRemaining: number;
}

export function hegemonyBanner(
  gameState: GameState | null | undefined,
  viewerId: string | null | undefined,
): HegemonyBanner | null {
  const clock = gameState?.lunar_hegemony;
  if (!gameState?.settings.space_age_moon_hegemony_enabled || !clock) return null;
  const holder = gameState.players.find((p) => p.player_id === clock.owner_id);
  return {
    holderName: holder?.username ?? 'Someone',
    isMe: !!viewerId && clock.owner_id === viewerId,
    turnsRemaining: Math.max(0, HEGEMONY_TURNS - clock.turns_held),
  };
}
