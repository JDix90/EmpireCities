import React from 'react';
import { Link, Navigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '../store/authStore';
import { useAuthStoreHydrated } from '../hooks/useAuthStoreHydrated';
import { useGuestStart } from '../hooks/useGuestStart';
import PlayTermsNotice from '../components/legal/PlayTermsNotice';
import { useOnboardingTutorialFirstEnabled } from '../store/featureFlagsStore';
import { APP_NAME_NAV, TAGLINE_PRIMARY } from '../constants/brand';

/**
 * `/` in the native app (utils/nativeApp.ts), where the website shows its
 * landing page.
 *
 * A player with a session goes straight to the lobby. Anyone else gets the
 * two things an app's first screen is for, play and sign in, and nothing that
 * was written for a search engine. Play makes a guest and starts exactly as
 * the landing page's button does (pages/LandingPage.tsx `handleGuest`): a new
 * guest into the tutorial match when `onboarding_tutorial_first_enabled` is on, else
 * the lobby. It is one tap and not automatic so that a player who already has
 * an account can sign in to it, rather than be handed a new guest on every
 * fresh install.
 */
export default function NativeHomePage() {
  const { t } = useTranslation('landing');
  const hydrated = useAuthStoreHydrated();
  const bootstrapped = useAuthStore((s) => s.bootstrapped);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const tutorialFirst = useOnboardingTutorialFirstEnabled();
  const { start, starting } = useGuestStart();

  // The same wait as PrivateRoute: until the silent refresh settles, the
  // persisted flag is only a guess, and a guess must not flash the buttons at
  // a player who is about to be sent to their lobby.
  const settled = hydrated && bootstrapped;
  if (settled && isAuthenticated && !starting) {
    return <Navigate to="/lobby" replace />;
  }

  return (
    <main
      className="min-h-screen bg-bf-dark flex flex-col items-center justify-center px-6 pt-safe-6 pb-safe-6 text-center"
      data-testid="native-home"
    >
      <h1 className="font-display text-4xl sm:text-5xl text-bf-gold tracking-widest">{APP_NAME_NAV}</h1>
      <p className="mt-3 text-bf-muted">{TAGLINE_PRIMARY}</p>

      <div className="mt-10 w-full max-w-xs space-y-3" aria-busy={!settled}>
        <button
          type="button"
          className="btn-primary w-full py-3 text-base"
          data-testid="native-home-play"
          disabled={!settled || starting}
          onClick={() => void start((isNewGuest) => (tutorialFirst && isNewGuest ? '/tutorial?start=1' : '/lobby'))}
        >
          {starting ? t('common:starting') : t('actions.playFreeNow')}
        </button>
        <Link
          to="/login"
          className="btn-secondary w-full py-3 text-base inline-flex items-center justify-center"
          data-testid="native-home-sign-in"
        >
          {t('actions.signIn')}
        </Link>
      </div>
      {!isAuthenticated && <PlayTermsNotice className="mt-4 max-w-xs" />}

      <nav className="mt-10 flex gap-5 text-xs text-bf-muted" aria-label="Legal">
        <Link to="/privacy" className="hover:text-bf-gold transition-colors">Privacy Policy</Link>
        <Link to="/terms" className="hover:text-bf-gold transition-colors">Terms of Service</Link>
      </nav>
    </main>
  );
}
