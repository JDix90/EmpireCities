import { describe, it, expect } from 'vitest';
import type { GameMap, GameState, PlayerState } from '../../types';
import { executeTechAbility } from './executeTechAbility';
import {
  areMoonPowersEnabled,
  checkMoonPowerRequirement,
  hasMoonGroundAccess,
  moonPowerGate,
} from './moonPowers';

/**
 * The Space Age gated tier. Two things have to hold at once: with the phase off
 * the game is byte-for-byte what it is today, and with it on the Moon is a
 * position that can be lost mid-turn rather than a credential you keep.
 */

type Seed = { id: string; owner?: string | null; units?: number; moon?: boolean };

function mkState(seeds: Seed[], settings: Partial<GameState['settings']> = {}): GameState {
  const territories = Object.fromEntries(
    seeds.map((s) => [
      s.id,
      {
        territory_id: s.id,
        owner_id: s.owner ?? null,
        unit_count: s.units ?? 3,
        buildings: [],
        region_id: s.moon ? 'lunar_surface' : 'north_america_2100',
        globe_id: s.moon ? 'moon' : 'earth',
      },
    ]),
  );
  return {
    era: 'space_age',
    phase: 'attack',
    settings: {
      space_age_moon_helium3_enabled: true,
      space_age_moon_gated_tier_enabled: true,
      tech_trees_enabled: true,
      ...settings,
    },
    territories,
    players: [
      { player_id: 'p1', helium3: 20, tech_points: 0, unlocked_techs: ['sa_dyson_array'] },
      { player_id: 'p2', helium3: 0, tech_points: 0, unlocked_techs: [] },
    ] as unknown as PlayerState[],
  } as unknown as GameState;
}

const MAP = { territories: [], connections: [] } as unknown as GameMap;

const MOON_TILES: Seed[] = [
  { id: 'moon_polar_north', owner: 'p1', moon: true },
  { id: 'moon_mare_imbrium', owner: 'p1', moon: true },
  { id: 'moon_near_side_north', owner: 'p1', moon: true },
];

const EARTH: Seed[] = [
  { id: 'na_launch_base', owner: 'p1', units: 4 },
  { id: 'euro_spaceport', owner: 'p2', units: 9 },
];

describe('the phase switch', () => {
  it('needs Phase 1, because the powers are priced in a resource Phase 1 creates', () => {
    // Enabling the tier alone would not gate dyson_beam behind the Moon — it
    // would take it out of the game, since no He-3 could ever be earned.
    const noEconomy = mkState([...EARTH, ...MOON_TILES], {
      space_age_moon_helium3_enabled: false,
    });
    expect(areMoonPowersEnabled(noEconomy)).toBe(false);
    expect(moonPowerGate(noEconomy, 'dyson_beam')).toBeNull();
    expect(checkMoonPowerRequirement(noEconomy, 'p2', 'dyson_beam')).toBeNull();
  });

  it('leaves the beam exactly as it is today while the phase is off', () => {
    const off = mkState([...EARTH], { space_age_moon_gated_tier_enabled: false });
    // p1 holds no Moon tile and has no He-3 cost to pay: today's behaviour.
    off.players[0].helium3 = 0;
    const res = executeTechAbility({
      state: off, map: MAP, playerId: 'p1', abilityId: 'dyson_beam', territoryId: 'euro_spaceport',
    });
    expect(res.success).toBe(true);
    expect(off.territories.euro_spaceport.unit_count).toBe(5);
    expect(res.helium3Spent).toBeUndefined();
  });
});

describe('Dyson Beam behind the Moon', () => {
  it('fires for a Moon holder and charges the fuel', () => {
    const state = mkState([...EARTH, ...MOON_TILES]);
    const res = executeTechAbility({
      state, map: MAP, playerId: 'p1', abilityId: 'dyson_beam', territoryId: 'euro_spaceport',
    });
    expect(res.success).toBe(true);
    expect(res.helium3Spent).toBe(6);
    expect(state.players[0].helium3).toBe(14);
    expect(state.territories.euro_spaceport.unit_count).toBe(5);
  });

  it('refuses a player who holds no lunar ground, however much He-3 they banked', () => {
    // §4.3: the Moon is a position, not a credential. A player who lands, mines,
    // and is then thrown off loses the beam the moment the last tile goes.
    const state = mkState([...EARTH]);
    const res = executeTechAbility({
      state, map: MAP, playerId: 'p1', abilityId: 'dyson_beam', territoryId: 'euro_spaceport',
    });
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/Moon territory/);
    expect(state.players[0].helium3).toBe(20);
    expect(state.territories.euro_spaceport.unit_count).toBe(9);
  });

  it('refuses when the fuel is short and says how short', () => {
    const state = mkState([...EARTH, ...MOON_TILES]);
    state.players[0].helium3 = 5;
    const res = executeTechAbility({
      state, map: MAP, playerId: 'p1', abilityId: 'dyson_beam', territoryId: 'euro_spaceport',
    });
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/6 Helium-3 \(you have 5\)/);
    expect(state.players[0].helium3).toBe(5);
  });

  it('charges nothing when the strike itself is rejected', () => {
    // The cost is taken after the effect reports success, so an invalid target
    // does not quietly burn six He-3.
    const state = mkState([...EARTH, ...MOON_TILES]);
    const res = executeTechAbility({
      state, map: MAP, playerId: 'p1', abilityId: 'dyson_beam', territoryId: 'na_launch_base',
    });
    expect(res.success).toBe(false);
    expect(state.players[0].helium3).toBe(20);
  });

  it('reports the wrong phase rather than a Moon requirement', () => {
    const state = mkState([...EARTH, ...MOON_TILES]);
    state.phase = 'draft';
    const res = executeTechAbility({
      state, map: MAP, playerId: 'p1', abilityId: 'dyson_beam', territoryId: 'euro_spaceport',
    });
    expect(res.error).toMatch(/attack phase/);
  });
});

