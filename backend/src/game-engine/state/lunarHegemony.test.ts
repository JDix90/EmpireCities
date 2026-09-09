import { describe, it, expect } from 'vitest';
import type { GameMap, GameState, PlayerState } from '../../types';
import { advanceToNextPlayer, checkVictory } from './gameStateManager';
import {
  HEGEMONY_TURNS,
  contestOpensMoonAccess,
  hasCompletedHegemony,
  hegemonyTurnsRemaining,
  soleMoonHolder,
  tickLunarHegemony,
} from './lunarHegemony';
import { getOrbitAccessResult } from './moonAccess';

/**
 * The Moon's own victory. Two rules carry it, and most of what follows pins
 * them: the clock RESETS rather than pauses when a single tile is lost, and
 * contesting an occupied Moon costs far less than discovering it did.
 */

const MOON_IDS = [
  'moon_polar_north', 'moon_polar_south', 'moon_mare_imbrium',
  'moon_mare_tranquillitatis', 'moon_oceanus_procellarum', 'moon_near_side_north',
  'moon_near_side_south', 'moon_far_side_north', 'moon_far_side_south',
];

function mkState(moonOwner: string | null, over: {
  earth?: Array<{ id: string; owner: string | null }>;
  enabled?: boolean;
  turn?: number;
  players?: Array<Partial<PlayerState> & { player_id: string }>;
} = {}): GameState {
  const territories: Record<string, unknown> = {};
  for (const id of MOON_IDS) {
    territories[id] = {
      territory_id: id, owner_id: moonOwner, unit_count: 3, unit_type: 'infantry',
      buildings: [], region_id: 'lunar_surface', globe_id: 'moon',
    };
  }
  for (const e of over.earth ?? [{ id: 'na_launch_base', owner: 'p1' }, { id: 'euro_spaceport', owner: 'p2' }]) {
    territories[e.id] = {
      territory_id: e.id, owner_id: e.owner, unit_count: 3, unit_type: 'infantry',
      buildings: [], region_id: 'north_america_2100', globe_id: 'earth',
    };
  }
  const players = (over.players ?? [{ player_id: 'p1' }, { player_id: 'p2' }]).map((p) => ({
    cards: [], is_eliminated: false, unlocked_techs: [], ability_uses: {},
    territory_count: Object.values(territories).filter((t) => (t as { owner_id: string }).owner_id === p.player_id).length,
    ...p,
  }));
  return {
    era: 'space_age',
    phase: 'fortify',
    turn_number: over.turn ?? 5,
    current_player_index: 0,
    diplomacy: [],
    settings: {
      space_age_moon_hegemony_enabled: over.enabled !== false,
      allowed_victory_conditions: ['domination', 'lunar_hegemony'],
      victory_type: 'domination',
    },
    territories,
    players,
  } as unknown as GameState;
}

const MAP = { territories: [], connections: [], worlds: [], regions: [] } as unknown as GameMap;

/** Run the clock forward by N of the holder's own turns. */
function holdFor(state: GameState, playerId: string, turns: number): void {
  for (let i = 0; i < turns; i++) tickLunarHegemony(state, playerId);
}

describe('who holds the Moon', () => {
  it('needs every tile, not most of them', () => {
    const state = mkState('p1');
    expect(soleMoonHolder(state)).toBe('p1');
    state.territories.moon_far_side_south.owner_id = 'p2';
    expect(soleMoonHolder(state)).toBeNull();
  });

  it('counts a neutral tile as nobody holding the Moon', () => {
    const state = mkState('p1');
    state.territories.moon_polar_south.owner_id = null;
    expect(soleMoonHolder(state)).toBeNull();
  });

  it('finds no hegemon on a board with no Moon', () => {
    const state = mkState(null, { earth: [{ id: 'na_launch_base', owner: 'p1' }] });
    for (const id of MOON_IDS) delete state.territories[id];
    expect(soleMoonHolder(state)).toBeNull();
  });
});

