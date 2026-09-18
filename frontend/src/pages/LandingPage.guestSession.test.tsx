import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

/**
 * The landing CTA must never mint a second guest over a live session.
 *
 * In a portal iframe this is the common path, not an edge case: reloading the
 * portal page resets the iframe to `/`, so a player whose session was just
 * recovered lands straight back on this button. Measured in the itch embed
 * before this guard, click → reload → click minted two guest accounts and
 * orphaned the first one's in-progress game.
 */
const navigateMock = vi.fn();
let tutorialFirst = false;

vi.mock('../services/api', () => ({ api: { post: vi.fn(), get: vi.fn() } }));
vi.mock('../services/socket', () => ({ resyncSocketAuth: vi.fn(), disconnectSocket: vi.fn() }));
vi.mock('../utils/visitAnalytics', () => ({ trackVisitEvent: vi.fn() }));
vi.mock('../components/landing/GameplayShowcase', () => ({ default: () => null }));
vi.mock('../store/featureFlagsStore', () => ({
  useOnboardingTutorialFirstEnabled: () => tutorialFirst,
  useHeroSingleCtaEnabled: () => true,
}));
vi.mock('react-router-dom', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-router-dom')>()),
  useNavigate: () => navigateMock,
}));

import LandingPage from './LandingPage';
import { useAuthStore } from '../store/authStore';

const loginAsGuestMock = vi.fn(async () => {
  useAuthStore.setState({
    user: { id: 'new', username: 'Guest_newborn' } as never,
    isAuthenticated: true,
  });
});

function renderLanding() {
  return render(
    <MemoryRouter>
      <LandingPage />
    </MemoryRouter>,
  );
}

const clickPlay = async () => {
  // The page carries several "Play Free Now" buttons; only the hero one runs
  // handleGuest — the rest open the Get Started modal.
  const cta = await screen.findByTestId('hero-guest-cta');
  // handleGuest is async, so its state updates land after the click returns —
  // flush them inside act() or React warns.
  await act(async () => {
    fireEvent.click(cta);
  });
};

describe('LandingPage guest CTA', () => {
  beforeEach(() => {
    navigateMock.mockClear();
    loginAsGuestMock.mockClear();
    tutorialFirst = false;
    useAuthStore.setState({
      user: null,
      accessToken: null,
      isAuthenticated: false,
      bootstrapped: true,
      loginAsGuest: loginAsGuestMock,
    });
  });

  it('mints a guest for a first-time visitor', async () => {
    renderLanding();
    await clickPlay();
    await waitFor(() => expect(loginAsGuestMock).toHaveBeenCalledTimes(1));
    expect(navigateMock).toHaveBeenCalledWith('/lobby');
  });

  it('reuses the session of a player who already has one', async () => {
    useAuthStore.setState({
      user: { id: 'u1', username: 'Guest_b8dc0234' } as never,
      isAuthenticated: true,
    });
    renderLanding();
    await clickPlay();
    await waitFor(() => expect(navigateMock).toHaveBeenCalledWith('/lobby'));
    expect(loginAsGuestMock).not.toHaveBeenCalled();
    expect(useAuthStore.getState().user?.username).toBe('Guest_b8dc0234');
  });

  it('does not re-run tutorial-first onboarding for a returning player', async () => {
    // The flag routes BRAND-NEW guests to `/tutorial?start=1`. A returning
    // player has already been triaged, so sending them back through it would
    // restart onboarding they may have finished.
    tutorialFirst = true;
    useAuthStore.setState({
      user: { id: 'u1', username: 'Guest_b8dc0234' } as never,
      isAuthenticated: true,
    });
    renderLanding();
    await clickPlay();
    await waitFor(() => expect(navigateMock).toHaveBeenCalledWith('/lobby'));
    expect(loginAsGuestMock).not.toHaveBeenCalled();
  });

  it('still routes a brand-new guest into tutorial-first onboarding', async () => {
    tutorialFirst = true;
    renderLanding();
    await clickPlay();
    await waitFor(() => expect(loginAsGuestMock).toHaveBeenCalledTimes(1));
    expect(navigateMock).toHaveBeenCalledWith('/tutorial?start=1');
  });

  it('waits for the silent refresh before deciding', async () => {
    // Pre-bootstrap the persisted flags are a guess; deciding early would mint
    // over a session that is about to come back.
    useAuthStore.setState({
      user: { id: 'u1', username: 'Guest_b8dc0234' } as never,
      isAuthenticated: false,
      bootstrapped: false,
    });
    renderLanding();
    await clickPlay();
    // Nothing should have happened yet — the click is parked on bootstrap.
    await new Promise((r) => setTimeout(r, 20));
    expect(loginAsGuestMock).not.toHaveBeenCalled();
    expect(navigateMock).not.toHaveBeenCalled();

    // Silent refresh lands and recovers the session.
    act(() => {
      useAuthStore.setState({ isAuthenticated: true, bootstrapped: true });
    });
    await waitFor(() => expect(navigateMock).toHaveBeenCalledWith('/lobby'));
    expect(loginAsGuestMock).not.toHaveBeenCalled();
  });
});
