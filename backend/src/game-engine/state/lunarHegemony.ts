/**
 * Lunar Hegemony — the Space Age Moon Race, Phase 3.
 *
 * The Moon's own victory: hold all nine lunar tiles at the end of your turn for
 * six consecutive own-turns and you win, however Earth stands. It exists so the
 * era has an ending that is not the 54-tile Earth grind, and so the Moon is
 * worth rushing rather than worth visiting.
 *
 * Two rules keep it a race rather than a coronation, and the package fails
 * without either:
 *
 * - **The clock resets the moment a single lunar tile leaves the holder.**
 *   Not decays, not pauses — resets. Six turns of holding all nine is a long
 *   time to be perfect, and one landing anywhere on the Moon starts it over.
 * - **Contesting is cheaper than discovering** (`contestOpensMoonAccess`).
 *   Once anybody holds lunar ground, everyone else's access requirement drops
 *   to Launch Pad tech plus a Launch Pad: two techs and one build against the
 *   four techs and two builds the first lander paid. The first player earns a
 *   head start, not a fortress.
 *
 * See docs/space-age-moon/README.md §5.
 */

import type { GameState, PlayerState, TerritoryState } from '../../types';
import { isLunarTerritory } from './helium3';

/**
 * Consecutive own-turns holding the whole Moon that win the game.
 *
 * SEVEN, not the six §5.1 specified. The sweep (5 replicates × 60 games per
 * value, with the Phase 2 tier on, which is how §10.2 ships the package) put 7
 * ahead of 6 on every criterion the gate names:
 *
 *   clock 6 → hegemony 15.0% · clocks broken 68% · Moon leader won 59.6% · decisive 71.7%
 *   clock 7 → hegemony 10.7% · clocks broken 77% · Moon leader won 51.6% · decisive 78.3%
 *   clock 8 → hegemony  9.7% · clocks broken 76% · Moon leader won 53.1% · decisive 71.3%
 *
 * Six sat the Moon-holder win share at 59.6% against §4.5's own 60% ceiling,
 * with a replicate at 69%. Seven pulls that to 51.6% — BELOW the tier-only
 * control — while making games more decisive and shorter, because the extra
 * turn is one more chance for a rival to go and break the clock.
 *
 * A game can carry its own value in `settings.space_age_hegemony_turns`; §9
 * lists 4–8 as the range. A Phase-3-only game (the tier off) wants 5, which is
 * what clears the 10% fire-rate floor without the tier's Moon pressure behind
 * it. Read the value through `hegemonyTurnsFor`, never this constant directly.
 */
export const HEGEMONY_TURNS = 7;

/** The clock length this game runs on. */
export function hegemonyTurnsFor(state: GameState): number {
  const configured = state.settings.space_age_hegemony_turns;
  return typeof configured === 'number' && configured > 0 ? configured : HEGEMONY_TURNS;
}

/**
 * Whether Phase 3's rules are live. Unlike the Phase 2 tier this does NOT
 * require the Helium-3 economy: the Hegemony is about holding ground, and it
 * prices nothing in He-3.
 */
export function isLunarHegemonyEnabled(state: GameState): boolean {
  // Optional chaining because this is now reached from `getOrbitAccessResult`,
  // which is called with partial states (fixtures, and the client-side hint
  // path) that carry territories but no settings.
  return state?.settings?.space_age_moon_hegemony_enabled === true;
}

/** Every lunar tile on the board. */
export function lunarTerritories(state: GameState): TerritoryState[] {
  return Object.values(state?.territories ?? {}).filter(isLunarTerritory);
}

/**
 * The player holding every lunar tile, or null when the Moon is shared, empty,
 * or partly neutral. A board with no Moon at all has no hegemon.
 */
export function soleMoonHolder(state: GameState): string | null {
  const tiles = lunarTerritories(state);
  if (tiles.length === 0) return null;
  const owner = tiles[0].owner_id;
  if (!owner) return null;
  return tiles.every((t) => t.owner_id === owner) ? owner : null;
}

export interface HegemonyTick {
  /** The clock as it stands after this tick. */
  clock: GameState['lunar_hegemony'];
  /** True when this tick completed the clock — the caller declares the victory. */
  completed: boolean;
  /** True when this tick broke a clock that had been running. */
  reset: boolean;
  /** The player whose clock was broken, when one was. */
  resetOwner?: string;
}

/**
 * Advance, start, or break the clock. Called at the END of a player's turn —
 * the design's "hold at the end of your turn" — and again once per round so an
 * event card that flips a tile between turns cannot be held past its effect.
 *
 * `playerId` is whose turn just ended, or null for the round-end sweep: the
 * sweep can only ever BREAK a clock, never advance one, because advancing is
 * what an own-turn is for.
 */
