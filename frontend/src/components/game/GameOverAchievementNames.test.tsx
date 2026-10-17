/**
 * The game-over screen lists what the game unlocked by the names players know
 * them by. It title-cased the ids: First Steps read "Tutorial Complete",
 * Unstoppable "Ten Streak", and Age of Sail "Age Of Sail".
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

const get = vi.hoisted(() => vi.fn());
vi.mock('../../services/api', () => ({ api: { get, post: vi.fn(async () => ({ data: {} })) } }));

import ActionModal, { type GameOverModalData } from './ActionModal';
import { useAuthStore } from '../../store/authStore';
import { resetAchievementNamesForTests } from '../../utils/achievementNames';

function gameOver(achievements_unlocked: string[] | undefined): GameOverModalData {
  return {
    type: 'game_over',
    gameId: 'g1',
    isWinner: true,
    winnerName: 'Ada',
    winnerColor: '#fff',
    turnCount: 7,
    viewerId: 'me',
    victory_condition: 'domination',
    achievements_unlocked,
    players: [
      { player_id: 'me', username: 'Ada', color: '#fff', territory_count: 12, is_eliminated: false, is_ai: false },
      { player_id: 'ai1', username: 'AI Bot 1', color: '#f00', territory_count: 0, is_eliminated: true, is_ai: true },
    ],
  } as GameOverModalData;
}

describe('achievements on the game-over screen', () => {
  beforeEach(() => {
    resetAchievementNamesForTests();
    get.mockReset();
    get.mockImplementation(async (url: string) => (url === '/users/achievements'
      ? {
          data: [
            { achievement_id: 'tutorial_complete', name: 'First Steps' },
            { achievement_id: 'ten_streak', name: 'Unstoppable' },
            { achievement_id: 'age_of_sail', name: 'Age of Sail' },
          ],
        }
      : Promise.reject(new Error(`not served in this test: ${url}`))));
    window.matchMedia = vi.fn().mockReturnValue({
      matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn(),
      addListener: vi.fn(), removeListener: vi.fn(),
    }) as unknown as typeof window.matchMedia;
    useAuthStore.setState({
      user: { user_id: 'me', username: 'Ada', level: 2, xp: 250, mmr: 1000 },
      isAuthenticated: true,
    });
  });

  it('names each one as its definition does', async () => {
    render(<ActionModal data={gameOver(['tutorial_complete', 'ten_streak', 'age_of_sail'])} onDismiss={() => {}} />);
    expect(await screen.findByText('First Steps')).toBeTruthy();
    expect(screen.getByText('Unstoppable')).toBeTruthy();
    expect(screen.getByText('Age of Sail')).toBeTruthy();
    expect(screen.queryByText('Tutorial Complete')).toBeNull();
  });

  it('fetches no definitions for a game that unlocked nothing', () => {
    render(<ActionModal data={gameOver(undefined)} onDismiss={() => {}} />);
    expect(get).not.toHaveBeenCalledWith('/users/achievements');
  });
});
