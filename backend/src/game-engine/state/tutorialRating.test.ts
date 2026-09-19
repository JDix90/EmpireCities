/**
 * The tutorial must not move a player's Glicko rating, in either direction.
 *
 * `recordGameResults` had no tutorial guard, so the lesson was rated like any
 * other solo game against a synthetic AI opponent. Measured against the real
 * Glicko config (initial mu 1500 / phi 350, tutorial bot priced at mu 1100):
 *
 *  - **Finishing it pays.** A completed tutorial is a guaranteed win — the
 *    tutorial bot never attacks (`aiBot.ts`) — worth **+49 mu** on the first
 *    run, and replaying climbs: 1500 → 1549 → 1580 → 1604 → 1622 over five
 *    runs, while phi tightens 350 → 235, making the rating look better
 *    evidenced than it is.
 *  - **Quitting it is catastrophic.** `game:resign` past the two-turn grace
 *    window credits the surviving AI a `last_standing` victory and runs the
 *    full finalize pipeline. From a fresh account that is **-473 mu**
 *    (1500 → 1027) — bottom of bronze before the player has finished a single
 *    real game. The tutorial's era steps land on the player's SECOND turn, so
 *    anyone who reaches them and then leaves is past the grace window.
 *
 * XP, gold and the recorded `final_rank` deliberately stay: the tutorial is
 * still a game that happened and still pays its onboarding reward. Only the
 * competitive number is withheld.
 *
 * Needs Postgres (migrated schema), gated on PG_TEST=1:
 *   PG_TEST=1 POSTGRES_HOST=127.0.0.1 POSTGRES_PORT=5499 POSTGRES_USER=postgres \
 *     POSTGRES_DB=borderfall POSTGRES_PASSWORD= \
 *     pnpm exec vitest run src/game-engine/state/tutorialRating.test.ts
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import type { GameState, PlayerState } from '../../types';

const enabled = process.env.PG_TEST === '1';

describe.runIf(enabled)('the tutorial does not rate the player (Postgres)', () => {
  let query: (sql: string, params?: unknown[]) => Promise<Record<string, unknown>[]>;
  let recordGameResults: (
    gameId: string, state: GameState, winnerIds: string[],
  ) => Promise<{ ratingDeltas: Map<string, number> }>;
  const userIds: string[] = [];
  const gameIds: string[] = [];

  async function seedUser(base: string): Promise<string> {
    const id = uuidv4();
    userIds.push(id);
    await query(
      `INSERT INTO users (user_id, username, email, password_hash)
       VALUES ($1, $2, $3, 'x')`,
      [id, `${base}_${id.slice(0, 8)}`, `${base}_${id.slice(0, 8)}@test.local`],
    );
    return id;
  }

  /** A finished 1v1-vs-bot game row with the human seated, plus its AI seat. */
  async function seedGame(userId: string, tutorial: boolean): Promise<string> {
    const gameId = uuidv4();
    gameIds.push(gameId);
    const settings = tutorial
      ? { tutorial: true, tutorial_lesson_module: 'core', max_players: 2 }
      : { max_players: 2 };
    await query(
      `INSERT INTO games (game_id, map_id, era_id, status, settings_json, game_type, is_ranked)
       VALUES ($1, 'era_ancient', 'ancient', 'completed', $2::jsonb, 'solo', false)`,
      [gameId, JSON.stringify(settings)],
    );
    await query(
      `INSERT INTO game_players (game_id, user_id, player_index, player_color, is_ai)
       VALUES ($1, $2, 0, '#e74c3c', false)`,
      [gameId, userId],
    );
    await query(
      `INSERT INTO game_players (game_id, user_id, player_index, player_color, is_ai, ai_difficulty)
       VALUES ($1, NULL, 1, '#3498db', true, $2)`,
      [gameId, tutorial ? 'tutorial' : 'medium'],
    );
    return gameId;
  }

  function player(overrides: Partial<PlayerState>): PlayerState {
    return {
      player_id: 'p', player_index: 0, username: 'p', color: '#fff',
      is_ai: false, is_eliminated: false, territory_count: 3, cards: [],
      mmr: 1000, capital_territory_id: null, secret_mission: null,
      ...overrides,
    } as PlayerState;
  }

  /** Minimal finished state: the human and the bot it played. */
  function state(userId: string, tutorial: boolean, humanWon: boolean): GameState {
    return {
      players: [
        player({ player_id: userId, player_index: 0, username: 'human',
                 territory_count: humanWon ? 6 : 0, is_eliminated: !humanWon }),
        player({ player_id: 'ai_1', player_index: 1, username: 'bot', is_ai: true,
                 ai_difficulty: tutorial ? 'tutorial' : 'medium',
                 territory_count: humanWon ? 0 : 6, is_eliminated: humanWon }),
      ],
      turn_number: 8,
      settings: tutorial
        ? { tutorial: true, tutorial_lesson_module: 'core' }
        : {},
    } as unknown as GameState;
  }

  const ratingRow = (userId: string) =>
    query(`SELECT rating_type, mu, phi FROM user_ratings WHERE user_id = $1`, [userId]);
  const playerRow = (gameId: string, userId: string) =>
    query(`SELECT final_rank, xp_earned, mmr_change FROM game_players
           WHERE game_id = $1 AND user_id = $2`, [gameId, userId]);
  const userRow = (userId: string) =>
    query(`SELECT xp, mmr FROM users WHERE user_id = $1`, [userId]);

  beforeAll(async () => {
    ({ query } = (await import('../../db/postgres')) as unknown as {
      query: (sql: string, params?: unknown[]) => Promise<Record<string, unknown>[]>;
    });
    ({ recordGameResults } = (await import('./statsManager')) as unknown as {
      recordGameResults: typeof recordGameResults;
    });
  }, 30_000);

  afterAll(async () => {
    if (gameIds.length) {
      await query('DELETE FROM games WHERE game_id = ANY($1)', [gameIds]).catch(() => {});
    }
    if (userIds.length) {
      await query('DELETE FROM users WHERE user_id = ANY($1)', [userIds]).catch(() => {});
    }
  });

  it('writes no rating at all for a completed tutorial', async () => {
    const u = await seedUser('tut_rate_win');
    const g = await seedGame(u, true);

    const ctx = await recordGameResults(g, state(u, true, true), [u]);

    // The whole point: no competitive number was created.
    expect(await ratingRow(u)).toEqual([]);
    expect(ctx.ratingDeltas.get(u) ?? 0).toBe(0);
    expect(Number((await playerRow(g, u))[0].mmr_change)).toBe(0);
    // Legacy mmr column stays at its default rather than being nudged up.
    expect(Number((await userRow(u))[0].mmr)).toBe(1000);
  });

  it('does not wreck an abandoned tutorial player — the loss is not rated either', async () => {
    const u = await seedUser('tut_rate_loss');
    const g = await seedGame(u, true);

    // Resigning past the grace window credits the AI a last_standing win and
    // runs this pipeline. Unguarded that was -473 mu from a fresh account.
    const ctx = await recordGameResults(g, state(u, true, false), ['ai_1']);

    expect(await ratingRow(u)).toEqual([]);
    expect(ctx.ratingDeltas.get(u) ?? 0).toBe(0);
    expect(Number((await userRow(u))[0].mmr)).toBe(1000);
  });

  it('leaves an existing solo rating from real games untouched', async () => {
    const u = await seedUser('tut_rate_keep');
    await query(
      `INSERT INTO user_ratings (user_id, rating_type, mu, phi, last_rated)
       VALUES ($1, 'solo', 1732, 120, NOW())`,
      [u],
    );
    const g = await seedGame(u, true);

    await recordGameResults(g, state(u, true, true), [u]);

    const rows = await ratingRow(u);
    expect(rows).toHaveLength(1);
    expect(Math.round(Number(rows[0].mu))).toBe(1732);
    expect(Math.round(Number(rows[0].phi))).toBe(120);
  });

  it('still records the tutorial outcome and pays its XP', async () => {
    const u = await seedUser('tut_rate_xp');
    const g = await seedGame(u, true);

    await recordGameResults(g, state(u, true, true), [u]);

    const row = (await playerRow(g, u))[0];
    expect(Number(row.final_rank)).toBe(1);
    // Onboarding still rewards finishing — only the rating is withheld.
    expect(Number(row.xp_earned)).toBeGreaterThan(0);
    expect(Number((await userRow(u))[0].xp)).toBeGreaterThan(0);
  });

  it('a real solo game against a bot is still rated — the guard is not a blanket off switch', async () => {
    const u = await seedUser('tut_rate_real');
    const g = await seedGame(u, false);

    const ctx = await recordGameResults(g, state(u, false, true), [u]);

    const rows = await ratingRow(u);
    expect(rows).toHaveLength(1);
    expect(rows[0].rating_type).toBe('solo');
    expect(Number(rows[0].mu)).toBeGreaterThan(1500);
    expect(ctx.ratingDeltas.get(u)!).toBeGreaterThan(0);
  });
});
