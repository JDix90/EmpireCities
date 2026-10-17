/**
 * Friend activity names the achievements a friend unlocked and the era of a
 * win. The game end records ids (`achievements`, `era_id`), and the feed read
 * `name` and `era`, fields nobody wrote: every unlock read `Unlocked
 * "achievement"` and every win a bare "Won a game".
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const get = vi.hoisted(() => vi.fn());
vi.mock('../../services/api', () => ({ api: { get } }));

import ActivityFeed from './ActivityFeed';
import { resetAchievementNamesForTests } from '../../utils/achievementNames';

const event = (id: string, event_data: Record<string, unknown>, event_type = 'achievement_unlocked') => ({
  id, user_id: 'u1', username: 'Ada', event_type, event_data, created_at: new Date().toISOString(),
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

  it('names the era of a win, as the game end records it', async () => {
    get.mockImplementation(async (url: string) => (url === '/feed'
      ? {
          data: {
            activities: [
              event('w1', { game_id: 'g1', era_id: 'medieval', username: 'Ada', turn_count: 12 }, 'game_won'),
              event('w2', { game_id: 'g2', era_id: '', username: 'Ada', turn_count: 9 }, 'game_won'),
            ],
          },
        }
      : { data: [] }));
    render(<MemoryRouter><ActivityFeed /></MemoryRouter>);
    expect(await screen.findByText('Won a game (Medieval Era)')).toBeTruthy();
    expect(screen.getByText('Won a game')).toBeTruthy();
  });
});
