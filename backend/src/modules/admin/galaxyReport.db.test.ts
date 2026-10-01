/**
 * The Galactic Age report end to end against Postgres: finalizeGame's record
 * (recordGalaxyGameResult) written once, read back by the report with each
 * human's username, filtered in SQL, and kept when an account is deleted.
 *
 * Needs Postgres (migrated schema), gated on PG_TEST=1:
 *   PG_TEST=1 POSTGRES_HOST=127.0.0.1 POSTGRES_PORT=5499 POSTGRES_USER=postgres \
 *     POSTGRES_DB=borderfall POSTGRES_PASSWORD= \
 *     pnpm exec vitest run src/modules/admin/galaxyReport.db.test.ts
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { v4 as uuidv4 } from 'uuid';
import type { GameMap, GameSettings, GameState } from '../../types';
import type { GalaxyReport, GalaxyReportFilters } from './galaxyReport';

const enabled = process.env.PG_TEST === '1';

const AUTHORED = JSON.parse(
  readFileSync(join(__dirname, '../../../../database/maps/era_galaxy.json'), 'utf-8'),
) as GameMap;
const FIVE = ['stellar_mandate', 'forge_syndicate', 'helion_navigators', 'void_custodians', 'stellar_mandate'];
const ALL: GalaxyReportFilters = { days: null, seats: null, mode: null, relations: null };

describe.runIf(enabled)('the Galactic Age report, recorded and read back (Postgres)', () => {
  let query: (sql: string, params?: unknown[]) => Promise<Record<string, unknown>[]>;
  let recordGalaxyGameResult: (gameId: string, state: GameState, winnerIds: readonly string[]) => Promise<boolean>;
  let loadGalaxyReport: (filters: GalaxyReportFilters) => Promise<GalaxyReport>;
  let initializeGameState: typeof import('../../game-engine/state/gameStateManager').initializeGameState;
  const userIds: string[] = [];
  const gameIds: string[] = [];

  async function seedUser(base: string): Promise<{ id: string; name: string }> {
    const id = uuidv4();
    const name = `${base}_${id.slice(0, 8)}`;
    userIds.push(id);
    await query(
      `INSERT INTO users (user_id, username, email, password_hash) VALUES ($1, $2, $3, 'x')`,
      [id, name, `${name}@test.local`],
    );
    return { id, name };
  }

  async function seedGame(opts: { eraId?: string; mapId?: string; status?: string; settings?: object } = {}) {
    const gameId = uuidv4();
    gameIds.push(gameId);
    await query(
      `INSERT INTO games (game_id, map_id, era_id, status, settings_json, game_type, started_at, ended_at)
       VALUES ($1, $2, $3, $4, $5::jsonb, 'custom', NOW() - INTERVAL '40 minutes', NOW())`,
      [gameId, opts.mapId ?? 'era_galaxy', opts.eraId ?? 'galaxy_age', opts.status ?? 'completed',
        JSON.stringify(opts.settings ?? {})],
    );
    return gameId;
  }

  /** Five seats Allied: the listed humans first, AI bots after. */
  function alliedFive(humans: string[]): GameState {
    const players = FIVE.map((faction_id, i) => ({
      player_id: humans[i] ?? `ai_${i}`, player_index: i, username: `P${i}`, color: '#fff',
      is_ai: !humans[i], ai_difficulty: humans[i] ? undefined : 'expert',
      is_eliminated: false, mmr: 1000, faction_id,
    }));
    const settings = {
      fog_of_war: false, turn_timer_seconds: 0, initial_unit_count: 3, card_set_escalating: false,
      diplomacy_enabled: false, factions_enabled: true, naval_enabled: false, events_enabled: false,
      economy_enabled: true, tech_trees_enabled: true, stability_enabled: false,
      era_advancement_enabled: false, galaxy_corridors_enabled: true, galaxy_house_relations: 'allied',
      allowed_victory_conditions: ['domination'], victory_type: 'domination', max_turns: 90,
    } as unknown as GameSettings;
    const state = initializeGameState('t_report', 'galaxy_age', JSON.parse(JSON.stringify(AUTHORED)) as GameMap,
      players as never, settings, { forceStartingPlayerIndex: 0 });
    state.victory_condition = 'lane_sovereignty';
    state.turn_number = 31;
    return state;
  }

  const solSide = (state: GameState) =>
    state.players.filter((p) => p.faction_id === 'stellar_mandate').map((p) => p.player_id);

  beforeAll(async () => {
    ({ query } = (await import('../../db/postgres')) as unknown as {
      query: (sql: string, params?: unknown[]) => Promise<Record<string, unknown>[]>;
    });
    ({ recordGalaxyGameResult } = await import('../../game-engine/state/galaxyResults'));
    ({ loadGalaxyReport } = await import('./galaxyReport'));
    ({ initializeGameState } = await import('../../game-engine/state/gameStateManager'));
  }, 30_000);

  afterAll(async () => {
    if (gameIds.length) await query('DELETE FROM games WHERE game_id = ANY($1)', [gameIds]).catch(() => {});
    if (userIds.length) await query('DELETE FROM users WHERE user_id = ANY($1)', [userIds]).catch(() => {});
  });

  it('records a finished game once, and reads it back with its seats, winners and usernames', async () => {
    const a = await seedUser('gal_a');
    const b = await seedUser('gal_b');
    const gameId = await seedGame();
    const state = alliedFive([a.id, b.id]);

    expect(await recordGalaxyGameResult(gameId, state, solSide(state))).toBe(true);
    expect(await recordGalaxyGameResult(gameId, state, [])).toBe(false);

    const report = await loadGalaxyReport(ALL);
    const game = report.games.find((g) => g.game_id === gameId)!;
    expect(game).toMatchObject({
      seats: 5, mode: 'partial_schism', relations: 'allied', board: 'sol',
      victory: 'lane_sovereignty', turns: 31, first_seat: 0, humans: 2,
    });
    expect(Date.parse(game.ended_at!) - Date.parse(game.started_at!)).toBeCloseTo(40 * 60_000, -4);
    const bySeat = game.seat_results;
    expect(bySeat.map((s) => s.seat)).toEqual([0, 1, 2, 3, 4]);
    const seatOf = (id: string) => bySeat[state.players.findIndex((p) => p.player_id === id)]!;
    expect(seatOf(a.id)).toMatchObject({ user_id: a.id, username: a.name, is_ai: false });
    expect(seatOf(b.id)).toMatchObject({ user_id: b.id, username: b.name, is_ai: false });
    expect(bySeat.filter((s) => s.is_ai).every((s) => s.user_id === null && s.ai_difficulty === 'expert')).toBe(true);
    // The first record stands: the second call's winners were never written.
    expect(bySeat.filter((s) => s.won).map((s) => s.world_id)).toEqual(['sol', 'sol']);
    expect(report.analytics.games).toBeGreaterThanOrEqual(1);
  });

  it('filters in SQL: seat count, mode, relations and the window', async () => {
    const gameId = await seedGame();
    const state = alliedFive([]);
    await recordGalaxyGameResult(gameId, state, solSide(state));
    const has = async (f: Partial<GalaxyReportFilters>) =>
      (await loadGalaxyReport({ ...ALL, ...f })).games.some((g) => g.game_id === gameId);
    expect(await has({ seats: 5, mode: 'partial_schism', relations: 'allied', days: 1 })).toBe(true);
    expect(await has({ seats: 8 })).toBe(false);
    expect(await has({ mode: 'colonies' })).toBe(false);
    expect(await has({ relations: 'concord' })).toBe(false);
  });

  it('counts a finished Galactic Age game with no record as unrecorded, and nothing else', async () => {
    const before = (await loadGalaxyReport(ALL)).unrecorded_games;
    const gameId = await seedGame();
    await seedGame({ eraId: 'ww2', mapId: 'era_ww2' });
    await seedGame({ status: 'in_progress' });
    await seedGame({ settings: { era_advancement_enabled: true } });
    expect((await loadGalaxyReport(ALL)).unrecorded_games).toBe(before + 1);
    // Recorded, it is described rather than counted.
    const state = alliedFive([]);
    await recordGalaxyGameResult(gameId, state, solSide(state));
    expect((await loadGalaxyReport(ALL)).unrecorded_games).toBe(before);
  });

  it("records a game whose player's account was deleted before it ended, without the link", async () => {
    const gone = uuidv4(); // never a users row: the account went mid-game
    const gameId = await seedGame();
    const state = alliedFive([gone]);
    expect(await recordGalaxyGameResult(gameId, state, solSide(state))).toBe(true);
    const game = (await loadGalaxyReport(ALL)).games.find((g) => g.game_id === gameId)!;
    const seat = game.seat_results[state.players.findIndex((p) => p.player_id === gone)]!;
    expect(seat).toMatchObject({ user_id: null, username: null, is_ai: false });
  });

  it("keeps the game when a player's account is deleted, and drops the link", async () => {
    const c = await seedUser('gal_c');
    const gameId = await seedGame();
    const state = alliedFive([c.id]);
    await recordGalaxyGameResult(gameId, state, solSide(state));
    await query('DELETE FROM users WHERE user_id = $1', [c.id]);
    const game = (await loadGalaxyReport(ALL)).games.find((g) => g.game_id === gameId)!;
    const seat = game.seat_results[state.players.findIndex((p) => p.player_id === c.id)]!;
    expect(seat).toMatchObject({ user_id: null, username: null, is_ai: false });
  });

  it('records nothing for a game outside the Galactic Age', async () => {
    const gameId = await seedGame({ eraId: 'ww2', mapId: 'era_ww2' });
    const state = { ...alliedFive([]), era: 'ww2', map_id: 'era_ww2' } as GameState;
    expect(await recordGalaxyGameResult(gameId, state, [])).toBe(false);
    const rows = await query('SELECT 1 FROM galaxy_game_results WHERE game_id = $1', [gameId]);
    expect(rows).toHaveLength(0);
  });
});
