import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import DailyChallengePage, { ordinal } from './DailyChallengePage';
import { useAuthStore } from '../store/authStore';
import { useFeatureFlagsStore } from '../store/featureFlagsStore';

const getMock = vi.fn();
vi.mock('../services/api', () => ({
  api: {
    get: (...a: unknown[]) => getMock(...a),
    post: vi.fn(),
  },
}));

const challenge = {
  challenge_date: '2026-09-07',
  era_id: 'ancient',
  map_id: 'era_ancient',
  seed: 1,
  player_count: 2,
  kind: 'puzzle',
  spec: { archetype: 'domination', title: 'The Crown\'s Reach', intro: '', goal: 'Take it all', era_id: 'ancient', map_id: 'era_ancient', seed: 1, player_count: 2, par_turns: 8 },
};

const entry = { entry_id: 'e1', won: true, puzzle_score: 870, turn_count: 9, territory_count: 12, completed_at: '2026-09-07T10:00:00Z' };

function mockToday(body: Record<string, unknown>) {
  getMock.mockImplementation((url: string) => {
    if (url === '/daily/today') return Promise.resolve({ data: body });
    // Weekly challenge: absent, so that card never renders here.
    return Promise.reject(new Error('no weekly'));
  });
}

function setGuest(isGuest: boolean) {
  useAuthStore.setState({
    user: { user_id: 'u1', username: isGuest ? 'Guest_u1' : 'Player', level: 1, xp: 0, mmr: 1000, is_guest: isGuest },
  } as never);
}

function renderPage() {
  return render(
    <MemoryRouter>
      <DailyChallengePage />
    </MemoryRouter>,
  );
}

describe('DailyChallengePage — guests play, registered rank', () => {
  beforeEach(() => {
    getMock.mockReset();
    const st = useFeatureFlagsStore.getState();
    useFeatureFlagsStore.setState({ ...st, flags: { ...st.flags, daily_guest_play_enabled: true } });
  });

  it('closes the door again when the operator flips the kill switch', async () => {
    setGuest(true);
    const st = useFeatureFlagsStore.getState();
    useFeatureFlagsStore.setState({ ...st, flags: { ...st.flags, daily_guest_play_enabled: false } });
    mockToday({ challenge, my_entry: null, active_game_id: null, attempts_today: 3, my_rank: null, leaderboard: [] });
    renderPage();
    await waitFor(() => expect(screen.getByRole('link', { name: /Create free account/ })).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: /Play Today's Challenge/ })).toBeNull();
  });

  it('offers a guest the Play button, not an account wall', async () => {
    setGuest(true);
    mockToday({ challenge, my_entry: null, active_game_id: null, attempts_today: 3, my_rank: null, leaderboard: [] });
    renderPage();
    await waitFor(() => expect(screen.getByRole('button', { name: /Play Today's Challenge/ })).toBeInTheDocument());
    expect(screen.queryByText(/free-account feature/i)).toBeNull();
  });

  it('names the place a guest would hold, and makes claiming it the CTA', async () => {
    setGuest(true);
    mockToday({
      challenge, my_entry: entry, active_game_id: null, attempts_today: 5, my_rank: 3,
      leaderboard: [{ username: 'A', won: true, puzzle_score: 1000, turn_count: 5, territory_count: 12, completed_at: entry.completed_at }],
    });
    renderPage();
    const card = await screen.findByTestId('daily-guest-rank');
    expect(card).toHaveTextContent(/would place you 3rd/);
    expect(card).toHaveTextContent(/Guest runs aren.t ranked/);
    const cta = screen.getByRole('link', { name: /Claim 3rd place/ });
    expect(cta).toHaveAttribute('href', '/upgrade');
    // They are not on the board they are looking at.
    expect(screen.queryByText('Guest_u1')).toBeNull();
  });

  it('tells a registered player their rank without a pitch', async () => {
    setGuest(false);
    mockToday({ challenge, my_entry: entry, active_game_id: null, attempts_today: 5, my_rank: 2, leaderboard: [] });
    renderPage();
    const line = await screen.findByTestId('daily-rank');
    expect(line).toHaveTextContent(/You.re 2nd today/);
    expect(screen.queryByTestId('daily-guest-rank')).toBeNull();
    expect(screen.queryByRole('link', { name: /Claim/ })).toBeNull();
  });

  it('shows no rank line before a run exists', async () => {
    setGuest(true);
    mockToday({ challenge, my_entry: null, active_game_id: null, attempts_today: 0, my_rank: null, leaderboard: [] });
    renderPage();
    await screen.findByRole('button', { name: /Play Today's Challenge/ });
    expect(screen.queryByTestId('daily-guest-rank')).toBeNull();
    expect(screen.queryByTestId('daily-rank')).toBeNull();
  });
});

describe('ordinal', () => {
  it('handles the English edge cases', () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 101, 111, 112].map(ordinal)).toEqual([
      '1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd', '23rd', '101st', '111th', '112th',
    ]);
  });
});