describe('Orbital Drop', () => {
  const draft = (seeds: Seed[], settings?: Partial<GameState['settings']>) => {
    const state = mkState(seeds, settings);
    state.phase = 'draft';
    return state;
  };

  it('places three units on any owned territory, however far from the Moon', () => {
    const state = draft([...EARTH, ...MOON_TILES]);
    const res = executeTechAbility({
      state, map: MAP, playerId: 'p1', abilityId: 'orbital_drop', territoryId: 'na_launch_base',
    });
    expect(res.success).toBe(true);
    expect(res.helium3Spent).toBe(8);
    expect(state.territories.na_launch_base.unit_count).toBe(7);
    expect(state.players[0].helium3).toBe(12);
  });

  it('needs three Moon tiles, not one', () => {
    const state = draft([...EARTH, MOON_TILES[0], MOON_TILES[1]]);
    const res = executeTechAbility({
      state, map: MAP, playerId: 'p1', abilityId: 'orbital_drop', territoryId: 'na_launch_base',
    });
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/3 Moon territories \(you hold 2\)/);
    expect(state.territories.na_launch_base.unit_count).toBe(4);
  });

  it('cannot take a tile: an enemy target is refused', () => {
    // 2a is reinforcement only. Landing on an enemy tile is Phase 2b, and it
    // resolves combat rather than adding units to someone else's stack.
    const state = draft([...EARTH, ...MOON_TILES]);
    const res = executeTechAbility({
      state, map: MAP, playerId: 'p1', abilityId: 'orbital_drop', territoryId: 'euro_spaceport',
    });
    expect(res.success).toBe(false);
    expect(state.territories.euro_spaceport.unit_count).toBe(9);
    expect(state.players[0].helium3).toBe(20);
  });

  it('does not resolve at all with the phase off, on any path', () => {
    // It has no unlocking tech, so the socket's ownership check is the only
    // thing standing between a client and this call. The engine refuses too.
    const state = draft([...EARTH, ...MOON_TILES], { space_age_moon_gated_tier_enabled: false });
    const res = executeTechAbility({
      state, map: MAP, playerId: 'p1', abilityId: 'orbital_drop', territoryId: 'na_launch_base',
    });
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/not enabled/);
    expect(state.territories.na_launch_base.unit_count).toBe(4);
  });
});

describe('who may reach for a Moon power at all', () => {
  it('lets lunar ground stand in for a tech unlock', () => {
    const state = mkState([...EARTH, ...MOON_TILES]);
    expect(hasMoonGroundAccess(state, 'p1', 'lunar_export')).toBe(true);
    expect(hasMoonGroundAccess(state, 'p1', 'orbital_drop')).toBe(true);
    expect(hasMoonGroundAccess(state, 'p2', 'orbital_drop')).toBe(false);
  });

  it('keeps Lunar Export on Phase 1 alone when Phase 2 is off', () => {
    // The two phases can be enabled independently; the Phase 1 sink must not
    // start depending on the tier that came after it.
    const state = mkState([...EARTH, ...MOON_TILES], { space_age_moon_gated_tier_enabled: false });
    expect(hasMoonGroundAccess(state, 'p1', 'lunar_export')).toBe(true);
    expect(hasMoonGroundAccess(state, 'p1', 'orbital_drop')).toBe(false);
  });

  it('needs three tiles for the drop but only one for the export', () => {
    const state = mkState([...EARTH, MOON_TILES[0]]);
    expect(hasMoonGroundAccess(state, 'p1', 'lunar_export')).toBe(true);
    expect(hasMoonGroundAccess(state, 'p1', 'orbital_drop')).toBe(false);
  });

  it('does not hand out abilities that answer to the tech tree', () => {
    const state = mkState([...EARTH, ...MOON_TILES]);
    expect(hasMoonGroundAccess(state, 'p1', 'dyson_beam')).toBe(false);
    expect(hasMoonGroundAccess(state, 'p1', 'atom_bomb')).toBe(false);
  });
});
