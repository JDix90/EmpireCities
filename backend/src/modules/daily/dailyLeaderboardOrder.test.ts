/**
 * The daily leaderboard's ordering across the v1 → v2 seam (migration 042,
 * docs/DAILY_PUZZLE_V2.md §4): a v2 day ranks by accuracy, first-try and
 * attempts with `won` shown but never ranked; a v1 day keeps its exact order.
 *
 * Needs Postgres (migrated schema), gated on PG_TEST=1:
 *   PG_TEST=1 POSTGRES_HOST=127.0.0.1 POSTGRES_PORT=5499 POSTGRES_USER=postgres \
 *     POSTGRES_DB=borderfall POSTGRES_PASSWORD= \
 *     pnpm exec vitest run src/modules/daily/dailyLeaderboardOrder.test.ts
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import { DAILY_LEADERBOARD_COLUMNS, DAILY_LEADERBOARD_ORDER_BY } from './dailyLeaderboardOrder';

const enabled = process.env.PG_TEST === '1';

describe('dailyLeaderboardOrder — the SQL fragment', () => {
  it('names every column the boards show and orders with the dce alias only', () => {
    expect(DAILY_LEADERBOARD_COLUMNS).toContain('dce.accuracy');
    expect(DAILY_LEADERBOARD_COLUMNS).toContain('dce.first_try');
    expect(DAILY_LEADERBOARD_COLUMNS).toContain('dce.attempts');
    expect(DAILY_LEADERBOARD_COLUMNS).toContain('puzzle_version');
    expect(DAILY_LEADERBOARD_ORDER_BY).not.toMatch(/\bu\./);
    expect(DAILY_LEADERBOARD_ORDER_BY.trim().startsWith('(')).toBe(true);
  });
});

describe.runIf(enabled)('dailyLeaderboardOrder — against Postgres', () => {
  let query: (sql: string, params?: unknown[]) => Promise<Record<string, unknown>[]>;
  const userIds: string[] = [];
  const V1_DATE = '2001-01-08';
  const V2_DATE = '2001-01-09';

  async function seedUser(name: string): Promise<string> {
    const id = uuidv4();
    userIds.push(id);
    await query(
      `INSERT INTO users (user_id, username, email, password_hash, is_guest) VALUES ($1, $2, $3, 'x', false)`,
      [id, `${name}_${id.slice(0, 8)}`, `${id}@test.local`],
    );
    return id;
  }

  interface Seed {
    won: boolean; score: number; turns: number; territories?: number;
    version?: number; accuracy?: number; attempts?: number; firstTry?: boolean; completedAt?: string;
  }
  async function seedEntry(date: string, userId: string, e: Seed): Promise<void> {
    await query(
      `INSERT INTO daily_challenge_entries
         (challenge_date, user_id, won, turn_count, territory_count, puzzle_score, objective_met, archetype,
          move_feedback_mistakes, puzzle_version, accuracy, attempts, first_try, completed_at)
       VALUES ($1, $2, $3, $4, $5, $6, $3, 'military_capture', 0, $7, $8, $9, $10, $11)`,
      [date, userId, e.won, e.turns, e.territories ?? 5, e.score, e.version ?? 1, e.accuracy ?? null,
        e.attempts ?? null, e.firstTry ?? null, e.completedAt ?? '2001-01-09T12:00:00Z'],
    );
  }

  async function board(date: string): Promise<Array<Record<string, unknown>>> {
    return query(
      `SELECT u.username, ${DAILY_LEADERBOARD_COLUMNS}
       FROM daily_challenge_entries dce
       JOIN users u ON u.user_id = dce.user_id
       WHERE dce.challenge_date = $1::date AND u.is_guest = false
       ORDER BY ${DAILY_LEADERBOARD_ORDER_BY}`,
      [date],
    );
  }

  beforeAll(async () => {
    ({ query } = (await import('../../db/postgres')) as unknown as {
      query: (sql: string, params?: unknown[]) => Promise<Record<string, unknown>[]>;
    });
    for (const date of [V1_DATE, V2_DATE]) {
      await query(
        `INSERT INTO daily_challenges (challenge_date, era_id, map_id, seed, player_count, kind, spec_json)
         VALUES ($1, 'ancient', 'era_ancient', 1, 2, 'puzzle', '{"archetype":"military_capture"}'::jsonb)
         ON CONFLICT (challenge_date) DO NOTHING`,
        [date],
      );
    }
  }, 60_000);

  afterAll(async () => {
    if (userIds.length) {
      await query(`DELETE FROM daily_challenge_entries WHERE user_id = ANY($1)`, [userIds]).catch(() => {});
      await query(`DELETE FROM users WHERE user_id = ANY($1)`, [userIds]).catch(() => {});
    }
    await query(`DELETE FROM daily_challenges WHERE challenge_date = ANY($1::date[])`, [[V1_DATE, V2_DATE]]).catch(() => {});
  });

  it('migration 042 added the v2 columns with a v1 default', async () => {
    const cols = await query(
      `SELECT column_name, column_default FROM information_schema.columns
       WHERE table_name = 'daily_challenge_entries' AND column_name = ANY($1)`,
      [['puzzle_version', 'accuracy', 'attempts', 'first_try', 'decisions_json']],
    );
    expect(cols.map((c) => c.column_name).sort()).toEqual(['accuracy', 'attempts', 'decisions_json', 'first_try', 'puzzle_version']);
    expect(String(cols.find((c) => c.column_name === 'puzzle_version')!.column_default)).toContain('1');
  });

  it('a v1 day ranks won, then score, then turns, then territories — as before', async () => {
    const a = await seedUser('v1a');
    const b = await seedUser('v1b');
    const c = await seedUser('v1c');
    const d = await seedUser('v1d');
    await seedEntry(V1_DATE, a, { won: true, score: 950, turns: 5 });
    await seedEntry(V1_DATE, b, { won: true, score: 1000, turns: 6 });
    await seedEntry(V1_DATE, c, { won: false, score: 1000, turns: 3 });
    await seedEntry(V1_DATE, d, { won: true, score: 950, turns: 4 });
    const rows = await board(V1_DATE);
    const order = rows.map((r) => String(r.username).split('_')[0]);
    expect(order).toEqual(['v1b', 'v1d', 'v1a', 'v1c']);
    expect(rows.every((r) => r.puzzle_version === 1)).toBe(true);
  });

  it('a v2 day ranks score (accuracy), then first-try, then attempts, then completion time; won is shown, never ranked', async () => {
    const lostButAccurate = await seedUser('v2lost');
    const wonSloppy = await seedUser('v2sloppy');
    const retried = await seedUser('v2retried');
    const firstTry = await seedUser('v2first');
    const later = await seedUser('v2later');
    const abandoned = await seedUser('v2quit');
    await seedEntry(V2_DATE, lostButAccurate, { won: false, score: 985, turns: 4, version: 2, accuracy: 98.5, attempts: 1, firstTry: true });
    await seedEntry(V2_DATE, wonSloppy, { won: true, score: 820, turns: 3, version: 2, accuracy: 82, attempts: 1, firstTry: true });
    await seedEntry(V2_DATE, retried, { won: true, score: 900, turns: 3, version: 2, accuracy: 90, attempts: 2, firstTry: false });
    await seedEntry(V2_DATE, firstTry, { won: true, score: 900, turns: 4, version: 2, accuracy: 90, attempts: 1, firstTry: true, completedAt: '2001-01-09T13:00:00Z' });
    await seedEntry(V2_DATE, later, { won: true, score: 900, turns: 2, version: 2, accuracy: 90, attempts: 1, firstTry: true, completedAt: '2001-01-09T14:00:00Z' });
    // An abandoned run: a v2 row with no accuracy, sorted below every finished one.
    await seedEntry(V2_DATE, abandoned, { won: false, score: 0, turns: 3, version: 2 });
    const rows = await board(V2_DATE);
    const order = rows.map((r) => String(r.username).split('_')[0]);
    expect(order).toEqual(['v2lost', 'v2first', 'v2later', 'v2retried', 'v2sloppy', 'v2quit']);
    expect(rows[0].won).toBe(false);
    expect(rows[0].accuracy).toBe(98.5);
    expect(rows[0].puzzle_version).toBe(2);
    expect(rows[rows.length - 1].accuracy).toBeNull();
  });
});
