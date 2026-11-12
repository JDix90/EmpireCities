/**
 * A returning session on the home page (comeback_hook_enabled): greeted by
 * name, its live streak named, and straight back in. Off, the page offers
 * "Play Free Now" as before.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const navigateMock = vi.fn();
const flags = vi.hoisted(() => ({ hook: true, singleCta: true }));
const apiGet = vi.hoisted(() => vi.fn());

vi.mock('../services/api', () => ({ api: { post: vi.fn(async () => ({})), get: apiGet } }));
vi.mock('../services/socket', () => ({ resyncSocketAuth: vi.fn(), disconnectSocket: vi.fn() }));
vi.mock('../utils/visitAnalytics', () => ({ trackVisitEvent: vi.fn() }));
vi.mock('../components/landing/GameplayShowcase', () => ({ default: () => null }));
vi.mock('../store/featureFlagsStore', () => ({
  useOnboardingTutorialFirstEnabled: () => false,
  useHeroSingleCtaEnabled: () => flags.singleCta,
  useLocalizationEnabled: () => false,
  useGalaxyAgeBetaEnabled: () => false,
  useComebackHookEnabled: () => flags.hook,
}));
vi.mock('react-router-dom', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-router-dom')>()),
  useNavigate: () => navigateMock,
}));

import LandingPage from './LandingPage';
import { useAuthStore } from '../store/authStore';

const signedIn = () =>
  useAuthStore.setState({
    user: { user_id: 'g1', username: 'GallantPuma', is_guest: true } as never,
    accessToken: 'tok',
    isAuthenticated: true,
    bootstrapped: true,
    loginAsGuest: vi.fn(),
  });

const renderLanding = () => render(<MemoryRouter><LandingPage /></MemoryRouter>);

describe('LandingPage for a returning session', () => {
  beforeEach(() => {
    flags.hook = true;
    flags.singleCta = true;
    navigateMock.mockClear();
    apiGet.mockReset().mockResolvedValue({ data: { daily_streak: 3, streak_alive: true } });
    signedIn();
  });

  it('greets them by name with their live streak, and takes them straight back in', async () => {
    renderLanding();
    const cta = screen.getByTestId('hero-guest-cta');
    expect(cta).toHaveTextContent('Continue as GallantPuma');
    expect(await screen.findByText('3-day play streak. Keep it going today.')).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(cta);
    });
    expect(navigateMock).toHaveBeenCalledWith('/lobby');
  });

  it('leaves a lapsed streak unsaid and welcomes them back instead', async () => {
    apiGet.mockResolvedValue({ data: { daily_streak: 5, streak_alive: false } });
    renderLanding();
    expect(await screen.findByTestId('hero-subline')).toHaveTextContent('Welcome back.');
    expect(screen.queryByText(/5-day play streak/)).toBeNull();
  });

  it('goes straight back in from the two-button hero too, without the get-started chooser', async () => {
    flags.singleCta = false;
    renderLanding();
    const cta = screen.getByTestId('hero-continue-cta');
    expect(cta).toHaveTextContent('Continue as GallantPuma');
    await act(async () => {
      fireEvent.click(cta);
    });
    expect(navigateMock).toHaveBeenCalledWith('/lobby');
  });

  it('is the page as before with the flag off', () => {
    flags.hook = false;
    renderLanding();
    expect(screen.getByTestId('hero-guest-cta')).toHaveTextContent('Play Free Now');
    expect(apiGet).not.toHaveBeenCalled();
  });
});
