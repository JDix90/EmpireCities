import React, { useEffect, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../services/api';
import toast from 'react-hot-toast';
import { useAuthStore } from '../store/authStore';
import { useAuthStoreHydrated } from '../hooks/useAuthStoreHydrated';

/**
 * /tutorial entry point — immediately starts a tutorial game and navigates
 * to it. The in-game TutorialOverlay handles all instruction slides with
 * the live map, so there is no need for a separate static slide deck here.
 *
 * The route is public: when a logged-out visitor lands here we auto-provision
 * a guest session before starting the tutorial. The tutorial wrap-up flow
 * (see GamePage / TutorialAccountPromptModal) then prompts them to upgrade
 * to a full account once they finish.
 */
export default function TutorialPage() {
  const navigate = useNavigate();
  const hydrated = useAuthStoreHydrated();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const bootstrapped = useAuthStore((s) => s.bootstrapped);
  const startedRef = useRef(false);

  useEffect(() => {
    if (!hydrated || !bootstrapped) return;
    if (startedRef.current) return;
    startedRef.current = true;

    (async () => {
      try {
        if (!isAuthenticated) {
          await useAuthStore.getState().loginAsGuest();
        }
        const res = await api.post<{ game_id: string }>('/games/tutorial/start', {});
        navigate(`/game/${res.data.game_id}`, { replace: true });
      } catch {
        toast.error('Could not start the tutorial. Try again.');
        navigate(isAuthenticated ? '/lobby' : '/', { replace: true });
      }
    })();
     
  }, [hydrated, bootstrapped]);

  return (
    <div className="min-h-screen-safe bg-cc-dark flex flex-col">
      <nav className="border-b border-cc-border px-6 py-4 flex justify-between items-center">
        <Link to="/" className="font-display text-cc-gold tracking-widest hover:text-white text-sm">
          ERAS OF EMPIRE
        </Link>
        <Link to={isAuthenticated ? '/lobby' : '/'} className="text-cc-muted text-sm hover:text-cc-gold">
          {isAuthenticated ? 'Skip to lobby' : 'Back to home'}
        </Link>
      </nav>
      <div className="flex-1 flex items-center justify-center">
        <p className="text-cc-muted text-sm animate-pulse">Starting tutorial…</p>
      </div>
    </div>
  );
}
