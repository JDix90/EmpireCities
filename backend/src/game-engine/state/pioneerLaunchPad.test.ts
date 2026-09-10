import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import type { GameMap, GameState, GameSettings } from '../../types';
import { initializeGameState } from './gameStateManager';
import { SPACE_AGE_FACTIONS } from '../eras/spaceage';
import { LAUNCH_PAD_LANE_SOURCE, connectionRequiresMoonAccess } from './moonAccess';
import { isLunarTerritory } from './helium3';

/**
 * The Lunar Pioneers' starting Launch Pad.
 *
 * Their one-line description promises "Moon access from turn one", and
 * `getMoonAccessState` does waive the tech ladder for them. But access is a
 * PERMISSION and reaching the Moon needs a ROUTE: all three authored orbit lanes
 * anchor in rival home regions (two in Terran's, one in Sino's) and none in
 * Oceania, so the Moon-native faction had to climb sa_orbital_recon →
 * sa_launch_pad_tech (12 TP) → launch_pad (8 gold) — the same first two rungs as
 * everyone, on the worst economy on the board — before it could go home.
 *
 * What these tests hold is the whole chain, because any link failing silently
 * leaves the pad decorative: the building is placed, the lane it opens exists at
 * init, and the lane actually reaches the Moon.
 */

const AUTHORED = JSON.parse(
  readFileSync(join(__dirname, '../../../../database/maps/era_space_age.json'), 'utf-8'),
) as GameMap;

const freshMap = () => JSON.parse(JSON.stringify(AUTHORED)) as GameMap;

function settings(overrides: Partial<GameSettings> = {}): GameSettings {
  return {
    fog_of_war: false, turn_timer_seconds: 0, initial_unit_count: 3, card_set_escalating: false,
    diplomacy_enabled: false, factions_enabled: true, economy_enabled: true, tech_trees_enabled: true,
    stability_enabled: false, allowed_victory_conditions: ['domination'], victory_type: 'domination',
    space_age_frontiers_enabled: false,
    ...overrides,
  } as unknown as GameSettings;
}

/** A game where p1 is guaranteed the Pioneers (the only faction requested). */
function game(map: GameMap, overrides: Partial<GameSettings> = {}): GameState {
  const players = [
    { player_id: 'p1', player_index: 0, username: 'p1', color: '#fff', is_ai: false, is_eliminated: false, mmr: 1000, faction_id: 'lunar_pioneers' },
    { player_id: 'p2', player_index: 1, username: 'p2', color: '#000', is_ai: false, is_eliminated: false, mmr: 1000, faction_id: 'terran_federation' },
  ];
  return initializeGameState('pioneer-test', 'space_age', map, players, settings(overrides), { forceStartingPlayerIndex: 0 });
}

const padTilesOf = (state: GameState, playerId: string) => Object.values(state.territories)
  .filter((t) => t.owner_id === playerId && (t.buildings?.includes('launch_pad') ?? false));

describe('the board is why the promise was empty', () => {
  it('anchors every authored orbit lane outside the Pioneer home', () => {
    // The premise of the whole fix, asserted rather than asserted-in-prose: if
    // an authored lane is ever added in Oceania this test should fail and the
    // starting pad be reconsidered.
    const map = freshMap();
    const region = new Map(map.territories.map((t) => [t.territory_id, (t as { region_id?: string }).region_id]));
    const authored = map.connections.filter((c) => c.type === 'orbit' && c.source !== LAUNCH_PAD_LANE_SOURCE);
    expect(authored.length).toBeGreaterThan(0);
    for (const c of authored) {
      expect(region.get(c.from)).not.toBe('oceania_2100');
      expect(region.get(c.to)).not.toBe('oceania_2100');
    }
  });
});

describe('what the Pioneers start with', () => {
  it('declares the pad as data, not as a hardcoded faction check', () => {
    const pioneers = SPACE_AGE_FACTIONS.find((f) => f.faction_id === 'lunar_pioneers');
    expect(pioneers?.starting_building).toBe('launch_pad');
  });

  it('places exactly one pad, on ground they own', () => {
    const state = game(freshMap());
    const pads = padTilesOf(state, 'p1');
    expect(pads).toHaveLength(1);
    expect(pads[0].owner_id).toBe('p1');
  });

  it('gives no other faction a starting building', () => {
    const state = game(freshMap());
    expect(padTilesOf(state, 'p2')).toHaveLength(0);
    for (const f of SPACE_AGE_FACTIONS) {
      if (f.faction_id !== 'lunar_pioneers') expect(f.starting_building).toBeUndefined();
    }
  });

  it('places nothing when the game has no economy to build with', () => {
    // No economy means no buildings arrays at all, so the board is equally bare
    // for everyone and a lone pad would be an orphan.
    const state = game(freshMap(), { economy_enabled: false });
    expect(padTilesOf(state, 'p1')).toHaveLength(0);
  });

  it('places nothing when factions are off', () => {
    const state = game(freshMap(), { factions_enabled: false });
    expect(Object.values(state.territories).some((t) => t.buildings?.includes('launch_pad'))).toBe(false);
  });
});

describe('the pad opens a real route at init', () => {
  it('has its orbit lane already synced before turn one', () => {
    // The failure mode this guards: gameRoomManager syncs lanes on room load and
    // the balance sim only syncs after a pad is BUILT during play, so a pad
    // seeded at init opened nothing until something else happened to trigger a
    // sync. The building would have been decorative.
    const map = freshMap();
    const state = game(map);
    const padId = padTilesOf(state, 'p1')[0].territory_id;
    const lane = map.connections.find(
      (c) => c.source === LAUNCH_PAD_LANE_SOURCE && (c.from === padId || c.to === padId),
    );
    expect(lane).toBeDefined();
    expect(lane!.type).toBe('orbit');
  });

  it('lands that lane on the Moon, and gates it behind Moon access', () => {
    const map = freshMap();
    const state = game(map);
    const padId = padTilesOf(state, 'p1')[0].territory_id;
    const lane = map.connections.find(
      (c) => c.source === LAUNCH_PAD_LANE_SOURCE && (c.from === padId || c.to === padId),
    )!;
    const moonEnd = lane.from === padId ? lane.to : lane.from;
    expect(isLunarTerritory(state.territories[moonEnd])).toBe(true);
    expect(connectionRequiresMoonAccess(map, padId, moonEnd)).toBe(true);
  });

  it('is deterministic — the same game seeds the same pad tile', () => {
    // The host is chosen by connection degree with an id tie-break, so a replay
    // or a reloaded room cannot land the pad somewhere else.
    const a = padTilesOf(game(freshMap()), 'p1')[0].territory_id;
    const b = padTilesOf(game(freshMap()), 'p1')[0].territory_id;
    expect(a).toBe(b);
  });
});
