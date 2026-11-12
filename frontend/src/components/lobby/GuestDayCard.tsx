import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Calendar, Check, Flame } from 'lucide-react';
import { api } from '../../services/api';
import { ERA_LABELS } from '../../constants/gameLobbyLabels';
import { trackFunnel } from '../../utils/funnelEvents';

interface StreakData {
  daily_streak: number;
  played_today: boolean;
  /** comeback_hook_enabled: a game today or yesterday keeps the streak. */
  streak_alive?: boolean;
}

export interface DailySummaryLike {
  era_id: string;
  title: string | null;
  completed: boolean;
}

/**
 * A guest's day in the lobby (comeback_hook_enabled): their play streak and
 * today's Daily Challenge. The lobby's sidebar showed a guest nothing but the
 * leaderboard. The streak, the daily and the login calendar were an account's
 * alone, so the one thing that brings a guest back was never in front of them.
 * A streak that has already lapsed (no game today or yesterday) is not shown:
 * the stored count is only reset by the next game.
 */
export default function GuestDayCard({ dailySummary }: { dailySummary: DailySummaryLike | null }) {
  const [streak, setStreak] = useState<StreakData | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.get<StreakData>('/progression/comeback')
      .then((res) => {
        if (!cancelled) setStreak(res.data);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const alive = !!streak && streak.daily_streak > 0 && streak.streak_alive !== false;

  return (
    <div className="card space-y-3" data-testid="guest-day-card">
      <h3 className="font-display text-bf-gold">Your day</h3>
      <p className="text-sm text-bf-text flex items-start gap-2" data-testid="guest-day-streak">
        <Flame size={15} className="text-orange-400 mt-0.5 shrink-0" aria-hidden />
        {alive ? (
          <span>
            <span className="text-orange-300 font-medium">{streak!.daily_streak}-day play streak.</span>{' '}
            {streak!.played_today ? 'Today counts already.' : 'Finish a game today to keep it.'}
          </span>
        ) : (
          <span>Finish a game today to start a play streak.</span>
        )}
      </p>
      <Link
        to="/daily"
        className="flex items-start gap-2 text-sm text-bf-text group"
        data-testid="guest-day-daily"
        onClick={() => trackFunnel({ event: 'daily_link_clicked', surface: 'lobby' }, { place: 'guest_card' })}
      >
        <Calendar size={15} className="text-sky-300 mt-0.5 shrink-0" aria-hidden />
        <span className="min-w-0">
          <span className="group-hover:text-bf-gold transition-colors">
            Today&apos;s Daily Challenge
            {dailySummary?.title ? <>: <span className="text-sky-200">{dailySummary.title}</span></> : null}
          </span>
          <span className="block text-xs text-bf-muted">
            {dailySummary?.completed ? (
              <span className="inline-flex items-center gap-1 text-green-300">
                <Check size={12} aria-hidden /> Done. A new one opens at midnight UTC.
              </span>
            ) : (
              <>
                {dailySummary?.era_id && ERA_LABELS[dailySummary.era_id] ? `${ERA_LABELS[dailySummary.era_id]} · ` : ''}
                One puzzle, a few minutes, the same for everyone.
              </>
            )}
          </span>
        </span>
      </Link>
    </div>
  );
}
