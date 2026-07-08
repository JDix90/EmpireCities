import { describe, it, expect, vi, beforeEach } from 'vitest';

const queryMock = vi.fn();
const queryOneMock = vi.fn();
vi.mock('../../db/postgres', () => ({
  query: (...a: unknown[]) => queryMock(...a),
  queryOne: (...a: unknown[]) => queryOneMock(...a),
  withTransaction: vi.fn(),
}));
vi.mock('../../services/analyticsEvents', () => ({ recordServerEvent: vi.fn() }));

import { checkOnboardingQuests } from './progressionService';

function setCompleted(questIds: string[]) {
  queryMock.mockImplementation(async (sql: string) => {
    if (sql.includes('SELECT quest_id FROM user_quests')) {
      return questIds.map((quest_id) => ({ quest_id }));
    }
    return [];
  });
}

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
