/**
 * Tests for the Redis game-state layer (Phase 2 of the stateless migration).
 *
 * Two tiers:
 *   1. Serialization round-trip — pure unit tests, no Redis, always run in CI.
 *      These prove JSON.stringify/JSON.parse is loss-free for GameState/GameMap.
 *   2. Redis integration — requires a running Redis instance.
 *      Set REDIS_TEST=1 to opt in. Run manually in dev/staging before Phase 3.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import type { GameState, GameMap, PlayerState, TerritoryState, GameSettings } from '../types';

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeSettings(overrides?: Partial<GameSettings>): GameSettings {
  return {
    fog_of_war: false,
    allowed_victory_conditions: ['domination'],
    turn_timer_seconds: 0,
    initial_unit_count: 3,
    card_set_escalating: true,
    diplomacy_enabled: false,
    ...overrides,
  };
}

function makePlayer(id: string, idx: number, extras?: Partial<PlayerState>): PlayerState {
  return {
    player_id: id,
    player_index: idx,
    username: `Player${idx}`,
    color: '#c0392b',
    is_ai: false,
    is_eliminated: false,
    territory_count: 3,
    cards: [
      { card_id: 'c1', territory_id: 't1', symbol: 'infantry' },
      { card_id: 'c2', territory_id: null, symbol: 'wild' },
    ],
    mmr: 1200,
    capital_territory_id: 't1',
    secret_mission: null,
    unlocked_techs: ['archer_range'],
    tech_points: 5,
    ability_uses: { flanking_maneuver: 1 },
    temporary_modifiers: [{ type: 'attack_modifier', value: 1, turns_remaining: 2 }],
    ...extras,
  };
}

function makeTerritory(id: string, owner: string | null, units: number): TerritoryState {
  return {
    territory_id: id,
    owner_id: owner,
    unit_count: units,
    unit_type: 'infantry',
    buildings: ['production_1', 'defense_1'],
    stability: 75,
    population: 3,
    region_id: 'western_europe',
  };
}

/**
 * Builds a GameState that exercises as many optional fields as possible.
 * The richer the fixture, the more confident we are that serialization is lossless.
 */
function makeFullGameState(overrides?: Partial<GameState>): GameState {
  return {
    game_id: 'test-game-redis-001',
    era: 'medieval',
    map_id: 'community_britain_925',
    phase: 'attack',
    current_player_index: 0,
    turn_number: 7,
    players: [
      makePlayer('user_a', 0),
      makePlayer('user_b', 1, { is_ai: true, ai_difficulty: 'medium', is_eliminated: false }),
    ],
    territories: {
      t1: makeTerritory('t1', 'user_a', 4),
      t2: makeTerritory('t2', 'user_a', 2),
      t3: makeTerritory('t3', 'user_b', 6),
      t4: makeTerritory('t4', null, 0),
    },
    card_deck: [
      { card_id: 'deck1', territory_id: 't2', symbol: 'cavalry' },
      { card_id: 'deck2', territory_id: 't3', symbol: 'artillery' },
    ],
    card_set_redemption_count: 2,
    diplomacy: [
      { player_index_a: 0, player_index_b: 1, status: 'truce', truce_turns_remaining: 2 },
    ],
    pending_truces: [{ proposer_id: 'user_a', target_id: 'user_b' }],
    settings: makeSettings({
      economy_enabled: true,
      tech_trees_enabled: true,
      events_enabled: true,
      factions_enabled: true,
    }),
    draft_units_remaining: 0,
    draft_placements_this_turn: { t1: 2, t2: 1 },
    turn_started_at: 1749170000000,
    game_started_at: 1749100000000,
    win_probability_history: [
      { step: 1, turn: 1, probabilities: { user_a: 0.55, user_b: 0.45 } },
      { step: 2, turn: 3, probabilities: { user_a: 0.62, user_b: 0.38 } },
    ],
    coaching_eligible: true,
    era_modifiers: { legion_reroll: false, sea_lanes: true },
    blitzkrieg_active: false,
    blitzkrieg_bonus_source_id: null,
    mission_seed_salt: 'abc123def456ghi789',
    ...overrides,
  };
}

