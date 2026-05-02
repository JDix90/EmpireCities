import React, { Suspense, lazy, useEffect, useRef } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { useAuthStore, selectIsAdminFromToken } from './store/authStore';
import { api } from './services/api';
import { useNetworkStatus } from './hooks/useNetworkStatus';
import { useAuthStoreHydrated } from './hooks/useAuthStoreHydrated';
import ErrorBoundary from './components/ErrorBoundary';

// Pages
const LandingPage = lazy(() => import('./pages/LandingPage'));
const LoginPage = lazy(() => import('./pages/LoginPage'));
const RegisterPage = lazy(() => import('./pages/RegisterPage'));
const LobbyPage = lazy(() => import('./pages/LobbyPage'));
const GamePage = lazy(() => import('./pages/GamePage'));
const MapEditorPage = lazy(() => import('./pages/MapEditorPage'));
const ProfilePage = lazy(() => import('./pages/ProfilePage'));
const MapHubPage = lazy(() => import('./pages/MapHubPage'));
const FriendsPage = lazy(() => import('./pages/FriendsPage'));
const NotFoundPage = lazy(() => import('./pages/NotFoundPage'));
const PrivacyPage = lazy(() => import('./pages/PrivacyPage'));
const TutorialPage = lazy(() => import('./pages/TutorialPage'));
const HowToPlayPage = lazy(() => import('./pages/HowToPlayPage'));
const DailyChallengePage = lazy(() => import('./pages/DailyChallengePage'));
const StorePage = lazy(() => import('./pages/StorePage'));
const ReplayPage = lazy(() => import('./pages/ReplayPage'));
const CampaignPage = lazy(() => import('./pages/CampaignPage'));
const LeaderboardsPage = lazy(() => import('./pages/LeaderboardsPage'));
const LiveGamesPage = lazy(() => import('./pages/LiveGamesPage'));
const SpectatorPage = lazy(() => import('./pages/SpectatorPage'));
const ModalLabPage = lazy(() => import('./pages/ModalLabPage'));
const AdminPage = lazy(() => import('./pages/AdminPage'));
const CodexPage = lazy(() => import('./pages/CodexPage'));
const WarRoomPage = lazy(() => import('./pages/WarRoomPage'));

function RouteLoadingFallback() {
  return (
    <div className="min-h-screen bg-cc-dark px-4 py-6 pt-safe pb-safe">
      {/* Nav skeleton */}
      <div className="h-12 bg-cc-surface border-b border-cc-border mb-6 rounded-none -mx-4 px-4 flex items-center gap-3">
        <div className="h-4 w-32 bg-cc-border/60 rounded animate-pulse" />
        <div className="flex-1" />
        <div className="h-8 w-20 bg-cc-border/40 rounded animate-pulse" />
      </div>
      <div className="max-w-4xl mx-auto space-y-4">
        {/* Hero card skeleton */}
        <div className="h-28 sm:h-32 bg-cc-surface border border-cc-border rounded-xl animate-pulse" />
        {/* Two content cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="h-40 bg-cc-surface border border-cc-border rounded-xl animate-pulse" />
          <div className="h-40 bg-cc-surface border border-cc-border rounded-xl animate-pulse" />
        </div>
        {/* Map area skeleton */}
        <div className="h-48 sm:h-64 bg-cc-surface border border-cc-border rounded-xl animate-pulse flex items-center justify-center">
          <p className="text-cc-muted/50 text-sm font-display tracking-widest animate-pulse">ERAS OF EMPIRE</p>
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
  if (!hydrated || !bootstrapped) {
    return <RouteLoadingFallback />;
  }
  return !isAuthenticated ? <>{children}</> : <Navigate to="/lobby" replace />;
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

  return (
    <ErrorBoundary>
    <Suspense fallback={<RouteLoadingFallback />}>
      {!isOnline && (
        <div className="fixed top-0 inset-x-0 z-[100] bg-red-600 text-white text-center text-sm py-1.5 font-medium">
          You are offline — reconnecting…
        </div>
      )}
      <Routes>
        {/* Public routes */}
        <Route path="/" element={<LandingPage />} />
        <Route path="/__modal-lab" element={<ModalLabPage />} />
        <Route path="/privacy" element={<PrivacyPage />} />
        <Route path="/how-to-play" element={<HowToPlayPage />} />
        <Route path="/tutorial" element={<TutorialPage />} />
        <Route path="/login" element={<PublicOnlyRoute><LoginPage /></PublicOnlyRoute>} />
        <Route path="/register" element={<PublicOnlyRoute><RegisterPage /></PublicOnlyRoute>} />

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