export function tickLunarHegemony(state: GameState, playerId: string | null): HegemonyTick {
  if (!isLunarHegemonyEnabled(state)) {
    return { clock: state.lunar_hegemony, completed: false, reset: false };
  }

  const holder = soleMoonHolder(state);
  const clock = state.lunar_hegemony;

  // Nobody holds the whole Moon: any running clock is broken outright.
  if (!holder) {
    if (clock) {
      state.lunar_hegemony = undefined;
      return { clock: undefined, completed: false, reset: true, resetOwner: clock.owner_id };
    }
    return { clock: undefined, completed: false, reset: false };
  }

  // Someone else took it over. Their clock starts from zero on their own turn,
  // not from whatever the previous holder had banked.
  if (clock && clock.owner_id !== holder) {
    state.lunar_hegemony = undefined;
    const broken: HegemonyTick = { clock: undefined, completed: false, reset: true, resetOwner: clock.owner_id };
    if (playerId !== holder) return broken;
    state.lunar_hegemony = { owner_id: holder, turns_held: 1, started_turn: state.turn_number };
    return { ...broken, clock: state.lunar_hegemony };
  }

  // The round-end sweep never advances a clock; it only breaks one, which the
  // branches above have already handled.
  if (playerId !== holder) {
    return { clock: state.lunar_hegemony, completed: false, reset: false };
  }

  if (!clock) {
    state.lunar_hegemony = { owner_id: holder, turns_held: 1, started_turn: state.turn_number };
    return { clock: state.lunar_hegemony, completed: hegemonyTurnsFor(state) <= 1, reset: false };
  }

  clock.turns_held += 1;
  return { clock, completed: clock.turns_held >= hegemonyTurnsFor(state), reset: false };
}

/** Whether this player's clock has run its course. */
export function hasCompletedHegemony(state: GameState, playerId: string): boolean {
  if (!isLunarHegemonyEnabled(state)) return false;
  const clock = state.lunar_hegemony;
  return !!clock && clock.owner_id === playerId && clock.turns_held >= hegemonyTurnsFor(state);
}

/** Own-turns the holder still needs. Null when no clock is running. */
export function hegemonyTurnsRemaining(state: GameState): number | null {
  const clock = state.lunar_hegemony;
  if (!clock || !isLunarHegemonyEnabled(state)) return null;
  return Math.max(0, hegemonyTurnsFor(state) - clock.turns_held);
}

/*
 * There is deliberately no `clearHegemonyForEliminated`. Elimination means
 * holding no territory at all, so an eliminated player cannot be the sole Moon
 * holder — the next tick sees a different holder (or none) and breaks the clock
 * on its own. `checkVictory` also only ever iterates active players, so a stale
 * clock could not win a game for a dead player even if one survived.
 */

/**
 * The contest rule — "the race is over, the war begins".
 *
 * True when somebody already holds lunar ground, which is what drops everyone
 * else's Moon access to Launch Pad tech plus a Launch Pad. This is the rule that
 * makes the whole package safe: without it, the cost to CONTEST an occupied
 * Moon equals the cost to DISCOVER it, and any Moon-based victory becomes
 * first-to-Moon-wins.
 *
 * Deliberately triggered by ONE tile rather than by the clock: waiting for a
 * hegemony to start would mean the counterplay arrives after the threat, and a
 * rival still needs turns to research, build and fly.
 */
export function contestOpensMoonAccess(state: GameState, playerId: string): boolean {
  if (!isLunarHegemonyEnabled(state)) return false;
  return lunarTerritories(state).some((t) => t.owner_id != null && t.owner_id !== playerId);
}

/**
 * The reduced Moon-access requirement while the Moon is contested: the tech
 * that unlocks the pad, and a pad to fly from. The pad already opens its own
 * lane to the nearest landing zone (`syncLaunchPadLanes`), so no authored
 * spaceport is needed either.
 */
export function contestAccessMissing(state: GameState, player: PlayerState): string[] {
  const missing: string[] = [];
  if (!(player.unlocked_techs?.includes('sa_launch_pad_tech') ?? false)) {
    missing.push('Launch Pad tech');
  }
  const hasLaunchPad = Object.values(state.territories).some(
    (t) => t.owner_id === player.player_id && (t.buildings?.includes('launch_pad') ?? false),
  );
  if (!hasLaunchPad) missing.push('Launch Pad building');
  return missing;
}
