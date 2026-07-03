import { describe, it, expect, vi, beforeEach } from 'vitest';
import { STREAK_FREEZE_PRICE_GOLD, STREAK_FREEZE_MAX_HELD } from '@borderfall/shared';

const eventMock = vi.fn();
vi.mock('../../services/analyticsEvents', () => ({
  recordServerEvent: (...a: unknown[]) => eventMock(...a),
}));

// In-memory user the mocked db operates on. The guarded UPDATE and the
// disambiguating SELECT are emulated faithfully enough to exercise every
// branch of purchaseStreakFreeze.
const user = { gold: 0, streak_freezes: 0 };
const txQueries: { sql: string; params: unknown[] }[] = [];

vi.mock('../../db/postgres', () => ({
  query: vi.fn(),
  queryOne: vi.fn(async () => ({ gold: user.gold, streak_freezes: user.streak_freezes })),
  withTransaction: vi.fn(async (fn: (client: unknown) => Promise<unknown>) =>
    fn({
      query: async (sql: string, params: unknown[]) => {
        txQueries.push({ sql, params });
        if (sql.includes('streak_freezes = COALESCE(streak_freezes, 0) + 1')) {
          if (user.gold >= STREAK_FREEZE_PRICE_GOLD && user.streak_freezes < STREAK_FREEZE_MAX_HELD) {
            user.gold -= STREAK_FREEZE_PRICE_GOLD;
            user.streak_freezes += 1;
            return { rows: [{ streak_freezes: user.streak_freezes, gold: user.gold }], rowCount: 1 };
          }
          return { rows: [], rowCount: 0 };
        }
        return { rows: [], rowCount: 1 };
      },
    }),
  ),
}));

import { purchaseStreakFreeze } from './progressionService';

describe('purchaseStreakFreeze', () => {
  beforeEach(() => {
    eventMock.mockClear();
    txQueries.length = 0;
    user.gold = 0;
    user.streak_freezes = 0;
  });

  it('charges gold, grants a freeze, and logs the transaction', async () => {
    user.gold = 120;
    const res = await purchaseStreakFreeze('u1');
    expect(res).toEqual({ code: 'ok', streak_freezes: 1, gold: 120 - STREAK_FREEZE_PRICE_GOLD });
    const ledger = txQueries.find((q) => q.sql.includes('gold_transactions'));
    expect(ledger?.params).toEqual(['u1', -STREAK_FREEZE_PRICE_GOLD, 'Purchased: Streak Freeze']);
    expect(eventMock).toHaveBeenCalledWith('streak_freeze_purchased', { held: 1 }, 'u1');
  });

  it('returns insufficient_gold without a ledger row when too poor', async () => {
    user.gold = STREAK_FREEZE_PRICE_GOLD - 1;
    const res = await purchaseStreakFreeze('u1');
    expect(res).toEqual({ code: 'insufficient_gold', balance: STREAK_FREEZE_PRICE_GOLD - 1 });
    expect(txQueries.find((q) => q.sql.includes('gold_transactions'))).toBeUndefined();
    expect(user.streak_freezes).toBe(0);
    expect(eventMock).not.toHaveBeenCalled();
  });

  it('returns at_cap when the held cap is reached, even with gold to spend', async () => {
    user.gold = 500;
    user.streak_freezes = STREAK_FREEZE_MAX_HELD;
    const res = await purchaseStreakFreeze('u1');
    expect(res).toEqual({ code: 'at_cap', held: STREAK_FREEZE_MAX_HELD });
    expect(user.gold).toBe(500);
  });

  it('sequential buys stop exactly at the cap', async () => {
    user.gold = 1000;
    expect((await purchaseStreakFreeze('u1')).code).toBe('ok');
    expect((await purchaseStreakFreeze('u1')).code).toBe('ok');
    expect((await purchaseStreakFreeze('u1')).code).toBe('at_cap');
    expect(user.streak_freezes).toBe(STREAK_FREEZE_MAX_HELD);
    expect(user.gold).toBe(1000 - STREAK_FREEZE_MAX_HELD * STREAK_FREEZE_PRICE_GOLD);
  });
});
