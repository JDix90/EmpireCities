/**
 * The seat-cap rule, pinned. `publicGames.routes.test.ts` pins the SQL twin
 * against a real database; this file pins the TypeScript one that
 * `/:gameId/join` and `/:gameId/invite` gate on.
 */
import { describe, it, expect } from 'vitest';
import {
  DEFAULT_MAX_PLAYERS,
  GALAXY_PLAYER_COUNT_ERROR,
  seatsPerFaction,
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

  it('seats two to four, or eight for the Schism', () => {
    const E = GALAXY_PLAYER_COUNT_ERROR;
    expect([1, 2, 3, 4, 5, 6, 7, 8, 9].map(galaxySeatCountError)).toEqual([
      E, null, null, null, E, E, E, null, E,
    ]);
    expect(GALAXY_PLAYER_COUNT_ERROR).toMatch(/2 to 4 players .* or 8 for the Schism/);
  });

  it('caps a Galactic lobby at the largest count it plays, and leaves the rest alone', () => {
    // Eight is a Schism lobby; four to seven stop at four, where a fifth seat has no board.
    expect(lobbySeatCap({ max_players: 8 }, 'galaxy_age', 'era_galaxy')).toBe(8);
    expect(lobbySeatCap({}, 'galaxy_age', 'era_galaxy')).toBe(8);
    for (const max_players of [4, 5, 6, 7]) {
      expect(lobbySeatCap({ max_players }, 'galaxy_age', 'era_galaxy')).toBe(4);
    }
    expect(lobbySeatCap({ max_players: 6 }, 'custom', 'era_galaxy')).toBe(4);
    expect(lobbySeatCap({ max_players: 3 }, 'galaxy_age', 'era_galaxy')).toBe(3);
    expect(lobbySeatCap({ max_players: 2 }, 'galaxy_age', 'era_galaxy')).toBe(2);
    expect(lobbySeatCap({ max_players: 8 }, 'ww2', 'era_ww2')).toBe(8);
    expect(lobbySeatCap({ max_players: 6 }, 'space_age', 'era_space_age')).toBe(6);
  });

  it('lets two seats share a faction only in a Schism lobby', () => {
    expect(seatsPerFaction({ max_players: 8 }, 'galaxy_age', 'era_galaxy')).toBe(2);
    expect(seatsPerFaction(JSON.stringify({ max_players: 8 }), 'custom', 'era_galaxy')).toBe(2);
    expect(seatsPerFaction({ max_players: 4 }, 'galaxy_age', 'era_galaxy')).toBe(1);
    expect(seatsPerFaction({ max_players: 6 }, 'galaxy_age', 'era_galaxy')).toBe(1);
    expect(seatsPerFaction({ max_players: 8 }, 'ww2', 'era_ww2')).toBe(1);
  });
});
