import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

vi.mock('../services/api', () => ({ api: { post: vi.fn(), get: vi.fn() } }));
vi.mock('../services/socket', () => ({ resyncSocketAuth: vi.fn(), disconnectSocket: vi.fn() }));

import NativeHomePage from './NativeHomePage';
import { useAuthStore, type AuthUser } from '../store/authStore';
import { useFeatureFlagsStore } from '../store/featureFlagsStore';

function renderHome() {
  render(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route path="/" element={<NativeHomePage />} />
        <Route path="/lobby" element={<p>lobby page</p>} />
        <Route path="/tutorial" element={<p>tutorial page</p>} />
        <Route path="/login" element={<p>login page</p>} />
        <Route path="/privacy" element={<p>privacy page</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

const guest = { user_id: 'g1', username: 'Guest_1', is_guest: true } as AuthUser;

/** A `loginAsGuest` that signs a guest in, as the store's does after the request. */
function stubGuestLogin() {
  const loginAsGuest = vi.fn(async () => {
    useAuthStore.setState({ user: guest, accessToken: 'token', isAuthenticated: true });
  });
  useAuthStore.setState({ loginAsGuest });
  return loginAsGuest;
}

function setTutorialFirst(on: boolean) {
  useFeatureFlagsStore.setState((s) => ({ flags: { ...s.flags, onboarding_tutorial_first_enabled: on } }));
}

describe('NativeHomePage', () => {
  beforeEach(() => {
    useAuthStore.setState({ user: null, accessToken: null, isAuthenticated: false, bootstrapped: true });
    setTutorialFirst(false);
  });

  it('sends a player with a session straight to the lobby', () => {
    useAuthStore.setState({ user: guest, accessToken: 'token', isAuthenticated: true });
    renderHome();
    expect(screen.getByText('lobby page')).toBeInTheDocument();
  });

  it('offers play and sign in, and nothing from the landing page', () => {
    renderHome();
    expect(screen.getByTestId('native-home-play')).toBeEnabled();
    expect(screen.getByTestId('native-home-sign-in')).toHaveAttribute('href', '/login');
    expect(screen.getByRole('link', { name: 'Privacy Policy' })).toHaveAttribute('href', '/privacy');
    expect(screen.getByRole('link', { name: 'Terms of Service' })).toHaveAttribute('href', '/terms');
    // The website's hero, era catalogue and marketing footer are not here.
    expect(screen.queryByTestId('hero-tagline')).toBeNull();
    expect(screen.queryByText('Choose Your Era')).toBeNull();
    expect(document.querySelectorAll('a[href^="/eras"], a[href^="/answers"], a[href^="/game-maps"], a[href="/about"]')).toHaveLength(0);
  });

  it('holds the buttons until the silent refresh has settled', () => {
    useAuthStore.setState({ bootstrapped: false });
    renderHome();
    expect(screen.getByTestId('native-home-play')).toBeDisabled();
  });

  it('does not send a session to the lobby on a guess: it waits for the refresh', () => {
    useAuthStore.setState({ user: guest, isAuthenticated: true, bootstrapped: false });
    renderHome();
    expect(screen.queryByText('lobby page')).toBeNull();
    expect(screen.getByTestId('native-home')).toBeInTheDocument();
  });

  it('Play makes a guest and opens the lobby', async () => {
    const loginAsGuest = stubGuestLogin();
    renderHome();
    fireEvent.click(screen.getByTestId('native-home-play'));
    await waitFor(() => expect(screen.getByText('lobby page')).toBeInTheDocument());
    expect(loginAsGuest).toHaveBeenCalledTimes(1);
  });

  it('Play takes a new guest to the tutorial match when tutorial-first is on', async () => {
    setTutorialFirst(true);
    stubGuestLogin();
    renderHome();
    fireEvent.click(screen.getByTestId('native-home-play'));
    await waitFor(() => expect(screen.getByText('tutorial page')).toBeInTheDocument());
  });

  it('Sign in goes to the sign-in page', () => {
    renderHome();
    fireEvent.click(screen.getByTestId('native-home-sign-in'));
    expect(screen.getByText('login page')).toBeInTheDocument();
  });
});
