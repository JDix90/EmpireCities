/**
 * Lane Sovereignty — the galaxy's own victory condition.
 *
 * Hold both gateways of five of the eight authored lanes at the start of your
 * turn, three turns running. The cases that matter:
 *   • only AUTHORED lanes count — a Jump Gate or Launch Pad lane joins two tiles
 *     the builder already holds, so counting them would sell the win;
 *   • the streak advances only at the holder's OWN turn start, and breaks the
 *     moment they drop below the bar;
 *   • the condition has to be in the allowed list, or none of it happens.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import type { GameMap, GameSettings, GameState, VictoryType } from '../../types';
import { advanceToNextPlayer, checkVictory, initializeGameState } from '../state/gameStateManager';
import {
  authoredOrbitLanes,
  corridorCompletionTargets,
  corridorsNeededFor,
  countCorridors,
  hasLaneSovereignty,
  laneSovereigntyProgress,
  tickLaneSovereignty,
  LANE_SOVEREIGNTY_CORRIDORS_NEEDED,
  LANE_SOVEREIGNTY_ROUNDS,
} from './laneSovereignty';

const AUTHORED = JSON.parse(
  readFileSync(join(__dirname, '../../../../database/maps/era_galaxy.json'), 'utf-8'),
) as GameMap;

const FACTIONS = ['stellar_mandate', 'forge_syndicate', 'helion_navigators', 'void_custodians'] as const;
const SEAT = ['p_sol', 'p_rust', 'p_verdan', 'p_nexus'] as const;

function settings(overrides: Partial<GameSettings> = {}): GameSettings {
  return {
    fog_of_war: false, turn_timer_seconds: 0, initial_unit_count: 3, card_set_escalating: false,
    diplomacy_enabled: false, factions_enabled: true, naval_enabled: false, events_enabled: false,
    economy_enabled: true, tech_trees_enabled: true, stability_enabled: false,
    era_advancement_enabled: false, galaxy_corridors_enabled: true,
    allowed_victory_conditions: ['domination', 'lane_sovereignty'] as VictoryType[],
    victory_type: 'domination', max_turns: 90,
    ...overrides,
  } as unknown as GameSettings;
}

function freshGalaxy(overrides: Partial<GameSettings> = {}): { state: GameState; map: GameMap } {
  const map = JSON.parse(JSON.stringify(AUTHORED)) as GameMap;
  const players = SEAT.map((id, i) => ({
    player_id: id, player_index: i, username: id, color: '#fff',
    is_ai: false, is_eliminated: false, mmr: 1000, faction_id: FACTIONS[i],
  }));
  const state = initializeGameState('t_sov', 'galaxy_age', map, players as never, settings(overrides), {
    forceStartingPlayerIndex: 0,
  });
  return { state, map };
}

/** Hand both gateways of the first `n` authored lanes to `playerId`. */
function grantCorridors(state: GameState, map: GameMap, playerId: string, n: number): void {
  for (const lane of authoredOrbitLanes(map).slice(0, n)) {
    state.territories[lane.from].owner_id = playerId;
    state.territories[lane.to].owner_id = playerId;
  }
}

describe('the lanes sovereignty is played on', () => {
  it('is the eight authored lanes, and never an engine-added one', () => {
    const map = JSON.parse(JSON.stringify(AUTHORED)) as GameMap;
    expect(authoredOrbitLanes(map)).toHaveLength(8);
    expect(corridorsNeededFor(map)).toBe(LANE_SOVEREIGNTY_CORRIDORS_NEEDED);
    // A Launch Pad / Jump Gate lane carries `source`; it must not widen the game.
    map.connections = [
      ...map.connections,
      { from: 'sol_columbia', to: 'rust_cinderworks', type: 'orbit', source: 'jump_gate' },
    ];
    expect(authoredOrbitLanes(map)).toHaveLength(8);
  });

  it('caps the bar at the number of lanes a map actually has', () => {
    const map = JSON.parse(JSON.stringify(AUTHORED)) as GameMap;
    map.connections = map.connections.filter((c) => c.type !== 'orbit');
    expect(corridorsNeededFor(map)).toBe(0);
  });
});

describe('counting corridors', () => {
  it('counts only lanes whose BOTH gateways the player holds', () => {
    const { state, map } = freshGalaxy();
    // The four-homeworld start gives nobody a corridor: every lane crosses worlds.
    for (const seat of SEAT) expect(countCorridors(state, map, seat)).toBe(0);
    grantCorridors(state, map, 'p_sol', 3);
    expect(countCorridors(state, map, 'p_sol')).toBe(3);
    // Losing one end drops the corridor.
    const [first] = authoredOrbitLanes(map);
    state.territories[first.to].owner_id = 'p_rust';
    expect(countCorridors(state, map, 'p_sol')).toBe(2);
  });

  it('ignores an engine-added lane between two tiles the player already holds', () => {
    const { state, map } = freshGalaxy();
    grantCorridors(state, map, 'p_sol', 5);
    const before = countCorridors(state, map, 'p_sol');
    map.connections = [
      ...map.connections,
      { from: 'sol_columbia', to: 'sol_pacifica', type: 'orbit', source: 'jump_gate' },
    ];
    state.territories.sol_columbia.owner_id = 'p_sol';
    state.territories.sol_pacifica.owner_id = 'p_sol';
    expect(countCorridors(state, map, 'p_sol')).toBe(before);
  });

  it('names the tiles that would close one more corridor', () => {
    const { state, map } = freshGalaxy();
    const targets = corridorCompletionTargets(state, map, 'p_sol');
    // Sol holds one end of the four lanes that touch it, and neither end of the rest.
    expect(targets.size).toBe(4);
    expect(targets.has('verdan_chlorophage_span')).toBe(true);
    expect(targets.has('rust_anvil_basin')).toBe(false);
  });
});

