import { describe, it, expect } from 'vitest';
import type { GameState, PlayerState } from '../../types';
import { tickLunarHegemony, hegemonyTurnsRemaining, contestOpensMoonAccess } from './lunarHegemony';

/**
 * A hegemony clock must not run in a game that cannot be won by it.
 *
 * `checkVictory` only ever declares a win the game's victory list allows, but
 * the clock was gated on the SETTING alone. With the phase on and the condition
 * off — which is every Space Age game whose host picked their own victory
 * conditions, since the defaults only fill a blank list — the clock still
 * advanced, still broadcast, and still drew the HUD countdown for a victory that
 * could never be declared. A rival reading "Hegemony in 2" and spending three
 * turns going to break it was answering a threat that did not exist.
 */

function mkState(allowed: string[]): GameState {
  const moon = ['moon_a', 'moon_b', 'moon_c'];
  return {
    era: 'space_age',
    turn_number: 5,
    settings: {
      space_age_moon_hegemony_enabled: true,
      allowed_victory_conditions: allowed,
    },
    territories: Object.fromEntries(moon.map((id) => [id, {
      territory_id: id, owner_id: 'p1', unit_count: 3, buildings: [],
    }])),
    players: [{ player_id: 'p1' }, { player_id: 'p2' }] as unknown as PlayerState[],
  } as unknown as GameState;
}

describe('the clock runs only where the victory is allowed', () => {
  it('runs when lunar_hegemony is an allowed condition', () => {
    const state = mkState(['domination', 'lunar_hegemony']);
    const tick = tickLunarHegemony(state, 'p1');
    expect(tick.clock?.turns_held).toBe(1);
    expect(hegemonyTurnsRemaining(state)).toBe(6);
  });

  it('does NOT run when the host picked victory conditions without it', () => {
    // The bug: this is an ordinary Space Age create where the host chose
    // "domination only". Before the fix the clock started here and counted down
    // on a HUD banner toward a win checkVictory would never declare.
    const state = mkState(['domination']);
    const tick = tickLunarHegemony(state, 'p1');
    expect(tick.clock).toBeUndefined();
    expect(state.lunar_hegemony).toBeUndefined();
    expect(hegemonyTurnsRemaining(state)).toBeNull();
  });

  it('withdraws the contest rule with it', () => {
    // The contest rule exists to make the Hegemony breakable. With no Hegemony
    // to break there is nothing for it to make cheaper, and Moon access falls
    // back to the full four-tech ladder — today's behaviour for any game
    // without Phase 3.
    const withVictory = mkState(['domination', 'lunar_hegemony']);
    expect(contestOpensMoonAccess(withVictory, 'p2')).toBe(true);
    expect(contestOpensMoonAccess(mkState(['domination']), 'p2')).toBe(false);
  });

  it('still runs for a create that chose nothing, which the defaults fill', () => {
    // normalizeGameSettings resolves an empty list to the game's defaults, and
    // an orbit-gated create with no preference is given lunar_hegemony.
    const state = mkState(['domination', 'threshold', 'lunar_hegemony']);
    expect(tickLunarHegemony(state, 'p1').clock?.turns_held).toBe(1);
  });
});
