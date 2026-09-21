import React, { useEffect, useState } from 'react';
import { useNavigate, Link, useSearchParams } from 'react-router-dom';
import { api } from '../services/api';
import { ERA_LABELS, formatWeeklyScoring } from '../constants/gameLobbyLabels';
import toast from 'react-hot-toast';
import { Calendar, Trophy, Play, Crown, Clock, Sword, Film } from 'lucide-react';
import SubpageShell from '../components/ui/SubpageShell';
import GuestGate from '../components/GuestGate';
import { useAuthStore } from '../store/authStore';
import { useDailyGuestPlayEnabled } from '../store/featureFlagsStore';
import { useRnParamTracker } from '../hooks/useRnParamTracker';
import { ownAuthUiAllowed } from '../utils/embedContext';
import { buildShareLine, decisionsLine, type PublicDailyPuzzleV2 } from '../utils/dailyPuzzleV2';

interface DailyPuzzleSpecPublic {
  archetype: string;
  title: string;
  intro: string;
  goal: string;
  hint?: string;
  max_turns?: number;
  /** Par: the turn the obvious line solves this day on. */
  par_turns?: number;
  /** The AI's difficulty for this day; the server defaults an unset field to medium. */
  ai_difficulty?: string;
  era_id: string;
  map_id: string;
  seed: number;
  player_count: number;
  /** A v2 decision-puzzle day (docs/DAILY_PUZZLE_V2.md); never the solution. */
  v2?: PublicDailyPuzzleV2;
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

/** The v2 columns every entry may carry (NULL on a v1 row). */
interface EntryV2Fields {
  puzzle_version?: number;
  accuracy?: number | null;
  first_try?: boolean | null;
  attempts?: number | null;
}

interface MyEntry extends EntryV2Fields {
  entry_id: string;
  won: boolean;
  puzzle_score?: number | null;
  turn_count: number | null;
  territory_count: number | null;
  completed_at: string;
  /** v2: the star and the crown, re-read from the run's decisions. */
  star?: boolean | null;
  crown?: boolean | null;
  decisions_best?: number | null;
  decisions_count?: number | null;
}

interface LeaderboardRow extends EntryV2Fields {
  username: string;
  won: boolean;
  puzzle_score?: number | null;
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
  /**
   * The viewer's place among registered commanders today, once they have an
   * entry. For a guest this is the place they WOULD hold — guests play the
   * daily but do not appear on the board.
   */
  my_rank?: number | null;
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

/** "Medium AI", "Hard AI": the day's own setting, not a fixed label. */
export function aiDifficultyLabel(difficulty: string | undefined | null): string {
  const d = (difficulty ?? 'medium').trim();
  return `${d.charAt(0).toUpperCase()}${d.slice(1)} AI`;
}

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

/** 1 → "1st", 2 → "2nd", 11 → "11th", 22 → "22nd". */
export function ordinal(n: number): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1: return `${n}st`;
    case 2: return `${n}nd`;
    case 3: return `${n}rd`;
    default: return `${n}th`;
  }
}

