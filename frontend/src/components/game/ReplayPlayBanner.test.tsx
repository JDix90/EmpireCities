import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';

vi.mock('../../services/api', () => ({ api: { post: vi.fn(), get: vi.fn() } }));
vi.mock('../../services/socket', () => ({ resyncSocketAuth: vi.fn(), disconnectSocket: vi.fn() }));
const trackVisitEvent = vi.fn();
vi.mock('../../utils/visitAnalytics', () => ({ trackVisitEvent: (...a: unknown[]) => trackVisitEvent(...a) }));

import { useAuthStore, type AuthUser } from '../../store/authStore';
import { useFeatureFlagsStore } from '../../store/featureFlagsStore';
import ReplayPlayBanner from './ReplayPlayBanner';

function Where() {
  const loc = useLocation();
  return <span data-testid="where">{loc.pathname + loc.search}</span>;
}

function renderBanner() {
  return render(
    <MemoryRouter initialEntries={['/replay/g1?source=share']}>
      <Routes>
        <Route path="/replay/:id" element={<ReplayPlayBanner />} />
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  );
}

function setFlags(playerLinks: boolean, tutorialFirst: boolean) {
  useFeatureFlagsStore.setState((s) => ({
    loaded: true,
    flags: { ...s.flags, player_links_play_enabled: playerLinks, onboarding_tutorial_first_enabled: tutorialFirst },
  }));
}

const newGuest = () =>
  vi.fn(async () => {
    useAuthStore.setState({ isAuthenticated: true, user: { user_id: 'g1', username: 'Guest', is_guest: true } as AuthUser, accessToken: 't' });
  });

describe('ReplayPlayBanner', () => {
  beforeEach(() => {
    trackVisitEvent.mockReset();
    useAuthStore.setState({ user: null, accessToken: null, isAuthenticated: false, bootstrapped: true });
  });

  it('shows nothing with the flag off, or to a signed-in viewer', () => {
    setFlags(false, true);
    const { unmount } = renderBanner();
    expect(screen.queryByRole('button', { name: 'Play free' })).toBeNull();
    unmount();
    setFlags(true, true);
    useAuthStore.setState({ isAuthenticated: true, user: { user_id: 'u1', username: 'p' } as AuthUser });
    renderBanner();
    expect(screen.queryByRole('button', { name: 'Play free' })).toBeNull();
  });

  it('starts a new guest in the tutorial, as the landing page does', async () => {
    setFlags(true, true);
    const loginAsGuest = newGuest();
    useAuthStore.setState({ loginAsGuest });
    renderBanner();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Play free' }));
    });
    expect(loginAsGuest).toHaveBeenCalledTimes(1);
    expect(trackVisitEvent).toHaveBeenCalledWith('hero_play_clicked', { placement: 'replay' });
    expect(screen.getByTestId('where').textContent).toBe('/tutorial?start=1');
  });

  it('sends a new guest to the lobby when the tutorial does not come first', async () => {
    setFlags(true, false);
    useAuthStore.setState({ loginAsGuest: newGuest() });
    renderBanner();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Play free' }));
    });
    expect(screen.getByTestId('where').textContent).toBe('/lobby');
  });
});
