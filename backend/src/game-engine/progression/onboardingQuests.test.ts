import { describe, it, expect, vi, beforeEach } from 'vitest';

const queryMock = vi.fn();
const queryOneMock = vi.fn();
vi.mock('../../db/postgres', () => ({
  query: (...a: unknown[]) => queryMock(...a),
  queryOne: (...a: unknown[]) => queryOneMock(...a),
  // The claim and its rewards run on a transaction client; route its queries
  // through the same mock so each test sees one ordered log of statements.
  withTransaction: async (fn: (client: unknown) => Promise<unknown>) =>
    fn({
      query: async (sql: string, params?: unknown[]) => {
        const rows = ((await queryMock(sql, params)) ?? []) as unknown[];
        return { rows, rowCount: rows.length };
      },
    }),
}));
vi.mock('../../services/analyticsEvents', () => ({ recordServerEvent: vi.fn() }));

import { checkOnboardingQuests } from './progressionService';

/**
 * `questIds` are already complete. The claim's `INSERT … RETURNING` returns
 * the row unless `lostRace`, where a concurrent call inserted it first.
 */
function setCompleted(questIds: string[], { lostRace = false } = {}) {
  queryMock.mockImplementation(async (sql: string, params?: unknown[]) => {
    if (sql.includes('SELECT quest_id FROM user_quests')) {
      return questIds.map((quest_id) => ({ quest_id }));
    }
    if (sql.includes('INSERT INTO user_quests')) {
      return lostRace ? [] : [{ quest_id: params?.[1] }];
    }
    return [];
  });
}

const rewardWrites = () =>
  queryMock.mock.calls.filter(([sql]) => /UPDATE users|gold_transactions/.test(sql as string));

describe('checkOnboardingQuests', () => {
  beforeEach(() => {
    queryMock.mockReset();
    queryOneMock.mockReset();
  });

  it('completes first_async out of order (nothing else done yet)', async () => {
    setCompleted([]);
    const quest = await checkOnboardingQuests('u1', 'async_start');
    expect(quest?.quest_id).toBe('first_async');
    expect(quest?.reward_gold).toBe(50);
    const insert = queryMock.mock.calls.find(([sql]) => (sql as string).includes('INSERT INTO user_quests'));
    expect(insert?.[1]).toEqual(['u1', 'first_async']);
    const ledger = queryMock.mock.calls.find(([sql]) => (sql as string).includes('gold_transactions'));
    expect(ledger?.[1]).toEqual(['u1', 50, 'Quest: The Long Game']);
  });

  it('pays nothing when a concurrent call claimed the quest first', async () => {
    setCompleted([], { lostRace: true });
    const quest = await checkOnboardingQuests('u1', 'async_start');
    expect(quest).toBeNull();
    expect(rewardWrites()).toEqual([]);
  });

  it('keeps sequential gating for the ordered chain', async () => {
    // Nothing completed: the only eligible sequential quest is first_win, so
    // a 'build' trigger (first_building, second in the chain) awards nothing.
    setCompleted([]);
    const quest = await checkOnboardingQuests('u1', 'build');
    expect(quest).toBeNull();
  });

  it('still completes the current sequential quest normally', async () => {
    setCompleted(['first_win']);
    const quest = await checkOnboardingQuests('u1', 'build');
    expect(quest?.quest_id).toBe('first_building');
  });

  it('does not complete first_async twice', async () => {
    setCompleted(['first_async']);
    const quest = await checkOnboardingQuests('u1', 'async_start');
    expect(quest).toBeNull();
  });

  it('sequential chain is unaffected by an already-completed first_async', async () => {
    setCompleted(['first_async', 'first_win']);
    const quest = await checkOnboardingQuests('u1', 'build');
    expect(quest?.quest_id).toBe('first_building');
  });
});
