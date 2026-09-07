import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import type { GameMap, GameState, GameSettings } from '../../types';
import { initializeGameState } from './gameStateManager';
import { applyBuild } from './economyManager';
import {
  LAUNCH_PAD_LANE_SOURCE,
  connectionRequiresMoonAccess,
  launchPadLaneConnections,
  nearestLandingZoneFor,
  syncLaunchPadLanes,
} from './moonAccess';

const AUTHORED = JSON.parse(
  readFileSync(join(__dirname, '../../../../database/maps/era_space_age.json'), 'utf-8'),
) as GameMap;

function freshMap(): GameMap {
  return JSON.parse(JSON.stringify(AUTHORED)) as GameMap;
}

function settings(overrides: Partial<GameSettings> = {}): GameSettings {
  return {
    fog_of_war: false, turn_timer_seconds: 0, initial_unit_count: 3, card_set_escalating: false,
    diplomacy_enabled: false, factions_enabled: false, economy_enabled: true, tech_trees_enabled: true,
    stability_enabled: false, allowed_victory_conditions: ['domination'], victory_type: 'domination',
    space_age_frontiers_enabled: false,
    ...overrides,
  } as unknown as GameSettings;
}

function game(map: GameMap, overrides: Partial<GameSettings> = {}): GameState {
  const players = ['p1', 'p2'].map((id, i) => ({
    player_id: id, player_index: i, username: id, color: '#fff', is_ai: false, is_eliminated: false, mmr: 1000,
  }));
  return initializeGameState('lanes-test', 'space_age', map, players, settings(overrides), { forceStartingPlayerIndex: 0 });
}

/** Give p1 a tile with a pad, bypassing tech and cost (the lane rule is what is under test). */
function padOn(state: GameState, territoryId: string, owner = 'p1'): void {
  const t = state.territories[territoryId];
  t.owner_id = owner;
  t.buildings = [...(t.buildings ?? []), 'launch_pad'];
}

describe('nearestLandingZoneFor', () => {
  const map = freshMap();

  it('sends a North American pad to Mare Frigoris via Cape Canaveral', () => {
    expect(nearestLandingZoneFor(map, 'na_eastern_corridor')).toEqual({
      earthAnchor: 'na_launch_base', moonTarget: 'moon_near_side_north',
    });
  });

  it('sends a Siberian pad to the Ocean of Storms via Gobi', () => {
    expect(nearestLandingZoneFor(map, 'asia_siberia_belt')).toEqual({
      earthAnchor: 'asia_cosmodrome', moonTarget: 'moon_oceanus_procellarum',
    });
  });

  it('sends a European pad to the Sea of Tranquility via Kourou', () => {
    expect(nearestLandingZoneFor(map, 'euro_nordic')).toEqual({
      earthAnchor: 'euro_spaceport', moonTarget: 'moon_mare_tranquillitatis',
    });
  });

  it('answers the anchor itself with its own lane', () => {
    expect(nearestLandingZoneFor(map, 'na_launch_base')?.moonTarget).toBe('moon_near_side_north');
  });

  it('opens nothing from the Moon or for unknown tiles', () => {
    expect(nearestLandingZoneFor(map, 'moon_mare_imbrium')).toBeNull();
    expect(nearestLandingZoneFor(map, 'nowhere')).toBeNull();
  });

  it('opens nothing on a map without authored orbit lanes', () => {
    const earthOnly = freshMap();
    earthOnly.connections = earthOnly.connections.filter((c) => c.type !== 'orbit');
    expect(nearestLandingZoneFor(earthOnly, 'na_eastern_corridor')).toBeNull();
  });
});

describe('syncLaunchPadLanes', () => {
  it('adds one orbit lane per pad, tagged as engine-added', () => {
    const map = freshMap();
    const state = game(map);
    const padId = 'la_pampas';
    padOn(state, padId);
    const before = map.connections.length;
    expect(syncLaunchPadLanes(map, state)).toBe(true);
    expect(map.connections.length).toBe(before + 1);
    const lane = map.connections[map.connections.length - 1];
    expect(lane.type).toBe('orbit');
    expect(lane.source).toBe(LAUNCH_PAD_LANE_SOURCE);
    expect(lane.from).toBe(padId);
    expect(lane.to).toBe(nearestLandingZoneFor(map, padId)!.moonTarget);
    expect(connectionRequiresMoonAccess(map, padId, lane.to)).toBe(true);
  });

  it('is idempotent', () => {
    const map = freshMap();
    const state = game(map);
    padOn(state, 'euro_nordic');
    expect(syncLaunchPadLanes(map, state)).toBe(true);
    const after = map.connections.length;
    expect(syncLaunchPadLanes(map, state)).toBe(false);
    expect(map.connections.length).toBe(after);
  });

  it('adds nothing for a pad on an authored spaceport already linked to the same landing zone', () => {
    const map = freshMap();
    const state = game(map);
    padOn(state, 'na_launch_base');
    expect(launchPadLaneConnections(map, state)).toEqual([]);
    expect(syncLaunchPadLanes(map, state)).toBe(false);
  });

  it('adds nothing for a pad on the Moon', () => {
    const map = freshMap();
    const state = game(map);
    padOn(state, 'moon_mare_imbrium');
    expect(syncLaunchPadLanes(map, state)).toBe(false);
  });

  it('removes the lane once the pad is gone', () => {
    const map = freshMap();
    const state = game(map);
    padOn(state, 'euro_nordic');
    syncLaunchPadLanes(map, state);
    state.territories.euro_nordic.buildings = [];
    expect(syncLaunchPadLanes(map, state)).toBe(true);
    expect(map.connections.some((c) => c.source === LAUNCH_PAD_LANE_SOURCE)).toBe(false);
  });

  it('keeps a lane when the pad territory changes hands', () => {
    const map = freshMap();
    const state = game(map);
    padOn(state, 'euro_nordic');
    syncLaunchPadLanes(map, state);
    state.territories.euro_nordic.owner_id = 'p2';
    expect(syncLaunchPadLanes(map, state)).toBe(false);
    expect(map.connections.some((c) => c.source === LAUNCH_PAD_LANE_SOURCE && c.from === 'euro_nordic')).toBe(true);
  });

  it('opens a lane from a seeded frontier tile', () => {
    const map = freshMap();
    const state = game(map, { space_age_frontiers_enabled: true });
    expect(state.territories.pacific_seasteads).toBeDefined();
    padOn(state, 'pacific_seasteads');
    expect(syncLaunchPadLanes(map, state)).toBe(true);
  });

  it('works through applyBuild with the real cost path', () => {
    const map = freshMap();
    const state = game(map, { tech_trees_enabled: false });
    const p1 = state.players[0];
    p1.special_resource = 50;
    const mine = Object.values(state.territories).find((t) => t.owner_id === 'p1' && t.world_id === 'earth')!;
    applyBuild(state, 'p1', mine.territory_id, 'launch_pad');
    expect(syncLaunchPadLanes(map, state)).toBe(true);
    expect(map.connections.some((c) => c.source === LAUNCH_PAD_LANE_SOURCE && c.from === mine.territory_id)).toBe(true);
  });
});
