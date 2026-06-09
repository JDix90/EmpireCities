import { describe, expect, it } from 'vitest';
import {
  isSameLobbyMap,
  lobbyMapChangeBlockedReason,
  parseLobbyMapChangeValue,
} from './lobbyMapChange';
import {
  formatRulesAndTheaterDisplay as formatLobbyMapChangeDisplay,
  validateLobbyMapChangePair,
} from './lobbyEraMapCompatibility';

describe('lobbyMapChange', () => {
  it('parses valid map change payloads', () => {
    expect(parseLobbyMapChangeValue({ era_id: 'ww2', map_id: 'era_ww2' })).toEqual({
      era_id: 'ww2',
      map_id: 'era_ww2',
    });
    expect(parseLobbyMapChangeValue({ era_id: 'medieval', map_id: 'community_britain_925' })).toEqual({
      era_id: 'medieval',
      map_id: 'community_britain_925',
    });
  });

  it('rejects invalid map change payloads', () => {
    expect(parseLobbyMapChangeValue(null)).toBeNull();
    expect(parseLobbyMapChangeValue({ era_id: 'bogus', map_id: 'era_ww2' })).toBeNull();
    expect(parseLobbyMapChangeValue({ era_id: 'ww2', map_id: '../evil' })).toBeNull();
  });

  it('blocks map changes for special game modes', () => {
    expect(
      lobbyMapChangeBlockedReason({
        era_id: 'ww2',
        map_id: 'era_ww2',
        is_ranked: false,
        settings: { tutorial: true },
      }),
    ).toMatch(/tutorial/i);

    expect(
      lobbyMapChangeBlockedReason({
        era_id: 'ww2',
        map_id: 'era_ww2',
        is_ranked: true,
        settings: {},
      }),
    ).toMatch(/ranked/i);
  });

  it('validates built-in, community, and unpaired map pairs', () => {
    expect(validateLobbyMapChangePair({ era_id: 'ww2', map_id: 'era_ww2' }, { isAdmin: false })).toBeNull();
    expect(
      validateLobbyMapChangePair(
        { era_id: 'medieval', map_id: 'community_britain_925' },
        { isAdmin: false },
      ),
    ).toBeNull();
    expect(
      validateLobbyMapChangePair({ era_id: 'ww2', map_id: 'era_ancient' }, { isAdmin: false }),
    ).toBeNull();
    expect(
      validateLobbyMapChangePair({ era_id: 'galaxy_age', map_id: 'era_galaxy' }, { isAdmin: false }),
    ).toMatch(/administrators/i);
    expect(
      validateLobbyMapChangePair({ era_id: 'galaxy_age', map_id: 'era_galaxy' }, { isAdmin: true }),
    ).toBeNull();
  });

  it('formats display labels for era and custom pairings', () => {
    expect(formatLobbyMapChangeDisplay('ww2', 'era_ww2')).toBe('World War II');
    expect(formatLobbyMapChangeDisplay('medieval', 'community_britain_925')).toBe(
      'Great Britain 925 A.D. · Medieval Era rules',
    );
    expect(formatLobbyMapChangeDisplay('ww2', 'era_ancient')).toBe(
      'Ancient World · World War II rules',
    );
  });

  it('detects unchanged map selections', () => {
    expect(
      isSameLobbyMap(
        { era_id: 'ww2', map_id: 'era_ww2' },
        { era_id: 'ww2', map_id: 'era_ww2' },
      ),
    ).toBe(true);
    expect(
      isSameLobbyMap(
        { era_id: 'ww2', map_id: 'era_ww2' },
        { era_id: 'ancient', map_id: 'era_ancient' },
      ),
    ).toBe(false);
  });
});
