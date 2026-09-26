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

/**
 * The clock length THIS game runs on. A game may carry its own value in
 * `space_age_hegemony_turns` (§9 lists 4-8 as the range), and a banner counting
 * down from the wrong number is worse than no banner: it tells every rival they
 * have turns they do not have.
 */
export function hegemonyTurnsFor(settings: GameState['settings'] | null | undefined): number {
  const configured = settings?.space_age_hegemony_turns;
  return typeof configured === 'number' && configured > 0 ? configured : HEGEMONY_TURNS;
}

/**
 * The victory conditions this game allows, resolved the way the server's
 * `getAllowedVictoryConditions` resolves them: the list when it has entries,
 * nothing when it is deliberately empty, else the legacy single type.
 */
function allowedVictoryConditions(settings: GameState['settings']): string[] {
  const list = settings.allowed_victory_conditions;
  if (Array.isArray(list)) return list;
  return [settings.victory_type ?? 'domination'];
}

/**
 * Whether the Hegemony is live in this game: the phase is on AND the game can
 * actually be won that way. Mirrors `isLunarHegemonyEnabled` on the backend,
 * which gates the clock and the contest rule on exactly these two things. A
 * game created before the Hegemony joined the lobby's own victory list carries
 * the phase without the condition, and in that game neither rule runs.
 */
export function isLunarHegemonyInPlay(settings: GameState['settings'] | null | undefined): boolean {
  if (settings?.space_age_moon_hegemony_enabled !== true) return false;
  return allowedVictoryConditions(settings).includes('lunar_hegemony');
}

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
  // The victory list matters as well as the phase: the server leaves a clock
  // alone in a game that cannot be won that way, and counting it down would
  // send every rival to answer a threat that does not exist.
  if (!gameState || !isLunarHegemonyInPlay(gameState.settings) || !clock) return null;
  const holder = gameState.players.find((p) => p.player_id === clock.owner_id);
  return {
    holderName: holder?.username ?? 'Someone',
    isMe: !!viewerId && clock.owner_id === viewerId,
    turnsRemaining: Math.max(0, hegemonyTurnsFor(gameState.settings) - clock.turns_held),
  };
}
