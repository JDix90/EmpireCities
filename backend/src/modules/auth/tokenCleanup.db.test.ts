/**
 * Against Postgres: the token sweep deletes the rows that can no longer sign
 * anyone in, a day after they stop working, and leaves every row that still
 * can, or only just stopped.
 *
 * Needs Postgres (migrated schema), gated on PG_TEST=1:
 *   PG_TEST=1 POSTGRES_HOST=127.0.0.1 POSTGRES_PORT=5499 POSTGRES_USER=postgres \
 *     POSTGRES_DB=borderfall POSTGRES_PASSWORD= \
 *     pnpm exec vitest run src/modules/auth/tokenCleanup.db.test.ts
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { v4 as uuidv4 } from 'uuid';

const enabled = process.env.PG_TEST === '1';
type Query = (sql: string, params?: unknown[]) => Promise<Record<string, unknown>[]>;

describe.runIf(enabled)('token cleanup (Postgres)', { timeout: 20_000 }, () => {
  let query: Query;
  let deleteDeadTokens: typeof import('./tokenCleanupService').deleteDeadTokens;
  const userId = uuidv4();

  beforeAll(async () => {
    ({ query } = (await import('../../db/postgres')) as unknown as { query: Query });
    ({ deleteDeadTokens } = await import('./tokenCleanupService'));
    await query(
      `INSERT INTO users (user_id, username, email, password_hash) VALUES ($1, $2, $3, 'x')`,
      [userId, `tokclean_${userId.slice(0, 8)}`, `tokclean_${userId.slice(0, 8)}@test.local`],
    );
  }, 30_000);

  afterAll(async () => {
    if (query) await query('DELETE FROM users WHERE user_id = $1', [userId]).catch(() => {});
  });

  it('deletes dead rows from all three tables and keeps the live and the recent', async () => {
    // [label, expires_at offset, revoked, created_at offset]
    const refresh: Array<[string, string, boolean, string]> = [
      ['live', '+30 days', false, '-1 hour'],
      ['revoked, issued just now', '+30 days', true, '-1 hour'],
      ['revoked, issued two days ago', '+28 days', true, '-2 days'],
      ['expired two days ago', '-2 days', false, '-32 days'],
      ['expired an hour ago', '-1 hour', false, '-30 days'],
    ];
    for (const [label, exp, revoked, created] of refresh) {
      await query(
        `INSERT INTO refresh_tokens (user_id, token_hash, expires_at, revoked, created_at)
         VALUES ($1, $2, NOW() + $3::interval, $4, NOW() + $5::interval)`,
        [userId, label, exp, revoked, created],
      );
    }
    // [label, expires_at offset, used_at offset or null]
    const oneTime: Array<[string, string, string | null]> = [
      ['pending', '+30 minutes', null],
      ['used an hour ago', '+10 minutes', '-1 hour'],
      ['used two days ago', '-2 days', '-2 days'],
      ['expired two days ago', '-2 days', null],
      ['expired an hour ago', '-1 hour', null],
    ];
    for (const table of ['password_reset_tokens', 'sign_in_link_tokens']) {
      for (const [label, exp, used] of oneTime) {
        await query(
          `INSERT INTO ${table} (user_id, token_hash, expires_at, used_at)
           VALUES ($1, $2, NOW() + $3::interval, NOW() + $4::interval)`,
          [userId, label, exp, used],
        );
      }
    }

    const deleted = await deleteDeadTokens();
    // Other rows in a shared database may go too, so count at least ours.
    expect(deleted.refresh_tokens).toBeGreaterThanOrEqual(2);
    expect(deleted.password_reset_tokens).toBeGreaterThanOrEqual(2);
    expect(deleted.sign_in_link_tokens).toBeGreaterThanOrEqual(2);

    const left = async (table: string) =>
      (await query(`SELECT token_hash FROM ${table} WHERE user_id = $1 ORDER BY token_hash`, [userId]))
        .map((r) => r.token_hash);
    expect(await left('refresh_tokens')).toEqual(['expired an hour ago', 'live', 'revoked, issued just now']);
    expect(await left('password_reset_tokens')).toEqual(['expired an hour ago', 'pending', 'used an hour ago']);
    expect(await left('sign_in_link_tokens')).toEqual(['expired an hour ago', 'pending', 'used an hour ago']);
  });
});
