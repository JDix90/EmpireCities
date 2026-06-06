import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { GameState } from '../../src/types';

vi.mock('../../src/db/postgres', () => ({
  queryOne: vi.fn(),
}));

vi.mock('../../src/sockets/redisGameStore', () => ({
  getGameState: vi.fn(),
}));

import { queryOne } from '../../src/db/postgres';
import { getGameState } from '../../src/sockets/redisGameStore';
import { compareGameStateStores } from './compareGameStateStores';

const baseState = (): GameState =>
  ({
    game_id: 'g1',
    era: 'ancient',
    map_id: 'era_ancient',
    phase: 'draft',
    current_player_index: 0,
    turn_number: 1,
    players: [],
    territories: {},
    card_deck: [],
    card_set_redemption_count: 0,
    diplomacy: [],
    settings: { turn_timer_seconds: 0 } as GameState['settings'],
    draft_units_remaining: 3,
    turn_started_at: Date.now(),
  }) as GameState;

describe('compareGameStateStores', () => {
  beforeEach(() => {
    vi.mocked(getGameState).mockReset();
    vi.mocked(queryOne).mockReset();
  });

  it('reports ok when redis and postgres match', async () => {
    const state = baseState();
    vi.mocked(getGameState).mockResolvedValue(state);
    vi.mocked(queryOne).mockResolvedValue({ turn_number: 1, state_json: { ...state } });

    const result = await compareGameStateStores('g1');
    expect(result.ok).toBe(true);
    expect(result.diffs).toHaveLength(0);
  });

  it('flags turn_number mismatch', async () => {
    const redis = baseState();
    const pg = { ...baseState(), turn_number: 2 };
    vi.mocked(getGameState).mockResolvedValue(redis);
    vi.mocked(queryOne).mockResolvedValue({ turn_number: 2, state_json: pg });

    const result = await compareGameStateStores('g1');
    expect(result.ok).toBe(false);
    expect(result.diffs.some((d) => d.includes('turn_number'))).toBe(true);
  });

  it('ignores turn_started_at drift', async () => {
    const redis = baseState();
    const pg = { ...baseState(), turn_started_at: redis.turn_started_at + 50_000 };
    vi.mocked(getGameState).mockResolvedValue(redis);
    vi.mocked(queryOne).mockResolvedValue({ turn_number: 1, state_json: pg });

    const result = await compareGameStateStores('g1');
    expect(result.ok).toBe(true);
  });
});
