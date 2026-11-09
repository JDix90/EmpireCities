/**
 * Which games the lobby's "N games played in the last 24 hours" counts, against
 * Postgres: every game started or finished in that time, tutorials and games
 * left part-way included, and never a lobby that did not start.
 *
 * Only this file's seeded games are queried, so it is safe beside the other
 * PG_TEST files on a shared database.
 *
 * Needs Postgres (migrated schema), gated on PG_TEST=1:
 *   PG_TEST=1 POSTGRES_HOST=127.0.0.1 POSTGRES_PORT=5499 POSTGRES_USER=postgres \
 *     POSTGRES_DB=borderfall POSTGRES_PASSWORD= \
 *     pnpm exec vitest run src/modules/games/gamesPlayedWindow.db.test.ts
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import { playedInLast24HoursSql } from './gamesPlayedWindow';

const enabled = process.env.PG_TEST === '1';
type Query = (sql: string, params?: unknown[]) => Promise<Record<string, unknown>[]>;

describe.runIf(enabled)('games played in the last 24 hours (Postgres)', () => {
  let query: Query;
  const games: Record<string, string> = {};

  /** A game with the given status, started and ended this many hours ago (null: never). */
  async function seed(name: string, status: string, startedHoursAgo: number | null, endedHoursAgo: number | null, tutorial = false) {
    const id = uuidv4();
    games[name] = id;
    await query(
      `INSERT INTO games (game_id, map_id, era_id, status, settings_json, game_type, created_at, started_at, ended_at)
       VALUES ($1, 'community_britain_925', 'medieval', $2, $3::jsonb, 'solo',
               NOW() - make_interval(hours => COALESCE($4::int, 1)),
               CASE WHEN $4::int IS NULL THEN NULL ELSE NOW() - make_interval(hours => $4::int) END,
               CASE WHEN $5::int IS NULL THEN NULL ELSE NOW() - make_interval(hours => $5::int) END)`,
      [id, status, JSON.stringify(tutorial ? { tutorial: true } : {}), startedHoursAgo, endedHoursAgo],
    );
  }

  beforeAll(async () => {
    ({ query } = (await import('../../db/postgres')) as unknown as { query: Query });
    await seed('still going', 'in_progress', 2, null);
    await seed('finished', 'completed', 3, 2);
    await seed('tutorial left part-way', 'abandoned', 1, 1, true);
    await seed('started yesterday, finished this morning', 'completed', 30, 5);
    await seed('finished two days ago', 'completed', 50, 48);
    await seed('lobby that never started', 'abandoned', null, 1);
    await seed('lobby still waiting', 'waiting', null, null);
  });

  afterAll(async () => {
    if (query) await query('DELETE FROM games WHERE game_id = ANY($1)', [Object.values(games)]).catch(() => {});
  });

  it('counts every game started or finished in the window, and no lobby that never started', async () => {
    const rows = await query(
      `SELECT g.game_id FROM games g WHERE g.game_id = ANY($1) AND ${playedInLast24HoursSql('g')}`,
      [Object.values(games)],
    );
    const counted = Object.entries(games).filter(([, id]) => rows.some((r) => r.game_id === id)).map(([name]) => name).sort();
    expect(counted).toEqual([
      'finished',
      'started yesterday, finished this morning',
      'still going',
      'tutorial left part-way',
    ]);
  });
});
