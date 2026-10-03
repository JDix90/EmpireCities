import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import LobbyPage from './LobbyPage';
import { useAuthStore } from '../store/authStore';

const getMock = vi.fn();
const postMock = vi.fn();
vi.mock('../services/api', () => ({
  api: {
    get: (...a: unknown[]) => getMock(...a),
    post: (...a: unknown[]) => postMock(...a),
    delete: vi.fn(() => Promise.resolve({ data: {} })),
  },
}));

vi.mock('../services/mapService', () => ({
  fetchMapById: vi.fn(() => Promise.reject(new Error('offline'))),
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => vi.fn() };
});

function stubMatchMedia() {
  window.matchMedia = vi.fn().mockReturnValue({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
  }) as unknown as typeof window.matchMedia;
}

function renderLobby(path: string, user: Record<string, unknown>) {
  useAuthStore.setState({
    user: { user_id: 'u1', username: 'commander', is_guest: false, xp: 50, ...user } as never,
    isAuthenticated: true,
  });
  return render(
    <MemoryRouter initialEntries={[path]}>
      <LobbyPage />
    </MemoryRouter>,
  );
}

/**
 * The Training Academy on the lobby lists the deep dives every era shares.
 * The Galactic Age track (seven lessons) is offered where a Galactic Age game
 * is set up instead, so the home section stays four cards tall.
 */
describe('LobbyPage Training Academy', () => {
  beforeEach(() => {
    getMock.mockReset();
    postMock.mockReset();
    getMock.mockImplementation(() => Promise.reject(new Error('offline')));
    stubMatchMedia();
  });

  it('lists the shared deep dives and keeps the Galactic Age track off the home grid', async () => {
    renderLobby('/lobby', { has_completed_tutorial: true });
    const academy = (await screen.findByText('Training Academy')).closest('.card') as HTMLElement;
    expect(within(academy).getByText('Advanced Settings')).toBeTruthy();
    expect(within(academy).getByText('Faction Abilities')).toBeTruthy();
    expect(within(academy).getByText('Technology Tree')).toBeTruthy();
    expect(within(academy).getByText('Era Advancement')).toBeTruthy();
    expect(within(academy).queryByText(/^Galactic Age:/)).toBeNull();
    expect(within(academy).getByRole('link', { name: 'View all' }).getAttribute('href')).toBe('/tutorial');
  });

  it('offers the Galactic Age lessons where a Galactic Age game is set up', async () => {
    renderLobby('/lobby?era=galaxy_age', { is_admin: true });
    await screen.findByText('Advanced Features');
    const offer = screen.getByTestId('galaxy-lessons-offer');
    const start = within(offer).getByRole('link', { name: /Start .*Galactic Age: The Differences/ });
    expect(start.getAttribute('href')).toBe('/tutorial?module=galaxy_primer&start=1');
    expect(within(offer).getByRole('link', { name: 'All lessons' }).getAttribute('href')).toBe('/tutorial');
  });

  it('makes no such offer for an era without the galaxy', async () => {
    renderLobby('/lobby?era=ww2', {});
    await screen.findByText('Advanced Features');
    expect(screen.queryByTestId('galaxy-lessons-offer')).toBeNull();
  });
});
