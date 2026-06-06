import { Navigate, useParams } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';

/**
 * Public landing for a shared "Challenge a friend" link (/join/:code).
 *
 * Resolves to the existing lobby auto-join flow (/lobby?join=CODE). Logged-out
 * invitees are routed through account creation first (preserving the code), so
 * after they sign up / sign in they land straight in the waiting lobby and join.
 */
export default function JoinGamePage() {
  const { code } = useParams<{ code: string }>();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  const normalized = (code ?? '').trim();
  if (!normalized) return <Navigate to="/lobby" replace />;

  const target = `/lobby?join=${encodeURIComponent(normalized)}`;
  if (isAuthenticated) return <Navigate to={target} replace />;

  return <Navigate to={`/register?redirect=${encodeURIComponent(target)}`} replace />;
}
