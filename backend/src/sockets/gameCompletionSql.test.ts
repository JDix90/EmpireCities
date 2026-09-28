/**
 * Marking a game completed (MARK_GAME_COMPLETED_SQL, the once-only gate at the
 * top of finalizeGame).
 *
 * Needs Postgres (migrated schema), gated on PG_TEST=1:
 *   PG_TEST=1 POSTGRES_HOST=127.0.0.1 POSTGRES_PORT=5499 POSTGRES_USER=postgres \
 *     POSTGRES_DB=borderfall POSTGRES_PASSWORD= \
 *     pnpm exec vitest run src/sockets/gameCompletionSql.test.ts
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { MARK_GAME_COMPLETED_SQL } from './gameCompletionSql';

const enabled = process.env.PG_TEST === '1';

type Pool = {
  query: (sql: string, params?: unknown[]) => Promise<{ rowCount: number | null; rows: Record<string, unknown>[] }>;
};

describe('MARK_GAME_COMPLETED_SQL', () => {
  it('moves only a game that is not already finished', () => {
    expect(MARK_GAME_COMPLETED_SQL).toMatch(/status NOT IN \('completed', 'abandoned'\)/);
    expect(MARK_GAME_COMPLETED_SQL).toMatch(/game_id = \$2/);
  });
});

describe.runIf(enabled)('MARK_GAME_COMPLETED_SQL — against Postgres', () => {
  let pgPool: Pool;
  const gameIds: string[] = [];

  async function newGame(status: string): Promise<string> {
    const { rows } = await pgPool.query(
      `INSERT INTO games (map_id, era_id, status) VALUES ('era_ancient', 'ancient', $1) RETURNING game_id`,
      [status],
    );
    gameIds.push(rows[0]!.game_id as string);
    return rows[0]!.game_id as string;
  }

  const statusOf = async (gameId: string) =>
    (await pgPool.query('SELECT status FROM games WHERE game_id = $1', [gameId])).rows[0]?.status;

  const complete = async (gameId: string) =>
    (await pgPool.query(MARK_GAME_COMPLETED_SQL, [null, gameId])).rowCount;

  beforeAll(async () => {
    ({ pgPool } = (await import('../db/postgres')) as unknown as { pgPool: Pool });
  }, 60_000);

  afterAll(async () => {
    if (gameIds.length) {
      await pgPool.query(`DELETE FROM games WHERE game_id = ANY($1::uuid[])`, [gameIds]).catch(() => {});
    }
  });

  it('completes a game in progress, exactly once', async () => {
    const gameId = await newGame('in_progress');
    expect(await complete(gameId)).toBe(1);
    expect(await statusOf(gameId)).toBe('completed');
    expect(await complete(gameId)).toBe(0);
  });

  it('leaves an abandoned game abandoned, so it pays nothing out', async () => {
    const gameId = await newGame('abandoned');
    expect(await complete(gameId)).toBe(0);
    expect(await statusOf(gameId)).toBe('abandoned');
  });
});
