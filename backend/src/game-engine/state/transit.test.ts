/**
 * Transit — cross-world fortifies as convoys.
 *
 * The cases that matter:
 *   • only cross-WORLD moves become convoys, and only with the flag on;
 *   • the units leave their garrison at once — the source is weaker immediately;
 *   • they land at the MOVER's next turn start, not anyone else's;
 *   • a convoy whose destination changed hands turns back, and one with nowhere
 *     left to go is lost;
 *   • a Drift Jump is never a convoy.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import type { GameMap, GameSettings, GameState } from '../../types';
import { advanceToNextPlayer, initializeGameState } from './gameStateManager';
import {
  TRANSIT_DELAY_ROUNDS,
  arriveConvoys,
  convoysInTransit,
  fortifyBecomesConvoy,
  launchConvoy,
  pruneStrandedConvoys,
  transitEnabled,
  unitsInTransit,
} from './transit';

const AUTHORED = JSON.parse(
  readFileSync(join(__dirname, '../../../../database/maps/era_galaxy.json'), 'utf-8'),
) as GameMap;

const FACTIONS = ['stellar_mandate', 'forge_syndicate', 'helion_navigators', 'void_custodians'] as const;
const SEAT = ['p_sol', 'p_rust', 'p_verdan', 'p_nexus'] as const;

const SOL_A = 'sol_columbia';
const SOL_B = 'sol_pacifica';
const RUST_A = 'rust_cinderworks';

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
    era_advancement_enabled: false, galaxy_corridors_enabled: true, galaxy_transit_enabled: true,
    allowed_victory_conditions: ['domination'], victory_type: 'domination', max_turns: 90,
    ...overrides,
  } as unknown as GameSettings;
  return {
    state: initializeGameState('t_transit', 'galaxy_age', map, players as never, settings, {
      forceStartingPlayerIndex: 0,
    }),
    map,
  };
}

describe('what becomes a convoy', () => {
  it('is a cross-world move, with the flag on and no Drift Jump', () => {
    const { state } = freshGalaxy();
    expect(transitEnabled(state)).toBe(true);
    expect(fortifyBecomesConvoy(state, SOL_A, RUST_A)).toBe(true);
    // Same world: an ordinary fortify, instant as always.
    expect(fortifyBecomesConvoy(state, SOL_A, SOL_B)).toBe(false);
    // The Helion signature is a jump, not a haul.
    expect(fortifyBecomesConvoy(state, SOL_A, RUST_A, { driftJump: true })).toBe(false);
  });

  it('is nothing at all with the flag off', () => {
    const { state } = freshGalaxy({ galaxy_transit_enabled: false });
    expect(transitEnabled(state)).toBe(false);
    expect(fortifyBecomesConvoy(state, SOL_A, RUST_A)).toBe(false);
  });
});

describe('sending, and landing', () => {
  it('takes the units out of the garrison the moment the order is given', () => {
    const { state } = freshGalaxy();
    state.territories[SOL_A].unit_count = 10;
    state.territories[RUST_A].owner_id = 'p_sol';
    state.territories[RUST_A].unit_count = 1;

    launchConvoy(state, 'p_sol', SOL_A, RUST_A, 6);
    expect(state.territories[SOL_A].unit_count).toBe(4);
    expect(state.territories[RUST_A].unit_count).toBe(1);
    expect(unitsInTransit(state, 'p_sol')).toBe(6);
    expect(convoysInTransit(state, 'p_rust')).toHaveLength(0);
  });

  it('lands at the mover\u2019s next turn start, and nobody else\u2019s', () => {
    const { state, map } = freshGalaxy();
    state.territories[SOL_A].unit_count = 10;
    state.territories[RUST_A].owner_id = 'p_sol';
    state.territories[RUST_A].unit_count = 1;
    launchConvoy(state, 'p_sol', SOL_A, RUST_A, 6);

    // Three other seats take their turns: the convoy is still in the void.
    state.current_player_index = 0;
    for (let i = 0; i < 3; i++) {
      advanceToNextPlayer(state, map);
      expect(state.territories[RUST_A].unit_count).toBe(1);
    }
    // Back round to the mover.
    advanceToNextPlayer(state, map);
    expect(state.current_player_index).toBe(0);
    expect(state.territories[RUST_A].unit_count).toBe(7);
    expect(state.transits).toBeUndefined();
    expect(state.last_transit_arrivals).toEqual([
      expect.objectContaining({ outcome: 'landed' }),
    ]);
  });

  it('waits exactly the configured number of rounds', () => {
    const { state } = freshGalaxy();
    state.territories[SOL_A].unit_count = 10;
    state.territories[RUST_A].owner_id = 'p_sol';
    launchConvoy(state, 'p_sol', SOL_A, RUST_A, 2);
    for (let round = 1; round < TRANSIT_DELAY_ROUNDS; round++) {
      expect(arriveConvoys(state, 'p_sol')).toEqual([]);
    }
    expect(arriveConvoys(state, 'p_sol')[0].outcome).toBe('landed');
  });
});

describe('when the war moves on without it', () => {
  it('turns back when the destination is no longer theirs', () => {
    const { state } = freshGalaxy();
    state.territories[SOL_A].unit_count = 10;
    state.territories[RUST_A].owner_id = 'p_sol';
    state.territories[RUST_A].unit_count = 1;
    launchConvoy(state, 'p_sol', SOL_A, RUST_A, 6);

    state.territories[RUST_A].owner_id = 'p_rust'; // the Syndicate takes it back
    const [arrival] = arriveConvoys(state, 'p_sol');
    expect(arrival.outcome).toBe('turned_back');
    expect(state.territories[SOL_A].unit_count).toBe(10); // 4 left + 6 home again
    expect(state.territories[RUST_A].unit_count).toBe(1); // the rival gains nothing
  });

  it('is lost when neither end is theirs any more', () => {
    const { state } = freshGalaxy();
    state.territories[SOL_A].unit_count = 10;
    state.territories[RUST_A].owner_id = 'p_sol';
    launchConvoy(state, 'p_sol', SOL_A, RUST_A, 6);

    state.territories[RUST_A].owner_id = 'p_rust';
    state.territories[SOL_A].owner_id = 'p_verdan';
    const [arrival] = arriveConvoys(state, 'p_sol');
    expect(arrival.outcome).toBe('lost');
    expect(state.territories[SOL_A].unit_count).toBe(4);
    expect(unitsInTransit(state, 'p_sol')).toBe(0);
  });

  it('drops convoys whose endpoints a map change removed', () => {
    const { state, map } = freshGalaxy();
    state.territories[RUST_A].owner_id = 'p_sol';
    state.territories[SOL_A].unit_count = 10;
    launchConvoy(state, 'p_sol', SOL_A, RUST_A, 2);
    expect(pruneStrandedConvoys(map, state)).toBe(false);
    map.territories = map.territories.filter((t) => t.territory_id !== RUST_A);
    expect(pruneStrandedConvoys(map, state)).toBe(true);
    expect(state.transits).toBeUndefined();
  });
});
