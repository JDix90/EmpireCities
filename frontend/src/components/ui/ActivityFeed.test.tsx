/**
 * Friend activity names the achievements a friend unlocked. The game end
 * records their ids, and the feed read a `name` field nobody wrote, so every
 * unlock read `Unlocked "achievement"`.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const get = vi.hoisted(() => vi.fn());
vi.mock('../../services/api', () => ({ api: { get } }));

import ActivityFeed from './ActivityFeed';
import { resetAchievementNamesForTests } from '../../utils/achievementNames';

const event = (id: string, event_data: Record<string, unknown>) => ({
  id, user_id: 'u1', username: 'Ada', event_type: 'achievement_unlocked', event_data, created_at: new Date().toISOString(),
});

describe('ActivityFeed', () => {
  beforeEach(() => {
    resetAchievementNamesForTests();
    get.mockReset();
  });

  it('names the achievements a friend unlocked', async () => {
    get.mockImplementation(async (url: string) => (url === '/feed'
      ? {
          data: {
            activities: [
              event('e1', { username: 'Ada', achievements: ['tutorial_complete', 'ten_streak', 'first_blood'] }),
              event('e2', { username: 'Ada', achievements: ['ten_streak'] }),
            ],
          },
        }
      : {
          data: [
            { achievement_id: 'tutorial_complete', name: 'First Steps' },
            { achievement_id: 'ten_streak', name: 'Unstoppable' },
            { achievement_id: 'first_blood', name: 'First Blood' },
          ],
        }));
    render(<MemoryRouter><ActivityFeed /></MemoryRouter>);
    expect(await screen.findByText('Unlocked "First Steps", "Unstoppable" and "First Blood"')).toBeTruthy();
    expect(screen.getByText('Unlocked "Unstoppable"')).toBeTruthy();
  });
});
