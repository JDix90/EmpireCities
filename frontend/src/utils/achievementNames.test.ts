/**
 * Achievement names come from their definitions, fetched once; until they
 * arrive, or if the fetch fails, the id in title case stands in.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const get = vi.hoisted(() => vi.fn());
vi.mock('../services/api', () => ({ api: { get } }));

import { achievementName, loadAchievementNames, resetAchievementNamesForTests } from './achievementNames';

const DEFINITIONS = [
  { achievement_id: 'tutorial_complete', name: 'First Steps' },
  { achievement_id: 'ten_streak', name: 'Unstoppable' },
];

describe('achievement names', () => {
  beforeEach(() => {
    resetAchievementNamesForTests();
    get.mockReset();
  });

  it('fetches the definitions once and names each id by them', async () => {
    get.mockResolvedValue({ data: DEFINITIONS });
    const [first, second] = await Promise.all([loadAchievementNames(), loadAchievementNames()]);
    expect(get).toHaveBeenCalledTimes(1);
    expect(get).toHaveBeenCalledWith('/users/achievements');
    expect(second).toBe(first);
    expect(achievementName('tutorial_complete', first)).toBe('First Steps');
    expect(achievementName('ten_streak', first)).toBe('Unstoppable');
  });

  it('falls back to the id in title case, and tries the fetch again after a failure', async () => {
    get.mockRejectedValueOnce(new Error('offline'));
    const none = await loadAchievementNames();
    expect(achievementName('age_of_sail', none)).toBe('Age Of Sail');
    get.mockResolvedValueOnce({ data: DEFINITIONS });
    expect(achievementName('tutorial_complete', await loadAchievementNames())).toBe('First Steps');
    expect(get).toHaveBeenCalledTimes(2);
  });
});
