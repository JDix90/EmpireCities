import React, { useEffect, useState } from 'react';
import { useNavigate, Link, useSearchParams } from 'react-router-dom';
import { api } from '../services/api';
import { ERA_LABELS, formatWeeklyScoring } from '../constants/gameLobbyLabels';
import toast from 'react-hot-toast';
import { Calendar, Trophy, Play, Crown, Clock, Sword, Film } from 'lucide-react';
import SubpageShell from '../components/ui/SubpageShell';

interface DailyPuzzleSpecPublic {
  archetype: string;
  title: string;
  intro: string;
  goal: string;
  hint?: string;
  max_turns?: number;
  era_id: string;
  map_id: string;
  seed: number;
  player_count: number;
}

interface DailyChallenge {
  challenge_date: string;
  era_id: string;
  map_id: string;
  seed: number;
  player_count: number;
  kind: string;
  spec: DailyPuzzleSpecPublic;
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
  /** Set when the user successfully completed today's daily; powers the "Watch Replay" CTA. */
  completed_game_id?: string | null;
  /** Real count of commanders who have attempted today's challenge. */
  attempts_today?: number;
  leaderboard: LeaderboardRow[];
}

interface WeeklyChallengeSummary {
  challenge_id: string;
  week_start_date: string;
  seed: number;
  rules_json: {
    objective?: string;
    turn_limit?: number;
    scoring?: string;
  };
}

interface WeeklyLeaderboardRow {
  username: string;
  score: number;
  efficiency_score: number;
  duration_seconds: number;
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

function formatDate(raw: string | undefined): string {
  if (!raw || typeof raw !== 'string') return '';
  const ymd = raw.slice(0, 10);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!m) return '';
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const da = Number(m[3]);
  const d = new Date(y, mo - 1, da);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

export default function DailyChallengePage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [data, setData] = useState<DailyResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [weeklyChallenge, setWeeklyChallenge] = useState<WeeklyChallengeSummary | null>(null);
  const [weeklyLeaderboard, setWeeklyLeaderboard] = useState<WeeklyLeaderboardRow[]>([]);

