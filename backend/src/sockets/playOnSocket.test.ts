/**
 * Play on after a win (play_on_enabled), end to end over the socket: a game
 * won on the Conquest threshold offers it in game:over; the winner asks; bots
 * always say yes and a human must; a unanimous yes starts a new game from the
 * final board that is won only by domination and records nothing.
 *
 * Postgres is mocked (statements are captured); Redis is real. Gated on
 * REDIS_TEST=1 like the other socket tests:
 *   REDIS_TEST=1 REDIS_HOST=localhost REDIS_PORT=6379 \
 *     pnpm exec vitest run src/sockets/playOnSocket.test.ts
 */
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';

const spies = vi.hoisted(() => ({
  tx: [] as Array<{ sql: string; params: unknown[] }>,
  results: 0,
  ranked: false,
}));

// The `games` status transition must succeed (rowCount 1) or finalize bails as
// a duplicate. The finished game is casual unless a test says otherwise.
vi.mock('../db/postgres', () => {
  const poolResult = { rows: [] as unknown[], rowCount: 1 };
  const client = {
    query: async (sql: string, params: unknown[] = []) => {
      spies.tx.push({ sql, params });
      return { rows: [] as unknown[], rowCount: 1 };
    },
    release: () => {},
  };
  return {
    query: async () => [],
    queryOne: async (sql: string) => {
      if (sql.includes('COALESCE(is_ranked, false) AS is_ranked FROM games')) return { is_ranked: spies.ranked };
      if (sql.includes('SELECT map_id, era_id, settings_json, game_type, game_mode, is_private FROM games')) {
        return {
          map_id: 'playon-map', era_id: 'ancient', game_type: 'solo', game_mode: 'classic', is_private: false,
          settings_json: { allowed_victory_conditions: ['domination', 'threshold'], victory_threshold: 50, max_turns: 150, max_players: 3 },
        };
      }
      return null;
    },
    withTransaction: async (fn: (c: typeof client) => Promise<unknown>) => fn(client),
    connectPostgres: async () => {},
    pgConnectionHint: () => null,
    pgPool: {
      query: async () => poolResult,
      connect: async () => client,
      end: async () => {},
      on: () => {},
      waitingCount: 0,
      totalCount: 0,
      idleCount: 0,
    },
  };
});

vi.mock('../game-engine/state/statsManager', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../game-engine/state/statsManager')>();
  return {
    ...mod,
    recordGameResults: async () => {
      spies.results++;
      return { ratingDeltas: new Map(), ratingProvisional: new Map(), ratingPlacement: new Map(), guestPlayerIds: new Set(), isRanked: false, xpEarnedByPlayer: {} };
    },
  };
});

vi.mock('../game-engine/progression/progressionService', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../game-engine/progression/progressionService')>();
  return { ...mod, applyWinStreak: async () => 0 };
});

import { createServer, type Server as HttpServer } from 'http';
import type { AddressInfo } from 'net';
import type { Server as IOServer } from 'socket.io';
import { io as ClientIO, type Socket as ClientSocket } from 'socket.io-client';
import type { GameState, GameMap, PlayerState, TerritoryState } from '../types';

const redisTestEnabled = process.env.REDIS_TEST === '1';