describe('the streak, and the win', () => {
  it('extends at the holder\'s own turn start and wins on the last required round', () => {
    const { state, map } = freshGalaxy();
    grantCorridors(state, map, 'p_sol', LANE_SOVEREIGNTY_CORRIDORS_NEEDED);

    // Every round before the last banks the streak without ending the game.
    for (let round = 1; round < LANE_SOVEREIGNTY_ROUNDS; round++) {
      tickLaneSovereignty(state, map, 'p_sol');
      expect(state.players[0].lane_sovereignty_streak).toBe(round);
      expect(hasLaneSovereignty(state, 'p_sol')).toBe(false);
      expect(checkVictory(state, map)).toBeNull();
    }

    tickLaneSovereignty(state, map, 'p_sol');
    expect(state.players[0].lane_sovereignty_streak).toBe(LANE_SOVEREIGNTY_ROUNDS);
    expect(hasLaneSovereignty(state, 'p_sol')).toBe(true);
    expect(checkVictory(state, map)).toEqual({ winnerIds: ['p_sol'], condition: 'lane_sovereignty' });
  });

  it('breaks the moment they are under the bar at a turn start', () => {
    const { state, map } = freshGalaxy();
    grantCorridors(state, map, 'p_sol', LANE_SOVEREIGNTY_CORRIDORS_NEEDED);
    tickLaneSovereignty(state, map, 'p_sol');
    expect(state.players[0].lane_sovereignty_streak).toBe(1);
    // A rival takes one gateway back between turns.
    state.territories[authoredOrbitLanes(map)[0].to].owner_id = 'p_verdan';
    tickLaneSovereignty(state, map, 'p_sol');
    expect(state.players[0].lane_sovereignty_streak).toBe(0);
    expect(checkVictory(state, map)).toBeNull();
  });

  it('is wired into the turn advance, and only for the incoming player', () => {
    const { state, map } = freshGalaxy();
    grantCorridors(state, map, 'p_sol', LANE_SOVEREIGNTY_CORRIDORS_NEEDED);
    // Also hand the bar to a seat that will NOT be next, to prove the tick is per-player.
    state.players[1].lane_sovereignty_streak = 1;
    state.current_player_index = 3;
    advanceToNextPlayer(state, map);
    expect(state.current_player_index).toBe(0);
    expect(state.players[0].lane_sovereignty_streak).toBe(1);
    // The seat that did not come up keeps the streak it had — no free rounds.
    expect(state.players[1].lane_sovereignty_streak).toBe(1);
    for (let round = 2; round <= LANE_SOVEREIGNTY_ROUNDS; round++) {
      state.current_player_index = 3;
      advanceToNextPlayer(state, map);
      expect(state.players[0].lane_sovereignty_streak).toBe(round);
    }
    expect(checkVictory(state, map)?.condition).toBe('lane_sovereignty');
  });

  it('does nothing at all when the condition is not in play', () => {
    const { state, map } = freshGalaxy({ allowed_victory_conditions: ['domination'] as VictoryType[] });
    grantCorridors(state, map, 'p_sol', 8);
    tickLaneSovereignty(state, map, 'p_sol');
    tickLaneSovereignty(state, map, 'p_sol');
    expect(state.players[0].lane_sovereignty_streak).toBeUndefined();
    expect(hasLaneSovereignty(state, 'p_sol')).toBe(false);
    expect(checkVictory(state, map)).toBeNull();
  });
});

describe('progress, for the HUD and the AI', () => {
  it('reports held / needed / streak, and is inapplicable when off', () => {
    const { state, map } = freshGalaxy();
    grantCorridors(state, map, 'p_sol', 2);
    expect(laneSovereigntyProgress(state, map, 'p_sol')).toEqual({
      applicable: true, held: 2, needed: LANE_SOVEREIGNTY_CORRIDORS_NEEDED, streak: 0,
      roundsNeeded: LANE_SOVEREIGNTY_ROUNDS,
    });
    const off = freshGalaxy({ allowed_victory_conditions: ['domination'] as VictoryType[] });
    grantCorridors(off.state, off.map, 'p_sol', 5);
    const p = laneSovereigntyProgress(off.state, off.map, 'p_sol');
    expect(p.applicable).toBe(false);
    expect(p.held).toBe(0);
  });
});
