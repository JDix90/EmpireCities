/**
 * The lobby's activity line counts games over a rolling 24 hours, so it says
 * "in the last 24 hours". As "games played today" it fell during the day as
 * the morning's games aged out, which read as a made-up number.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import LobbyPage from './LobbyPage';
import { useAuthStore } from '../store/authStore';

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

function renderLobby(gamesInLast24h: number) {
  getMock.mockImplementation((url: string) =>
    url === '/games/stats/activity'
      ? Promise.resolve({ data: { games_in_progress: 0, games_today: gamesInLast24h, games_total: 500 } })
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
