import { describe, it, expect, vi, beforeEach } from 'vitest';

const queryMock = vi.fn();
const queryOneMock = vi.fn();
const recordServerEventMock = vi.fn();

vi.mock('../../db/postgres', () => ({
  query: (...a: unknown[]) => queryMock(...a),
  queryOne: (...a: unknown[]) => queryOneMock(...a),
}));
vi.mock('../../services/analyticsEvents', () => ({
  recordServerEvent: (...a: unknown[]) => recordServerEventMock(...a),
}));

import { recordDailyChallengeLoss, DAILY_GRACE_TURNS } from './recordDailyEntry';

const GAME = 'game-1';
const USER = 'user-1';

/** Queue the three queryOne lookups the helper makes, in order. */
function stubLookups(opts: {
  daily?: string | null;
  archetype?: string | null;
  participant?: boolean;
  turn?: number | null;
}) {
  const { daily = '2026-09-04', archetype = 'military_capture', participant = true, turn = 5 } = opts;
  queryOneMock
    .mockResolvedValueOnce(daily === null ? null : { daily_challenge_date: daily, archetype })
    .mockResolvedValueOnce(participant ? { c: 1 } : null)
    .mockResolvedValueOnce(turn === null ? null : { turn_number: turn });
}

beforeEach(() => {
  queryMock.mockReset();
  queryOneMock.mockReset();
  recordServerEventMock.mockReset();
  queryMock.mockResolvedValue([{ entry_id: 'e1' }]); // default: insert wrote a row
});

describe('recordDailyChallengeLoss', () => {
  it('writes a losing entry when a daily game is abandoned past the grace window', async () => {
    stubLookups({ turn: 5 });
    await recordDailyChallengeLoss(GAME, USER);

    expect(queryMock).toHaveBeenCalledTimes(1);
    const [sql, params] = queryMock.mock.calls[0];
    expect(sql).toMatch(/INSERT INTO daily_challenge_entries/);
    expect(sql).toMatch(/ON CONFLICT \(challenge_date, user_id\) DO NOTHING/);
    // won=false and puzzle_score=0 are hard-coded in the VALUES clause; params
    // carry date, user, turn reached, and archetype.
    expect(params).toEqual(['2026-09-04', USER, 5, 'military_capture']);
    expect(recordServerEventMock).toHaveBeenCalledTimes(1);
    const [evt, evtPayload] = recordServerEventMock.mock.calls[0];
    expect(evt).toBe('daily_challenge_settled');
    expect(evtPayload).toMatchObject({ won: false, via: 'abandon', puzzle_score: 0 });
  });

  it('does NOT write an entry within the grace window (pre-first-move mulligan)', async () => {
    stubLookups({ turn: DAILY_GRACE_TURNS });
    await recordDailyChallengeLoss(GAME, USER);
    expect(queryMock).not.toHaveBeenCalled();
    expect(recordServerEventMock).not.toHaveBeenCalled();
  });

  it('treats a game with no persisted snapshot as turn 0 (free restart)', async () => {
    stubLookups({ turn: null });
    await recordDailyChallengeLoss(GAME, USER);
    expect(queryMock).not.toHaveBeenCalled();
  });

  it('is a no-op for a non-daily game', async () => {
    stubLookups({ daily: null });
    await recordDailyChallengeLoss(GAME, USER);
    // Only the first lookup runs; participant/snapshot/insert never happen.
    expect(queryOneMock).toHaveBeenCalledTimes(1);
    expect(queryMock).not.toHaveBeenCalled();
  });

  it('never records on behalf of a non-participant', async () => {
    stubLookups({ participant: false });
    await recordDailyChallengeLoss(GAME, USER);
    expect(queryMock).not.toHaveBeenCalled();
    expect(recordServerEventMock).not.toHaveBeenCalled();
  });

  it('does not emit an analytics event when the entry already existed (ON CONFLICT)', async () => {
    stubLookups({ turn: 9 });
    queryMock.mockResolvedValueOnce([]); // conflict → no row returned
    await recordDailyChallengeLoss(GAME, USER);
    expect(queryMock).toHaveBeenCalledTimes(1);
    expect(recordServerEventMock).not.toHaveBeenCalled();
  });
});
