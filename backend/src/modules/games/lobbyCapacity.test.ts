/**
 * The seat-cap rule, pinned. `publicGames.routes.test.ts` pins the SQL twin
 * against a real database; this file pins the TypeScript one that
 * `/:gameId/join` and `/:gameId/invite` gate on.
 */
import { describe, it, expect } from 'vitest';
import {
  DEFAULT_MAX_PLAYERS,
  GALAXY_PLAYER_COUNT_ERROR,
  PUBLIC_LOBBY_GAME_TYPES,
  effectiveMaxPlayers,
  galaxySeatCountError,
  isGalacticAgeGame,
  lobbySeatCap,
} from './lobbyCapacity';

describe('effectiveMaxPlayers', () => {
  it('reads a numeric max_players straight through', () => {
    expect(effectiveMaxPlayers({ max_players: 4 })).toBe(4);
    // What LobbyPage's "Full Game" button sends with one AI opponent — the
    // lobby that showed "2/8" and then 409'd.
    expect(effectiveMaxPlayers({ max_players: 2 })).toBe(2);
  });

  it('falls back to 8 when the key is absent — campaign never writes it', () => {
    expect(effectiveMaxPlayers({ is_campaign: true, player_count: 3 })).toBe(DEFAULT_MAX_PLAYERS);
    expect(effectiveMaxPlayers({})).toBe(DEFAULT_MAX_PLAYERS);
    expect(effectiveMaxPlayers(null)).toBe(DEFAULT_MAX_PLAYERS);
    expect(effectiveMaxPlayers(undefined)).toBe(DEFAULT_MAX_PLAYERS);
  });

  it('clamps a stored value outside 2…8 rather than trusting it', () => {
    expect(effectiveMaxPlayers({ max_players: 99 })).toBe(8);
    expect(effectiveMaxPlayers({ max_players: 1 })).toBe(2);
    expect(effectiveMaxPlayers({ max_players: 0 })).toBe(2);
    expect(effectiveMaxPlayers({ max_players: -5 })).toBe(2);
  });

  it('ignores a non-numeric max_players instead of producing NaN', () => {
    expect(effectiveMaxPlayers({ max_players: '4' })).toBe(DEFAULT_MAX_PLAYERS);
    expect(effectiveMaxPlayers({ max_players: null })).toBe(DEFAULT_MAX_PLAYERS);
    expect(effectiveMaxPlayers({ max_players: NaN })).toBe(DEFAULT_MAX_PLAYERS);
  });

  it('floors a fractional cap, matching the SQL twin', () => {
    expect(effectiveMaxPlayers({ max_players: 4.7 })).toBe(4);
  });

  it('accepts settings_json still in its unparsed string form', () => {
    expect(effectiveMaxPlayers('{"max_players":3}')).toBe(3);
    expect(effectiveMaxPlayers('not json')).toBe(DEFAULT_MAX_PLAYERS);
  });
});

describe('PUBLIC_LOBBY_GAME_TYPES', () => {
  it('advertises open and mixed lobbies, never a single-player session', () => {
    expect([...PUBLIC_LOBBY_GAME_TYPES]).toEqual(['multiplayer', 'hybrid']);
    // Campaign, daily and tutorial all insert game_type 'solo'.
    expect(PUBLIC_LOBBY_GAME_TYPES).not.toContain('solo');
  });
});

describe('the Galactic Age seat cap', () => {
  it('knows a Galactic game by its era or its board', () => {
    expect(isGalacticAgeGame('galaxy_age', 'era_galaxy')).toBe(true);
    expect(isGalacticAgeGame('custom', 'era_galaxy')).toBe(true);
    expect(isGalacticAgeGame('galaxy_age', 'some_map')).toBe(true);
    expect(isGalacticAgeGame('space_age', 'era_ascension_galaxy')).toBe(false);
    expect(isGalacticAgeGame('ww2', 'era_ww2')).toBe(false);
  });

  it('seats two to four', () => {
    expect([1, 2, 3, 4, 5, 8].map(galaxySeatCountError)).toEqual([
      GALAXY_PLAYER_COUNT_ERROR, null, null, null, GALAXY_PLAYER_COUNT_ERROR, GALAXY_PLAYER_COUNT_ERROR,
    ]);
  });

  it('caps a Galactic lobby at four even when it stored eight, and leaves the rest alone', () => {
    expect(lobbySeatCap({ max_players: 8 }, 'galaxy_age', 'era_galaxy')).toBe(4);
    expect(lobbySeatCap({}, 'galaxy_age', 'era_galaxy')).toBe(4);
    expect(lobbySeatCap({ max_players: 3 }, 'galaxy_age', 'era_galaxy')).toBe(3);
    expect(lobbySeatCap({ max_players: 8 }, 'ww2', 'era_ww2')).toBe(8);
    expect(lobbySeatCap({ max_players: 6 }, 'space_age', 'era_space_age')).toBe(6);
  });
});
