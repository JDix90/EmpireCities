/**
 * Solo games by bot level, against real Postgres: the mode read from each
 * game's settings, the level from its highest bot, the win from its winner,
 * and the round-cap ending and round count from its `game_finished` event.
 *
 * Needs Postgres (migrated schema), gated on PG_TEST=1:
 *   PG_TEST=1 POSTGRES_HOST=127.0.0.1 POSTGRES_PORT=5499 POSTGRES_USER=postgres \
 *     POSTGRES_DB=borderfall POSTGRES_PASSWORD= \
 *     pnpm exec vitest run src/services/analyticsQueries.db.test.ts
 *
 * The query is limited to the games this file seeds, so it is safe beside the
 * other PG_TEST files on a shared database.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import type { getSoloGamesByLevel as GetSoloGamesByLevel } from './analyticsQueries';

const enabled = process.env.PG_TEST === '1';

type AimCount = 'ai_captures_from_players' | 'ai_captures_from_humans' | 'ai_captures_from_leader' | 'ai_captures_from_weakest';
/** Where the bots' captures came from, as game_finished counts them. */
function aim(players: number, humans: number, leader: number, weakest: number): Record<AimCount, number> {
  return {
    ai_captures_from_players: players,
    ai_captures_from_humans: humans,
    ai_captures_from_leader: leader,
    ai_captures_from_weakest: weakest,
  };
}

