import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import { api } from '../services/api';
import { ERA_LABELS } from '../constants/gameLobbyLabels';
import { Timer, RefreshCw, Swords } from 'lucide-react';
import clsx from 'clsx';

interface ActiveGame {
  game_id: string;
  era_id: string;
  game_type: string;
  created_at: string;
  started_at: string | null;
  turn_number: number | null;
  saved_at: string | null;
  async_mode?: boolean;
  async_turn_deadline?: string | null;
  current_player_id?: string | null;
}

function formatTimeLeft(ms: number): string {
  if (ms <= 0) return 'Expired';
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  if (h >= 24) return `${Math.floor(h / 24)}d ${h % 24}h`;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export default function WarRoomPage() {
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const [games, setGames] = useState<ActiveGame[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchGames = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    else setRefreshing(true);
    try {
      const res = await api.get<ActiveGame[]>('/users/me/active-games');
      const sorted = (res.data ?? []).sort((a, b) => {
        const aMine = a.current_player_id === user?.user_id ? 0 : 1;
        const bMine = b.current_player_id === user?.user_id ? 0 : 1;
        return aMine - bMine;
      });
      setGames(sorted);
    } catch { /* noop */ } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [user?.user_id]);

  useEffect(() => {
    fetchGames();
    const interval = setInterval(() => fetchGames(true), 30_000);
    return () => clearInterval(interval);
  }, [fetchGames]);

  return (
    <div className="max-w-5xl mx-auto px-4 py-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="font-display text-3xl text-cc-gold">War Room</h1>
          <p className="text-cc-muted text-sm mt-1">All your active games in one place.</p>
        </div>
        <button
          onClick={() => fetchGames(true)}
          disabled={refreshing}
          className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-cc-surface border border-cc-border
                     text-cc-muted hover:text-cc-text hover:border-cc-gold/40 text-sm transition-colors disabled:opacity-50"
        >
          <RefreshCw className={clsx('w-4 h-4', refreshing && 'animate-spin')} />
          Refresh
        </button>
      </div>

      {loading && <p className="text-cc-muted text-sm">Loading games…</p>}

      {!loading && games.length === 0 && (
        <div className="text-center py-16 space-y-4">
          <Swords className="w-10 h-10 text-cc-muted mx-auto" />
          <p className="text-cc-muted">No active games.</p>
          <Link
            to="/lobby"
            className="inline-block px-4 py-2 rounded-lg bg-cc-gold/15 border border-cc-gold/30
                       text-cc-gold hover:bg-cc-gold/25 text-sm transition-colors"
          >
            Find a Game
          </Link>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {games.map((game) => {
          const isMyTurn = game.current_player_id === user?.user_id;
          const deadline = game.async_turn_deadline ? new Date(game.async_turn_deadline) : null;
          const timeLeft = deadline ? deadline.getTime() - Date.now() : null;
          const isUrgent = timeLeft !== null && timeLeft < 3_600_000;

          return (
            <button
              key={game.game_id}
              onClick={() => navigate(`/game/${game.game_id}`)}
              className={clsx(
                'text-left p-4 rounded-xl border transition-all',
                isMyTurn
                  ? 'bg-cc-gold/10 border-cc-gold/50 shadow-lg shadow-cc-gold/10'
                  : 'bg-cc-surface border-cc-border hover:border-cc-gold/30',
              )}
            >
              {isMyTurn && (
                <p className="text-cc-gold text-xs font-semibold uppercase tracking-wide mb-2 animate-pulse">
                  ● Your Turn
                </p>
              )}

              <p className="font-display text-cc-text mb-0.5">
                {ERA_LABELS[game.era_id] ?? game.era_id}
              </p>
              <p className="text-cc-muted text-xs mb-3">
                {game.game_type}{game.async_mode ? ' · Async' : ' · Live'}
                {game.turn_number != null && ` · Turn ${game.turn_number}`}
              </p>

              {timeLeft !== null ? (
                <p className={clsx('flex items-center gap-1 text-xs', isUrgent ? 'text-red-400' : 'text-green-400')}>
                  <Timer className="w-3.5 h-3.5" />
                  {formatTimeLeft(timeLeft)} remaining
                </p>
              ) : (
                <p className="text-xs text-cc-muted">● Live game</p>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