function makeFullGameMap(): GameMap {
  return {
    map_id: 'community_britain_925',
    name: 'Britain 925',
    era: 'medieval',
    canvas_width: 800,
    canvas_height: 600,
    territories: [
      {
        territory_id: 't1',
        name: 'Northumbria',
        polygon: [[0, 0], [100, 0], [100, 100], [0, 100]],
        center_point: [50, 50],
        region_id: 'northern_england',
        geo_polygon: [[-1.5, 54.0], [-1.0, 54.5], [-1.5, 55.0], [-2.0, 54.5]],
      },
      {
        territory_id: 't2',
        name: 'Mercia',
        polygon: [[0, 100], [100, 100], [100, 200], [0, 200]],
        center_point: [50, 150],
        region_id: 'midlands',
      },
    ],
    connections: [
      { from: 't1', to: 't2', type: 'land' },
    ],
    regions: [
      { region_id: 'northern_england', name: 'Northern England', bonus: 2 },
      { region_id: 'midlands', name: 'Midlands', bonus: 3 },
    ],
  };
}

// ── Tier 1: Serialization round-trip (no Redis, always runs) ──────────────────

describe('GameState serialization round-trip', () => {
  it('round-trips a minimal GameState without data loss', () => {
    const state = makeFullGameState();
    const recovered = JSON.parse(JSON.stringify(state)) as GameState;
    expect(recovered).toEqual(state);
  });

  it('preserves all optional PlayerState fields', () => {
    const state = makeFullGameState();
    const recovered = JSON.parse(JSON.stringify(state)) as GameState;
    const original = state.players[0];
    const result = recovered.players[0];
    expect(result.unlocked_techs).toEqual(original.unlocked_techs);
    expect(result.temporary_modifiers).toEqual(original.temporary_modifiers);
    expect(result.ability_uses).toEqual(original.ability_uses);
    expect(result.tech_points).toBe(original.tech_points);
    expect(result.cards).toEqual(original.cards);
  });

  it('preserves AI player fields including ai_difficulty', () => {
    const state = makeFullGameState();
    const recovered = JSON.parse(JSON.stringify(state)) as GameState;
    const ai = recovered.players[1];
    expect(ai.is_ai).toBe(true);
    expect(ai.ai_difficulty).toBe('medium');
  });

  it('preserves territory buildings, stability, and population', () => {
    const state = makeFullGameState();
    const recovered = JSON.parse(JSON.stringify(state)) as GameState;
    const t = recovered.territories['t1'];
    expect(t.buildings).toEqual(['production_1', 'defense_1']);
    expect(t.stability).toBe(75);
    expect(t.population).toBe(3);
  });

  it('preserves win_probability_history snapshots', () => {
    const state = makeFullGameState();
    const recovered = JSON.parse(JSON.stringify(state)) as GameState;
    expect(recovered.win_probability_history).toHaveLength(2);
    expect(recovered.win_probability_history![0].probabilities['user_a']).toBe(0.55);
  });

  it('preserves null owner and zero units in unowned territories', () => {
    const state = makeFullGameState();
    const recovered = JSON.parse(JSON.stringify(state)) as GameState;
    expect(recovered.territories['t4'].owner_id).toBeNull();
    expect(recovered.territories['t4'].unit_count).toBe(0);
  });

  it('preserves null values in optional state fields', () => {
    const state = makeFullGameState();
    const recovered = JSON.parse(JSON.stringify(state)) as GameState;
    expect(recovered.blitzkrieg_bonus_source_id).toBeNull();
    expect(recovered.players[0].secret_mission).toBeNull();
  });

  it('preserves diplomacy entries with truce status', () => {
    const state = makeFullGameState();
    const recovered = JSON.parse(JSON.stringify(state)) as GameState;
    expect(recovered.diplomacy[0].status).toBe('truce');
    expect(recovered.diplomacy[0].truce_turns_remaining).toBe(2);
  });
});

describe('GameMap serialization round-trip', () => {
  it('round-trips a GameMap without data loss', () => {
    const map = makeFullGameMap();
    const recovered = JSON.parse(JSON.stringify(map)) as GameMap;
    expect(recovered).toEqual(map);
  });

  it('preserves geo_polygon coordinates precisely', () => {
    const map = makeFullGameMap();
    const recovered = JSON.parse(JSON.stringify(map)) as GameMap;
    expect(recovered.territories[0].geo_polygon).toEqual(map.territories[0].geo_polygon);
  });

  it('preserves connection types', () => {
    const map = makeFullGameMap();
    const recovered = JSON.parse(JSON.stringify(map)) as GameMap;
    expect(recovered.connections[0].type).toBe('land');
  });
});

// ── Tier 2: Redis integration (opt-in with REDIS_TEST=1) ─────────────────────

const redisTestEnabled = process.env['REDIS_TEST'] === '1';