describe('the clock', () => {
  it('starts when a player ends a turn holding all nine', () => {
    const state = mkState('p1');
    const tick = tickLunarHegemony(state, 'p1');
    expect(tick.clock).toMatchObject({ owner_id: 'p1', turns_held: 1 });
    expect(hegemonyTurnsRemaining(state)).toBe(HEGEMONY_TURNS - 1);
  });

  it('advances only on the holder\'s own turns', () => {
    const state = mkState('p1');
    tickLunarHegemony(state, 'p1');
    tickLunarHegemony(state, 'p2');
    tickLunarHegemony(state, 'p2');
    expect(state.lunar_hegemony?.turns_held).toBe(1);
  });

  it('completes after the full count and wins the game', () => {
    const state = mkState('p1');
    holdFor(state, 'p1', HEGEMONY_TURNS);
    expect(hasCompletedHegemony(state, 'p1')).toBe(true);
    expect(checkVictory(state, MAP)).toEqual({ winnerIds: ['p1'], condition: 'lunar_hegemony' });
  });

  it('does not win one turn early', () => {
    const state = mkState('p1');
    holdFor(state, 'p1', HEGEMONY_TURNS - 1);
    expect(hasCompletedHegemony(state, 'p1')).toBe(false);
    expect(checkVictory(state, MAP)).toBeNull();
  });

  it('RESETS on losing a single tile — it does not pause', () => {
    // The rule the whole phase rests on. Five turns of perfect holding are
    // worth nothing the moment one lander touches down.
    const state = mkState('p1');
    holdFor(state, 'p1', HEGEMONY_TURNS - 1);
    state.territories.moon_far_side_south.owner_id = 'p2';
    const tick = tickLunarHegemony(state, 'p1');
    expect(tick.reset).toBe(true);
    expect(state.lunar_hegemony).toBeUndefined();

    // And retaking it starts from one, not from where it left off.
    state.territories.moon_far_side_south.owner_id = 'p1';
    tickLunarHegemony(state, 'p1');
    expect(state.lunar_hegemony?.turns_held).toBe(1);
  });

  it('breaks between turns too, so an event card cannot be held past', () => {
    // The round-end sweep passes no player: it may break a clock, never advance
    // one.
    const state = mkState('p1');
    holdFor(state, 'p1', 3);
    state.territories.moon_polar_north.owner_id = null; // an event flipped it
    const sweep = tickLunarHegemony(state, null);
    expect(sweep.reset).toBe(true);
    expect(state.lunar_hegemony).toBeUndefined();
  });

  it('never advances on the round-end sweep', () => {
    const state = mkState('p1');
    holdFor(state, 'p1', 2);
    tickLunarHegemony(state, null);
    tickLunarHegemony(state, null);
    expect(state.lunar_hegemony?.turns_held).toBe(2);
  });

  it('hands a conqueror a fresh clock rather than the previous holder\'s', () => {
    const state = mkState('p1');
    holdFor(state, 'p1', HEGEMONY_TURNS - 1);
    for (const id of MOON_IDS) state.territories[id].owner_id = 'p2';
    tickLunarHegemony(state, 'p2');
    expect(state.lunar_hegemony).toMatchObject({ owner_id: 'p2', turns_held: 1 });
  });

  it('does nothing at all while the phase is off', () => {
    const state = mkState('p1', { enabled: false });
    holdFor(state, 'p1', HEGEMONY_TURNS + 2);
    expect(state.lunar_hegemony).toBeUndefined();
    expect(hasCompletedHegemony(state, 'p1')).toBe(false);
  });

  it('is not offered as a victory unless the game allows it', () => {
    const state = mkState('p1');
    state.settings.allowed_victory_conditions = ['domination'];
    holdFor(state, 'p1', HEGEMONY_TURNS);
    expect(checkVictory(state, MAP)).toBeNull();
  });
});

describe('the clock ticks on the real turn boundary', () => {
  it('advances through advanceToNextPlayer, not just when called directly', () => {
    // The wiring, not the rule: a clock that only moved in tests would never
    // complete in a game.
    const state = mkState('p1');
    for (let i = 0; i < HEGEMONY_TURNS * 2; i++) advanceToNextPlayer(state, MAP);
    expect(state.lunar_hegemony?.owner_id).toBe('p1');
    expect(state.lunar_hegemony!.turns_held).toBeGreaterThanOrEqual(HEGEMONY_TURNS);
  });
});

describe('the contest rule', () => {
  const contestState = (moonOwner: string | null) => {
    const state = mkState(moonOwner, {
      players: [
        { player_id: 'p1' },
        { player_id: 'p2', unlocked_techs: ['sa_launch_pad_tech'] },
      ],
    });
    state.territories.euro_spaceport.buildings = ['launch_pad'];
    return state;
  };

  it('opens once somebody else holds lunar ground', () => {
    expect(contestOpensMoonAccess(contestState('p1'), 'p2')).toBe(true);
  });

  it('stays shut while the Moon is empty', () => {
    expect(contestOpensMoonAccess(contestState(null), 'p2')).toBe(false);
  });

  it('is not opened by your own holding', () => {
    expect(contestOpensMoonAccess(contestState('p2'), 'p2')).toBe(false);
  });

  it('lets a rival fly on Launch Pad tech and a pad alone', () => {
    // The full ladder is four techs and two builds. Contesting is two techs and
    // one build — the first lander earns a head start, not a fortress.
    const state = contestState('p1');
    const p2 = state.players[1];
    expect(p2.unlocked_techs).not.toContain('sa_lunar_expansion');
    expect(p2.space_station_launched).toBeFalsy();
    expect(getOrbitAccessResult(state, p2, MAP, 'space_age').allowed).toBe(true);
  });

  it('still asks for the pad', () => {
    const state = contestState('p1');
    state.territories.euro_spaceport.buildings = [];
    const res = getOrbitAccessResult(state, state.players[1], MAP, 'space_age');
    expect(res.allowed).toBe(false);
    expect(res.missing).toContain('Launch Pad building');
  });

  it('leaves the full ladder in place while the Moon is unclaimed', () => {
    const state = contestState(null);
    const res = getOrbitAccessResult(state, state.players[1], MAP, 'space_age');
    expect(res.allowed).toBe(false);
    expect(res.missing).toContain('Lunar Expansion tech');
  });

  it('does not cheapen access while the phase is off', () => {
    const state = contestState('p1');
    state.settings.space_age_moon_hegemony_enabled = false;
    const res = getOrbitAccessResult(state, state.players[1], MAP, 'space_age');
    expect(res.allowed).toBe(false);
    expect(res.missing).toContain('Lunar Expansion tech');
  });

  it('never takes access away from someone who already has it', () => {
    const state = contestState('p1');
    const p1 = state.players[0];
    p1.faction_id = 'lunar_pioneers';
    expect(getOrbitAccessResult(state, p1, MAP, 'space_age').allowed).toBe(true);
  });
});
