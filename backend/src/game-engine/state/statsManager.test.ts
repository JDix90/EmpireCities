import { describe, it, expect, afterEach } from 'vitest';
import type { GameState, PlayerState } from '../../types';
import { computeRanks, resolveXpConfig, redactGuestRatings, levelBand, resultsXpSummary, type GameResultContext } from './statsManager';
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
    const ranks = computeRanks(players, ['win']);
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
    const ranks = computeRanks(players, ['win']);
    expect(ranks.get('fought')).toBe(2);
    expect(ranks.get('quit')).toBe(3);
  });

  it('gives all alliance winners rank 1 and starts others below them', () => {
    const players = [
      makePlayer({ player_id: 'ally1', territory_count: 10 }),
      makePlayer({ player_id: 'ally2', territory_count: 8 }),
      makePlayer({ player_id: 'loser', territory_count: 4 }),
    ];
    const ranks = computeRanks(players, ['ally1', 'ally2']);
    expect(ranks.get('ally1')).toBe(1);
    expect(ranks.get('ally2')).toBe(1);
    expect(ranks.get('loser')).toBe(3);
  });

  it('ranks survivors above eliminated players on non-domination wins', () => {
    const players = [
      makePlayer({ player_id: 'win', territory_count: 20 }),
      makePlayer({ player_id: 'alive', territory_count: 8 }),
      makePlayer({ player_id: 'dead', is_eliminated: true, territory_count: 0 }),
    ];
    const ranks = computeRanks(players, ['win']);
    expect(ranks.get('alive')).toBe(2);
    expect(ranks.get('dead')).toBe(3);
  });
});

describe('redactGuestRatings', () => {
  function ctx(overrides: Partial<GameResultContext> = {}): GameResultContext {
    return {
      isRanked: false,
      ratingDeltas: new Map([['guest1', -263], ['reg1', 12]]),
      ratingProvisional: new Map([['guest1', true], ['reg1', false]]),
      ratingPlacement: new Map([['guest1', 1], ['reg1', 3]]),
      guestPlayerIds: new Set(['guest1']),
      xpEarnedByPlayer: { guest1: 25, reg1: 40 },
      ...overrides,
    };
  }

  it('removes guest players from both emitted rating maps', () => {
    const out = redactGuestRatings(ctx());
    expect(out.rating_deltas).toEqual({ reg1: 12 });
    expect(out.rating_provisional).toEqual({ reg1: false });
    // Placement games (placement_rating_enabled) are part of the rating, so they go too.
    expect(out.rating_placement).toEqual({ reg1: 3 });
  });

  it('passes everything through when no guests played', () => {
    const out = redactGuestRatings(ctx({ guestPlayerIds: new Set() }));
    expect(out.rating_deltas).toEqual({ guest1: -263, reg1: 12 });
  });

  it('never touches the XP map — progression is the part guests keep', () => {
    const c = ctx();
    redactGuestRatings(c);
    expect(c.xpEarnedByPlayer).toEqual({ guest1: 25, reg1: 40 });
  });

  it('shows a guest their rating change once guests are ranked on the boards', () => {
    setAdminConfigCacheForTests({ feature_flags: { guest_leaderboards_enabled: true } });
    try {
      const out = redactGuestRatings(ctx());
      expect(out.rating_deltas).toEqual({ guest1: -263, reg1: 12 });
      expect(out.rating_provisional).toEqual({ guest1: true, reg1: false });
    } finally {
      resetAdminConfigCacheForTests();
    }
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

describe('the results screen\'s level bar (levelBand, resultsXpSummary)', () => {
  it('gives each total its level and the XP that level starts and ends at', () => {
    expect(levelBand(0)).toEqual({ xp: 0, level: 1, floor: 0, next: 250 });
    expect(levelBand(249)).toEqual({ xp: 249, level: 1, floor: 0, next: 250 });
    expect(levelBand(250)).toEqual({ xp: 250, level: 2, floor: 250, next: 1000 });
    expect(levelBand(1155)).toEqual({ xp: 1155, level: 3, floor: 1000, next: 2250 });
    expect(levelBand(-40)).toEqual({ xp: 0, level: 1, floor: 0, next: 250 });
  });

  it('takes the game\'s XP and every medal\'s off the total now, to find where the game began', () => {
    // The review's guest: a win paid 105 XP, two medals 1,000 more, and the
    // lobby then showed 1,155 XP at Level 3 after a screen that said "+105 XP".
    const summary = resultsXpSummary(1155, 105, [{ id: 'first_victory', xp: 500 }, { id: 'conqueror', xp: 500 }]);
    expect(summary.before).toEqual({ xp: 50, level: 1, floor: 0, next: 250 });
    expect(summary.after).toEqual({ xp: 1155, level: 3, floor: 1000, next: 2250 });
    expect(summary.game).toBe(105);
    expect(summary.medals).toHaveLength(2);
  });

  it('never starts below nothing', () => {
    expect(resultsXpSummary(80, 105, []).before).toEqual({ xp: 0, level: 1, floor: 0, next: 250 });
  });
});