describe.runIf(redisTestEnabled)('Redis integration — setGameState / getGameState', () => {
  // Dynamically import to avoid touching the Redis singleton in unit-only runs.
  let setGameState: (id: string, s: GameState) => Promise<void>;
  let getGameState: (id: string) => Promise<GameState | null>;
  let setGameMap: (id: string, m: GameMap) => Promise<void>;
  let getGameMap: (id: string) => Promise<GameMap | null>;
  let deleteGameKeys: (id: string) => Promise<void>;
  let markPlayerConnected: (id: string, pid: string, socketId: string) => Promise<void>;
  let markPlayerDisconnected: (id: string, pid: string, socketId: string) => Promise<void>;
  let isPlayerConnected: (id: string, pid: string) => Promise<boolean>;
  let acquireAiInFlight: (id: string) => Promise<boolean>;
  let releaseAiInFlight: (id: string) => Promise<void>;
  let isAiInFlight: (id: string) => Promise<boolean>;

  beforeAll(async () => {
    const store = await import('./redisGameStore');
    setGameState = store.setGameState;
    getGameState = store.getGameState;
    setGameMap = store.setGameMap;
    getGameMap = store.getGameMap;
    deleteGameKeys = store.deleteGameKeys;
    markPlayerConnected = store.markPlayerConnected;
    markPlayerDisconnected = store.markPlayerDisconnected;
    isPlayerConnected = store.isPlayerConnected;
    acquireAiInFlight = store.acquireAiInFlight;
    releaseAiInFlight = store.releaseAiInFlight;
    isAiInFlight = store.isAiInFlight;
  });

  const TEST_GAME_ID = 'redis-test-phase2-001';

  it('round-trips a complete GameState through real Redis without data loss', async () => {
    const state = makeFullGameState({ game_id: TEST_GAME_ID });
    await setGameState(TEST_GAME_ID, state);
    const recovered = await getGameState(TEST_GAME_ID);
    expect(recovered).toEqual(state);
  });

  it('round-trips a complete GameMap through real Redis without data loss', async () => {
    const map = makeFullGameMap();
    await setGameMap(TEST_GAME_ID, map);
    const recovered = await getGameMap(TEST_GAME_ID);
    expect(recovered).toEqual(map);
  });

  it('returns null for a game that does not exist', async () => {
    const result = await getGameState('nonexistent-game-id-zzz');
    expect(result).toBeNull();
  });

  it('marks and queries player connected presence correctly', async () => {
    await markPlayerConnected(TEST_GAME_ID, 'user_a', 'sock_a1');
    expect(await isPlayerConnected(TEST_GAME_ID, 'user_a')).toBe(true);
    expect(await isPlayerConnected(TEST_GAME_ID, 'user_b')).toBe(false);

    await markPlayerConnected(TEST_GAME_ID, 'user_b', 'sock_b1');
    expect(await isPlayerConnected(TEST_GAME_ID, 'user_b')).toBe(true);

    await markPlayerDisconnected(TEST_GAME_ID, 'user_a', 'sock_a1');
    expect(await isPlayerConnected(TEST_GAME_ID, 'user_a')).toBe(false);
  });

  it('refcounts sockets so closing one of two tabs keeps the player present', async () => {
    const GID = 'redis-test-refcount-001';
    await markPlayerConnected(GID, 'multi', 'tab_1');
    await markPlayerConnected(GID, 'multi', 'tab_2');
    expect(await isPlayerConnected(GID, 'multi')).toBe(true);

    // Closing the first tab must NOT mark the player gone — the second is live.
    await markPlayerDisconnected(GID, 'multi', 'tab_1');
    expect(await isPlayerConnected(GID, 'multi')).toBe(true);

    // Closing the last tab finally clears presence.
    await markPlayerDisconnected(GID, 'multi', 'tab_2');
    expect(await isPlayerConnected(GID, 'multi')).toBe(false);
  });

  it('AI in-flight lock acquires exclusively and releases', async () => {
    expect(await isAiInFlight(TEST_GAME_ID)).toBe(false);

    const first = await acquireAiInFlight(TEST_GAME_ID);
    expect(first).toBe(true);
    expect(await isAiInFlight(TEST_GAME_ID)).toBe(true);

    // Second acquire while held must fail (SET NX semantics)
    const second = await acquireAiInFlight(TEST_GAME_ID);
    expect(second).toBe(false);

    await releaseAiInFlight(TEST_GAME_ID);
    expect(await isAiInFlight(TEST_GAME_ID)).toBe(false);
  });

  it('deleteGameKeys removes all keys for the game', async () => {
    await deleteGameKeys(TEST_GAME_ID);
    expect(await getGameState(TEST_GAME_ID)).toBeNull();
    expect(await getGameMap(TEST_GAME_ID)).toBeNull();
    expect(await isAiInFlight(TEST_GAME_ID)).toBe(false);
  });
});