describe.runIf(redisTestEnabled)('play on after a win (socket integration)', () => {
  let httpServer: HttpServer;
  let ioServer: IOServer;
  let port: number;
  let signAccessToken: (p: { sub: string; username: string }) => string;
  let setGameState: (id: string, s: GameState) => Promise<void>;
  let getGameState: (id: string) => Promise<GameState | null>;
  let setGameMap: (id: string, m: GameMap) => Promise<void>;
  let deleteGameKeys: (id: string) => Promise<void>;
  let shutdownGameSocket: (io: IOServer) => Promise<void>;
  let adminConfig: typeof import('../services/adminConfig');
  let redis: typeof import('../db/redis').redis;

  const openClients: ClientSocket[] = [];
  const createdGames: string[] = [];

  beforeAll(async () => {
    const sockets = await import('./gameSocket');
    shutdownGameSocket = sockets.shutdownGameSocket;
    ({ signAccessToken } = await import('../utils/jwt'));
    const store = await import('./redisGameStore');
    setGameState = store.setGameState;
    getGameState = store.getGameState;
    setGameMap = store.setGameMap;
    deleteGameKeys = store.deleteGameKeys;
    adminConfig = await import('../services/adminConfig');
    const redisMod = await import('../db/redis');
    redis = redisMod.redis;
    await redis.connect().catch(() => { /* lazyConnect — may already be connecting */ });

    httpServer = createServer();
    ioServer = sockets.initGameSocket(httpServer);
    await new Promise<void>((resolve) => httpServer.listen(0, resolve));
    port = (httpServer.address() as AddressInfo).port;
  }, 30_000);

  afterAll(async () => {
    for (const c of openClients) c.disconnect();
    adminConfig.resetAdminConfigCacheForTests();
    await shutdownGameSocket(ioServer).catch(() => { /* worker teardown best-effort */ });
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
  }, 30_000);

  afterEach(async () => {
    while (openClients.length) openClients.pop()?.disconnect();
    for (const id of createdGames.splice(0)) {
      await deleteGameKeys(id).catch(() => {});
      await redis.del(`play_on:${id}`).catch(() => {});
    }
    spies.tx.length = 0;
    spies.results = 0;
    spies.ranked = false;
  });

  // This file's own: a human's game:state goes to their user room, which the
  // Redis adapter shares with every socket test file on the same Redis.
  const ME = 'playon_p1';
  const FRIEND = 'playon_p2';
  const BOT = 'ai_2';

  function player(id: string, idx: number, extras: Partial<PlayerState> = {}): PlayerState {
    return {
      player_id: id, player_index: idx, username: id.toUpperCase(), color: '#c0392b',
      is_ai: false, is_eliminated: false, territory_count: 1, cards: [], mmr: 1000,
      capital_territory_id: null, secret_mission: null, unlocked_techs: [], ability_uses: {},
      ...extras,
    } as PlayerState;
  }

  function terr(id: string, owner: string | null, units: number): TerritoryState {
    return { territory_id: id, owner_id: owner, unit_count: units, unit_type: 'infantry' } as TerritoryState;
  }

  /**
   * Round 3 of a game won at 50% of four territories. I hold `a`; taking `b`
   * (1 unit) with dice [6,6,6 | 1] wins on the threshold while the second seat
   * holds `c` and the bot `d`. The second seat is a friend or a bot.
   */
  function buildState(gameId: string, second: 'friend' | 'bot'): GameState {
    const secondId = second === 'friend' ? FRIEND : 'ai_1';
    return {
      game_id: gameId,
      era: 'ancient',
      map_id: 'playon-map',
      phase: 'attack',
      current_player_index: 0,
      turn_number: 3,
      players: [
        player(ME, 0, { territory_count: 1 }),
        player(secondId, 1, { territory_count: 2, ...(second === 'bot' ? { is_ai: true, ai_difficulty: 'easy' } : {}) }),
        player(BOT, 2, { is_ai: true, ai_difficulty: 'easy', territory_count: 1 }),
      ],
      territories: { a: terr('a', ME, 20), b: terr('b', secondId, 1), c: terr('c', secondId, 1), d: terr('d', BOT, 1) },
      card_deck: [
        { card_id: 'd1', territory_id: 'a', symbol: 'infantry' },
        { card_id: 'd2', territory_id: 'b', symbol: 'cavalry' },
      ],
      card_set_redemption_count: 0,
      diplomacy: [],
      settings: {
        fog_of_war: false, allowed_victory_conditions: ['domination', 'threshold'], victory_type: 'domination',
        victory_threshold: 50, max_turns: 150,
        turn_timer_seconds: 0, initial_unit_count: 3, card_set_escalating: true, diplomacy_enabled: false,
      },
      draft_units_remaining: 0,
      turn_started_at: 1_700_000_000_000,
      era_modifiers: {},
      puzzle_dice_queue: Array(40).fill([6, 6, 6, 1]).flat(),
    } as unknown as GameState;
  }

  function buildMap(): GameMap {
    return {
      map_id: 'playon-map',
      name: 'Play On Test',
      era: 'ancient',
      territories: ['a', 'b', 'c', 'd'].map((id, i) => ({
        territory_id: id, name: id.toUpperCase(), polygon: [], center_point: [i, 0], region_id: 'r',
      })),
      connections: [
        { from: 'a', to: 'b', type: 'land' },
        { from: 'a', to: 'c', type: 'land' },
        { from: 'a', to: 'd', type: 'land' },
      ],
      regions: [{ region_id: 'r', name: 'R', bonus: 0 }],
    } as GameMap;
  }

  async function connect(userId: string): Promise<ClientSocket> {
    const token = signAccessToken({ sub: userId, username: userId.toUpperCase() });
    const client = ClientIO(`http://localhost:${port}`, {
      auth: { token }, transports: ['websocket'], forceNew: true, reconnection: false,
    });
    openClients.push(client);
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('client connect timeout')), 10_000);
      client.once('connect', () => { clearTimeout(t); resolve(); });
      client.once('connect_error', (e) => { clearTimeout(t); reject(e); });
    });
    return client;
  }

  async function joinRoom(userId: string, gameId: string): Promise<void> {
    for (let i = 0; i < 50; i++) {
      const s = [...ioServer.sockets.sockets.values()].find((sk) => sk.data?.userId === userId);
      if (s) { s.join(gameId); return; }
      await new Promise((r) => setTimeout(r, 10));
    }
    throw new Error(`server socket for ${userId} not found`);
  }

  function waitFor<T = unknown>(client: ClientSocket, event: string, timeoutMs = 10_000): Promise<T> {
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(`timeout waiting for ${event}`)), timeoutMs);
      client.once(event, (payload: T) => { clearTimeout(t); resolve(payload); });
    });
  }

  interface GameOver {
    victory_condition?: string;
    winner_ids?: string[];
    play_on?: { proposer_ids: string[]; human_ids: string[]; bot_count: number; expires_in_ms: number };
    play_on_of?: string;
    rematch_config?: { settings: Record<string, unknown> };
  }

  /** Win `gameId` on the threshold with `clients[0]`, and return each client's game:over. */
  async function winOnThreshold(gameId: string, second: 'friend' | 'bot', clients: Array<{ id: string; socket: ClientSocket }>) {
    await setGameState(gameId, buildState(gameId, second));
    await setGameMap(gameId, buildMap());
    createdGames.push(gameId);
    for (const c of clients) await joinRoom(c.id, gameId);
    const overs = clients.map((c) => waitFor<GameOver>(c.socket, 'game:over'));
    clients[0].socket.emit('game:attack', { gameId, fromId: 'a', toId: 'b' });
    return Promise.all(overs);
  }

  const setPlayOn = (on: boolean) => adminConfig.setAdminConfigCacheForTests({ feature_flags: { play_on_enabled: on } });

  it('offers nothing while the switch is off', async () => {
    setPlayOn(false);
    const me = await connect(ME);
    const [over] = await winOnThreshold('playon-off', 'bot', [{ id: ME, socket: me }]);
    expect(over.victory_condition).toBe('threshold');
    expect(over.play_on).toBeUndefined();
  });

  it('offers nothing in a ranked game', async () => {
    setPlayOn(true);
    spies.ranked = true;
    const me = await connect(ME);
    const [over] = await winOnThreshold('playon-ranked', 'bot', [{ id: ME, socket: me }]);
    expect(over.play_on).toBeUndefined();
  });

  it('against bots, goes straight on from the final board, for domination alone, and records nothing', async () => {
    setPlayOn(true);
    const me = await connect(ME);
    const oldId = 'playon-bots';
    const [over] = await winOnThreshold(oldId, 'bot', [{ id: ME, socket: me }]);
    expect(over.victory_condition).toBe('threshold');
    expect(over.play_on).toMatchObject({ proposer_ids: [ME], human_ids: [ME], bot_count: 2 });
    expect(over.play_on!.expires_in_ms).toBeGreaterThan(4 * 60_000);
    expect(spies.results).toBe(1);

    const result = waitFor<{ gameId: string; outcome: string; new_game_id?: string }>(me, 'game:play_on_result');
    me.emit('game:play_on_propose', { gameId: oldId });
    const res = await result;
    expect(res).toMatchObject({ gameId: oldId, outcome: 'accepted' });
    const newId = res.new_game_id!;
    createdGames.push(newId);

    // A new games row, unranked and marked, with the same seats.
    const gameInsert = spies.tx.find((t) => t.sql.includes('INSERT INTO games'));
    expect(gameInsert?.params[0]).toBe(newId);
    expect(JSON.parse(gameInsert!.params[3] as string)).toMatchObject({
      allowed_victory_conditions: ['domination'], max_turns: null, play_on_of: oldId,
    });
    expect(JSON.parse(gameInsert!.params[3] as string)).not.toHaveProperty('victory_threshold');
    expect(spies.tx.find((t) => t.sql.includes('INSERT INTO game_players'))?.params).toEqual([newId, oldId]);

    // The final board, my turn going on in its attack.
    const next = (await getGameState(newId))!;
    expect(next.game_id).toBe(newId);
    expect(next.phase).toBe('attack');
    expect(next.territories.b.owner_id).toBe(ME);
    expect(next.play_on).toMatchObject({ of: oldId, won_by: [ME], won_with: 'threshold', won_turn: 3 });
    expect(next.settings.allowed_victory_conditions).toEqual(['domination']);
    // The finished game is left as it ended.
    expect((await getGameState(oldId))?.phase).toBe('game_over');

    // Taking the rest ends it on domination, with nothing recorded or offered.
    await joinRoom(ME, newId);
    me.emit('game:attack', { gameId: newId, fromId: 'a', toId: 'c' });
    await waitFor(me, 'game:state');
    const finalOver = waitFor<GameOver>(me, 'game:over');
    me.emit('game:attack', { gameId: newId, fromId: 'a', toId: 'd' });
    const done = await finalOver;
    // Taking the last territory also puts the last rival out, which the
    // engine reads as last standing, as in any game.
    expect(['domination', 'last_standing']).toContain(done.victory_condition);
    expect(done.winner_ids).toEqual([ME]);
    expect(done.play_on_of).toBe(oldId);
    expect(done.play_on).toBeUndefined();
    expect(spies.results).toBe(1);
    // A rematch from it is a rematch of the game it continued.
    expect(done.rematch_config?.settings).toMatchObject({ allowed_victory_conditions: ['domination', 'threshold'], victory_threshold: 50 });
  });

  it('asks the other human, and a yes carries it', async () => {
    setPlayOn(true);
    const me = await connect(ME);
    const friend = await connect(FRIEND);
    const oldId = 'playon-yes';
    const [mine, theirs] = await winOnThreshold(oldId, 'friend', [{ id: ME, socket: me }, { id: FRIEND, socket: friend }]);
    expect(mine.play_on).toMatchObject({ proposer_ids: [ME], human_ids: [ME, FRIEND], bot_count: 1 });
    expect(theirs.play_on).toEqual(mine.play_on);

    const asked = waitFor<{ proposer_id: string; voters: Array<{ player_id: string; vote: boolean | null }>; bot_count: number }>(friend, 'game:play_on');
    me.emit('game:play_on_propose', { gameId: oldId });
    expect(await asked).toMatchObject({ proposer_id: ME, voters: [{ player_id: FRIEND, vote: null }], bot_count: 1 });

    // Only a winner can ask, and only once.
    const refused = waitFor<{ message: string }>(friend, 'game:play_on_refused');
    friend.emit('game:play_on_propose', { gameId: oldId });
    expect((await refused).message).toMatch(/already been asked/);

    const results = [me, friend].map((c) => waitFor<{ outcome: string; new_game_id?: string }>(c, 'game:play_on_result'));
    friend.emit('game:play_on_vote', { gameId: oldId, yes: true });
    const [a, b] = await Promise.all(results);
    expect(a.outcome).toBe('accepted');
    expect(b.new_game_id).toBe(a.new_game_id);
    createdGames.push(a.new_game_id!);
  });

  it('ends at a no, and the game ends where it was won', async () => {
    setPlayOn(true);
    const me = await connect(ME);
    const friend = await connect(FRIEND);
    const oldId = 'playon-no';
    await winOnThreshold(oldId, 'friend', [{ id: ME, socket: me }, { id: FRIEND, socket: friend }]);

    const asked = waitFor(friend, 'game:play_on');
    me.emit('game:play_on_propose', { gameId: oldId });
    await asked;
    const result = waitFor<{ outcome: string; new_game_id?: string }>(me, 'game:play_on_result');
    friend.emit('game:play_on_vote', { gameId: oldId, yes: false });
    expect(await result).toEqual({ gameId: oldId, outcome: 'declined' });
    expect(spies.tx.some((t) => t.sql.includes('INSERT INTO games'))).toBe(false);
  });
});
