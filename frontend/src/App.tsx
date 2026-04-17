import React, { Suspense, lazy, useEffect } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { useAuthStore } from './store/authStore';
import { useNetworkStatus } from './hooks/useNetworkStatus';

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

function RouteLoadingFallback() {
  return (
    <div className="min-h-screen bg-cc-dark flex items-center justify-center px-6">
      <div className="text-center">
        <p className="font-display text-xl tracking-widest text-cc-gold">Loading</p>
        <p className="mt-2 text-sm text-cc-muted animate-pulse">Preparing the next front…</p>
      </div>
    </div>
  );
}

// Route guard
function PrivateRoute({ children }: { children: React.ReactNode }) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const location = useLocation();
  if (!isAuthenticated) {
    const redirect = encodeURIComponent(location.pathname + location.search);
    return <Navigate to={`/login?redirect=${redirect}`} replace />;
  }
  return <>{children}</>;
}

function PublicOnlyRoute({ children }: { children: React.ReactNode }) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  return !isAuthenticated ? <>{children}</> : <Navigate to="/lobby" replace />;
}

export default function App() {
  const { isAuthenticated, refreshToken } = useAuthStore();

  const user = useAuthStore((s) => s.user);

  // Attempt silent token refresh on app load
  useEffect(() => {
    if (isAuthenticated) {
      refreshToken();
    }
  }, []);

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
        <Route path="/login" element={<PublicOnlyRoute><LoginPage /></PublicOnlyRoute>} />
        <Route path="/register" element={<PublicOnlyRoute><RegisterPage /></PublicOnlyRoute>} />

        {/* Protected routes */}
        <Route path="/tutorial" element={<PrivateRoute><TutorialPage /></PrivateRoute>} />
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

        {/* 404 */}
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </Suspense>
  );
}
