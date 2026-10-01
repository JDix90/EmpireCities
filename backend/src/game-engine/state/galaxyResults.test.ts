/**
 * The admin report's record of a finished Galactic Age game: every board the
 * era deals, read off a real dealt state. The record is what the report groups
 * by, so each board must come out as the mode, roles, sides and worlds it is.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import type { GameMap, GameSettings, GameState } from '../../types';
import { initializeGameState } from './gameStateManager';
import { isGalaxyReportGame, summarizeGalaxyGame } from './galaxyResults';
import { PARTIAL_ALLIED_TUNING } from './galaxySchism';

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

/** Seats in lobby order; the ones listed in `ai` are expert bots. */
function seats(factions: Array<string | null>, ai: number[] = []) {
  return factions.map((faction_id, i) => ({
    player_id: ai.includes(i) ? `ai_${i}` : `p${i}`, player_index: i, username: `P${i}`, color: '#fff',
    is_ai: ai.includes(i), ai_difficulty: ai.includes(i) ? 'expert' : undefined,
    is_eliminated: false, mmr: 1000, faction_id,
  }));
}

function start(
  factions: Array<string | null>,
  overrides: Partial<GameSettings> = {},
  opts: { ai?: number[]; first?: number } = {},
): GameState {
  const map = JSON.parse(JSON.stringify(AUTHORED)) as GameMap;
  return initializeGameState('t_results', 'galaxy_age', map, seats(factions, opts.ai) as never, settings(overrides), {
    forceStartingPlayerIndex: opts.first ?? 0,
  });
}

const FIVE = [...FACTIONS, 'stellar_mandate'];

function summarize(state: GameState, winnerIds: string[] = []) {
  const result = summarizeGalaxyGame(state, winnerIds);
  expect(result).not.toBeNull();
  return result!;
}

/** The seat record of the player whose faction and position among that faction's seats match. */
function seatOf(state: GameState, result: ReturnType<typeof summarize>, faction: string, nth = 0) {
  const player = state.players.filter((p) => p.faction_id === faction)[nth]!;
  return result.seat_results[state.players.indexOf(player)]!;
}

describe('which games the Galactic Age report records', () => {
  it('records a Galactic Age game, and nothing for another era or a climb into this one', () => {
    const state = start(FACTIONS);
    expect(isGalaxyReportGame(state)).toBe(true);
    expect(summarizeGalaxyGame({ ...state, era: 'ww2', map_id: 'era_ww2' } as GameState, [])).toBeNull();
    const climbing = { ...state, settings: { ...state.settings, era_advancement_enabled: true } } as GameState;
    expect(isGalaxyReportGame(climbing)).toBe(false);
    expect(summarizeGalaxyGame(climbing, [])).toBeNull();
  });
});

