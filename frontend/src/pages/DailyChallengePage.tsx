import React, { useEffect, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { api } from '../services/api';
import { ERA_LABELS } from '../constants/gameLobbyLabels';
import toast from 'react-hot-toast';
import { Calendar, Trophy, Play, Crown, Clock, Sword, ChevronLeft } from 'lucide-react';

interface DailyChallenge {
  challenge_date: string;
  era_id: string;
  map_id: string;
  seed: number;
  player_count: number;
}

interface MyEntry {
  entry_id: string;
  won: boolean;
  turn_count: number | null;
  territory_count: number | null;
  completed_at: string;
}

interface LeaderboardRow {
  username: string;
  won: boolean;
  turn_count: number | null;
  territory_count: number | null;
  completed_at: string;
}

interface DailyResponse {
  challenge: DailyChallenge;
  my_entry: MyEntry | null;
  active_game_id: string | null;
  leaderboard: LeaderboardRow[];
}

const ERA_ICON: Record<string, string> = {
  ancient:      '⚔️',
  medieval:     '🏰',
  discovery:    '⛵',
  ww2:          '🪖',
  coldwar:      '☢️',
  modern:       '🌐',
  acw:          '🎖️',
  risorgimento: '🇮🇹',
  space_age:    '🚀',
};

function formatDate(iso: string): string {
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

export default function DailyChallengePage() {
  const navigate = useNavigate();
  const [data, setData] = useState<DailyResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    api
      .get<DailyResponse>('/daily/today')
      .then((res) => setData(res.data))
      .catch(() => toast.error('Could not load Daily Challenge'))
      .finally(() => setLoading(false));
  }, []);

  const handlePlay = async () => {
    if (starting || !data) return;
    setStarting(true);
    try {
      const res = await api.post<{ game_id: string }>('/daily/start');
      navigate(`/game/${res.data.game_id}`);
    } catch (err: unknown) {
      const msg =
        err && typeof err === 'object' && 'response' in err
          ? (err as { response?: { data?: { error?: string } } }).response?.data?.error
          : null;
      toast.error(msg ?? 'Could not start challenge');
    } finally {
      setStarting(false);
    }
  };

  const handleResume = () => {
    if (data?.active_game_id) navigate(`/game/${data.active_game_id}`);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-cc-dark flex items-center justify-center">
        <div className="text-cc-muted animate-pulse">Loading today's challenge…</div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="min-h-screen bg-cc-dark flex items-center justify-center">
        <div className="text-red-400">Failed to load challenge. <Link to="/lobby" className="underline text-cc-gold">Return to lobby</Link></div>
      </div>
    );
  }

  const { challenge, my_entry, active_game_id, leaderboard } = data;
  const alreadyPlayed = my_entry !== null;
  const eraLabel = ERA_LABELS[challenge.era_id] ?? challenge.era_id;
  const eraIcon = ERA_ICON[challenge.era_id] ?? '🏛';

  return (
    <div className="min-h-screen bg-cc-dark text-cc-text">
      {/* Header */}
      <div className="border-b border-cc-border bg-[#0d1117]/80 backdrop-blur-sm">
        <div className="max-w-2xl mx-auto px-4 py-4 flex items-center gap-3">
          <Link to="/lobby" className="text-cc-muted hover:text-cc-gold transition-colors">
            <ChevronLeft className="w-5 h-5" />
          </Link>
          <Calendar className="w-5 h-5 text-cc-gold" />
          <h1 className="font-display text-xl text-cc-gold">Daily Challenge</h1>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 py-8 space-y-6">
        {/* Challenge card */}
        <div className="rounded-xl border border-cc-gold/30 bg-[#1a1a2e]/80 p-6 shadow-xl">
          <div className="flex items-start justify-between gap-4 mb-4">
            <div>
              <p className="text-cc-muted text-sm mb-1">{formatDate(challenge.challenge_date)}</p>
              <div className="flex items-center gap-2">
                <span className="text-2xl" role="img" aria-label={eraLabel}>{eraIcon}</span>
                <h2 className="font-display text-2xl text-cc-gold">{eraLabel}</h2>
              </div>
              <p className="text-cc-muted text-sm mt-1">{challenge.player_count} players · Hard AI</p>
            </div>
            {alreadyPlayed && (
              <div className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium ${
                my_entry!.won ? 'bg-green-900/40 text-green-400 border border-green-500/30' : 'bg-red-900/40 text-red-400 border border-red-500/30'
              }`}>
                {my_entry!.won ? <Trophy className="w-4 h-4" /> : <Sword className="w-4 h-4" />}
                {my_entry!.won ? 'Victory' : 'Defeated'}
              </div>
            )}
          </div>

          {/* User result summary */}
          {alreadyPlayed && (
            <div className="rounded-lg bg-cc-dark/60 border border-cc-border p-4 mb-4 grid grid-cols-3 gap-4 text-center">
              <div>
                <p className="text-cc-muted text-xs mb-1">Turns</p>
                <p className="text-cc-gold font-bold text-lg">{my_entry!.turn_count ?? '—'}</p>
              </div>
              <div>
                <p className="text-cc-muted text-xs mb-1">Territories</p>
                <p className="text-cc-gold font-bold text-lg">{my_entry!.territory_count ?? '—'}</p>
              </div>
              <div>
                <p className="text-cc-muted text-xs mb-1">Finished</p>
                <p className="text-cc-text text-sm">{formatTime(my_entry!.completed_at)}</p>
              </div>
            </div>
          )}

          {/* Action button */}
          {alreadyPlayed ? (
            <p className="text-center text-cc-muted text-sm">Come back tomorrow for a new challenge!</p>
          ) : active_game_id ? (
            <button
              type="button"
              onClick={handleResume}
              className="btn-primary w-full flex items-center justify-center gap-2"
            >
              <Play className="w-4 h-4" />
              Resume Challenge
            </button>
          ) : (
            <button
              type="button"
              onClick={handlePlay}
              disabled={starting}
              className="btn-primary w-full flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {starting ? (
                <span className="animate-spin w-4 h-4 border-2 border-white/30 border-t-white rounded-full" />
              ) : (
                <Play className="w-4 h-4" />
              )}
              {starting ? 'Starting…' : 'Play Today\'s Challenge'}
            </button>
          )}
        </div>

        {/* Leaderboard */}
        <div className="rounded-xl border border-cc-border bg-[#1a1a2e]/60 overflow-hidden">
          <div className="flex items-center gap-2 px-5 py-3 border-b border-cc-border">
            <Crown className="w-4 h-4 text-cc-gold" />
            <h3 className="font-display text-sm text-cc-gold">Today's Leaderboard</h3>
          </div>
          {leaderboard.length === 0 ? (
            <p className="text-center text-cc-muted text-sm py-6">No one has played today yet — be the first!</p>
          ) : (
            <div className="divide-y divide-cc-border/50">
              {leaderboard.map((row, i) => (
                <div key={row.username + i} className="flex items-center gap-3 px-5 py-3">
                  <span className={`w-6 text-center text-sm font-bold ${i === 0 ? 'text-yellow-400' : i === 1 ? 'text-slate-300' : i === 2 ? 'text-amber-600' : 'text-cc-muted'}`}>
                    {i + 1}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-cc-text text-sm truncate">{row.username}</p>
                  </div>
                  <div className="flex items-center gap-3 text-xs text-cc-muted shrink-0">
                    {row.turn_count !== null && (
                      <span className="flex items-center gap-1">
                        <Clock className="w-3 h-3" /> {row.turn_count}t
                      </span>
                    )}
                    {row.won ? (
                      <span className="text-green-400">Win</span>
                    ) : (
                      <span className="text-red-400">Loss</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
