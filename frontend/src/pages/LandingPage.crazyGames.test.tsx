import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

/**
 * CrazyGames forbids our own login flow inside their frame — "No external
 * login options" sits under BASIC requirements on their QA checklist, and
 * their account docs tell guests not to "use different login methods than
 * 'Login with CrazyGames'".
 *
 * The landing page is the first thing a reviewer sees, so this pins the two
 * Sign In CTAs and the Create Free Account link to that rule. Guest play must
 * survive — it is the only way in once auth is hidden.
 */
let authUiAllowed = true;

vi.mock('../services/api', () => ({ api: { post: vi.fn(), get: vi.fn() } }));
vi.mock('../services/socket', () => ({ resyncSocketAuth: vi.fn(), disconnectSocket: vi.fn() }));
vi.mock('../utils/visitAnalytics', () => ({ trackVisitEvent: vi.fn() }));
vi.mock('../components/landing/GameplayShowcase', () => ({ default: () => null }));
vi.mock('../store/featureFlagsStore', () => ({
  useOnboardingTutorialFirstEnabled: () => false,
  useHeroSingleCtaEnabled: () => true,
  useLocalizationEnabled: () => false,
}));
vi.mock('../utils/embedContext', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../utils/embedContext')>()),
  ownAuthUiAllowed: () => authUiAllowed,
}));
vi.mock('react-router-dom', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-router-dom')>()),
  useNavigate: () => vi.fn(),
}));

import LandingPage from './LandingPage';

const renderLanding = () =>
  render(
    <MemoryRouter>
      <LandingPage />
    </MemoryRouter>,
  );

describe('LandingPage inside a CrazyGames embed', () => {
  beforeEach(() => {
    authUiAllowed = true;
  });

  it('shows Sign In to a direct player', () => {
    renderLanding();
    expect(screen.getAllByRole('link', { name: /sign in/i }).length).toBeGreaterThan(0);
  });

  it('hides every login and registration CTA when auth UI is disallowed', () => {
    authUiAllowed = false;
    renderLanding();
    expect(screen.queryByRole('link', { name: /sign in/i })).toBeNull();
    expect(screen.queryByRole('link', { name: /create free account/i })).toBeNull();
    // Nothing may link to the auth routes either — a visible dead link is the
    // same finding as a visible form.
    const hrefs = Array.from(document.querySelectorAll('a')).map((a) => a.getAttribute('href') ?? '');
    expect(hrefs.filter((h) => /\/(login|register|upgrade)$/.test(h))).toEqual([]);
  });

  it('keeps guest play available, since it is the only way in', () => {
    authUiAllowed = false;
    renderLanding();
    expect(screen.getByTestId('hero-guest-cta')).toBeInTheDocument();
  });
});
