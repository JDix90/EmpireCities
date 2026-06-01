import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import { api } from '../services/api';
import { ERA_LABELS } from '../constants/gameLobbyLabels';
import { Timer, RefreshCw, Swords } from 'lucide-react';
import clsx from 'clsx';
import SubpageShell from '../components/ui/SubpageShell';

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
  // Sub-minute granularity reads as "0m remaining" which players have
  // misread as "the timer is broken". Round up to one minute at the floor
  // and call it out explicitly when under a minute.
  if (ms < 60_000) return 'Under 1m';
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  if (h >= 24) return `${Math.floor(h / 24)}d ${h % 24}h`;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

/** Absolute deadline shown as a tooltip + a11y label so timezone is unambiguous. */
function formatAbsoluteDeadline(deadline: Date | null): string {
  if (!deadline) return '';
  try {
    return deadline.toLocaleString(undefined, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      timeZoneName: 'short',
    });
  } catch {
    return deadline.toString();
  }
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
    <SubpageShell
      title="WAR ROOM"
      icon={Swords}
      maxWidth="5xl"
      contentClassName="space-y-6"
      headerRight={(
        <button
          type="button"
          onClick={() => fetchGames(true)}
          disabled={refreshing}
          className="text-bf-muted hover:text-bf-text transition-colors p-1 disabled:opacity-50"
          title="Refresh"
          aria-label="Refresh active games"
        >
          <RefreshCw className={clsx('w-4 h-4', refreshing && 'animate-spin')} />
        </button>
      )}
    >
      <p className="text-bf-muted text-sm -mt-2">All your active games in one place.</p>

      {loading && <p className="text-bf-muted text-sm">Loading games…</p>}

      {!loading && games.length === 0 && (
        <div className="text-center py-16 space-y-4">
          <Swords className="w-10 h-10 text-bf-muted mx-auto" />
          <p className="text-bf-muted">No active games.</p>
          <Link to="/lobby" className="btn-primary text-sm">
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
                  ? 'bg-bf-gold/10 border-bf-gold/50 shadow-lg shadow-bf-gold/10'
                  : 'bg-bf-surface border-bf-border hover:border-bf-gold/30',
              )}
            >
              {isMyTurn && (
                <p className="text-bf-gold text-xs font-semibold uppercase tracking-wide mb-2 animate-pulse">
                  ● Your Turn
                </p>
              )}

              <p className="font-display text-bf-text mb-0.5">
                {ERA_LABELS[game.era_id] ?? game.era_id}
              </p>
              <p className="text-bf-muted text-xs mb-3">
                {game.game_type}{game.async_mode ? ' · Async' : ' · Live'}
                {game.turn_number != null && ` · Turn ${game.turn_number}`}
              </p>

              {timeLeft !== null ? (
                <p
                  className={clsx('flex items-center gap-1 text-xs', isUrgent ? 'text-red-400' : 'text-green-400')}
                  title={deadline ? `Deadline: ${formatAbsoluteDeadline(deadline)}` : undefined}
                  aria-label={
                    deadline
                      ? `${formatTimeLeft(timeLeft)} remaining; deadline ${formatAbsoluteDeadline(deadline)}`
                      : `${formatTimeLeft(timeLeft)} remaining`
                  }
                >
                  <Timer className="w-3.5 h-3.5" aria-hidden />
                  {formatTimeLeft(timeLeft)} remaining
                </p>
              ) : (
                <p className="text-xs text-bf-muted">● Live game</p>
              )}
            </button>
          );
        })}
      </div>
    </SubpageShell>
  );
}
