/**
 * The friend-streak chip on a win's gold. The server sends the bonus as
 * { multiplier, streak, friends }; the results read it as a number, so
 * `(bonus ?? 0) > 0` was never true and the chip never showed.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../../services/api', () => ({ api: { get: vi.fn(async () => ({ data: {} })), post: vi.fn(async () => ({ data: {} })) } }));

import ActionModal, { type GameOverModalData } from './ActionModal';
import { useAuthStore } from '../../store/authStore';
import { useFeatureFlagsStore } from '../../store/featureFlagsStore';

const data = {
  type: 'game_over',
  gameId: 'g1',
  isWinner: true,
  winnerName: 'Ada',
  winnerColor: '#e74c3c',
  turnCount: 9,
  viewerId: 'me',
  victory_condition: 'domination',
  players: [
    { player_id: 'me', username: 'Ada', color: '#e74c3c', territory_count: 14, is_eliminated: false, is_ai: false },
    { player_id: 'p2', username: 'Bo', color: '#3498db', territory_count: 0, is_eliminated: true, is_ai: false },
  ],
  xpEarned: 120,
  progression: {
    win_streak: 1, daily_streak: 3, daily_streak_milestone: null, gold_awarded: 22, gold_multiplier: 1, level_cosmetic: null,
    friend_streak_bonus: { multiplier: 1.1, streak: 5, friends: ['Bo'] },
  },
} as GameOverModalData;

describe('the friend-streak chip on the results', () => {
  beforeEach(() => {
    window.matchMedia = vi.fn().mockReturnValue({
      matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn(),
    }) as unknown as typeof window.matchMedia;
    useAuthStore.setState({ user: { user_id: 'me', username: 'Ada', level: 3, xp: 1200, mmr: 1000 }, isAuthenticated: true });
    useFeatureFlagsStore.setState((s) => ({ flags: { ...s.flags, results_rewards_first_enabled: false } }));
  });

  it('shows the bonus the server sent, as a percentage', () => {
    render(<MemoryRouter><ActionModal data={data} onDismiss={() => {}} /></MemoryRouter>);
    expect(screen.getByText(/\+10% friend streak bonus/)).toBeInTheDocument();
  });
});
