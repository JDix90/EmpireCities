import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Flame, Coins, Swords, Snowflake } from 'lucide-react';
import { api } from '../../services/api';

interface ComebackData {
  is_guest: boolean;
  daily_streak: number;
  played_today: boolean;
  next_streak_milestone: { day: number; gold: number } | null;
  tomorrow_login_reward: number | null;
  already_claimed_today: boolean | null;
  daily_challenge_done_today: boolean;
  streak_freezes: number | null;
}

/**
 * The "come back tomorrow" moment on the game-over screen — the one place we
 * reliably have the player's attention at the end of a session. Shows the
 * streak they now have to protect, tomorrow's (bigger) login chest, and a
 * daily-challenge tease. Self-contained and fail-silent: if the fetch dies,
 * the game-over screen simply doesn't grow this section.
 */
export default function ComeBackTomorrowPanel({ className }: { className?: string }) {
  const [data, setData] = useState<ComebackData | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.get('/progression/comeback')
      .then((res) => {
        if (!cancelled) setData(res.data);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  if (!data) return null;

  const milestone = data.next_streak_milestone;
  const daysToMilestone = milestone ? milestone.day - data.daily_streak : null;

  return (
    <div className={`p-4 rounded-xl bg-white/[0.03] border border-white/10 text-left space-y-2.5 ${className ?? ''}`}>
      <p className="text-white/40 text-xs font-semibold uppercase tracking-wider">Tomorrow awaits</p>

      {data.daily_streak > 0 && (
        <p className="text-sm text-white/80 flex items-start gap-2">
          <Flame size={15} className="text-orange-400 mt-0.5 shrink-0" />
          <span>
            <span className="text-orange-300 font-medium">{data.daily_streak}-day play streak.</span>{' '}
            {milestone && daysToMilestone != null && (
              <>Play tomorrow — {daysToMilestone === 1
                ? <>the <span className="text-bf-gold">{milestone.gold}-gold milestone</span> is next</>
                : <>{daysToMilestone} days to the <span className="text-bf-gold">{milestone.gold}-gold milestone</span></>}.
              </>
            )}
            {data.is_guest && (
              <span className="text-bf-muted"> Create a free account to protect it.</span>
            )}
          </span>
        </p>
      )}

      {!data.is_guest && (data.streak_freezes ?? 0) > 0 && data.daily_streak > 0 && (
        <p className="text-xs text-sky-300/90 flex items-start gap-2">
          <Snowflake size={13} className="mt-0.5 shrink-0" />
          <span>
            {data.streak_freezes} streak freeze{data.streak_freezes === 1 ? '' : 's'} armed — one missed day
            won&apos;t break your streak.
          </span>
        </p>
      )}

      {!data.is_guest && data.tomorrow_login_reward != null && (
        <p className="text-sm text-white/80 flex items-start gap-2">
          <Coins size={15} className="text-bf-gold mt-0.5 shrink-0" />
          <span>
            Tomorrow&apos;s login chest:{' '}
            <span className="text-bf-gold font-medium">{data.tomorrow_login_reward} gold</span>
            {data.already_claimed_today === false && ' (today’s is still unclaimed in the lobby)'}
          </span>
        </p>
      )}

      {!data.is_guest && !data.daily_challenge_done_today && (
        <p className="text-sm text-white/80 flex items-start gap-2">
          <Swords size={15} className="text-sky-300 mt-0.5 shrink-0" />
          <span>
            Today&apos;s <Link to="/daily" className="text-sky-300 underline underline-offset-2 hover:text-sky-200">Daily Challenge</Link>{' '}
            is still open — a fresh one lands at midnight UTC.
          </span>
        </p>
      )}
    </div>
  );
}