export default function DailyChallengePage() {
  useRnParamTracker();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const isGuest = useAuthStore((s) => !!s.user?.is_guest);
  // Operator kill switch; when off, guests get the account offer where Play would be.
  const guestPlayClosed = isGuest && !useDailyGuestPlayEnabled();
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
    if (guestPlayClosed) {
      // Normally this converts the guest. Where accounts are not on offer,
      // bouncing to /upgrade would only redirect them away, so say why.
      if (!ownAuthUiAllowed()) {
        toast('Today\u2019s challenge is finished for guest players.');
        return;
      }
      navigate('/upgrade');
      return;
    }
    setStarting(true);
    try {
      const res = await api.post<{ game_id: string }>('/daily/start');
      navigate(`/game/${res.data.game_id}`);
    } catch (err: unknown) {
      const response =
        err && typeof err === 'object' && 'response' in err
          ? (err as { response?: { status?: number; data?: { error?: string } } }).response
          : null;
      // Guests can start a daily, so a 403 here is no longer "make an account" —
      // it is a genuine denial (ban, closed day). Say so plainly; never surface
      // the middleware's developer-facing body.
      if (response?.status === 403) {
        toast.error('You can\'t start today\'s challenge right now');
        return;
      }
      toast.error(response?.data?.error ?? 'Could not start challenge');
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

  const { challenge, my_entry, active_game_id, completed_game_id, leaderboard, attempts_today, my_rank } = data;
  const alreadyPlayed = my_entry !== null;
  const canWatchReplay = !!my_entry?.won && !!completed_game_id;
  const isV2Day = !!challenge.spec?.v2;
  const isV2Entry = !!my_entry && (my_entry.puzzle_version ?? 1) >= 2 && typeof my_entry.accuracy === 'number';
  const shareLine = isV2Entry && my_entry
    ? buildShareLine({
      date: typeof challenge.challenge_date === 'string' ? challenge.challenge_date.slice(0, 10) : '',
      accuracy: my_entry.accuracy ?? 0,
      star: !!my_entry.star,
      crown: !!my_entry.crown,
      won: my_entry.won,
      bestCount: my_entry.decisions_best ?? 0,
      decisionCount: my_entry.decisions_count ?? 0,
      url: `${window.location.origin}/daily`,
    })
    : null;
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
              <p className="text-bf-muted text-sm mt-1">{challenge.player_count} players · {aiDifficultyLabel(challenge.spec?.ai_difficulty)}</p>
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
              {isV2Day ? (
                <div className="mt-2 text-xs" data-testid="daily-v2-card">
                  <p className="text-bf-gold/90">{decisionsLine(challenge.spec.v2!)}</p>
                  {challenge.spec.v2!.plan_prose.length > 0 && (
                    <ul className="mt-1.5 space-y-0.5 text-bf-muted leading-snug">
                      {challenge.spec.v2!.plan_prose.map((line, i) => (
                        <li key={i}>› {line}</li>
                      ))}
                    </ul>
                  )}
                </div>
              ) : typeof challenge.spec?.par_turns === 'number' && (
                <p className="text-bf-muted text-xs mt-2">
                  Par <span className="text-bf-text font-medium">{challenge.spec.par_turns}</span>
                  {' '}{challenge.spec.par_turns === 1 ? 'turn' : 'turns'} · beat it to score above 1000
                </p>
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

          {/* Where today's run stands. Guests can play the daily but are not on
              the board (a guest identity is one unauthenticated POST away, so a
              board that admitted them would be farmable). Naming the place they
              WOULD hold turns that gap into the reason to create the account —
              and upgrading keeps the same user_id, so the entry appears on the
              board the moment they do. */}
          {alreadyPlayed && typeof my_rank === 'number' && (
            isGuest ? (
              <div
                className="rounded-lg border border-bf-gold/40 bg-bf-gold/10 p-4 mb-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3"
                data-testid="daily-guest-rank"
              >
                <p className="text-sm text-bf-text">
                  That run would place you{' '}
                  <span className="text-bf-gold font-semibold">{ordinal(my_rank)}</span> on today&apos;s board.
                  <span className="text-bf-muted"> Guest runs aren&apos;t ranked — create a free account and this one is.</span>
                </p>
                {ownAuthUiAllowed() && (
                  <Link
                    to="/upgrade"
                    className="btn-primary inline-flex items-center justify-center min-h-[44px] px-5 shrink-0"
                  >
                    Claim {ordinal(my_rank)} place
                  </Link>
                )}
              </div>
            ) : (
              <p className="text-sm text-bf-muted mb-3" data-testid="daily-rank">
                You&apos;re <span className="text-bf-gold font-semibold">{ordinal(my_rank)}</span> today.
              </p>
            )
          )}

          {/* A v2 run: accuracy is the score, the star or crown the badge, and
              the share line the thing to paste (docs/DAILY_PUZZLE_V2.md §3). */}
          {alreadyPlayed && isV2Entry && my_entry && (
            <div className="rounded-lg bg-bf-dark/60 border border-bf-gold/30 p-4 mb-4" data-testid="daily-v2-result">
              <div className="flex items-baseline justify-between gap-3">
                <p className="text-bf-gold font-display text-2xl">
                  {my_entry.crown ? '👑 ' : my_entry.star ? '★ ' : ''}{Math.round(my_entry.accuracy ?? 0)} % accuracy
                </p>
                {typeof my_entry.puzzle_score === 'number' && (
                  <p className="text-bf-muted text-sm">{my_entry.puzzle_score} pts</p>
                )}
              </div>
              <p className="text-bf-muted text-xs mt-1">
                {typeof my_entry.decisions_best === 'number' && typeof my_entry.decisions_count === 'number'
                  ? `${my_entry.decisions_best}/${my_entry.decisions_count} decisions best`
                  : 'Graded against the exact solution'}
                {my_entry.first_try === false && typeof my_entry.attempts === 'number' ? ` · ${my_entry.attempts} attempts` : ''}
                {my_entry.crown ? ' · a crown' : my_entry.star ? ' · a star' : ''}
              </p>
              {shareLine && (
                <div className="mt-3 flex items-center gap-2">
                  <code className="flex-1 min-w-0 truncate text-[11px] text-bf-muted bg-black/30 rounded px-2 py-1.5">{shareLine}</code>
                  <button
                    type="button"
                    onClick={() => {
                      void navigator.clipboard?.writeText(shareLine).then(() => toast.success('Share line copied')).catch(() => undefined);
                    }}
                    className="shrink-0 rounded bg-bf-gold/15 hover:bg-bf-gold/25 border border-bf-gold/30 px-2.5 py-1.5 text-xs text-bf-gold"
                  >
                    Share
                  </button>
                </div>
              )}
            </div>
          )}

          {/* User result summary */}
          {alreadyPlayed && (
            <div className="rounded-lg bg-bf-dark/60 border border-bf-border p-4 mb-4 grid grid-cols-3 gap-4 text-center">
              <div>
                <p className="text-bf-muted text-xs mb-1">
                  Turns{typeof challenge.spec?.par_turns === 'number' ? ` · par ${challenge.spec.par_turns}` : ''}
                </p>
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
          ) : guestPlayClosed ? (
            <GuestGate
              title="Play today's challenge"
              description="The Daily Challenge needs a free account right now — one puzzle a day, the same map for everyone. Your guest progress carries over."
              ctaLabel="Create free account"
            />
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
                    {(row.puzzle_version ?? 1) >= 2 && typeof row.accuracy === 'number' ? (
                      <span className="text-bf-gold font-semibold" title="Accuracy: 100 minus the win probability given up across the run's decisions">
                        {Math.round(row.accuracy)} %{row.first_try ? '' : ' ↺'}
                      </span>
                    ) : typeof row.puzzle_score === 'number' && (
                      <span className="text-bf-gold font-semibold" title="Puzzle score: 1000 at par, more for beating it, less for risky moves">
                        {row.puzzle_score}
                      </span>
                    )}
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
                {/* The weekly queue lives in the ranked tab, which is registered-only
                    (rejectGuest on /matchmaking/join and the weekly submit). */}
                <button
                  type="button"
                  onClick={() => navigate(isGuest ? '/upgrade' : '/lobby?weekly=1')}
                  className="btn-primary flex-1"
                >
                  {isGuest ? 'Create account to enter' : 'Enter Weekly Queue'}
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
