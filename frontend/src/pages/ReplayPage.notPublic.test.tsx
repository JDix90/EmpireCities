/**
 * A replay that isn't public, opened by someone who can't watch it. Most of
 * those visitors arrive from a shared link without an account; before guests
 * could make their replays public, that was every link a guest shared. A
 * signed-out visitor is offered Play free first (player_links_play_enabled),
 * with Sign in for a player who was in the game.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import ReplayPage from './ReplayPage';
import { useAuthStore, type AuthUser } from '../store/authStore';
import { useFeatureFlagsStore } from '../store/featureFlagsStore';

vi.mock('../services/api', () => ({
  api: { get: vi.fn(() => Promise.reject(new Error('unexpected'))), post: vi.fn(() => Promise.resolve({ data: {} })) },
}));
vi.mock('../services/socket', () => ({ resyncSocketAuth: vi.fn(), disconnectSocket: vi.fn() }));
vi.mock('../utils/device', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../utils/device')>()),
  isPhoneLayout: () => true,
  isMobileViewport: () => true,
  prefersReducedMotion: () => false,
}));
vi.mock('../hooks/useFrameBudget', () => ({
  usePageFrameBudget: () => ({ active: false, fps: 60, reduced: false }),
}));
vi.mock('../utils/globeLoader', () => ({
  GlobeMapLazy: () => <div data-testid="globe" />,
  GalaxyStrategicViewLazy: () => null,
  preloadGlobeChunks: () => {},
}));
vi.mock('../components/game/GameMap', () => ({ default: () => <div data-testid="map-2d" /> }));
vi.mock('../components/game/ReplayClipExporter', () => ({ default: () => null }));
vi.mock('../utils/replayLoader', () => {
  class ReplayNotPublicError extends Error {}
  return {
    loadReplaySnapshots: () => Promise.reject(new ReplayNotPublicError('Replay is not public')),
    ReplayNotPublicError,
  };
});

function renderReplay() {
  return render(
    <MemoryRouter initialEntries={['/replay/g1?source=share']}>
      <Routes>
        <Route path="/replay/:gameId" element={<ReplayPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

const setPlayerLinks = (on: boolean) =>
  useFeatureFlagsStore.setState((s) => ({ loaded: true, flags: { ...s.flags, player_links_play_enabled: on } }));

describe('ReplayPage, a replay that is not public', () => {
  beforeEach(() => {
    window.matchMedia = vi.fn().mockReturnValue({
      matches: false, media: '', onchange: null,
      addListener: vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn(),
    }) as unknown as typeof window.matchMedia;
    useAuthStore.setState({ user: null, accessToken: null, isAuthenticated: false, bootstrapped: true });
  });
  afterEach(() => cleanup());

  it('offers a signed-out visitor Play free first, then Sign in', async () => {
    setPlayerLinks(true);
    renderReplay();
    expect(await screen.findByText("This replay isn't public")).toBeInTheDocument();
    const play = screen.getByRole('button', { name: 'Play free' });
    const signIn = screen.getByRole('button', { name: /Sign in/ });
    expect(play.className).toContain('btn-primary');
    expect(signIn.className).toContain('btn-secondary');
    expect(play.compareDocumentPosition(signIn) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('keeps Sign in as the main button with player links off', async () => {
    setPlayerLinks(false);
    renderReplay();
    await screen.findByText("This replay isn't public");
    expect(screen.queryByRole('button', { name: 'Play free' })).toBeNull();
    expect(screen.getByRole('button', { name: /Sign in/ }).className).toContain('btn-primary');
  });

  it('offers a signed-in viewer neither', async () => {
    setPlayerLinks(true);
    useAuthStore.setState({ isAuthenticated: true, user: { user_id: 'u1', username: 'Ada' } as AuthUser, accessToken: 't' });
    renderReplay();
    await screen.findByText("This replay isn't public");
    expect(screen.queryByRole('button', { name: 'Play free' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Sign in/ })).toBeNull();
  });
});
