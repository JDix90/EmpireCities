/**
 * The landing's two "Play Free Now" buttons do the same thing. With the
 * single-CTA hero (`hero_single_cta_enabled`) the hero's starts play at once,
 * but the bottom one, same label, opened the Get Started modal: one more step
 * for the visitor who read the whole page. It now starts play too; with the
 * hero flag off both still open the modal, as before.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const navigateMock = vi.fn();
let singleCta = true;

vi.mock('../services/api', () => ({ api: { post: vi.fn(), get: vi.fn() } }));
vi.mock('../services/socket', () => ({ resyncSocketAuth: vi.fn(), disconnectSocket: vi.fn() }));
vi.mock('../utils/visitAnalytics', () => ({ trackVisitEvent: vi.fn() }));
vi.mock('../components/landing/GameplayShowcase', () => ({ default: () => null }));
vi.mock('../store/featureFlagsStore', () => ({
  useOnboardingTutorialFirstEnabled: () => false,
  useHeroSingleCtaEnabled: () => singleCta,
  useLocalizationEnabled: () => false,
}));
vi.mock('react-router-dom', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-router-dom')>()),
  useNavigate: () => navigateMock,
}));

import LandingPage from './LandingPage';
import { useAuthStore } from '../store/authStore';

const loginAsGuestMock = vi.fn(async () => {
  useAuthStore.setState({ user: { id: 'new', username: 'Guest_newborn' } as never, isAuthenticated: true });
});

async function clickBottom() {
  render(
    <MemoryRouter>
      <LandingPage />
    </MemoryRouter>,
  );
  await act(async () => {
    fireEvent.click(screen.getByTestId('bottom-guest-cta'));
  });
}

describe('the landing\'s bottom Play Free Now', () => {
  beforeEach(() => {
    navigateMock.mockClear();
    loginAsGuestMock.mockClear();
    singleCta = true;
    useAuthStore.setState({
      user: null, accessToken: null, isAuthenticated: false, bootstrapped: true,
      loginAsGuest: loginAsGuestMock,
    });
  });

  it('starts play like the hero\'s, without the Get Started modal', async () => {
    await clickBottom();
    await waitFor(() => expect(loginAsGuestMock).toHaveBeenCalledTimes(1));
    expect(navigateMock).toHaveBeenCalledWith('/lobby');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('opens the Get Started modal, as the hero\'s does, with the hero flag off', async () => {
    singleCta = false;
    await clickBottom();
    expect(loginAsGuestMock).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeTruthy();
  });
});
