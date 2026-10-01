/**
 * The backfill's guards, game by game. Its candidates are already the games
 * whose last saved board is the game-over board (galaxyReport.db.test.ts reads
 * that against Postgres); these are the boards that change, or turn out
 * unusable, between that select and the read.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { GameState } from '../../types';

const queryMock = vi.hoisted(() => vi.fn());
const recordMock = vi.hoisted(() => vi.fn());
vi.mock('../../db/postgres', () => ({ query: (...a: unknown[]) => queryMock(...a) }));
vi.mock('../../game-engine/state/galaxyResults', () => ({
  recordGalaxyGameResult: (...a: unknown[]) => recordMock(...a),
}));

import { backfillGalaxyResults } from './galaxyBackfill';

const ENDED = '2026-09-28 12:00:00.123456+00'; // games.ended_at::text
const board = (over: Partial<GameState>) => ({ phase: 'game_over', ...over }) as GameState;

/** The candidates the select answers, then each game's last board (undefined: pruned meanwhile). */
function serve(candidates: string[], boards: Record<string, GameState | undefined>): void {
  queryMock.mockImplementation(async (sql: string, params: unknown[]) => {
    if (/FROM games g/.test(sql)) return candidates.map((game_id) => ({ game_id, ended_at: ENDED }));
    const state = boards[params[0] as string];
    return state ? [{ state_json: state }] : [];
  });
}

beforeEach(() => {
  queryMock.mockReset();
  recordMock.mockReset();
});

describe('backfillGalaxyResults', () => {
  it('records each usable board as it ended, and counts why it skipped the rest', async () => {
    serve(['pruned', 'reopened', 'no_winner', 'side', 'legacy', 'taken'], {
      reopened: board({ phase: 'attack' }),
      no_winner: board({ winner_ids: [], winner_id: undefined }),
      side: board({ winner_ids: ['u1', 'ai_2'], winner_id: 'u1' }),
      legacy: board({ winner_id: 'u3' }),
      taken: board({ winner_ids: ['u4'], winner_id: 'u4' }),
    });
    recordMock.mockImplementation(async (gameId: string) => gameId !== 'taken');

    expect(await backfillGalaxyResults()).toEqual({
      checked: 6,
      recorded: 2,
      skipped: { no_saved_board: 1, not_finished: 1, no_winner: 1, not_recorded: 1 },
      more: false,
    });
    // A side that won together is credited whole; a board from before winner_ids, its one winner.
    expect(recordMock.mock.calls.map(([id, , winners, endedAt]) => [id, winners, endedAt])).toEqual([
      ['side', ['u1', 'ai_2'], ENDED],
      ['legacy', ['u3'], ENDED],
      ['taken', ['u4'], ENDED],
    ]);
  });

  it('reads one more candidate than the batch, to say whether more remain', async () => {
    serve(['a', 'b', 'c'], { a: board({ winner_ids: ['u1'] }), b: board({ winner_ids: ['u2'] }) });
    recordMock.mockResolvedValue(true);

    expect(await backfillGalaxyResults(2)).toMatchObject({ checked: 2, recorded: 2, more: true });
    expect(queryMock.mock.calls[0]![1]).toEqual([3]);
    expect(recordMock.mock.calls.map(([id]) => id)).toEqual(['a', 'b']);

    serve(['c'], { c: board({ winner_ids: ['u3'] }) });
    expect(await backfillGalaxyResults(2)).toMatchObject({ checked: 1, recorded: 1, more: false });
  });
});
