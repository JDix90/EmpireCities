/**
 * The route a fortify needs (state/fortifyRoute.ts): a path over the mover's
 * own ground that crosses no orbit lane it cannot use, and an open orbit gate
 * between two worlds. Players' moves (game:fortify) and bots' share it.
 */
import { describe, it, expect } from 'vitest';
import type { GameMap, GameState, PlayerState } from '../../types';
import { fortifyRouteAllowed, pathExists } from './fortifyRoute';

/** Earth's Cape and East by land; the Cape's pad to Moon A by orbit; Moon A to Moon B by land. */
const MAP = {
  map_id: 'era_space_age_mini',
  name: 'Mini Space Age',
  territories: [
    { territory_id: 'na_launch_base', name: 'Cape', polygon: [], center_point: [0, 0], region_id: 'na' },
    { territory_id: 'na_east', name: 'East', polygon: [], center_point: [0, 0], region_id: 'na' },
    { territory_id: 'moon_a', name: 'Moon A', polygon: [], center_point: [0, 0], region_id: 'lunar_surface', globe_id: 'moon' },
    { territory_id: 'moon_b', name: 'Moon B', polygon: [], center_point: [0, 0], region_id: 'lunar_surface', globe_id: 'moon' },
  ],
  connections: [
    { from: 'na_launch_base', to: 'na_east', type: 'land' },
    { from: 'na_launch_base', to: 'moon_a', type: 'orbit' },
    { from: 'moon_a', to: 'moon_b', type: 'land' },
  ],
  regions: [
    { region_id: 'na', name: 'North America', bonus: 3 },
    { region_id: 'lunar_surface', name: 'Lunar Surface', bonus: 6 },
  ],
} as GameMap;

function board(owners: Record<string, string>, over: Partial<GameState> = {}): GameState {
  const territories = Object.fromEntries(Object.entries(owners).map(([id, owner]) => [
    id,
    { territory_id: id, owner_id: owner, unit_count: 5, buildings: id === 'na_launch_base' ? ['launch_pad'] : [] },
  ]));
  return { era: 'space_age', settings: {}, territories, ...over } as unknown as GameState;
}

const ALL_P1 = { na_launch_base: 'p1', na_east: 'p1', moon_a: 'p1', moon_b: 'p1' };
const gated = { player_id: 'p1', unlocked_techs: [] } as unknown as PlayerState;
const cleared = { player_id: 'p1', unlocked_techs: ['sa_lunar_expansion'], space_station_launched: true } as unknown as PlayerState;

describe('pathExists', () => {
  it('walks only the owner\'s ground', () => {
    expect(pathExists('na_east', 'moon_b', board(ALL_P1), MAP, 'p1')).toBe(true);
    expect(pathExists('na_east', 'moon_b', board({ ...ALL_P1, moon_a: 'p2' }), MAP, 'p1')).toBe(false);
  });
});

describe('fortifyRouteAllowed', () => {
  it('allows a move over the player\'s own land', () => {
    expect(fortifyRouteAllowed(board(ALL_P1), MAP, gated, 'na_east', 'na_launch_base')).toBe(true);
    expect(fortifyRouteAllowed(board(ALL_P1), MAP, gated, 'moon_a', 'moon_b')).toBe(true);
  });

  it('refuses a move with no path of the player\'s own', () => {
    expect(fortifyRouteAllowed(board({ ...ALL_P1, na_launch_base: 'p2' }), MAP, cleared, 'na_east', 'moon_a')).toBe(false);
  });

  it('refuses an orbit lane the player cannot cross, at either end of the route or inside it', () => {
    // Inside: East to Moon B crosses the lane at the Cape. At the ends: Cape to Moon A is the lane.
    expect(fortifyRouteAllowed(board(ALL_P1), MAP, gated, 'na_east', 'moon_b')).toBe(false);
    expect(fortifyRouteAllowed(board(ALL_P1), MAP, gated, 'na_launch_base', 'moon_a')).toBe(false);
    expect(fortifyRouteAllowed(board(ALL_P1), MAP, cleared, 'na_east', 'moon_b')).toBe(true);
    expect(fortifyRouteAllowed(board(ALL_P1), MAP, cleared, 'na_launch_base', 'moon_a')).toBe(true);
  });

  it('refuses a lane sealed against the player, and not for the one who sealed it', () => {
    const sealed = board(ALL_P1, { lane_blockades: { 'moon_a::na_launch_base': { owner_id: 'p2', turns_remaining: 2 } } } as Partial<GameState>);
    expect(fortifyRouteAllowed(sealed, MAP, cleared, 'na_launch_base', 'moon_a')).toBe(false);
    const theirs = board({ na_launch_base: 'p2', na_east: 'p2', moon_a: 'p2', moon_b: 'p2' }, { lane_blockades: { 'moon_a::na_launch_base': { owner_id: 'p2', turns_remaining: 2 } } } as Partial<GameState>);
    expect(fortifyRouteAllowed(theirs, MAP, { ...cleared, player_id: 'p2' } as PlayerState, 'na_launch_base', 'moon_a')).toBe(true);
  });
});
