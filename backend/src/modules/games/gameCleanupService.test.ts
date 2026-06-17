import { describe, it, expect, vi, beforeEach } from 'vitest';

const queryMock = vi.fn();
vi.mock('../../db/postgres', () => ({ query: (...a: unknown[]) => queryMock(...a) }));

import { deleteExpiredGameStateSnapshots } from './gameCleanupService';

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
