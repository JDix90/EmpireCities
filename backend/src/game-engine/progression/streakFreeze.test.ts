import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PoolClient } from 'pg';

const eventMock = vi.fn();
vi.mock('../../services/analyticsEvents', () => ({
  recordServerEvent: (...a: unknown[]) => eventMock(...a),
}));

import { updateDailyStreak } from './progressionService';

const ymd = (daysAgo: number) => new Date(Date.now() - daysAgo * 86_400_000).toISOString().slice(0, 10);

interface FakeUser {
  daily_streak: number;
  last_played_date: string | null;
  streak_freezes: number;
}

function makeClient(user: FakeUser) {
  const calls: { sql: string; params: unknown[] }[] = [];
  const client = {
    query: vi.fn(async (sql: string, params?: unknown[]) => {
      calls.push({ sql, params: params ?? [] });
      if (sql.startsWith('SELECT daily_streak')) {
        return {
          rows: [{ daily_streak: user.daily_streak, last_played_date: user.last_played_date }],
          rowCount: 1,
        };
      }
      if (sql.includes('streak_freezes = streak_freezes - 1')) {
        if (user.streak_freezes > 0) {
          user.streak_freezes -= 1;
          return { rows: [], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      }
      return { rows: [], rowCount: 1 };
    }),
  } as unknown as PoolClient;
  return { client, calls };
}

const freezeCalls = (calls: { sql: string }[]) =>
  calls.filter((c) => c.sql.includes('streak_freezes = streak_freezes - 1'));
const streakWrite = (calls: { sql: string; params: unknown[] }[]) =>
  calls.find((c) => c.sql.includes('SET daily_streak'));

describe('updateDailyStreak with streak freezes', () => {
  beforeEach(() => {
    eventMock.mockClear();
  });

  it('is a no-op when already played today', async () => {
    const { client, calls } = makeClient({ daily_streak: 5, last_played_date: ymd(0), streak_freezes: 2 });
    const res = await updateDailyStreak(client, 'u1');
    expect(res).toEqual({ streak: 5, milestone: null, freeze_used: false });
    expect(streakWrite(calls)).toBeUndefined();
    expect(freezeCalls(calls)).toHaveLength(0);
  });

  it('continues the streak from yesterday without touching freezes', async () => {
    const { client, calls } = makeClient({ daily_streak: 4, last_played_date: ymd(1), streak_freezes: 2 });
    const res = await updateDailyStreak(client, 'u1');
    expect(res.streak).toBe(5);
    expect(res.freeze_used).toBe(false);
    expect(freezeCalls(calls)).toHaveLength(0);
  });

  it('bridges exactly one missed day when a freeze is held', async () => {
    const user: FakeUser = { daily_streak: 5, last_played_date: ymd(2), streak_freezes: 2 };
    const { client, calls } = makeClient(user);
    const res = await updateDailyStreak(client, 'u1');
    expect(res.streak).toBe(6);
    expect(res.freeze_used).toBe(true);
    expect(user.streak_freezes).toBe(1);
    // streak_freeze_used_on records the bridged (missed) day = yesterday
    expect(freezeCalls(calls)[0]!.params).toEqual(['u1', ymd(1)]);
    expect(eventMock).toHaveBeenCalledWith('streak_freeze_consumed', { streak: 6 }, 'u1');
  });

  it('resets to 1 after one missed day when no freeze is held', async () => {
    const { client, calls } = makeClient({ daily_streak: 5, last_played_date: ymd(2), streak_freezes: 0 });
    const res = await updateDailyStreak(client, 'u1');
    expect(res.streak).toBe(1);
    expect(res.freeze_used).toBe(false);
    expect(freezeCalls(calls)).toHaveLength(1); // attempted, guarded UPDATE matched no row
    expect(eventMock).not.toHaveBeenCalled();
  });

  it('resets after two missed days without consuming a held freeze', async () => {
    const user: FakeUser = { daily_streak: 9, last_played_date: ymd(3), streak_freezes: 2 };
    const { client, calls } = makeClient(user);
    const res = await updateDailyStreak(client, 'u1');
    expect(res.streak).toBe(1);
    expect(res.freeze_used).toBe(false);
    expect(user.streak_freezes).toBe(2);
    expect(freezeCalls(calls)).toHaveLength(0);
  });

  it('does not attempt a freeze for a zero streak', async () => {
    const { client, calls } = makeClient({ daily_streak: 0, last_played_date: ymd(2), streak_freezes: 1 });
    const res = await updateDailyStreak(client, 'u1');
    expect(res.streak).toBe(1);
    expect(freezeCalls(calls)).toHaveLength(0);
  });

  it('awards the milestone when the bridged day lands on one', async () => {
    const user: FakeUser = { daily_streak: 6, last_played_date: ymd(2), streak_freezes: 1 };
    const { client, calls } = makeClient(user);
    const res = await updateDailyStreak(client, 'u1');
    expect(res).toMatchObject({ streak: 7, milestone: 7, freeze_used: true });
    const goldAward = calls.find((c) => c.sql.includes('gold = COALESCE'));
    expect(goldAward?.params?.[0]).toBe(75);
  });
});