  useEffect(() => {
    api
      .get<DailyResponse>('/daily/today')
      .then((res) => setData(res.data))
      .catch(() => toast.error('Could not load Daily Challenge'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    let cancelled = false;
    api.get<{ challenge: WeeklyChallengeSummary }>('/enhancements/weekly/current')
      .then(async (res) => {
        if (cancelled) return;
        setWeeklyChallenge(res.data.challenge);
        try {
          const lb = await api.get<{ leaderboard: WeeklyLeaderboardRow[] }>(
            `/enhancements/weekly/${res.data.challenge.challenge_id}/leaderboard`,
          );
          if (!cancelled) setWeeklyLeaderboard(lb.data.leaderboard.slice(0, 10));
        } catch {
          if (!cancelled) setWeeklyLeaderboard([]);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setWeeklyChallenge(null);
          setWeeklyLeaderboard([]);
        }
      });
    return () => { cancelled = true; };
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
      <SubpageShell title="DAILY CHALLENGE" icon={Calendar} maxWidth="2xl">
        <p className="text-bf-muted animate-pulse text-center py-12">Loading today&apos;s challenge…</p>
      </SubpageShell>
    );
  }

  if (!data) {
    return (
      <SubpageShell title="DAILY CHALLENGE" icon={Calendar} maxWidth="2xl">
        <p className="text-red-400 text-center py-12">
          Failed to load challenge.{' '}
          <Link to="/lobby" className="underline text-bf-gold">Return to lobby</Link>
        </p>
      </SubpageShell>
    );
  }

  const { challenge, my_entry, active_game_id, completed_game_id, leaderboard, attempts_today } = data;
  const alreadyPlayed = my_entry !== null;
  const canWatchReplay = !!my_entry?.won && !!completed_game_id;
  const eraLabel = ERA_LABELS[challenge.era_id] ?? challenge.era_id;
  const eraIcon = ERA_ICON[challenge.era_id] ?? '🏛';
  const weeklyTabRequested = searchParams.get('tab') === 'weekly';

  return (
    <SubpageShell title="DAILY CHALLENGE" icon={Calendar} maxWidth="2xl" contentClassName="space-y-6">
        {/* Challenge card */}
        <div className="card border-bf-gold/30 shadow-lg">
          <div className="flex items-start justify-between gap-4 mb-4">
            <div>
              <p className="text-bf-muted text-sm mb-1">
                {formatDate(challenge.challenge_date) ||
                  (typeof challenge.challenge_date === 'string' ? challenge.challenge_date.slice(0, 10) : '')}
              </p>
              <div className="flex items-center gap-2">
                <span className="text-2xl" role="img" aria-label={eraLabel}>{eraIcon}</span>
                <h2 className="font-display text-xl text-bf-gold tracking-wide">{eraLabel}</h2>
              </div>
              <p className="text-bf-muted text-sm mt-1">{challenge.player_count} players · Hard AI</p>
              {attempts_today != null && attempts_today > 0 && (
                <p className="text-bf-gold/80 text-sm mt-1">
                  {attempts_today} commander{attempts_today === 1 ? '' : 's'} attempted today
                </p>
              )}
              {challenge.spec?.title && (
                <p className="text-bf-text font-medium mt-3">{challenge.spec.title}</p>
              )}
              {challenge.spec?.goal && (
                <p className="text-bf-muted text-sm mt-2 leading-relaxed">{challenge.spec.goal}</p>
              )}
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
            <div className="rounded-lg bg-bf-dark/60 border border-bf-border p-4 mb-4 grid grid-cols-3 gap-4 text-center">
              <div>
                <p className="text-bf-muted text-xs mb-1">Turns</p>
                <p className="text-bf-gold font-bold text-lg">{my_entry!.turn_count ?? '—'}</p>
              </div>
              <div>
                <p className="text-bf-muted text-xs mb-1">Territories</p>
                <p className="text-bf-gold font-bold text-lg">{my_entry!.territory_count ?? '—'}</p>
              </div>
              <div>
                <p className="text-bf-muted text-xs mb-1">Finished</p>
                <p className="text-bf-text text-sm">{formatTime(my_entry!.completed_at)}</p>
              </div>
            </div>
          )}

          {/* Action button */}
          {alreadyPlayed ? (
            canWatchReplay ? (
              <div className="flex flex-col gap-2">
                <button
                  type="button"
                  onClick={() => navigate(`/replay/${completed_game_id}?source=daily`)}
                  className="btn-primary w-full flex items-center justify-center gap-2"
                >
                  <Film className="w-4 h-4" />
                  Watch Replay
                </button>
                <p className="text-center text-bf-muted text-xs">
                  Time-lapse with coaching tips. Come back tomorrow for a new challenge!
                </p>
              </div>
            ) : (
              <p className="text-center text-bf-muted text-sm">Come back tomorrow for a new challenge!</p>
            )
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
        <div className="card p-0 overflow-hidden">
          <div className="flex items-center gap-2 px-5 py-3 border-b border-bf-border">
            <Crown className="w-4 h-4 text-bf-gold" />
            <h3 className="font-display text-sm text-bf-gold tracking-widest">TODAY&apos;S LEADERBOARD</h3>
          </div>
          {leaderboard.length === 0 ? (
            <p className="text-center text-bf-muted text-sm py-6">No one has played today yet — be the first!</p>
          ) : (
            <div className="divide-y divide-bf-border/50">
              {leaderboard.map((row, i) => (
                <div key={row.username + i} className="flex items-center gap-3 px-5 py-3">
                  <span className={`w-6 text-center text-sm font-bold ${i === 0 ? 'text-yellow-400' : i === 1 ? 'text-slate-300' : i === 2 ? 'text-amber-600' : 'text-bf-muted'}`}>
                    {i + 1}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-bf-text text-sm truncate">{row.username}</p>
                  </div>
                  <div className="flex items-center gap-3 text-xs text-bf-muted shrink-0">
                    {row.turn_count !== null && (
                      <span className="flex items-center gap-1" title="Turns taken to finish">
                        <Clock className="w-3 h-3" /> {row.turn_count} {row.turn_count === 1 ? 'turn' : 'turns'}
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

        {/* Weekly seeded challenge entry point */}
        {weeklyChallenge && (
          <div className={`card p-0 overflow-hidden ${
            weeklyTabRequested ? 'border-bf-gold/45 bg-bf-gold/5' : ''
          }`}>
            <div className="flex items-center gap-2 px-5 py-3 border-b border-bf-border">
              <Trophy className="w-4 h-4 text-bf-gold" />
              <h3 className="font-display text-sm text-bf-gold tracking-widest">WEEKLY SEEDED CHALLENGE</h3>
            </div>
            <div className="p-5 space-y-3">
              <p className="text-bf-text text-sm">
                Week of <span className="text-bf-gold font-medium">{weeklyChallenge.week_start_date}</span>
              </p>
              <p className="text-bf-muted text-sm">
                {weeklyChallenge.rules_json?.objective ?? 'Same seed and rules for every competitor.'}
              </p>
              {typeof weeklyChallenge.rules_json?.turn_limit === 'number' && (
                <p className="text-bf-muted text-xs">Turn limit: {weeklyChallenge.rules_json.turn_limit}</p>
              )}
              {weeklyChallenge.rules_json?.scoring && (
                <p className="text-bf-muted text-xs">Ranked by: {formatWeeklyScoring(weeklyChallenge.rules_json.scoring)}</p>
              )}
              <div className="flex flex-col sm:flex-row gap-2">
                <button
                  type="button"
                  onClick={() => navigate('/lobby?weekly=1')}
                  className="btn-primary flex-1"
                >
                  Enter Weekly Queue
                </button>
              </div>
              {weeklyLeaderboard.length > 0 && (
                <div className="pt-3 border-t border-bf-border">
                  <p className="text-[11px] uppercase tracking-wider text-bf-muted mb-2">Top weekly players</p>
                  <div className="space-y-1.5">
                    {weeklyLeaderboard.slice(0, 5).map((row, idx) => (
                      <div key={`${row.username}-${idx}`} className="flex items-center justify-between text-xs">
                        <span className="text-bf-text">#{idx + 1} {row.username}</span>
                        <span className="text-bf-gold font-mono">{row.score}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
    </SubpageShell>
  );
}
