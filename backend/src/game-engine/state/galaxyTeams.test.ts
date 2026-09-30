/**
 * Galactic Age team boards (state/galaxyTeams.ts): Allied houses at eight
 * seats and 2v2 at four.
 *
 * The cases that matter:
 *   • Allied houses deal one side per world, its two houses; 2v2 deals the two
 *     pairs GALAXY_2V2_PAIRS names; every other game deals none;
 *   • the seats are reordered so the sides alternate, each keeping its own
 *     seat order, and every seat index matches its place;
 *   • an Allied board opens with no Concord, no Lane Crown and the world's
 *     ALLIED_TUNING on each house; a team game plays without secret missions;
 *   • a region the side holds whole pays its bonus, where a split one used to
 *     pay nobody.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import type { GameMap, GameSettings, GameState, GameTeam } from '../../types';
import { calculateContinentBonuses, initializeGameState } from './gameStateManager';
import { dropSecretMissions, GALAXY_2V2_PAIRS, galaxyTeamsFor, seatTeamsApart } from './galaxyTeams';
import { ALLIED_TUNING, holdsLaneCrown, laneCrownBonus, schismHouseOf, schismHouseTiles } from './galaxySchism';
import { activeTruceBetween } from './truces';
import { areAllies } from './teams';
import { getPlayerReinforceBonus } from './techManager';

const AUTHORED = JSON.parse(
  readFileSync(join(__dirname, '../../../../database/maps/era_galaxy.json'), 'utf-8'),
) as GameMap;

const FACTIONS = ['stellar_mandate', 'forge_syndicate', 'helion_navigators', 'void_custodians'];
const HOME: Record<string, string> = {
  stellar_mandate: 'sol',
  forge_syndicate: 'rust',
  helion_navigators: 'verdan',
  void_custodians: 'nexus_station',
};

function settings(overrides: Partial<GameSettings> = {}): GameSettings {
  return {
    fog_of_war: false, turn_timer_seconds: 0, initial_unit_count: 3, card_set_escalating: false,
    diplomacy_enabled: false, factions_enabled: true, naval_enabled: false, events_enabled: false,
    economy_enabled: true, tech_trees_enabled: true, stability_enabled: false,
    era_advancement_enabled: false, galaxy_corridors_enabled: true,
    allowed_victory_conditions: ['domination'], victory_type: 'domination', max_turns: 90,
    ...overrides,
  } as unknown as GameSettings;
}

function seats(factions: Array<string | null>) {
  return factions.map((faction_id, i) => ({
    player_id: `p${i}`, player_index: i, username: `P${i}`, color: '#fff',
    is_ai: false, is_eliminated: false, mmr: 1000, faction_id,
  }));
}

function start(factions: string[], overrides: Partial<GameSettings> = {}): { state: GameState; map: GameMap } {
  const map = JSON.parse(JSON.stringify(AUTHORED)) as GameMap;
  const state = initializeGameState('t_teams', 'galaxy_age', map, seats(factions) as never, settings(overrides), {
    forceStartingPlayerIndex: 0,
  });
  return { state, map };
}

const worldOf = (state: GameState, id: string) => HOME[state.players.find((p) => p.player_id === id)!.faction_id!]!;

afterEach(() => {
  for (const w of Object.keys(ALLIED_TUNING)) ALLIED_TUNING[w] = { ...ALLIED_TUNING[w]!, ...BASE_TUNING[w] };
});
const BASE_TUNING = JSON.parse(JSON.stringify(ALLIED_TUNING)) as typeof ALLIED_TUNING;

describe('which games deal teams', () => {
  it('Allied houses: one side per world, its two houses', () => {
    const teams = galaxyTeamsFor('galaxy_age', AUTHORED, seats([...FACTIONS, ...FACTIONS]), { galaxy_house_relations: 'allied' });
    expect(teams).toHaveLength(4);
    for (const t of teams!) expect(t.player_ids).toHaveLength(2);
    expect(teams!.map((t) => t.name).sort()).toEqual(['Forge Syndicate', 'Helion Navigators', 'Stellar Mandate', 'Void Custodians']);
    expect(teams!.find((t) => t.player_ids.includes('p0'))!.player_ids).toEqual(['p0', 'p4']);
  });

  it('2v2: the two pairs of worlds across the ring', () => {
    const teams = galaxyTeamsFor('galaxy_age', AUTHORED, seats(FACTIONS), { galaxy_2v2: true })!;
    expect(GALAXY_2V2_PAIRS).toEqual([['sol', 'rust'], ['verdan', 'nexus_station']]);
    expect(teams.map((t) => t.player_ids)).toEqual([['p0', 'p1'], ['p2', 'p3']]);
    expect(teams[0]!.name).toBe('Stellar Mandate & Forge Syndicate');
  });

  it('nothing for the Concord, Civil War, a free-for-all four, other seat counts or another era', () => {
    const eight = seats([...FACTIONS, ...FACTIONS]);
    expect(galaxyTeamsFor('galaxy_age', AUTHORED, eight, {})).toBeNull();
    expect(galaxyTeamsFor('galaxy_age', AUTHORED, eight, { galaxy_house_relations: 'civil_war' })).toBeNull();
    expect(galaxyTeamsFor('galaxy_age', AUTHORED, eight, { galaxy_2v2: true })).toBeNull();
    expect(galaxyTeamsFor('galaxy_age', AUTHORED, seats(FACTIONS), {})).toBeNull();
    expect(galaxyTeamsFor('galaxy_age', AUTHORED, seats(FACTIONS.slice(0, 3)), { galaxy_2v2: true })).toBeNull();
    expect(galaxyTeamsFor('ww2', AUTHORED, seats(FACTIONS), { galaxy_2v2: true })).toBeNull();
  });

  it('nothing when a seat has no home world', () => {
    expect(galaxyTeamsFor('galaxy_age', AUTHORED, seats([...FACTIONS.slice(0, 3), null]), { galaxy_2v2: true })).toBeNull();
  });
});

describe('seating the sides apart', () => {
  it('alternates the sides, keeping each side in its own seat order', () => {
    const players = seats(['a', 'a', 'b', 'b']).map((p, i) => ({ ...p, player_id: ['a1', 'a2', 'b1', 'b2'][i]! }));
    const teams: GameTeam[] = [
      { team_id: 'x', name: 'A', player_ids: ['a2', 'a1'] },
      { team_id: 'y', name: 'B', player_ids: ['b1', 'b2'] },
    ];
    const seated = seatTeamsApart(players, teams);
    expect(players.map((p) => p.player_id)).toEqual(['a1', 'b1', 'a2', 'b2']);
    expect(players.map((p) => p.player_index)).toEqual([0, 1, 2, 3]);
    expect(seated).toEqual([
      { team_id: 'team_1', name: 'A', player_ids: ['a1', 'a2'] },
      { team_id: 'team_2', name: 'B', player_ids: ['b1', 'b2'] },
    ]);
  });

  it('never seats allies back to back at eight', () => {
    // Every world's houses side by side, the worst seating for it.
    const { state } = start(['stellar_mandate', 'stellar_mandate', 'forge_syndicate', 'forge_syndicate',
      'helion_navigators', 'helion_navigators', 'void_custodians', 'void_custodians'], { galaxy_house_relations: 'allied' });
    const n = state.players.length;
    for (let i = 0; i < n; i++) {
      const next = state.players[(i + 1) % n]!;
      expect(areAllies(state, state.players[i]!.player_id, next.player_id)).toBe(false);
      expect(state.players[i]!.player_index).toBe(i);
    }
    expect(state.teams!.map((t) => t.player_ids.map((id) => state.players.findIndex((p) => p.player_id === id))))
      .toEqual([[0, 4], [1, 5], [2, 6], [3, 7]]);
  });
});

describe('an Allied houses start', () => {
  const allied = () => start([...FACTIONS, ...FACTIONS], { galaxy_house_relations: 'allied' });

  it('seats each world as one side, with no Concord and no Lane Crown', () => {
    const { state } = allied();
    expect(state.teams).toHaveLength(4);
    const mode = state.galaxy_mode;
    expect(mode?.id).toBe('schism');
    if (mode?.id !== 'schism') return;
    expect(mode.relations).toBe('allied');
    expect(mode.concord_rounds).toBe(0);
    expect(mode.lane_crown_bonus).toBe(0);
    for (const team of state.teams!) {
      const [a, b] = team.player_ids;
      expect(worldOf(state, a!)).toBe(worldOf(state, b!));
      expect(activeTruceBetween(state, a!, b!)).toBeNull();
      for (const id of [a!, b!]) {
        const house = schismHouseOf(state, id)!;
        const tiles = Object.values(state.territories).filter((t) => t.owner_id === id).map((t) => t.territory_id).sort();
        expect(tiles).toEqual([...schismHouseTiles(house)].sort());
      }
    }
  });

  it("records each world's Allied numbers on its houses and drafts them", () => {
    ALLIED_TUNING.rust = { reinforce: 2, opening: 1 };
    const { state } = allied();
    for (const p of state.players) {
      const house = schismHouseOf(state, p.player_id)!;
      const expected = house.world_id === 'rust' ? 2 : BASE_TUNING[house.world_id]!.reinforce;
      expect(house.reinforce_bonus ?? 0).toBe(expected);
    }
    const rustHouse = state.players.find((p) => worldOf(state, p.player_id) === 'rust')!;
    const tile = Object.values(state.territories).find((t) => t.owner_id === rustHouse.player_id)!;
    expect(tile.unit_count).toBe(3 + 1);
    const withBonus = getPlayerReinforceBonus(state, rustHouse.player_id);
    ALLIED_TUNING.rust = { reinforce: 0, opening: 0 };
    // The recorded number pays, not today's table.
    expect(getPlayerReinforceBonus(state, rustHouse.player_id)).toBe(withBonus);
  });

  it('never pays a Crown, even to a house that takes every gateway', () => {
    const { state } = allied();
    const mode = state.galaxy_mode;
    if (mode?.id !== 'schism') throw new Error('no schism');
    const me = state.players[0]!.player_id;
    const world = schismHouseOf(state, me)!.world_id;
    for (const id of mode.crown_gateways[world]!) state.territories[id]!.owner_id = me;
    expect(holdsLaneCrown(state, me)).toBe(true);
    expect(laneCrownBonus(state, me)).toBe(0);
  });
});

describe('a 2v2 start', () => {
  it('pairs the worlds across the ring and alternates the sides', () => {
    const { state } = start(FACTIONS, { galaxy_2v2: true });
    expect(state.galaxy_mode).toBeUndefined();
    expect(state.teams!.map((t) => t.player_ids.map((id) => worldOf(state, id)).sort())).toEqual([
      ['rust', 'sol'],
      ['nexus_station', 'verdan'],
    ]);
    for (let i = 0; i < 4; i++) {
      expect(areAllies(state, state.players[i]!.player_id, state.players[(i + 1) % 4]!.player_id)).toBe(false);
    }
    // Everyone still opens on their whole home world.
    for (const p of state.players) {
      const worlds = new Set(Object.values(state.territories).filter((t) => t.owner_id === p.player_id).map((t) => t.world_id));
      expect([...worlds]).toEqual([HOME[p.faction_id!]]);
    }
  });

  it('is a free-for-all four without the setting', () => {
    const { state } = start(FACTIONS);
    expect(state.teams).toBeUndefined();
    expect(state.players.map((p) => p.player_id)).toEqual(['p0', 'p1', 'p2', 'p3']);
  });

  it('plays without secret missions', () => {
    const { state } = start(FACTIONS, {
      galaxy_2v2: true,
      allowed_victory_conditions: ['domination', 'secret_mission'],
    } as Partial<GameSettings>);
    expect(state.settings.allowed_victory_conditions).toEqual(['domination']);
    expect(state.players.every((p) => p.secret_mission === null)).toBe(true);
  });
});

describe('dropping secret missions', () => {
  it('keeps the rest, and Domination when a mission was the only way to win', () => {
    const a = settings({ allowed_victory_conditions: ['threshold', 'secret_mission'] } as Partial<GameSettings>);
    dropSecretMissions(a);
    expect(a.allowed_victory_conditions).toEqual(['threshold']);
    const b = settings({ allowed_victory_conditions: ['secret_mission'], victory_type: 'secret_mission' } as Partial<GameSettings>);
    dropSecretMissions(b);
    expect(b.allowed_victory_conditions).toEqual(['domination']);
    expect(b.victory_type).toBe('domination');
  });
});

describe('a region the side holds whole', () => {
  it('pays the member holding most of it, where a split region paid nobody', () => {
    const { state, map } = start([...FACTIONS, ...FACTIONS], { galaxy_house_relations: 'allied' });
    // Verdan's Brilliance region is split between its two Allied houses.
    const tiles = map.territories.filter((t) => t.region_id === 'verdan_brilliance').map((t) => t.territory_id);
    const owners = [...new Set(tiles.map((id) => state.territories[id]!.owner_id!))];
    expect(owners).toHaveLength(2);
    const bonus = map.regions.find((r) => r.region_id === 'verdan_brilliance')!.bonus;
    const most = owners.sort((a, b) =>
      tiles.filter((id) => state.territories[id]!.owner_id === b).length
      - tiles.filter((id) => state.territories[id]!.owner_id === a).length)[0]!;
    const other = owners.find((o) => o !== most)!;
    const withSide = calculateContinentBonuses(state, map, most);
    const otherBonus = calculateContinentBonuses(state, map, other);
    const teams = state.teams;
    state.teams = undefined;
    expect(withSide - calculateContinentBonuses(state, map, most)).toBe(bonus);
    expect(calculateContinentBonuses(state, map, other)).toBe(otherBonus);
    state.teams = teams;
  });
});
