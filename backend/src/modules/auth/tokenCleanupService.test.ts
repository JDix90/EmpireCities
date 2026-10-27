/**
 * The token sweep deletes in batches: a full batch means there may be more, a
 * short one means the table is done, and a cap keeps one tick from running on
 * through a table that has grown for years.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const queryMock = vi.hoisted(() => vi.fn());
vi.mock('../../db/postgres', () => ({
  query: (...a: unknown[]) => queryMock(...a),
}));

import {
  deleteDeadTokens,
  TOKEN_CLEANUP_BATCH,
  TOKEN_CLEANUP_MAX_BATCHES,
  TOKEN_TABLES,
} from './tokenCleanupService';

const tableOf = (sql: string) => /DELETE FROM (\w+)/.exec(sql)?.[1];

// A block body: an arrow returning the mock would hand vitest a cleanup to call.
beforeEach(() => {
  queryMock.mockReset();
});

describe('deleteDeadTokens', () => {
  it('works through each table until a batch comes back short', async () => {
    const answers: Record<string, number[]> = {
      refresh_tokens: [TOKEN_CLEANUP_BATCH, TOKEN_CLEANUP_BATCH, 12],
      password_reset_tokens: [3],
      sign_in_link_tokens: [0],
    };
    queryMock.mockImplementation(async (sql: string) => [{ n: answers[tableOf(sql)!]!.shift() }]);

    const deleted = await deleteDeadTokens();

    expect(deleted).toEqual({
      refresh_tokens: 2 * TOKEN_CLEANUP_BATCH + 12,
      password_reset_tokens: 3,
      sign_in_link_tokens: 0,
    });
    expect(queryMock.mock.calls.map(([sql]) => tableOf(sql))).toEqual([
      'refresh_tokens', 'refresh_tokens', 'refresh_tokens', 'password_reset_tokens', 'sign_in_link_tokens',
    ]);
    for (const [, params] of queryMock.mock.calls) expect(params).toEqual([TOKEN_CLEANUP_BATCH]);
  });

  it('stops a table at the cap and leaves the rest for the next tick', async () => {
    queryMock.mockImplementation(async (sql: string) =>
      [{ n: tableOf(sql) === 'refresh_tokens' ? TOKEN_CLEANUP_BATCH : 0 }]);

    const deleted = await deleteDeadTokens();

    expect(deleted.refresh_tokens).toBe(TOKEN_CLEANUP_MAX_BATCHES * TOKEN_CLEANUP_BATCH);
    expect(queryMock.mock.calls.filter(([sql]) => tableOf(sql) === 'refresh_tokens')).toHaveLength(TOKEN_CLEANUP_MAX_BATCHES);
  });

  it('only ever deletes what the readers would refuse, a day after', () => {
    expect(TOKEN_TABLES.map((t) => [t.table, t.dead])).toEqual([
      // A rotated row counts from when it was replaced (migration 054).
      ['refresh_tokens', "expires_at < NOW() - INTERVAL '1 day' OR (revoked AND COALESCE(rotated_at, created_at) < NOW() - INTERVAL '1 day')"],
      ['password_reset_tokens', "expires_at < NOW() - INTERVAL '1 day' OR used_at < NOW() - INTERVAL '1 day'"],
      ['sign_in_link_tokens', "expires_at < NOW() - INTERVAL '1 day' OR used_at < NOW() - INTERVAL '1 day'"],
    ]);
  });
});
