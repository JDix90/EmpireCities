import React, { useEffect } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { useAuthStore } from './store/authStore';

// Pages
import LandingPage from './pages/LandingPage';
import LoginPage from './pages/LoginPage';
import RegisterPage from './pages/RegisterPage';
import LobbyPage from './pages/LobbyPage';
import GamePage from './pages/GamePage';
import MapEditorPage from './pages/MapEditorPage';
import ProfilePage from './pages/ProfilePage';
import MapHubPage from './pages/MapHubPage';
import FriendsPage from './pages/FriendsPage';
import NotFoundPage from './pages/NotFoundPage';
import PrivacyPage from './pages/PrivacyPage';
import TutorialPage from './pages/TutorialPage';
import DailyChallengePage from './pages/DailyChallengePage';
import StorePage from './pages/StorePage';
import ReplayPage from './pages/ReplayPage';
import CampaignPage from './pages/CampaignPage';

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

  // Attempt silent token refresh on app load
  useEffect(() => {
    if (isAuthenticated) {
      refreshToken();
    }
  }, []);

  return (
    <Routes>
      {/* Public routes */}
      <Route path="/" element={<LandingPage />} />
      <Route path="/privacy" element={<PrivacyPage />} />
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

      {/* 404 */}
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}
