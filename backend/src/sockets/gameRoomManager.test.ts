import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { GameState, GameMap } from '../types';

vi.mock('../db/postgres', () => ({
  query: vi.fn().mockResolvedValue(undefined),
  queryOne: vi.fn(),
}));

vi.mock('./mapResolver', () => ({
  resolveMap: vi.fn(),
}));

vi.mock('./redisGameStore', () => ({
  getGameState: vi.fn(),
  getGameMap: vi.fn(),
  setGameState: vi.fn(),
  setGameMap: vi.fn(),
  refreshGameTTL: vi.fn().mockResolvedValue(undefined),
  deleteGameKeys: vi.fn(),
  getConnectedPlayers: vi.fn().mockResolvedValue([]),
  markPlayerConnected: vi.fn(),
  markPlayerDisconnected: vi.fn(),
  acquireAiInFlight: vi.fn(),
  releaseAiInFlight: vi.fn(),
  isAiInFlight: vi.fn(),
}));

import { queryOne } from '../db/postgres';
import { resolveMap } from './mapResolver';
import { getGameState, getGameMap, setGameState } from './redisGameStore';
import {
  loadAuthoritativeRoom,
  persistGameStateAfterMutation,
  flushGameState,
  setCachedRoom,
  deleteCachedRoom,
  getCachedRoom,
} from './gameRoomManager';
import { resetMigrationMetrics, getMigrationMetrics } from './migrationMetrics';

function makeState(gameId: string, turn = 3): GameState {
  return {
    game_id: gameId,
    era: 'ancient',
    map_id: 'test_map',
    phase: 'draft',
    current_player_index: 0,
    turn_number: turn,
    players: [],
    territories: {},
    card_deck: [],
    card_set_redemption_count: 0,
    diplomacy: [],
    settings: {
      fog_of_war: false,
      turn_timer_seconds: 0,
      initial_unit_count: 3,
      card_set_escalating: true,
      diplomacy_enabled: false,
    },
    draft_units_remaining: 0,
    turn_started_at: Date.now(),
  };
}

function makeMap(): GameMap {
  return {
    map_id: 'test_map',
    name: 'Test',
    territories: [],
    connections: [],
    regions: [],
  };
}

describe('loadAuthoritativeRoom', () => {
  beforeEach(() => {
    deleteCachedRoom('game-auth-1');
    vi.mocked(getGameState).mockReset();
    vi.mocked(getGameMap).mockReset();
    vi.mocked(queryOne).mockReset();
  });

  it('prefers Redis over stale local cache', async () => {
    const stale = makeState('game-auth-1', 1);
    const fresh = makeState('game-auth-1', 5);
    const map = makeMap();
    setCachedRoom('game-auth-1', stale, map);

    vi.mocked(getGameState).mockResolvedValue(fresh);
    vi.mocked(getGameMap).mockResolvedValue(map);

    const room = await loadAuthoritativeRoom('game-auth-1');
    expect(room?.state.turn_number).toBe(5);
    expect(getCachedRoom('game-auth-1')?.state.turn_number).toBe(5);
  });

  it('falls back to local cache when Redis is empty', async () => {
    const cached = makeState('game-auth-1', 2);
    const map = makeMap();
    setCachedRoom('game-auth-1', cached, map);

    vi.mocked(getGameState).mockResolvedValue(null);

    const room = await loadAuthoritativeRoom('game-auth-1');
    expect(room?.state.turn_number).toBe(2);
  });

  it('self-heals from Postgres when every layer misses and no mapId was passed', async () => {
    vi.mocked(getGameState).mockResolvedValue(null);
    vi.mocked(queryOne).mockImplementation(async (sql: string) => {
      if (sql.includes('FROM games')) return { map_id: 'test_map' };
      if (sql.includes('FROM game_states')) return { state_json: makeState('game-auth-1', 7) };
      return null;
    });
    vi.mocked(resolveMap).mockResolvedValue(makeMap());

    const room = await loadAuthoritativeRoom('game-auth-1');
    expect(room?.state.turn_number).toBe(7);
    // Recovery warms Redis so the next action takes the fast path again.
    expect(setGameState).toHaveBeenCalled();
  });

  it('does not resurrect games that are no longer in progress', async () => {
    vi.mocked(getGameState).mockResolvedValue(null);
    // Status filter excludes the finished game → games lookup returns null.
    vi.mocked(queryOne).mockResolvedValue(null);

    const room = await loadAuthoritativeRoom('game-auth-1');
    expect(room).toBeNull();
    // It must never have tried to load state backups without the games row.
    expect(vi.mocked(queryOne).mock.calls.every(([sql]) => !String(sql).includes('FROM game_states'))).toBe(true);
  });
});

describe('persistGameStateAfterMutation', () => {
  beforeEach(() => {
    resetMigrationMetrics();
    vi.mocked(setGameState).mockReset();
    vi.mocked(setGameState).mockResolvedValue(undefined);
  });

  it('writes Redis immediately', async () => {
    const state = makeState('game-persist-1');
    await persistGameStateAfterMutation('game-persist-1', state);
    expect(setGameState).toHaveBeenCalledWith('game-persist-1', state);
  });

  it('records metric when Redis write fails', async () => {
    vi.mocked(setGameState).mockRejectedValue(new Error('redis down'));
    await expect(persistGameStateAfterMutation('game-persist-1', makeState('game-persist-1'))).rejects.toThrow();
    expect(getMigrationMetrics().redis_save_failures).toBe(1);
  });
});

describe('flushGameState', () => {
  beforeEach(() => {
    vi.mocked(setGameState).mockResolvedValue(undefined);
  });

  it('writes Redis immediately on flush', async () => {
    const state = makeState('game-flush-1');
    await flushGameState('game-flush-1', state);
    expect(setGameState).toHaveBeenCalledWith('game-flush-1', state);
  });
});
