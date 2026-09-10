/**
 * Lane weather — the event deck edits the graph.
 *
 * Nebula Closure shuts one authored lane to EVERYONE for two rounds; Lane Surge
 * opens a temporary lane between two worlds the ring does not join. The cases
 * that matter:
 *   • a closure blocks the gateways' own owner, unlike an Emergency Seal;
 *   • it ages once per ROUND, not with a player's turn;
 *   • a surge lands between worlds that are NOT already neighbours, is projected
 *     onto the map copy as `source: 'lane_surge'`, and is removed when it blows over;
 *   • weather never touches a lane the players built.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { inferWorldId } from '@borderfall/shared';
import type { GameMap, GameSettings, GameState } from '../../types';
import { advanceToNextPlayer, initializeGameState } from './gameStateManager';
import { isLaneSealedForPlayer, orbitLaneId } from './moonAccess';
import {
  LANE_WEATHER_DURATION,
  applyLaneClosure,
  applyLaneSurge,
  isLaneClosedByWeather,
  laneSurgeConnections,
  syncLaneWeatherLanes,
  tickLaneWeather,
} from './laneWeather';

const AUTHORED = JSON.parse(
  readFileSync(join(__dirname, '../../../../database/maps/era_galaxy.json'), 'utf-8'),
) as GameMap;

const FACTIONS = ['stellar_mandate', 'forge_syndicate', 'helion_navigators', 'void_custodians'] as const;
const SEAT = ['p_sol', 'p_rust', 'p_verdan', 'p_nexus'] as const;

function freshGalaxy(overrides: Partial<GameSettings> = {}): { state: GameState; map: GameMap } {
  const map = JSON.parse(JSON.stringify(AUTHORED)) as GameMap;
  const players = SEAT.map((id, i) => ({
    player_id: id, player_index: i, username: id, color: '#fff',
    is_ai: false, is_eliminated: false, mmr: 1000, faction_id: FACTIONS[i],
  }));
  const settings = {
    fog_of_war: false, turn_timer_seconds: 0, initial_unit_count: 3, card_set_escalating: false,
    diplomacy_enabled: false, factions_enabled: true, naval_enabled: false, events_enabled: false,
    economy_enabled: true, tech_trees_enabled: true, stability_enabled: false,
    era_advancement_enabled: false, galaxy_corridors_enabled: true,
    allowed_victory_conditions: ['domination'], victory_type: 'domination', max_turns: 90,
    ...overrides,
  } as unknown as GameSettings;
  return { state: initializeGameState('t_wx', 'galaxy_age', map, players as never, settings, {
    forceStartingPlayerIndex: 0,
  }), map };
}

describe('Nebula Closure', () => {
  it('shuts the most-contested authored lane to everyone, including its own gateways\' owners', () => {
    const { state, map } = freshGalaxy();
    const result = applyLaneClosure(state, map);
    const shut = result.lane_weather!;
    expect(shut.kind).toBe('closure');
    expect(shut.rounds).toBe(LANE_WEATHER_DURATION);
    // The four-homeworld start makes every lane contested, so one is picked.
    expect(isLaneClosedByWeather(state, shut.from, shut.to)).toBe(true);
    expect(isLaneClosedByWeather(state, shut.to, shut.from)).toBe(true);
    // Unlike a seal, it blocks the owners of BOTH gateways.
    const fromOwner = state.territories[shut.from].owner_id!;
    const toOwner = state.territories[shut.to].owner_id!;
    expect(isLaneSealedForPlayer(state, shut.from, shut.to, fromOwner)).toBe(true);
    expect(isLaneSealedForPlayer(state, shut.from, shut.to, toOwner)).toBe(true);
    // And only that lane.
    const other = map.connections.find(
      (c) => c.type === 'orbit' && !c.source && orbitLaneId(c.from, c.to) !== orbitLaneId(shut.from, shut.to),
    )!;
    expect(isLaneClosedByWeather(state, other.from, other.to)).toBe(false);
  });

  it('ages once per round and clears itself', () => {
    const { state, map } = freshGalaxy();
    const shut = applyLaneClosure(state, map).lane_weather!;
    for (let round = 1; round < LANE_WEATHER_DURATION; round++) {
      tickLaneWeather(state);
      expect(isLaneClosedByWeather(state, shut.from, shut.to)).toBe(true);
    }
    tickLaneWeather(state);
    expect(isLaneClosedByWeather(state, shut.from, shut.to)).toBe(false);
    expect(state.lane_weather).toBeUndefined();
  });

  it('never shuts the same lane twice at once', () => {
    const { state, map } = freshGalaxy();
    const first = applyLaneClosure(state, map).lane_weather!;
    const second = applyLaneClosure(state, map).lane_weather!;
    expect(orbitLaneId(second.from, second.to)).not.toBe(orbitLaneId(first.from, first.to));
    expect(Object.keys(state.lane_weather!.closures!)).toHaveLength(2);
  });
});

describe('Lane Surge', () => {
  it('joins two worlds the authored ring does not, and lands on their gateways', () => {
    const { state, map } = freshGalaxy();
    const surge = applyLaneSurge(state, map).lane_weather!;
    expect(surge.kind).toBe('surge');
    const byId = new Map(map.territories.map((t) => [t.territory_id, t]));
    const wa = inferWorldId(byId.get(surge.from)!);
    const wb = inferWorldId(byId.get(surge.to)!);
    expect(wa).not.toBe(wb);
    // The shipped ring is sol–verdan–rust–nexus–sol, so the only non-neighbour
    // pairs are sol/rust and verdan/nexus.
    expect([`${wa}::${wb}`, `${wb}::${wa}`].some((k) => k === 'rust::sol' || k === 'nexus_station::verdan')).toBe(true);
    // Both ends are authored gateway tiles.
    for (const id of [surge.from, surge.to]) {
      expect(map.connections.some((c) => c.type === 'orbit' && !c.source && (c.from === id || c.to === id))).toBe(true);
    }
  });

  it('is projected onto the map copy and removed when it blows over', () => {
    const { state, map } = freshGalaxy();
    const surge = applyLaneSurge(state, map).lane_weather!;
    expect(syncLaneWeatherLanes(map, state)).toBe(true);
    const lane = map.connections.find((c) => c.source === 'lane_surge')!;
    expect([lane.from, lane.to].sort()).toEqual([surge.from, surge.to].sort());
    expect(lane.type).toBe('orbit');
    expect(syncLaneWeatherLanes(map, state)).toBe(false); // idempotent

    for (let i = 0; i < LANE_WEATHER_DURATION; i++) tickLaneWeather(state);
    expect(laneSurgeConnections(state)).toHaveLength(0);
    expect(syncLaneWeatherLanes(map, state)).toBe(true);
    expect(map.connections.some((c) => c.source === 'lane_surge')).toBe(false);
  });

  it('does not open the same surge twice at once', () => {
    const { state, map } = freshGalaxy();
    const first = applyLaneSurge(state, map).lane_weather!;
    const second = applyLaneSurge(state, map).lane_weather!;
    expect(orbitLaneId(second.from, second.to)).not.toBe(orbitLaneId(first.from, first.to));
    expect(state.lane_weather!.surges).toHaveLength(2);
    // Both non-neighbour pairs are now taken, so a third surge finds nothing.
    expect(applyLaneSurge(state, map).lane_weather).toBeUndefined();
  });
});

describe('weather and the lanes players build', () => {
  it('never closes an engine-added lane', () => {
    const { state, map } = freshGalaxy();
    map.connections = [
      ...map.connections,
      { from: 'sol_columbia', to: 'rust_cinderworks', type: 'orbit', source: 'jump_gate' },
    ];
    // Shut every authored lane; the gate lane is still open.
    for (let i = 0; i < 8; i++) applyLaneClosure(state, map);
    expect(Object.keys(state.lane_weather!.closures!)).toHaveLength(8);
    expect(isLaneClosedByWeather(state, 'sol_columbia', 'rust_cinderworks')).toBe(false);
  });

  it('is aged by the turn advance, once per round', () => {
    const { state, map } = freshGalaxy();
    const shut = applyLaneClosure(state, map).lane_weather!;
    const laneId = orbitLaneId(shut.from, shut.to);
    // Three player turns inside one round: the round has not wrapped, so nothing ages.
    state.current_player_index = 0;
    for (let i = 0; i < 3; i++) advanceToNextPlayer(state, map);
    expect(state.lane_weather!.closures![laneId]).toBe(LANE_WEATHER_DURATION);
    // The fourth wraps the round.
    advanceToNextPlayer(state, map);
    expect(state.lane_weather!.closures![laneId]).toBe(LANE_WEATHER_DURATION - 1);
  });
});
