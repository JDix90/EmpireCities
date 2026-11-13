/**
 * The lobby clean-up's picks (lobby_cleanup_enabled): the next quest a player
 * can do where they are, and the next achievements to name.
 */
import { describe, it, expect } from 'vitest';
import { nextAchievementIds, nextQuest } from './questOrder';

const progress = (done: string[]) =>
  ['first_win', 'first_building', 'first_tech', 'first_ranked', 'first_friend', 'first_async'].map((quest_id) => ({
    quest_id,
    completed_at: done.includes(quest_id) ? '2026-11-01T00:00:00Z' : null,
  }));

describe('nextQuest', () => {
  it('starts everyone on a first win', () => {
    expect(nextQuest(progress([]), false)?.quest.quest_id).toBe('first_win');
    expect(nextQuest(progress([]), true)?.quest.quest_id).toBe('first_win');
  });

  it('after a win, offers an account other people before a building it cannot build in Quick Match', () => {
    const pick = nextQuest(progress(['first_win']), false)!;
    expect(pick.quest.quest_id).toBe('first_friend');
    expect(pick.position).toBe(2);
    expect(pick.total).toBe(6);
  });

  it('never shows a guest a quest that needs an account, and says where to build', () => {
    const pick = nextQuest(progress(['first_win']), true)!;
    expect(pick.quest.quest_id).toBe('first_building');
    expect(pick.where).toMatch(/Full Game/);
    expect(pick.total).toBe(3);
    expect(nextQuest(progress(['first_win', 'first_building', 'first_tech']), true)).toBeNull();
  });

  it('leaves ranked for last, since it needs an opponent waiting', () => {
    expect(nextQuest(progress(['first_win', 'first_friend', 'first_async', 'first_building', 'first_tech']), false)?.quest.quest_id).toBe('first_ranked');
  });

  it('counts quests done out of order in the position', () => {
    expect(nextQuest(progress(['first_tech']), false)).toMatchObject({ position: 2, quest: { quest_id: 'first_win' } });
  });
});

describe('nextAchievementIds', () => {
  // Sorted by name, as the API sends it.
  const catalog = [
    { achievement_id: 'card_shark', xp_reward: 250 },
    { achievement_id: 'diplomat', xp_reward: 150 },
    { achievement_id: 'first_blood', xp_reward: 200 },
    { achievement_id: 'immortal_streak', xp_reward: 1000 },
    { achievement_id: 'medieval_lord', xp_reward: 400 },
    { achievement_id: 'tutorial_complete', xp_reward: 100 },
    { achievement_id: 'veteran', xp_reward: 600 },
  ];

  it('names what a new player earns first, not the smallest reward or the hardest bar', () => {
    const ids = nextAchievementIds(catalog, new Set(), { immortal_streak: { current: 0, target: 25 }, veteran: { current: 0, target: 50 } });
    expect([...ids]).toEqual(['tutorial_complete', 'first_blood', 'medieval_lord']);
  });

  it('puts a bar already moving first, and never one already earned', () => {
    const ids = nextAchievementIds(catalog, new Set(['tutorial_complete']), { veteran: { current: 30, target: 50 } });
    expect([...ids]).toEqual(['veteran', 'first_blood', 'medieval_lord']);
  });

  it('leaves the ones that need other people for later', () => {
    const ids = nextAchievementIds(catalog, new Set(['tutorial_complete', 'first_blood', 'medieval_lord', 'card_shark']), {});
    expect([...ids]).toEqual(['veteran', 'immortal_streak', 'diplomat']);
  });
});
