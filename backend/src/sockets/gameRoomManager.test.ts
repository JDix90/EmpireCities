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

import { query, queryOne } from '../db/postgres';
import { resolveMap } from './mapResolver';
import { getGameState, getGameMap, setGameState, getConnectedPlayers } from './redisGameStore';
import {
  loadAuthoritativeRoom,
  loadGameRoomFromPostgres,
  mapIdForSavedState,
  persistGameStateAfterMutation,
  flushGameState,
  flushPendingPostgresSave,
  setCachedRoom,
  deleteCachedRoom,
  getCachedRoom,
  connectSocket,
  hasOtherActiveHumanConnected,
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

/**
 * The flush game:leave and the last disconnect use: they hold no game lock, so
 * it must never write a room they loaded (see gameLeaveSocket.test.ts).
 */
describe('flushPendingPostgresSave', () => {
  const backupsOf = (gameId: string) =>
    vi.mocked(query).mock.calls.filter(([, params]) => (params as unknown[] | undefined)?.[0] === gameId);

  beforeEach(() => {
    vi.mocked(setGameState).mockReset();
    vi.mocked(setGameState).mockResolvedValue(undefined);
  });

  it('writes the pending Postgres backup now, once, and never touches Redis', async () => {
    const state = makeState('game-flush-2', 4);
    await persistGameStateAfterMutation('game-flush-2', state);
    vi.mocked(setGameState).mockClear();

    flushPendingPostgresSave('game-flush-2');
    expect(backupsOf('game-flush-2').map(([, params]) => params)).toEqual([
      ['game-flush-2', 4, JSON.stringify(state)],
    ]);
    await new Promise((r) => setTimeout(r, 900)); // past the debounce: nothing more is written
    expect(backupsOf('game-flush-2')).toHaveLength(1);
    expect(setGameState).not.toHaveBeenCalled();
  });

  it('writes nothing when no backup is pending', () => {
    flushPendingPostgresSave('game-flush-3');
    expect(backupsOf('game-flush-3')).toHaveLength(0);
  });
});

/**
 * Board transforms (`era_advancement_board_transform`) rewrite the board to the
 * next era's map and set `state.map_id` to it. The `games.map_id` column that
 * every Postgres-recovery caller passes here is written once at creation, so a
 * recovered game used to load a transformed board's territories against the
 * departing era's map — the server reporting one territory count and the client
 * rendering another.
 */
describe('recovering a board that has transformed era', () => {
  beforeEach(() => {
    deleteCachedRoom('game-transformed');
    vi.mocked(queryOne).mockReset();
    vi.mocked(resolveMap).mockReset();
  });

  it('prefers the state\'s own map id over the caller\'s stale one', () => {
    const transformed = { ...makeState('g'), map_id: 'era_medieval' };
    expect(mapIdForSavedState(transformed, 'era_ancient')).toBe('era_medieval');
  });

  it('falls back to the caller when the state carries no map id', () => {
    const legacy = { ...makeState('g'), map_id: undefined } as unknown as GameState;
    expect(mapIdForSavedState(legacy, 'era_ancient')).toBe('era_ancient');
    expect(mapIdForSavedState(undefined, 'era_ancient')).toBe('era_ancient');
  });

  it('resolves the arrived era map, not the one games.map_id still records', async () => {
    const transformed = { ...makeState('game-transformed'), map_id: 'era_medieval' };
    const medieval: GameMap = { ...makeMap(), map_id: 'era_medieval' };
    vi.mocked(queryOne).mockResolvedValue({ state_json: transformed });
    vi.mocked(resolveMap).mockResolvedValue(medieval);

    // The caller passes the stale column value, as every recovery path does.
    const room = await loadGameRoomFromPostgres('game-transformed', 'era_ancient');

    expect(resolveMap).toHaveBeenCalledWith('era_medieval');
    expect(room?.map.map_id).toBe('era_medieval');
  });
});

/**
 * A three-seat Colonies game bridges the ring's gaps with lanes that live in
 * state and the game's map copy, not the authored file. A room rebuilt from the
 * authored map (Postgres recovery) must regain them, like Jump Gate lanes.
 */
describe('recovering a Colonies board', () => {
  beforeEach(() => {
    deleteCachedRoom('game-colonies');
    vi.mocked(queryOne).mockReset();
    vi.mocked(resolveMap).mockReset();
  });

  it('puts the bridging lanes back on the rebuilt map copy', async () => {
    const saved: GameState = {
      ...makeState('game-colonies'),
      map_id: 'era_galaxy',
      galaxy_mode: { id: 'colonies', neutral_worlds: ['nexus_station'], lanes: [{ from: 'rust_a', to: 'sol_a' }] },
    };
    const authored: GameMap = {
      ...makeMap(),
      map_id: 'era_galaxy',
      connections: [{ from: 'sol_b', to: 'verdan_b', type: 'orbit' }],
    };
    vi.mocked(queryOne).mockResolvedValue({ state_json: saved });
    vi.mocked(resolveMap).mockResolvedValue(authored);

    const room = await loadGameRoomFromPostgres('game-colonies', 'era_galaxy');

    expect(room?.map.connections).toContainEqual({ from: 'rust_a', to: 'sol_a', type: 'orbit', source: 'galaxy_mode' });
    expect(room?.map.connections).toHaveLength(2);
  });
});

/**
 * The away-AI covers a seat only while someone else is at the table waiting on
 * it (driveCurrentSeatIfAi).
 */
describe('hasOtherActiveHumanConnected', () => {
  const withPlayers = (players: Array<Partial<GameState['players'][number]>>): GameState =>
    ({ ...makeState('game-presence'), players } as unknown as GameState);
  const table = withPlayers([
    { player_id: 'away', is_ai: false, is_eliminated: false },
    { player_id: 'other', is_ai: false, is_eliminated: false },
    { player_id: 'out', is_ai: false, is_eliminated: true },
    { player_id: 'bot', is_ai: true, is_eliminated: false },
  ]);

  beforeEach(() => {
    deleteCachedRoom('game-presence');
    vi.mocked(getConnectedPlayers).mockReset().mockResolvedValue([]);
  });

  it('counts another human still in the game', async () => {
    vi.mocked(getConnectedPlayers).mockResolvedValue(['away', 'other']);
    expect(await hasOtherActiveHumanConnected('game-presence', table, 'away')).toBe(true);
  });

  it('does not count the seat itself, a bot or an eliminated player', async () => {
    vi.mocked(getConnectedPlayers).mockResolvedValue(['away', 'out', 'bot']);
    expect(await hasOtherActiveHumanConnected('game-presence', table, 'away')).toBe(false);
  });

  it('reads this instance\'s sockets when Redis holds no presence', async () => {
    expect(await hasOtherActiveHumanConnected('game-presence', table, 'away')).toBe(false);
    connectSocket('game-presence', 'socket-1', 'other');
    expect(await hasOtherActiveHumanConnected('game-presence', table, 'away')).toBe(true);
  });
});
