/**
 * One replay snapshot per turn, plus the game's opening board
 * (SAVE_TURN_SNAPSHOT_SQL, the statement every Postgres backup of a live game
 * runs).
 *
 * Needs Postgres (migrated schema), gated on PG_TEST=1:
 *   PG_TEST=1 POSTGRES_HOST=127.0.0.1 POSTGRES_PORT=5499 POSTGRES_USER=postgres \
 *     POSTGRES_DB=borderfall POSTGRES_PASSWORD= \
 *     pnpm exec vitest run src/sockets/gameSnapshotSql.test.ts
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { SAVE_TURN_SNAPSHOT_SQL } from './gameSnapshotSql';

const enabled = process.env.PG_TEST === '1';

describe('SAVE_TURN_SNAPSHOT_SQL', () => {
  it('inserts the new snapshot and deletes only earlier ones of the same game and turn', () => {
    expect(SAVE_TURN_SNAPSHOT_SQL).toMatch(/INSERT INTO game_states/);
    expect(SAVE_TURN_SNAPSHOT_SQL).toMatch(/earlier\.game_id = \$1/);
    expect(SAVE_TURN_SNAPSHOT_SQL).toMatch(/earlier\.turn_number = \$2/);
    // The game's first snapshot is never deleted, so a replay opens on the start.
    expect(SAVE_TURN_SNAPSHOT_SQL).toMatch(/ORDER BY opening\.saved_at ASC/);
  });
});

describe.runIf(enabled)('SAVE_TURN_SNAPSHOT_SQL — against Postgres', () => {
  let query: (sql: string, params?: unknown[]) => Promise<Record<string, unknown>[]>;
  const gameIds: string[] = [];

  async function newGame(): Promise<string> {
    const [row] = await query(
      `INSERT INTO games (map_id, era_id, status) VALUES ('era_ancient', 'ancient', 'in_progress') RETURNING game_id`,
    );
    gameIds.push(row.game_id as string);
    return row.game_id as string;
  }

  const save = (gameId: string, turn: number, label: string) =>
    query(SAVE_TURN_SNAPSHOT_SQL, [gameId, turn, JSON.stringify({ turn_number: turn, label })]);

  const snapshots = (gameId: string) =>
    query(
      `SELECT turn_number, state_json->>'label' AS label FROM game_states
       WHERE game_id = $1 ORDER BY saved_at, id`,
      [gameId],
    );

  beforeAll(async () => {
    ({ query } = (await import('../db/postgres')) as unknown as {
      query: (sql: string, params?: unknown[]) => Promise<Record<string, unknown>[]>;
    });
  }, 60_000);

  afterAll(async () => {
    if (gameIds.length) {
      // game_states rows go with their game (ON DELETE CASCADE).
      await query(`DELETE FROM games WHERE game_id = ANY($1::uuid[])`, [gameIds]).catch(() => {});
    }
  });

  it('keeps the opening board and the newest snapshot of each turn', async () => {
    const gameId = await newGame();
    await save(gameId, 1, 'opening');
    await save(gameId, 1, 'turn 1 draft');
    await save(gameId, 1, 'turn 1 attack');
    await save(gameId, 1, 'turn 1 end');
    await save(gameId, 2, 'turn 2 draft');
    await save(gameId, 2, 'turn 2 end');
    await save(gameId, 3, 'turn 3 end');

    expect(await snapshots(gameId)).toEqual([
      { turn_number: 1, label: 'opening' },
      { turn_number: 1, label: 'turn 1 end' },
      { turn_number: 2, label: 'turn 2 end' },
      { turn_number: 3, label: 'turn 3 end' },
    ]);
  });

  it('leaves other games alone', async () => {
    const mine = await newGame();
    const other = await newGame();
    await save(other, 1, 'other opening');
    await save(other, 1, 'other turn 1 end');
    await save(mine, 1, 'mine opening');
    await save(mine, 1, 'mine turn 1 end');
    await save(mine, 1, 'mine turn 1 later');

    expect(await snapshots(other)).toEqual([
      { turn_number: 1, label: 'other opening' },
      { turn_number: 1, label: 'other turn 1 end' },
    ]);
    expect(await snapshots(mine)).toEqual([
      { turn_number: 1, label: 'mine opening' },
      { turn_number: 1, label: 'mine turn 1 later' },
    ]);
  });
});
