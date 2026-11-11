/**
 * Results lead with the rewards (results_rewards_first_enabled): the level bar,
 * the XP and the medals right under the outcome, then the turns and rating,
 * and the chart of each player's share of the map on the main view. Coaching
 * moves to its own tab, and the standings tab no longer repeats the medals.
 * Off, the results are as before.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../../services/api', () => ({ api: { get: vi.fn(async () => ({ data: {} })), post: vi.fn(async () => ({ data: {} })) } }));
vi.mock('../../utils/device', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../utils/device')>()),
  prefersReducedMotion: () => true,
}));

import ActionModal, { type GameOverModalData } from './ActionModal';
import { useAuthStore } from '../../store/authStore';
import { useFeatureFlagsStore } from '../../store/featureFlagsStore';

const history = Array.from({ length: 6 }, (_, i) => ({ step: i, turn: i + 1, probabilities: { me: 0.5 + i * 0.04, ai1: 0.5 - i * 0.04 } }));
const data = {
  type: 'game_over',
  gameId: 'g1',
  isWinner: true,
  winnerName: 'GallantPuma',
  winnerColor: '#e74c3c',
  turnCount: 9,
  viewerId: 'me',
  victory_condition: 'threshold',
  victory_threshold: 65,
  players: [
    { player_id: 'me', username: 'GallantPuma', color: '#e74c3c', territory_count: 10, is_eliminated: false, is_ai: false },
    { player_id: 'ai1', username: 'Atabeg Kerim', color: '#3498db', territory_count: 4, is_eliminated: false, is_ai: true },
  ],
  xpEarned: 105,
  achievements_unlocked: ['first_victory'],
  win_probability_history: history,
  progression: {
    win_streak: 1, daily_streak: 1, daily_streak_milestone: null, gold_awarded: 20, gold_multiplier: 1, level_cosmetic: null,
    xp: {
      game: 105,
      medals: [{ id: 'first_victory', xp: 500 }],
      before: { xp: 50, level: 1, floor: 0, next: 250 },
      after: { xp: 655, level: 2, floor: 250, next: 1000 },
    },
  },
  insights: [
    { turn: 3, title: 'Held the line at Wessex', impact: 'high', explanation: 'e', alternative: 'a' },
  ],
} as GameOverModalData;

const setFlag = (on: boolean) =>
  useFeatureFlagsStore.setState((s) => ({ flags: { ...s.flags, results_rewards_first_enabled: on } }));

const renderResults = () =>
  render(<MemoryRouter><ActionModal data={data} onDismiss={() => {}} /></MemoryRouter>);

/** Whether `a` comes before `b` in the document. */
const before = (a: Element, b: Element) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

describe('results, rewards first', () => {
  beforeEach(() => {
    window.matchMedia = vi.fn().mockReturnValue({
      matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn(),
    }) as unknown as typeof window.matchMedia;
    useAuthStore.setState({ user: { user_id: 'me', username: 'GallantPuma', level: 1, xp: 50, mmr: 1000 }, isAuthenticated: true });
  });
  afterEach(() => setFlag(false));

  it('puts the level-up, the XP and the medals under the outcome, then the turns, then the share-of-map chart', () => {
    setFlag(true);
    renderResults();
    const rewards = screen.getByTestId('results-rewards');
    expect(screen.getByTestId('results-level')).toHaveTextContent('Level 2');
    expect(screen.getByTestId('results-level-up')).toHaveTextContent('Level up!');
    expect(within(rewards).getByTestId('results-medals')).toHaveTextContent('+500 XP');
    const turns = screen.getByText('Turns');
    const chart = screen.getByText(/share over time/i);
    expect(before(screen.getByText('Victory!'), rewards)).toBe(true);
    expect(before(rewards, turns)).toBe(true);
    expect(before(turns, chart)).toBe(true);
    // The old bare line is gone.
    expect(screen.queryByText('+105 XP')).toBeNull();
  });

  it('moves coaching into its own tab, and keeps the medals out of the standings', () => {
    setFlag(true);
    renderResults();
    expect(screen.queryByText('Coaching Turning Points')).toBeNull();
    expect(screen.getByRole('button', { name: 'Standings' })).toBeInTheDocument();
    expect(screen.queryByText('Medals Earned')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Coaching' }));
    expect(screen.getByTestId('gameover-coaching')).toHaveTextContent('Held the line at Wessex');
  });

  it('is the results as before with the flag off', () => {
    setFlag(false);
    renderResults();
    expect(screen.queryByTestId('results-rewards')).toBeNull();
    expect(screen.getByText('+105 XP')).toBeInTheDocument();
    expect(screen.getByText('Coaching Turning Points')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Results' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Match Stats' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Coaching' })).toBeNull();
    expect(screen.getByText('Medals Earned')).toBeInTheDocument();
    // The chart sits after the turns, as it always did.
    expect(before(screen.getByText('Turns'), screen.getByText(/share over time/i))).toBe(true);
  });
});
