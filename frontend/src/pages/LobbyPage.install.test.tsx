/**
 * The lobby's offer to add Borderfall to the home screen
 * (home_screen_install_enabled): to a player who has finished a game, never
 * on a first visit, and only with the flag on.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import LobbyPage from './LobbyPage';
import { useAuthStore } from '../store/authStore';
import { useFeatureFlagsStore } from '../store/featureFlagsStore';
import { resetInstallStateForTests } from '../services/homeScreenInstall';

vi.mock('../services/api', () => ({
  api: {
    get: vi.fn(() => Promise.reject(new Error('offline'))),
    post: vi.fn(() => Promise.resolve({ data: {} })),
    delete: vi.fn(() => Promise.resolve({ data: {} })),
  },
}));
vi.mock('../services/mapService', () => ({
  fetchMapById: vi.fn(() => Promise.reject(new Error('offline'))),
}));

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';

function setFlag(on: boolean) {
  useFeatureFlagsStore.setState((s) => ({ flags: { ...s.flags, home_screen_install_enabled: on } }));
}

/** The lobby as an iPhone player sees it, with the profile the server sends: onboarding_stage is always a number. */
function renderLobby(xp: number) {
  useAuthStore.setState({
    user: { user_id: 'u1', username: 'commander', is_guest: false, xp, onboarding_stage: 3 } as never,
    isAuthenticated: true,
  });
  return render(
    <MemoryRouter initialEntries={['/lobby']}>
      <LobbyPage />
    </MemoryRouter>,
  );
}

describe('LobbyPage: Add to Home Screen', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
    resetInstallStateForTests();
    vi.stubGlobal('navigator', { ...navigator, userAgent: IPHONE, platform: 'iPhone', maxTouchPoints: 5 });
    window.matchMedia = vi.fn().mockReturnValue({
      matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn(),
    }) as unknown as typeof window.matchMedia;
    setFlag(true);
  });

  it('offers it to a player who has finished a game', async () => {
    renderLobby(120);
    expect(await screen.findByTestId('install-offer-lobby')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add to Home Screen' })).toBeInTheDocument();
  });

  it('does not offer it on a first visit, before any game is finished', async () => {
    renderLobby(0);
    await screen.findByTestId('full-game-start');
    expect(screen.queryByTestId('install-offer-lobby')).toBeNull();
  });

  it('offers nothing with the flag off', async () => {
    setFlag(false);
    renderLobby(120);
    await screen.findByTestId('full-game-start');
    expect(screen.queryByTestId('install-offer-lobby')).toBeNull();
  });
});
