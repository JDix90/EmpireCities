import { describe, it, expect, afterEach } from 'vitest';
import type { GameState, PlayerState } from '../../types';
import { computeRanks, resolveXpConfig } from './statsManager';
import { resetAdminConfigCacheForTests, setAdminConfigCacheForTests } from '../../services/adminConfig';

function makePlayer(overrides: Partial<PlayerState>): PlayerState {
  return {
    player_id: 'p',
    player_index: 0,
    username: 'p',
    color: '#fff',
    is_ai: false,
    is_eliminated: false,
    territory_count: 0,
    cards: [],
    mmr: 1000,
    capital_territory_id: null,
    secret_mission: null,
    ...overrides,
  };
}

describe('computeRanks', () => {
  it('ranks the winner first and eliminated players by territory count', () => {
    const players = [
      makePlayer({ player_id: 'win', territory_count: 30 }),
      makePlayer({ player_id: 'a', is_eliminated: true, territory_count: 5 }),
      makePlayer({ player_id: 'b', is_eliminated: true, territory_count: 9 }),
    ];
    const ranks = computeRanks(players, 'win');
    expect(ranks.get('win')).toBe(1);
    expect(ranks.get('b')).toBe(2);
    expect(ranks.get('a')).toBe(3);
  });

  it('ranks resigners below players eliminated in combat', () => {
    const players = [
      makePlayer({ player_id: 'win', territory_count: 30 }),
      makePlayer({ player_id: 'fought', is_eliminated: true, territory_count: 1 }),
      makePlayer({ player_id: 'quit', is_eliminated: true, has_resigned: true, territory_count: 12 }),
    ];
    const ranks = computeRanks(players, 'win');
    expect(ranks.get('fought')).toBe(2);
    expect(ranks.get('quit')).toBe(3);
  });

  it('ranks survivors above eliminated players on non-domination wins', () => {
    const players = [
      makePlayer({ player_id: 'win', territory_count: 20 }),
      makePlayer({ player_id: 'alive', territory_count: 8 }),
      makePlayer({ player_id: 'dead', is_eliminated: true, territory_count: 0 }),
    ];
    const ranks = computeRanks(players, 'win');
    expect(ranks.get('alive')).toBe(2);
    expect(ranks.get('dead')).toBe(3);
  });
});

describe('resolveXpConfig', () => {
  afterEach(() => {
    resetAdminConfigCacheForTests();
  });

  it('uses cached config when no snapshot exists', () => {
    setAdminConfigCacheForTests({ xp: { base: 81 } as any });
    const state = { settings: {} } as GameState;
    expect(resolveXpConfig(state).base).toBe(81);
  });

  it('uses game snapshot over live cache values', () => {
    setAdminConfigCacheForTests({ xp: { base: 81 } as any });
    const state = {
      settings: {
        xp_snapshot: {
          base: 52,
        },
      },
    } as GameState;
    expect(resolveXpConfig(state).base).toBe(52);
  });
});
