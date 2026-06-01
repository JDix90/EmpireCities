import React, { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { useAuthStore, selectIsAdminFromToken } from './store/authStore';
import { api } from './services/api';
import { mergeServerTutorialModules } from './tutorial/progression';
import { useNetworkStatus } from './hooks/useNetworkStatus';
import { useAuthStoreHydrated } from './hooks/useAuthStoreHydrated';
import ErrorBoundary from './components/ErrorBoundary';
import { lazyWithChunkRetry } from './utils/lazyWithChunkRetry';
import { APP_NAME_NAV } from './constants/brand';

// Pages — every route uses `lazyWithChunkRetry` so a stale tab that requests
// a hashed chunk filename that no longer exists (post-deploy) retries once
// and then force-reloads, instead of dumping the user into a blank error
// screen. See utils/lazyWithChunkRetry.ts for the recovery policy.
const LandingPage = lazyWithChunkRetry(() => import('./pages/LandingPage'));
const LoginPage = lazyWithChunkRetry(() => import('./pages/LoginPage'));
const RegisterPage = lazyWithChunkRetry(() => import('./pages/RegisterPage'));
const ForgotPasswordPage = lazyWithChunkRetry(() => import('./pages/ForgotPasswordPage'));
const ResetPasswordPage = lazyWithChunkRetry(() => import('./pages/ResetPasswordPage'));
const LobbyPage = lazyWithChunkRetry(() => import('./pages/LobbyPage'));
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
const DailyChallengePage = lazyWithChunkRetry(() => import('./pages/DailyChallengePage'));
const StorePage = lazyWithChunkRetry(() => import('./pages/StorePage'));
const ReplayPage = lazyWithChunkRetry(() => import('./pages/ReplayPage'));
const CampaignPage = lazyWithChunkRetry(() => import('./pages/CampaignPage'));
const LeaderboardsPage = lazyWithChunkRetry(() => import('./pages/LeaderboardsPage'));
const LiveGamesPage = lazyWithChunkRetry(() => import('./pages/LiveGamesPage'));
const SpectatorPage = lazyWithChunkRetry(() => import('./pages/SpectatorPage'));
const ModalLabPage = lazyWithChunkRetry(() => import('./pages/ModalLabPage'));
const MapVisualLabPage = lazyWithChunkRetry(() => import('./pages/MapVisualLabPage'));
const AdminPage = lazyWithChunkRetry(() => import('./pages/AdminPage'));
const CodexPage = lazyWithChunkRetry(() => import('./pages/CodexPage'));
const WarRoomPage = lazyWithChunkRetry(() => import('./pages/WarRoomPage'));

function RouteLoadingFallback() {
  return (
    <div className="min-h-screen bg-bf-dark px-4 py-6 pt-safe pb-safe">
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

export default function App() {
  const { isAuthenticated } = useAuthStore();
  const user = useAuthStore((s) => s.user);
  const attemptedInitialSilentRefreshRef = useRef(false);
  const hydrated = useAuthStoreHydrated();

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
      // Logged-out, or a transient guest session that did not survive reload — nothing to do.
      if (!state.isAuthenticated || !state.user || state.user.is_guest) {
        useAuthStore.getState().setBootstrapped(true);
        return;
      }
      try {
        const ok = await state.refreshToken({ silent: true });
        if (ok) {
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
        }
      } finally {
        useAuthStore.getState().setBootstrapped(true);
      }
    })();
  }, [hydrated]);

  // Initialize push notifications for authenticated non-guest users
  useEffect(() => {
    if (isAuthenticated && user && !user.is_guest) {
      void import('./services/pushNotifications')
        .then(({ initPushNotifications }) => initPushNotifications())
        .catch(() => {});
    }
  }, [isAuthenticated, user]);

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
      <Routes>
        {/* Public routes */}
        <Route path="/" element={<LandingPage />} />
        <Route path="/__modal-lab" element={<ModalLabPage />} />
        <Route path="/__map-visual-lab" element={<MapVisualLabPage />} />
        <Route path="/privacy" element={<PrivacyPage />} />
        <Route path="/terms" element={<TermsPage />} />
        <Route path="/how-to-play" element={<HowToPlayPage />} />
        <Route path="/tutorial" element={<TutorialPage />} />
        <Route path="/login" element={<PublicOnlyRoute><LoginPage /></PublicOnlyRoute>} />
        <Route path="/register" element={<PublicOnlyRoute><RegisterPage /></PublicOnlyRoute>} />
        <Route path="/forgot-password" element={<PublicOnlyRoute><ForgotPasswordPage /></PublicOnlyRoute>} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />

        {/* Protected routes */}
        <Route path="/daily" element={<PrivateRoute><DailyChallengePage /></PrivateRoute>} />
        <Route path="/store" element={<PrivateRoute><StorePage /></PrivateRoute>} />
        <Route path="/lobby" element={<PrivateRoute><LobbyPage /></PrivateRoute>} />
        <Route path="/game/:gameId" element={<PrivateRoute><GamePage /></PrivateRoute>} />
        <Route path="/replay/:gameId" element={<PrivateRoute><ReplayPage /></PrivateRoute>} />
        <Route path="/editor" element={<PrivateRoute><MapEditorPage /></PrivateRoute>} />
        <Route path="/editor/:mapId" element={<PrivateRoute><MapEditorPage /></PrivateRoute>} />
        <Route path="/profile" element={<PrivateRoute><ProfilePage /></PrivateRoute>} />
        <Route path="/profile/:userId" element={<PrivateRoute><ProfilePage /></PrivateRoute>} />
        <Route path="/campaign" element={<PrivateRoute><CampaignPage /></PrivateRoute>} />
        <Route path="/maps" element={<PrivateRoute><MapHubPage /></PrivateRoute>} />
        <Route path="/friends" element={<PrivateRoute><FriendsPage /></PrivateRoute>} />
        <Route path="/leaderboards" element={<PrivateRoute><LeaderboardsPage /></PrivateRoute>} />
        <Route path="/live-games" element={<PrivateRoute><LiveGamesPage /></PrivateRoute>} />
        <Route path="/spectate/:gameId" element={<PrivateRoute><SpectatorPage /></PrivateRoute>} />
        <Route path="/admin" element={<PrivateRoute><AdminRoute><AdminPage /></AdminRoute></PrivateRoute>} />
        <Route path="/codex" element={<CodexPage />} />
        <Route path="/war-room" element={<PrivateRoute><WarRoomPage /></PrivateRoute>} />

        {/* 404 */}
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </Suspense>
    </ErrorBoundary>
  );
}