describe('the board a finished game dealt', () => {
  it('reads Colonies: each seat alone on its own home world', () => {
    const result = summarize(start(['stellar_mandate', 'forge_syndicate']));
    expect(result).toMatchObject({ seats: 2, mode: 'colonies', relations: null, board: null });
    expect(result.seat_results.map((s) => [s.role, s.world_id, s.house, s.side])).toEqual([
      ['home', 'sol', null, null],
      ['home', 'rust', null, null],
    ]);
  });

  it('tells four seats on their home worlds from a scattered start or the Territory Draft', () => {
    const home = summarize(start(FACTIONS));
    expect(home.mode).toBe('home_worlds');
    expect(home.seat_results.map((s) => s.world_id)).toEqual(FACTIONS.map((f) => HOME[f]));
    expect(home.seat_results.every((s) => s.role === 'home')).toBe(true);

    const scattered = summarize(start([null, null, null, null], { factions_enabled: false, galaxy_plain_lanes: true }));
    expect(scattered.mode).toBe('scattered');
    expect(scattered.seat_results.map((s) => [s.role, s.world_id])).toEqual(Array(4).fill(['scattered', null]));

    expect(summarize(start(FACTIONS, { territory_selection: true })).mode).toBe('scattered');
  });

  it('reads 2v2: two sides of two, each seat on its home world', () => {
    const state = start(FACTIONS, { galaxy_2v2: true });
    const result = summarize(state);
    expect(result.mode).toBe('2v2');
    const sides = result.seat_results.map((s) => s.side);
    expect(new Set(sides).size).toBe(2);
    for (const side of new Set(sides)) expect(sides.filter((s) => s === side)).toHaveLength(2);
    expect(result.seat_results.every((s) => s.role === 'home' && !!s.world_id)).toBe(true);
    for (const team of state.teams!) {
      for (const id of team.player_ids) {
        expect(result.seat_results[state.players.findIndex((p) => p.player_id === id)]!.side).toBe(team.team_id);
      }
    }
  });

  it('reads the Schism at eight: every seat a house with a rival, under the relations it was dealt', () => {
    const state = start([...FACTIONS, ...FACTIONS]);
    const result = summarize(state);
    expect(result).toMatchObject({ seats: 8, mode: 'schism', relations: 'concord', board: null });
    expect(result.seat_results.every((s) => s.role === 'rival' && !!s.house)).toBe(true);
    const mode = state.galaxy_mode!;
    if (mode.id !== 'schism') throw new Error('not a Schism board');
    for (const house of mode.houses) {
      const seat = result.seat_results[state.players.findIndex((p) => p.player_id === house.player_id)]!;
      expect([seat.house, seat.world_id, seat.reinforce_bonus]).toEqual([house.name, house.world_id, house.reinforce_bonus ?? null]);
    }
    expect(summarize(start([...FACTIONS, ...FACTIONS], { galaxy_house_relations: 'civil_war' })).relations).toBe('civil_war');
  });

  it('reads a Partial Schism: the split world and its rival houses, and the houses alone', () => {
    const state = start(FIVE);
    const result = summarize(state);
    expect(result).toMatchObject({ seats: 5, mode: 'partial_schism', relations: 'concord', board: 'sol' });
    expect([seatOf(state, result, 'stellar_mandate', 0).role, seatOf(state, result, 'stellar_mandate', 1).role])
      .toEqual(['rival', 'rival']);
    for (const f of FACTIONS.slice(1)) expect(seatOf(state, result, f)).toMatchObject({ role: 'alone', world_id: HOME[f] });
  });

  it('reads an Allied Partial Schism: allies on the split world, whole worlds, sides and their numbers', () => {
    const state = start(FIVE, { galaxy_house_relations: 'allied' });
    const result = summarize(state);
    expect(result).toMatchObject({ mode: 'partial_schism', relations: 'allied', board: 'sol' });
    const sol = [seatOf(state, result, 'stellar_mandate', 0), seatOf(state, result, 'stellar_mandate', 1)];
    expect(sol.map((s) => s.role)).toEqual(['ally', 'ally']);
    expect(sol[0]!.side).toBe(sol[1]!.side);
    expect(sol[0]!.reinforce_bonus).toBe(PARTIAL_ALLIED_TUNING[5]!.sol!.sol);
    for (const f of FACTIONS.slice(1)) {
      const seat = seatOf(state, result, f);
      expect(seat).toMatchObject({ role: 'whole', world_id: HOME[f], house: null });
      expect(seat.reinforce_bonus).toBe(PARTIAL_ALLIED_TUNING[5]!.sol![HOME[f]!]);
    }
    expect(new Set(result.seat_results.map((s) => s.side)).size).toBe(4);
  });
});

describe('how a finished game went', () => {
  it('records the credited winners, the ending, the first seat and who each seat was', () => {
    const state = start(FACTIONS, {}, { ai: [1, 3], first: 2 });
    state.turn_number = 27;
    state.victory_condition = 'lane_sovereignty';
    state.players[1]!.is_eliminated = true;
    state.players[0]!.has_resigned = true;
    state.players[0]!.is_eliminated = true;
    state.players[2]!.territory_count = 40;
    const result = summarize(state, ['p2']);
    expect(result).toMatchObject({ victory: 'lane_sovereignty', turns: 27, first_seat: 2, humans: 2 });
    expect(result.seat_results.map((s) => s.won)).toEqual([false, false, true, false]);
    expect(result.seat_results.map((s) => [s.user_id, s.is_ai, s.ai_difficulty])).toEqual([
      ['p0', false, null],
      [null, true, 'expert'],
      ['p2', false, null],
      [null, true, 'expert'],
    ]);
    expect(result.seat_results.map((s) => [s.eliminated, s.resigned])).toEqual([
      [true, true], [true, false], [false, false], [false, false],
    ]);
    expect(result.seat_results[2]!.territories).toBe(40);
  });

  it('credits every seat of the winning side', () => {
    const state = start(FIVE, { galaxy_house_relations: 'allied' });
    const solIds = state.players.filter((p) => p.faction_id === 'stellar_mandate').map((p) => p.player_id);
    const result = summarize(state, solIds);
    const winners = result.seat_results.filter((s) => s.won);
    expect(winners).toHaveLength(2);
    expect(winners.every((s) => s.world_id === 'sol' && s.role === 'ally')).toBe(true);
  });
});
