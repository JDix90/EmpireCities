import React, { useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../services/api';
import toast from 'react-hot-toast';

/**
 * /tutorial entry point — immediately starts a tutorial game and navigates
 * to it. The in-game TutorialOverlay handles all instruction slides with
 * the live map, so there is no need for a separate static slide deck here.
 */
export default function TutorialPage() {
  const navigate = useNavigate();

  useEffect(() => {
    api.post<{ game_id: string }>('/games/tutorial/start', {})
      .then((res) => navigate(`/game/${res.data.game_id}`, { replace: true }))
      .catch(() => {
        toast.error('Could not start the tutorial. Try again.');
        navigate('/lobby', { replace: true });
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="min-h-screen-safe bg-cc-dark flex flex-col">
      <nav className="border-b border-cc-border px-6 py-4 flex justify-between items-center">
        <Link to="/" className="font-display text-cc-gold tracking-widest hover:text-white text-sm">
          ERAS OF EMPIRE
        </Link>
        <Link to="/lobby" className="text-cc-muted text-sm hover:text-cc-gold">
          Skip to lobby
        </Link>
      </nav>
      <div className="flex-1 flex items-center justify-center">
        <p className="text-cc-muted text-sm animate-pulse">Starting tutorial…</p>
      </div>
    </div>
  );
}
