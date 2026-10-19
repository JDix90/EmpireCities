import { Link, Navigate, useParams } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import { useFeatureFlagsStore, usePlayerLinksPlayEnabled } from '../store/featureFlagsStore';
import { useGuestStart } from '../hooks/useGuestStart';
import { trackVisitEvent } from '../utils/visitAnalytics';

/**
 * Public landing for a shared "Challenge a friend" link (/join/:code).
 *
 * Resolves to the existing lobby auto-join flow (/lobby?join=CODE). A signed-in
 * invitee goes straight there. A signed-out one is offered to join as a guest
 * (`player_links_play_enabled`), or to sign in or create an account first,
 * keeping the code either way; with the flag off they are sent through account
 * creation, as before.
 */
export default function JoinGamePage() {
  const { code } = useParams<{ code: string }>();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const flagsLoaded = useFeatureFlagsStore((s) => s.loaded);
  const guestJoin = usePlayerLinksPlayEnabled();

  const normalized = (code ?? '').trim();
  if (!normalized) return <Navigate to="/lobby" replace />;

  const target = `/lobby?join=${encodeURIComponent(normalized)}`;
  if (isAuthenticated) return <Navigate to={target} replace />;
  // Until the flags arrive the page cannot tell which of the two it offers.
  if (!flagsLoaded) return <div className="min-h-screen bg-bf-dark" aria-busy="true" />;
  if (!guestJoin) return <Navigate to={`/register?redirect=${encodeURIComponent(target)}`} replace />;

  return <InviteWelcome code={normalized} target={target} />;
}

function InviteWelcome({ code, target }: { code: string; target: string }) {
  const { start, starting } = useGuestStart();
  const redirect = encodeURIComponent(target);
  return (
    <main className="min-h-screen bg-bf-dark px-4 pt-safe-6 pb-safe-6 flex items-center justify-center">
      <div className="w-full max-w-md rounded-2xl border border-bf-border bg-bf-surface p-6 text-center space-y-5">
        <div className="space-y-2">
          <p className="font-display text-sm tracking-widest text-bf-gold">BORDERFALL</p>
          <h1 className="font-display text-2xl text-bf-text">You&apos;re invited to a game</h1>
          <p className="text-sm text-bf-muted leading-relaxed">
            A friend has challenged you to Borderfall, a free strategy game played on a 3D globe. Join as a guest
            to play right away; you can save your account later.
          </p>
        </div>
        <p className="text-xs text-bf-muted">
          Game code <span className="font-mono text-bf-text">{code}</span>
        </p>
        <button
          type="button"
          className="btn-primary w-full"
          disabled={starting}
          onClick={() => {
            trackVisitEvent('hero_play_clicked', { placement: 'invite' });
            // Signed in, the page itself moves on to the lobby's join.
            void start();
          }}
        >
          {starting ? 'Joining…' : 'Join as a guest'}
        </button>
        <p className="text-sm text-bf-muted">
          Have an account?{' '}
          <Link to={`/login?redirect=${redirect}`} className="text-bf-gold hover:underline">
            Sign in
          </Link>{' '}
          or{' '}
          <Link to={`/register?redirect=${redirect}`} className="text-bf-gold hover:underline">
            create one
          </Link>
          .
        </p>
      </div>
    </main>
  );
}
