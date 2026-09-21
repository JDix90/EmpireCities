import React, { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { useAuthStore, selectIsAdminFromToken } from './store/authStore';
import { useFeatureFlagsStore, useMapEditorEnabled } from './store/featureFlagsStore';
import { applyLocalizationPolicy } from './i18n';
import { api } from './services/api';
import { mergeServerTutorialModules } from './tutorial/progression';
import { useNetworkStatus } from './hooks/useNetworkStatus';
import { useAuthStoreHydrated } from './hooks/useAuthStoreHydrated';
import { ownAuthUiAllowed } from './utils/embedContext';
import ErrorBoundary from './components/ErrorBoundary';
import GlobalMatchNotifier from './components/notifications/GlobalMatchNotifier';
import GlobalTurnNotifier from './components/notifications/GlobalTurnNotifier';
import { lazyWithChunkRetry } from './utils/lazyWithChunkRetry';
import { APP_NAME_NAV } from './constants/brand';
import { applyAccessibilityDomPrefs, subscribeUserPreferences } from './utils/userPreferences';

// Pages — every route uses `lazyWithChunkRetry` so a stale tab that requests
// a hashed chunk filename that no longer exists (post-deploy) retries once
// and then force-reloads, instead of dumping the user into a blank error
// screen. See utils/lazyWithChunkRetry.ts for the recovery policy.
const LandingPage = lazyWithChunkRetry(() => import('./pages/LandingPage'));
const LoginPage = lazyWithChunkRetry(() => import('./pages/LoginPage'));
const RegisterPage = lazyWithChunkRetry(() => import('./pages/RegisterPage'));
const ForgotPasswordPage = lazyWithChunkRetry(() => import('./pages/ForgotPasswordPage'));
const ResetPasswordPage = lazyWithChunkRetry(() => import('./pages/ResetPasswordPage'));
const UnsubscribePage = lazyWithChunkRetry(() => import('./pages/UnsubscribePage'));
const LobbyPage = lazyWithChunkRetry(() => import('./pages/LobbyPage'));
const JoinGamePage = lazyWithChunkRetry(() => import('./pages/JoinGamePage'));
const GamePage = lazyWithChunkRetry(() => import('./pages/GamePage'));
const MapEditorPage = lazyWithChunkRetry(() => import('./pages/MapEditorPage'));
const ProfilePage = lazyWithChunkRetry(() => import('./pages/ProfilePage'));
const MapHubPage = lazyWithChunkRetry(() => import('./pages/MapHubPage'));
const FriendsPage = lazyWithChunkRetry(() => import('./pages/FriendsPage'));
const NotFoundPage = lazyWithChunkRetry(() => import('./pages/NotFoundPage'));
const PrivacyPage = lazyWithChunkRetry(() => import('./pages/PrivacyPage'));
const TermsPage = lazyWithChunkRetry(() => import('./pages/TermsPage'));
const TutorialPage = lazyWithChunkRetry(() => import('./pages/TutorialPage'));
const HowToPlayPage = lazyWithChunkRetry(() => import('./pages/HowToPlayPage'));
const ErasPage = lazyWithChunkRetry(() => import('./pages/ErasPage'));
const MapsPage = lazyWithChunkRetry(() => import('./pages/MapsPage'));
const EraDetailPage = lazyWithChunkRetry(() => import('./pages/EraDetailPage'));
// Public Daily archive (one page per settled day). Named export for the index
// so both share a chunk — they are always reached from one another.
const AnswerPage = lazyWithChunkRetry(() => import('./pages/AnswerPage'));
const DailyArchivePage = lazyWithChunkRetry(() => import('./pages/DailyArchivePage'));
const DailyArchiveIndexPage = lazyWithChunkRetry(() =>
  import('./pages/DailyArchivePage').then((m) => ({ default: m.DailyArchiveIndexPage })));
const AboutPage = lazyWithChunkRetry(() => import('./pages/AboutPage'));
const DailyChallengePage = lazyWithChunkRetry(() => import('./pages/DailyChallengePage'));
const StorePage = lazyWithChunkRetry(() => import('./pages/StorePage'));
const SettingsPage = lazyWithChunkRetry(() => import('./pages/SettingsPage'));
const ReplayPage = lazyWithChunkRetry(() => import('./pages/ReplayPage'));
const CampaignPage = lazyWithChunkRetry(() => import('./pages/CampaignPage'));
const LeaderboardsPage = lazyWithChunkRetry(() => import('./pages/LeaderboardsPage'));
const LiveGamesPage = lazyWithChunkRetry(() => import('./pages/LiveGamesPage'));
const SpectatorPage = lazyWithChunkRetry(() => import('./pages/SpectatorPage'));
const ModalLabPage = lazyWithChunkRetry(() => import('./pages/ModalLabPage'));
const MapVisualLabPage = lazyWithChunkRetry(() => import('./pages/MapVisualLabPage'));
/** Build-time gate for the QA harness routes below. Never set in production. */
const LAB_ROUTES_ENABLED = import.meta.env.VITE_LAB_ROUTES === '1';
const AdminPage = lazyWithChunkRetry(() => import('./pages/AdminPage'));
// Warfront (experimental RTS mode) — admin-only, and lazy like every other route so
// the PixiJS tactical view never lands in a player's bundle.
const WarfrontPage = lazyWithChunkRetry(() => import('./pages/WarfrontPage'));
const UpgradePage = lazyWithChunkRetry(() => import('./pages/UpgradePage'));
const CodexPage = lazyWithChunkRetry(() => import('./pages/CodexPage'));
const WarRoomPage = lazyWithChunkRetry(() => import('./pages/WarRoomPage'));

function RouteLoadingFallback() {
  return (
    <div className="min-h-screen bg-bf-dark px-4 pt-safe-6 pb-safe-6">
      {/* Nav skeleton */}
      <div className="h-12 bg-bf-surface border-b border-bf-border mb-6 rounded-none -mx-4 px-4 flex items-center gap-3">
        <div className="h-4 w-32 bg-bf-border/60 rounded animate-pulse" />
        <div className="flex-1" />
        <div className="h-8 w-20 bg-bf-border/40 rounded animate-pulse" />
      </div>
      <div className="max-w-4xl mx-auto space-y-4">
        {/* Hero card skeleton */}
        <div className="h-28 sm:h-32 bg-bf-surface border border-bf-border rounded-xl animate-pulse" />
        {/* Two content cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="h-40 bg-bf-surface border border-bf-border rounded-xl animate-pulse" />
          <div className="h-40 bg-bf-surface border border-bf-border rounded-xl animate-pulse" />
        </div>
        {/* Map area skeleton */}
        <div className="h-48 sm:h-64 bg-bf-surface border border-bf-border rounded-xl animate-pulse flex items-center justify-center">
          <p className="text-bf-muted/50 text-sm font-display tracking-widest animate-pulse">{APP_NAME_NAV}</p>
        </div>
      </div>
    </div>
  );
}

// Route guard — wait for persisted auth to rehydrate AND for the silent-refresh
// bootstrap to complete so we do not send users to /login on refresh.
function PrivateRoute({ children }: { children: React.ReactNode }) {
  const hydrated = useAuthStoreHydrated();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const bootstrapped = useAuthStore((s) => s.bootstrapped);
  const location = useLocation();
  if (!hydrated || !bootstrapped) {
    return <RouteLoadingFallback />;
  }
  if (!isAuthenticated) {
    const redirect = encodeURIComponent(location.pathname + location.search);
    return <Navigate to={`/login?redirect=${redirect}`} replace />;
  }
  return <>{children}</>;
}

/**
 * Routes that present our own login/registration flow.
 *
 * CrazyGames forbids one inside their frame (see `ownAuthUiAllowed`), so there
 * the route redirects away instead of rendering. The CTAs that lead here are
 * hidden in the same build, but guarding the route as well means a typed URL
 * or a stale link cannot reach the form either — which is what a reviewer
 * would try.
 *
 * The target is `/`, which must stay a PUBLIC route: `PrivateRoute` sends an
 * unauthenticated user to `/login`, so redirecting here to anything private
 * would bounce /lobby -> /login -> /lobby forever inside the frame.
 */
function AuthUiRoute({ children }: { children: React.ReactNode }) {
  if (!ownAuthUiAllowed()) {
    return <Navigate to="/" replace />;
  }
  return <>{children}</>;
}

function PublicOnlyRoute({ children }: { children: React.ReactNode }) {
  const hydrated = useAuthStoreHydrated();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const bootstrapped = useAuthStore((s) => s.bootstrapped);
  const location = useLocation();
  if (!hydrated || !bootstrapped) {
    return <RouteLoadingFallback />;
  }
  if (!isAuthenticated) {
    return <>{children}</>;
  }
  // Honor the `?redirect=` query param that `PrivateRoute` writes when a
  // logged-out user follows a deep link (e.g. /game/<id>). Without this the
  // user lands on /lobby and loses the URL they clicked. Same-origin check:
  // we only accept paths that start with `/` so a hostile redirect=
  // (https://attacker.com/) cannot be used as an open redirect.
  const params = new URLSearchParams(location.search);
  const raw = params.get('redirect');
  if (raw) {
    try {
      const decoded = decodeURIComponent(raw);
      if (decoded.startsWith('/') && !decoded.startsWith('//')) {
        return <Navigate to={decoded} replace />;
      }
    } catch {
      /* malformed encoding — fall through to default redirect */
    }
  }
  return <Navigate to="/lobby" replace />;
}

/**
 * Route for the guest→account upgrade flow ONLY. /register can't serve it:
 * that's a PublicOnlyRoute, which bounces every authenticated user (guests
 * included) to /lobby — the historical reason the guest "Create Free
 * Account" CTAs silently went nowhere.
 */
function GuestOnlyRoute({ children }: { children: React.ReactNode }) {
  const hydrated = useAuthStoreHydrated();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const bootstrapped = useAuthStore((s) => s.bootstrapped);
  const isGuest = useAuthStore((s) => s.user?.is_guest === true);
  if (!hydrated || !bootstrapped) {
    return <RouteLoadingFallback />;
  }
  if (!isAuthenticated) {
    return <Navigate to="/register" replace />;
  }
  if (!isGuest) {
    return <Navigate to="/lobby" replace />;
  }
  return <>{children}</>;
}

function AdminRoute({ children }: { children: React.ReactNode }) {
  // Source of truth for "is the user allowed to see admin UI?" is the JWT
  // claim, not the persisted user object. localStorage is attacker-mutable;
  // a forged is_admin there should never light up admin scaffolds. The
  // backend additionally enforces this for every /api/admin/* call.
  const accessToken = useAuthStore((s) => s.accessToken);
  const bootstrapped = useAuthStore((s) => s.bootstrapped);
  if (!bootstrapped) {
    return <RouteLoadingFallback />;
  }
  if (!selectIsAdminFromToken(accessToken)) {
    return <Navigate to="/lobby" replace />;
  }
  return <>{children}</>;
}

function MapEditorRoute({ children }: { children: React.ReactNode }) {
  const mapEditorEnabled = useMapEditorEnabled();
  const flagsLoaded = useFeatureFlagsStore((s) => s.loaded);
  if (!flagsLoaded) {
    return <RouteLoadingFallback />;
  }
  if (!mapEditorEnabled) {
    return <Navigate to="/lobby" replace />;
  }
  return <PrivateRoute>{children}</PrivateRoute>;
}

export default function App() {
  const { isAuthenticated } = useAuthStore();
  const user = useAuthStore((s) => s.user);
  const attemptedInitialSilentRefreshRef = useRef(false);
  const hydrated = useAuthStoreHydrated();

  useEffect(() => {
    applyAccessibilityDomPrefs();
    return subscribeUserPreferences(applyAccessibilityDomPrefs);
  }, []);

  // Bootstrap auth on app load. Because access tokens are no longer persisted
  // to localStorage (they live in memory only — see authStore.ts), every page
  // reload starts with `accessToken === null`. We attempt a silent refresh
  // here using the HttpOnly refresh cookie so the user is back to a fully-
  // authenticated state before any protected route renders.
  useEffect(() => {
    if (!hydrated) return; // wait for the persisted slice to come back from storage
    if (attemptedInitialSilentRefreshRef.current) return;
    attemptedInitialSilentRefreshRef.current = true;
    void (async () => {
      const state = useAuthStore.getState();
      // Logged out — nothing to recover. (Guests recover like registered
      // users now: their refresh cookie survives the reload.)
      if (!state.isAuthenticated || !state.user) {
        useAuthStore.getState().setBootstrapped(true);
        return;
      }
      const syncProfile = async () => {
        try {
          const res = await api.get('/users/me');
          useAuthStore.getState().setUser(res.data);
          // Merge server-side tutorial module completions into localStorage so
          // TutorialPage reflects accurate completion state on any device.
          if (Array.isArray(res.data.tutorial_modules_completed)) {
            mergeServerTutorialModules(res.data.tutorial_modules_completed);
          }
        } catch {
          /* best-effort profile re-fetch — flags like is_admin will reflect on next nav */
        }
      };
      try {
        let outcome = await state.refreshToken({ silent: true });
        if (outcome === 'ok') {
          await syncProfile();
          return;
        }
        if (outcome === 'invalid') return;
        // 'unreachable': the reload may have raced a backend restart/deploy.
        // Don't hold the splash screen hostage — mark bootstrapped now (the
        // session is still marked authenticated, so the user stays on their
        // page) and keep retrying in the background. The session only clears
        // if the server, once reachable, actually rejects the refresh cookie.
        useAuthStore.getState().setBootstrapped(true);
        for (const delayMs of [1500, 3000, 6000, 12000]) {
          await new Promise((resolve) => setTimeout(resolve, delayMs));
          outcome = await useAuthStore.getState().refreshToken({ silent: true });
          if (outcome === 'ok') {
            await syncProfile();
            return;
          }
          if (outcome === 'invalid') return;
        }
      } finally {
        useAuthStore.getState().setBootstrapped(true);
      }
    })();
  }, [hydrated]);

  useEffect(() => {
    void useFeatureFlagsStore.getState().load();
  }, []);

  // Reconcile the UI language with the server's `localization_enabled` once
  // the flags land — an admin override can differ from the client-side default
  // main.tsx applied before first paint. Idempotent; see src/i18n.
  const flagsLoadedForI18n = useFeatureFlagsStore((s) => s.loaded);
  const localizationEnabled = useFeatureFlagsStore((s) => s.flags.localization_enabled);
  useEffect(() => {
    if (!flagsLoadedForI18n) return;
    void applyLocalizationPolicy(localizationEnabled).catch(() => {});
  }, [flagsLoadedForI18n, localizationEnabled]);

  // Complete push registration for any authenticated session, guests
  // included: init only re-registers a browser that already granted
  // permission (the asking lives in the opt-in controls), and a guest's
  // browser token needs no email — a guest in an async game is exactly who a
  // turn alert is for.
  useEffect(() => {
    if (isAuthenticated && user) {
      void import('./services/pushNotifications')
        .then(({ initPushNotifications }) => initPushNotifications())
        .catch(() => {});
    }
  }, [isAuthenticated, user]);

  // PWA install attribution (fires when the user adds the app to their home
  // screen). Best-effort: 401s for signed-out users are swallowed.
  useEffect(() => {
    const onInstalled = () => {
      api.post('/analytics/ui-event', { event: 'pwa_installed' }).catch(() => {});
    };
    window.addEventListener('appinstalled', onInstalled);
    return () => window.removeEventListener('appinstalled', onInstalled);
  }, []);

  const isOnline = useNetworkStatus();

  // Track viewport width so the toaster position can flip to bottom-center on
  // narrow screens — `top-right` is awkward on phones (the dismiss tap target
  // overlaps the safe-area / status bar). Updates only on resize so it's not
  // a re-render hot path.
  const [isNarrow, setIsNarrow] = useState(() =>
    typeof window === 'undefined' ? false : window.matchMedia('(max-width: 640px)').matches,
  );
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mql = window.matchMedia('(max-width: 640px)');
    const onChange = (e: MediaQueryListEvent) => setIsNarrow(e.matches);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, []);

  const toasterPosition = isNarrow ? 'bottom-center' : 'top-right';
  // Push toasts below the offline banner (~32px) so they aren't visually
  // stacked on top of it. On mobile the toaster sits at the bottom anyway,
  // so the banner offset is moot — just respect the safe-area inset.
  const toasterContainerStyle = useMemo<React.CSSProperties>(() => {
    if (isNarrow) {
      return { bottom: 'calc(env(safe-area-inset-bottom, 0px) + 16px)' };
    }
    return { top: `calc(env(safe-area-inset-top, 0px) + ${isOnline ? 16 : 48}px)` };
  }, [isNarrow, isOnline]);

  return (
    <ErrorBoundary>
    <Suspense fallback={<RouteLoadingFallback />}>
      {!isOnline && (
        <div className="fixed top-0 inset-x-0 z-[100] bg-red-600 text-white text-center text-sm py-1.5 font-medium">
          You are offline — reconnecting…
        </div>
      )}
      <Toaster
        position={toasterPosition}
        containerStyle={toasterContainerStyle}
        toastOptions={{
          style: {
            background: '#1a1f2e',
            color: '#e8e8e8',
            border: '1px solid #2d3448',
          },
        }}
      />
      <GlobalMatchNotifier />
      <GlobalTurnNotifier />
      <Routes>
        {/* Public routes */}
        <Route path="/" element={<LandingPage />} />
        {/*
          QA harnesses for the Playwright modal/map-visual specs. They shipped
          unauthenticated and ungated on production, above even /privacy, with
          only the `__` prefix for obscurity. Gated behind a build-time flag that
          CI sets for the frontend build the e2e specs preview
          (.github/workflows/ci.yml) and the production image never passes
          (docker/Dockerfile.frontend). To run these specs locally, build with
          VITE_LAB_ROUTES=1.
        */}
        {LAB_ROUTES_ENABLED && <Route path="/__modal-lab" element={<ModalLabPage />} />}
        {LAB_ROUTES_ENABLED && <Route path="/__map-visual-lab" element={<MapVisualLabPage />} />}
        <Route path="/privacy" element={<PrivacyPage />} />
        <Route path="/terms" element={<TermsPage />} />
        <Route path="/how-to-play" element={<HowToPlayPage />} />
        <Route path="/eras" element={<ErasPage />} />
        {/* Per-era and per-map pages. One component for each family — it
            resolves its content from seoContent.mjs by pathname, the same
            module the build prerenders the crawlable HTML from. A static
            segment outranks the dynamic one, so /maps never falls through
            to /maps/:slug. */}
        <Route path="/eras/:slug" element={<EraDetailPage />} />
        <Route path="/maps" element={<MapsPage />} />
        <Route path="/maps/:slug" element={<MapsPage />} />
        {/* Settled Daily puzzles are public and crawlable; /daily itself stays
            private. A static segment outranks the dynamic one in React Router,
            so /daily/archive never falls through to /daily/:date. */}
        {/* Question-shaped answer pages. One component for all of them — it
            resolves its content from seoContent.mjs by pathname, the same
            module the build prerenders the crawlable HTML from. */}
        <Route path="/answers" element={<AnswerPage />} />
        <Route path="/answers/:slug" element={<AnswerPage />} />
        <Route path="/daily/archive" element={<DailyArchiveIndexPage />} />
        <Route path="/daily/:date" element={<DailyArchivePage />} />
        <Route path="/about" element={<AboutPage />} />
        <Route path="/tutorial" element={<TutorialPage />} />
        <Route path="/join/:code" element={<JoinGamePage />} />
        {/* Public replay viewer — ReplayPage loads the authed participant feed
            when signed in and falls back to the public-replay endpoint (which
            only succeeds when the owner made it public) otherwise. */}
        <Route path="/replay/:gameId" element={<ReplayPage />} />
        <Route path="/login" element={<AuthUiRoute><PublicOnlyRoute><LoginPage /></PublicOnlyRoute></AuthUiRoute>} />
        <Route path="/register" element={<AuthUiRoute><PublicOnlyRoute><RegisterPage /></PublicOnlyRoute></AuthUiRoute>} />
        <Route path="/upgrade" element={<AuthUiRoute><GuestOnlyRoute><UpgradePage /></GuestOnlyRoute></AuthUiRoute>} />
        <Route path="/forgot-password" element={<AuthUiRoute><PublicOnlyRoute><ForgotPasswordPage /></PublicOnlyRoute></AuthUiRoute>} />
        <Route path="/reset-password" element={<AuthUiRoute><ResetPasswordPage /></AuthUiRoute>} />
        <Route path="/unsubscribe" element={<UnsubscribePage />} />

        {/* Protected routes */}
        <Route path="/daily" element={<PrivateRoute><DailyChallengePage /></PrivateRoute>} />
        <Route path="/store" element={<PrivateRoute><StorePage /></PrivateRoute>} />
        <Route path="/lobby" element={<PrivateRoute><LobbyPage /></PrivateRoute>} />
        <Route path="/game/:gameId" element={<PrivateRoute><GamePage /></PrivateRoute>} />
        <Route path="/editor" element={<MapEditorRoute><MapEditorPage /></MapEditorRoute>} />
        <Route path="/editor/:mapId" element={<MapEditorRoute><MapEditorPage /></MapEditorRoute>} />
        <Route path="/profile" element={<PrivateRoute><ProfilePage /></PrivateRoute>} />
        <Route path="/profile/:userId" element={<PrivateRoute><ProfilePage /></PrivateRoute>} />
        <Route path="/settings" element={<PrivateRoute><SettingsPage /></PrivateRoute>} />
        <Route path="/campaign" element={<PrivateRoute><CampaignPage /></PrivateRoute>} />
        {/* React Router v6 already matches a trailing slash (`/maps/`) to this
            route, so no separate `/maps/` redirect is needed. A duplicate
            `path="/maps/"` route actually hijacks the `/maps` match and renders
            a no-op <Navigate to="/maps">, blanking the page. */}
        <Route path="/maps" element={<PrivateRoute><MapHubPage /></PrivateRoute>} />
        <Route path="/friends" element={<PrivateRoute><FriendsPage /></PrivateRoute>} />
        <Route path="/leaderboards" element={<PrivateRoute><LeaderboardsPage /></PrivateRoute>} />
        <Route path="/live-games" element={<PrivateRoute><LiveGamesPage /></PrivateRoute>} />
        {/* Natural guess for the nav's "Live" item — redirect instead of a 404. */}
        <Route path="/live" element={<Navigate to="/live-games" replace />} />
        <Route path="/spectate/:gameId" element={<PrivateRoute><SpectatorPage /></PrivateRoute>} />
        <Route path="/admin" element={<PrivateRoute><AdminRoute><AdminPage /></AdminRoute></PrivateRoute>} />
        <Route path="/admin/warfront" element={<PrivateRoute><AdminRoute><WarfrontPage /></AdminRoute></PrivateRoute>} />
        <Route path="/codex" element={<CodexPage />} />
        <Route path="/war-room" element={<PrivateRoute><WarRoomPage /></PrivateRoute>} />

        {/* 404 */}
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </Suspense>
    </ErrorBoundary>
  );
}
