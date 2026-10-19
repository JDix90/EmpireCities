import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';

const post = vi.fn();
vi.mock('../services/api', () => ({ api: { post: (...a: unknown[]) => post(...a), get: vi.fn() } }));
vi.mock('../services/socket', () => ({ resyncSocketAuth: vi.fn(), disconnectSocket: vi.fn() }));
vi.mock('../utils/visitAnalytics', () => ({ trackVisitEvent: vi.fn() }));

import { useAuthStore, type AuthUser } from '../store/authStore';
import { useFeatureFlagsStore } from '../store/featureFlagsStore';
import JoinGamePage from './JoinGamePage';

function Where() {
  const loc = useLocation();
  return <span data-testid="where">{loc.pathname + loc.search}</span>;
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/join/:code" element={<JoinGamePage />} />
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  );
}

function setFlags(loaded: boolean, on: boolean) {
  useFeatureFlagsStore.setState((s) => ({ loaded, flags: { ...s.flags, player_links_play_enabled: on } }));
}

describe('JoinGamePage', () => {
  beforeEach(() => {
    post.mockReset();
    useAuthStore.setState({ user: null, accessToken: null, isAuthenticated: false, bootstrapped: true });
  });

  it('sends a signed-in invitee straight to the join', () => {
    setFlags(true, true);
    useAuthStore.setState({ isAuthenticated: true, user: { user_id: 'u1', username: 'p' } as AuthUser });
    renderAt('/join/ABC123');
    expect(screen.getByTestId('where').textContent).toBe('/lobby?join=ABC123');
  });

  it('with the flag off, sends a signed-out invitee through account creation, as before', () => {
    setFlags(true, false);
    renderAt('/join/ABC123');
    expect(screen.getByTestId('where').textContent).toBe(`/register?redirect=${encodeURIComponent('/lobby?join=ABC123')}`);
  });

  it('waits for the flags before choosing', () => {
    setFlags(false, false);
    renderAt('/join/ABC123');
    expect(screen.queryByTestId('where')).toBeNull();
    expect(screen.queryByText('Join as a guest')).toBeNull();
  });

  it('offers a signed-out invitee to join as a guest, or to sign in or sign up keeping the code', () => {
    setFlags(true, true);
    renderAt('/join/ABC123');
    expect(screen.getByText("You're invited to a game")).toBeTruthy();
    expect(screen.getByText('ABC123')).toBeTruthy();
    const target = encodeURIComponent('/lobby?join=ABC123');
    expect(screen.getByRole('link', { name: 'Sign in' }).getAttribute('href')).toBe(`/login?redirect=${target}`);
    expect(screen.getByRole('link', { name: 'create one' }).getAttribute('href')).toBe(`/register?redirect=${target}`);
  });

  it('joins as a new guest and moves on to the join', async () => {
    setFlags(true, true);
    const loginAsGuest = vi.fn(async () => {
      useAuthStore.setState({ isAuthenticated: true, user: { user_id: 'g1', username: 'Guest', is_guest: true } as AuthUser, accessToken: 't' });
    });
    useAuthStore.setState({ loginAsGuest });
    renderAt('/join/ABC123');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Join as a guest' }));
    });
    expect(loginAsGuest).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('where').textContent).toBe('/lobby?join=ABC123');
  });
});
