import { describe, it, expect, vi } from 'vitest';
import {
  FIRST_MATCH_ERA_ID,
  FIRST_MATCH_MAP_ID,
  FIRST_MATCH_PREFS,
  fetchFirstMatchPending,
  firstMatchPendingFromStats,
} from './firstMatch';
import { quickMatchVictorySettings } from './quickMatchPrefs';
import { LOBBY_ERA_MAP_IDS } from '../constants/lobbyMapOptions';

describe('the first match', () => {
  it('is one Easy bot under the default Conquest ending', () => {
    expect(FIRST_MATCH_PREFS).toEqual({ aiCount: 1, aiDifficulty: 'easy', victory: 'majority' });
    expect(quickMatchVictorySettings(FIRST_MATCH_PREFS)).toMatchObject({
      allowed_victory_conditions: ['domination', 'threshold'],
      victory_threshold: 65,
    });
  });

  it('plays Great Britain 925 under the medieval rules era the lobby recommends for it', () => {
    expect(FIRST_MATCH_MAP_ID).toBe('community_britain_925');
    expect(FIRST_MATCH_ERA_ID).toBe('medieval');
    expect(LOBBY_ERA_MAP_IDS[FIRST_MATCH_ERA_ID]).toBe('era_medieval');
  });
});

describe('firstMatchPendingFromStats', () => {
  it('is pending only when no game has been finished', () => {
    expect(firstMatchPendingFromStats({ overall: { played: 0, won: 0 } })).toBe(true);
    expect(firstMatchPendingFromStats({ overall: { played: 1, won: 0 } })).toBe(false);
  });

  it('cannot tell from a response it does not recognise', () => {
    expect(firstMatchPendingFromStats(null)).toBeNull();
    expect(firstMatchPendingFromStats({})).toBeNull();
    expect(firstMatchPendingFromStats({ overall: { played: '0' } })).toBeNull();
  });
});

describe('fetchFirstMatchPending', () => {
  it('asks the stats endpoint', async () => {
    const get = vi.fn().mockResolvedValue({ data: { overall: { played: 0 } } });
    expect(await fetchFirstMatchPending(get, false)).toBe(true);
    expect(get).toHaveBeenCalledWith('/users/me/stats');
  });

  it("leaves a player's own Quick Match setup alone, without asking", async () => {
    const get = vi.fn();
    expect(await fetchFirstMatchPending(get, true)).toBe(false);
    expect(get).not.toHaveBeenCalled();
  });

  it('falls back to the ordinary Quick Match when the check fails or reads oddly', async () => {
    expect(await fetchFirstMatchPending(vi.fn().mockRejectedValue(new Error('offline')), false)).toBe(false);
    expect(await fetchFirstMatchPending(vi.fn().mockResolvedValue({ data: {} }), false)).toBe(false);
  });
});
