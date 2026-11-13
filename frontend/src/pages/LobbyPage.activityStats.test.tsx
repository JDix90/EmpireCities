/**
 * The lobby's activity line counts games over a rolling 24 hours, so it says
 * "in the last 24 hours". As "games played today" it fell during the day as
 * the morning's games aged out, which read as a made-up number.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import LobbyPage from './LobbyPage';
import { useAuthStore } from '../store/authStore';
import { useFeatureFlagsStore } from '../store/featureFlagsStore';

const getMock = vi.fn();
vi.mock('../services/api', () => ({
  api: {
    get: (...a: unknown[]) => getMock(...a),
    post: vi.fn(() => Promise.reject(new Error('offline'))),
    delete: vi.fn(() => Promise.resolve({ data: {} })),
  },
}));
vi.mock('../services/mapService', () => ({
  fetchMapById: vi.fn(() => Promise.reject(new Error('offline'))),
}));

function renderLobby(gamesInLast24h: number, gamesInProgress = 0, gamesPlayedTotal = 480) {
  getMock.mockImplementation((url: string) =>
    url === '/games/stats/activity'
      ? Promise.resolve({ data: { games_in_progress: gamesInProgress, games_today: gamesInLast24h, games_total: 500, games_played_total: gamesPlayedTotal } })
      : Promise.reject(new Error('offline')),
  );
  useAuthStore.setState({
    user: { user_id: 'u1', username: 'commander', is_guest: true, xp: 50 } as never,
    isAuthenticated: true,
  });
  return render(
    <MemoryRouter initialEntries={['/lobby']}>
      <LobbyPage />
    </MemoryRouter>,
  );
}

describe('the lobby\'s games count', () => {
  beforeEach(() => {
    getMock.mockReset();
    window.matchMedia = vi.fn().mockReturnValue({
      matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn(),
    }) as unknown as typeof window.matchMedia;
  });

  it('names the window it counts, and what it counts', async () => {
    renderLobby(37);
    const line = await screen.findByTestId('lobby-games-24h');
    expect(line).toHaveTextContent(/37\s*games played in the last 24 hours/);
    expect(line).not.toHaveTextContent(/today/);
    expect(line).toHaveAttribute('title', expect.stringMatching(/started or finished in the last 24 hours, tutorials and unfinished games included/));
  });

  it('says "game" for one', async () => {
    renderLobby(1);
    expect(await screen.findByTestId('lobby-games-24h')).toHaveTextContent(/^1\s*game played in the last 24 hours$/);
  });
});

describe('the lobby\'s counters at any size, and the early-access count', () => {
  const setFlags = (flags: { lobby_cleanup_enabled?: boolean; early_access_count_enabled?: boolean }) =>
    useFeatureFlagsStore.setState((st) => ({ flags: { ...st.flags, ...flags } }));
  beforeEach(() => {
    getMock.mockReset();
    window.matchMedia = vi.fn().mockReturnValue({
      matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn(),
    }) as unknown as typeof window.matchMedia;
  });
  afterEach(() => setFlags({ lobby_cleanup_enabled: false, early_access_count_enabled: false }));

  it('shows "1 game being played right now" and a small 24-hour count, with the lobby clean-up on too', async () => {
    setFlags({ lobby_cleanup_enabled: true });
    renderLobby(3, 1);
    expect(await screen.findByTestId('lobby-games-live')).toHaveTextContent(/^1\s*game being played right now$/);
    expect(screen.getByTestId('lobby-games-24h')).toHaveTextContent(/^3\s*games played in the last 24 hours$/);
  });

  it('leads with "Early access · N games played so far" when the flag is on', async () => {
    setFlags({ early_access_count_enabled: true });
    renderLobby(3, 1, 1284);
    const total = await screen.findByTestId('lobby-games-all-time');
    expect(total).toHaveTextContent(/^Early access\s*1,284\s*games played so far$/);
    // First on the line: it frames the live numbers after it.
    expect(total.parentElement?.firstElementChild).toBe(total);
    expect(screen.getByTestId('lobby-games-live')).toBeInTheDocument();
  });

  it('shows the count even when nobody is playing right now', async () => {
    setFlags({ early_access_count_enabled: true });
    renderLobby(0, 0, 37);
    expect(await screen.findByTestId('lobby-games-all-time')).toHaveTextContent(/37\s*games played so far/);
    expect(screen.queryByTestId('lobby-games-live')).toBeNull();
  });

  it('is not shown with the flag off, though the server sends the total', async () => {
    renderLobby(12, 4, 1284);
    await screen.findByTestId('lobby-games-24h');
    expect(screen.queryByTestId('lobby-games-all-time')).toBeNull();
  });
});