describe.runIf(enabled)('solo games by bot level (Postgres)', () => {
  let query: (sql: string, params?: unknown[]) => Promise<Record<string, unknown>[]>;
  let getSoloGamesByLevel: typeof GetSoloGamesByLevel;
  const userIds: string[] = [];
  const gameIds: string[] = [];
  let player = '';
  let friend = '';
  let admin = '';

  async function seedUser(name: string, isAdmin = false): Promise<string> {
    const id = uuidv4();
    userIds.push(id);
    const username = `${name}_${id.slice(0, 8)}`;
    await query(
      `INSERT INTO users (user_id, username, email, password_hash, is_admin) VALUES ($1, $2, $3, 'x', $4)`,
      [id, username, `${username}@test.local`, isAdmin],
    );
    return id;
  }

  /**
   * A game with these humans and bots (a bot is its level, or null for none).
   * `finish` records its game_finished event, as finalizeGame does per human.
   */
  async function seedGame(opts: {
    humans: string[];
    bots: Array<string | null>;
    status: 'completed' | 'abandoned' | 'in_progress';
    settings?: object;
    winner?: string | null;
    startedDaysAgo?: number;
    finish?: { victory_type: string; turn_count: number } & Partial<Record<AimCount, number>>;
  }): Promise<string> {
    const id = uuidv4();
    gameIds.push(id);
    await query(
      `INSERT INTO games (game_id, map_id, era_id, status, settings_json, game_type, started_at, winner_id)
       VALUES ($1, 'era_ancient', 'ancient', $2, $3::jsonb, 'solo', NOW() - make_interval(days => $4::int), $5)`,
      [id, opts.status, JSON.stringify(opts.settings ?? {}), opts.startedDaysAgo ?? 0, opts.winner ?? null],
    );
    const seats: Array<{ user: string | null; level: string | null }> = [
      ...opts.humans.map((user) => ({ user, level: null })),
      ...opts.bots.map((level) => ({ user: null, level })),
    ];
    for (let i = 0; i < seats.length; i += 1) {
      await query(
        `INSERT INTO game_players (game_id, user_id, player_index, player_color, is_ai, ai_difficulty)
         VALUES ($1, $2, $3, '#ffffff', $4, $5)`,
        [id, seats[i]!.user, i, seats[i]!.user === null, seats[i]!.level],
      );
    }
    if (opts.finish) {
      for (const human of opts.humans) {
        await query(
          `INSERT INTO analytics_events (event, user_id, properties) VALUES ('game_finished', $1, $2::jsonb)`,
          [human, JSON.stringify({ game_id: id, won: opts.winner === human, ...opts.finish })],
        );
      }
    }
    return id;
  }

  beforeAll(async () => {
    ({ query } = (await import('../db/postgres')) as unknown as {
      query: (sql: string, params?: unknown[]) => Promise<Record<string, unknown>[]>;
    });
    ({ getSoloGamesByLevel } = await import('./analyticsQueries'));
    player = await seedUser('solo_player');
    friend = await seedUser('solo_friend');
    admin = await seedUser('solo_admin', true);

    // Quick Match against easy bots: a win on the round cap, a loss, a win by surrender.
    const capped = await seedGame({
      humans: [player], bots: ['easy', 'easy'], status: 'completed', winner: player,
      finish: { victory_type: 'turn_limit', turn_count: 60, ...aim(10, 6, 4, 3) },
    });
    // The same finish recorded twice still counts the game, and its captures, once.
    await query(
      `INSERT INTO analytics_events (event, user_id, properties) VALUES ('game_finished', $1, $2::jsonb)`,
      [player, JSON.stringify({ game_id: capped, won: true, victory_type: 'turn_limit', turn_count: 60, ...aim(10, 6, 4, 3) })],
    );
    // Finished before the bots' captures were counted: it adds none.
    await seedGame({
      humans: [player], bots: ['easy'], status: 'completed', winner: null,
      finish: { victory_type: 'domination', turn_count: 40 },
    });
    // A win by accepting the bots' surrender.
    await seedGame({
      humans: [player], bots: ['easy'], status: 'completed', winner: player,
      finish: { victory_type: 'surrender', turn_count: 50, ...aim(2, 2, 2, 0) },
    });
    // An easy and a hard bot: a hard game. Left before the end.
    await seedGame({ humans: [player], bots: ['easy', 'hard'], status: 'abandoned' });
    await seedGame({
      humans: [player], bots: ['tutorial'], status: 'completed', winner: player, settings: { tutorial: true },
      finish: { victory_type: 'domination', turn_count: 12 },
    });
    // One rival, the human: every capture is the human's, the leader's and the weakest's.
    await seedGame({
      humans: [player], bots: ['easy'], status: 'completed', winner: player, settings: { first_match: true },
      finish: { victory_type: 'domination', turn_count: 20, ...aim(4, 4, 4, 4) },
    });
    await seedGame({ humans: [player], bots: ['medium'], status: 'in_progress', settings: { daily_challenge_date: '2026-10-01' } });
    // A bot with no level plays medium.
    await seedGame({ humans: [player], bots: [null], status: 'in_progress', settings: { is_campaign: true } });

    // Not solo games, or not counted, or outside the window.
    await seedGame({ humans: [player, friend], bots: ['expert'], status: 'completed', winner: friend });
    await seedGame({ humans: [admin], bots: ['expert'], status: 'completed', winner: admin });
    await seedGame({ humans: [], bots: ['expert', 'expert'], status: 'completed' });
    await seedGame({ humans: [player], bots: ['expert'], status: 'completed', winner: player, startedDaysAgo: 40 });
  });

  afterAll(async () => {
    if (gameIds.length) {
      await query(`DELETE FROM analytics_events WHERE properties->>'game_id' = ANY($1::text[])`, [gameIds]).catch(() => {});
      await query('DELETE FROM games WHERE game_id = ANY($1)', [gameIds]).catch(() => {});
    }
    if (userIds.length) await query('DELETE FROM users WHERE user_id = ANY($1)', [userIds]).catch(() => {});
  });

  it('reads each mode and level, and the cap endings, surrender wins, rounds and bot captures of the finished games', async () => {
    expect(await getSoloGamesByLevel(30, gameIds)).toEqual([
      { mode: 'tutorial', level: 'tutorial', started: 1, finished: 1, won: 1, abandoned: 0, running: 0, capped: 0, surrendered: 0, median_rounds: 12, bot_captures: 0, bot_captures_from_human: 0, bot_captures_from_leader: 0, bot_captures_from_weakest: 0 },
      { mode: 'first_match', level: 'easy', started: 1, finished: 1, won: 1, abandoned: 0, running: 0, capped: 0, surrendered: 0, median_rounds: 20, bot_captures: 4, bot_captures_from_human: 4, bot_captures_from_leader: 4, bot_captures_from_weakest: 4 },
      { mode: 'campaign', level: 'medium', started: 1, finished: 0, won: 0, abandoned: 0, running: 1, capped: 0, surrendered: 0, median_rounds: null, bot_captures: 0, bot_captures_from_human: 0, bot_captures_from_leader: 0, bot_captures_from_weakest: 0 },
      { mode: 'daily', level: 'medium', started: 1, finished: 0, won: 0, abandoned: 0, running: 1, capped: 0, surrendered: 0, median_rounds: null, bot_captures: 0, bot_captures_from_human: 0, bot_captures_from_leader: 0, bot_captures_from_weakest: 0 },
      { mode: 'other', level: 'easy', started: 3, finished: 3, won: 2, abandoned: 0, running: 0, capped: 1, surrendered: 1, median_rounds: 50, bot_captures: 12, bot_captures_from_human: 8, bot_captures_from_leader: 6, bot_captures_from_weakest: 3 },
      { mode: 'other', level: 'hard', started: 1, finished: 0, won: 0, abandoned: 1, running: 0, capped: 0, surrendered: 0, median_rounds: null, bot_captures: 0, bot_captures_from_human: 0, bot_captures_from_leader: 0, bot_captures_from_weakest: 0 },
    ]);
  });

  it('takes in a game started 40 days ago once the window reaches it', async () => {
    const rows = await getSoloGamesByLevel(45, gameIds);
    expect(rows.find((r) => r.level === 'expert')).toMatchObject({ mode: 'other', started: 1, won: 1 });
  });
});
