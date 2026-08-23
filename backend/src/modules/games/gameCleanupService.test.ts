import { describe, it, expect, vi, beforeEach } from 'vitest';

const queryMock = vi.fn();
vi.mock('../../db/postgres', () => ({ query: (...a: unknown[]) => queryMock(...a) }));

import { abandonStaleGames, deleteExpiredGameStateSnapshots } from './gameCleanupService';

beforeEach(() => queryMock.mockReset());

describe('deleteExpiredGameStateSnapshots', () => {
  it('prunes only ended games, batched, and returns the rows-deleted count', async () => {
    queryMock.mockResolvedValue([{ id: 'g1' }, { id: 'g2' }, { id: 'g3' }]);
    const pruned = await deleteExpiredGameStateSnapshots();
    expect(pruned).toBe(3);

    const [sql, params] = queryMock.mock.calls[0];
    expect(sql).toMatch(/DELETE FROM game_states/);
    // Only ended games are eligible (never live ones)…
    expect(sql).toMatch(/status IN \('completed', 'abandoned'\)/);
    // …and the delete is bounded by a LIMIT so a backlog drains incrementally.
    expect(sql).toMatch(/LIMIT \$2/);
    expect(params[0]).toBeGreaterThan(0); // retention window in ms
    expect(params[1]).toBe(5000); // batch size
  });
});

describe('abandonStaleGames', () => {
  /**
   * Closes the gap that made snapshot retention ineffective in production:
   * deleteExpiredGameStateSnapshots only considers TERMINAL games, but a game
   * nobody finishes never becomes terminal. 43 such games held 53,794 snapshot
   * rows (~35GB, 98% of the table) reaching back three months, entirely
   * invisible to the 30-day window.
   */
  it('only targets non-terminal games idle past the threshold, batched', async () => {
    queryMock.mockResolvedValue([{ game_id: 'g1' }, { game_id: 'g2' }]);
    const abandoned = await abandonStaleGames();
    expect(abandoned).toEqual(['g1', 'g2']);

    const [sql, params] = queryMock.mock.calls[0];
    expect(sql).toMatch(/UPDATE games/);
    expect(sql).toMatch(/status = 'abandoned'/);
    // Live-but-unfinished games are exactly the target; terminal ones are
    // already handled by the snapshot prune and must not be re-touched.
    expect(sql).toMatch(/status IN \('waiting', 'in_progress'\)/);
    expect(sql).not.toMatch(/'completed'/);
    // Bounded, like the other sweeps, so the first run over a backlog drains
    // incrementally instead of one huge UPDATE.
    expect(sql).toMatch(/LIMIT \$2/);
    expect(params[1]).toBe(500);
  });

  it('uses a 9-day default threshold, well clear of the 72h max async deadline', async () => {
    queryMock.mockResolvedValue([]);
    await abandonStaleGames();
    const [, params] = queryMock.mock.calls[0];
    expect(params[0]).toBe(9 * 24 * 60 * 60 * 1000);
    // The longest selectable async turn deadline is 72h; a live game waiting on
    // a player must never be swept.
    expect(params[0]).toBeGreaterThan(72 * 60 * 60 * 1000);
  });

  it('back-dates ended_at to last activity so an existing backlog is reclaimable now', async () => {
    queryMock.mockResolvedValue([]);
    await abandonStaleGames();
    const [sql] = queryMock.mock.calls[0];
    // The snapshot prune keys off COALESCE(ended_at, created_at). Setting
    // ended_at = NOW() would start a fresh 30-day clock on games that have
    // already been idle for months.
    expect(sql).toMatch(/ended_at = COALESCE\(/);
    expect(sql).toMatch(/MAX\(gs\.saved_at\)/);
    expect(sql).not.toMatch(/ended_at = NOW\(\)/);
  });

  it('leaves ratings, XP and winner_id alone', async () => {
    queryMock.mockResolvedValue([]);
    await abandonStaleGames();
    const [sql] = queryMock.mock.calls[0];
    expect(sql).not.toMatch(/winner_id/);
    expect(sql).not.toMatch(/mmr|rating|\bxp\b/i);
  });
});
