import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import clsx from 'clsx';
import { Flame, Coins, Swords, Snowflake, CalendarDays, Hourglass, ChevronDown, ChevronUp } from 'lucide-react';
import toast from 'react-hot-toast';
import { api } from '../../services/api';
import { useAuthStore } from '../../store/authStore';
import { useStreakFreezesEnabled, useAsyncOnboardingEnabled } from '../../store/featureFlagsStore';
import { ERA_LABELS } from '../../constants/gameLobbyLabels';
import DailyLoginCalendar from '../ui/DailyLoginCalendar';

interface ComebackData {
  is_guest: boolean;
  daily_streak: number;
  played_today: boolean;
  next_streak_milestone: { day: number; gold: number } | null;
  tomorrow_login_reward: number | null;
  today_login_reward: number | null;
  login_streak: number | null;
  already_claimed_today: boolean | null;
  daily_challenge_done_today: boolean;
  streak_freezes: number | null;
  streak_freeze_used_on: string | null;
  streak_freeze_price: number;
  streak_freeze_max: number;
  streak_freezes_purchasable: boolean;
}

interface TodayPanelProps {
  /** New users get the solo-first layout; hide the daily-challenge row for them. */
  isNewUser: boolean;
  dailySummary: { era_id: string; attempts_today: number; completed: boolean } | null;
  /** True when the user already has at least one async game running. */
  hasActiveAsyncGames: boolean;
  /** Opens the challenge-a-friend modal (async-by-default game creation). */
  onStartAsyncGame: () => void;
  className?: string;
}

const ymdDaysAgo = (daysAgo: number) => new Date(Date.now() - daysAgo * 86_400_000).toISOString().slice(0, 10);

/**
 * The lobby's single glanceable "what's in it for me today" surface —
 * consolidates the login chest, daily challenge, play streak, and streak
 * freezes that were previously scattered across the right column. The month
 * calendar survives behind a disclosure. Fail-silent like the comeback panel:
 * if the fetch dies the aside just doesn't grow this card.
 */
export default function TodayPanel({ isNewUser, dailySummary, hasActiveAsyncGames, onStartAsyncGame, className }: TodayPanelProps) {
  const [data, setData] = useState<ComebackData | null>(null);
  const [claiming, setClaiming] = useState(false);
  const [buyingFreeze, setBuyingFreeze] = useState(false);
  const [calendarOpen, setCalendarOpen] = useState(false);
  const user = useAuthStore((s) => s.user);
  const setUser = useAuthStore((s) => s.setUser);
  const streakFreezesEnabled = useStreakFreezesEnabled();
  const asyncOnboardingEnabled = useAsyncOnboardingEnabled();

  useEffect(() => {
    let cancelled = false;
    api.get('/progression/comeback')
      .then((res) => {
        if (!cancelled) setData(res.data);
      })
      .catch(() => {});
    api.post('/analytics/ui-event', { event: 'today_panel_shown' }).catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  if (!data || data.is_guest) return null;

  const milestone = data.next_streak_milestone;
  const daysToMilestone = milestone ? milestone.day - data.daily_streak : null;
  // Only surface "a freeze saved you" while it's fresh (the bridged day was
  // yesterday or the day before) — the column is overwritten on each use.
  const freezeSavedRecently =
    data.streak_freeze_used_on === ymdDaysAgo(1) || data.streak_freeze_used_on === ymdDaysAgo(2);
  const showFreezes = streakFreezesEnabled && ((data.streak_freezes ?? 0) > 0 || data.streak_freezes_purchasable);

  const handleClaim = async () => {
    if (claiming || data.already_claimed_today !== false) return;
    setClaiming(true);
    try {
      const res = await api.post('/progression/daily-login');
      setData((prev) => (prev ? { ...prev, already_claimed_today: true } : prev));
      if (user) {
        setUser({ ...user, gold: res.data.gold, daily_streak: res.data.daily_streak });
      }
      if (res.data.claimed) {
        toast.success(`+${res.data.gold_awarded} gold claimed!`, { icon: '🪙' });
      } else {
        toast('Already claimed today', { icon: '✅' });
      }
    } catch {
      toast.error('Could not claim daily reward');
    } finally {
      setClaiming(false);
    }
  };

  const handleBuyFreeze = async () => {
    if (buyingFreeze) return;
    setBuyingFreeze(true);
    api.post('/analytics/ui-event', { event: 'streak_freeze_buy_clicked' }).catch(() => {});
    try {
      const res = await api.post('/progression/streak-freeze');
      setData((prev) => (prev ? { ...prev, streak_freezes: res.data.streak_freezes } : prev));
      if (user) {
        setUser({ ...user, gold: res.data.gold });
      }
      toast.success('Streak freeze armed — one missed day is covered.', { icon: '❄️' });
    } catch (err) {
      const status = (err as { response?: { status?: number; data?: { error?: string } } }).response?.status;
      if (status === 409) toast('You already hold the maximum freezes', { icon: '❄️' });
      else if (status === 402) toast.error('Not enough gold');
      else toast.error('Could not buy a streak freeze');
    } finally {
      setBuyingFreeze(false);
    }
  };

  const handleAsyncCta = () => {
    api.post('/analytics/ui-event', { event: 'async_cta_clicked', properties: { source: 'today_panel' } }).catch(() => {});
    onStartAsyncGame();
  };

  return (
    <div className={clsx('rounded-xl bg-bf-surface border border-bf-border p-4', className)} data-testid="today-panel">
      <h3 className="font-display text-bf-gold text-sm flex items-center gap-2 mb-3">
        <CalendarDays size={16} /> Today
      </h3>

      <div className="space-y-2.5">
        {/* Streak status */}
        <p className="text-sm text-bf-text flex items-start gap-2">
          <Flame size={15} className="text-orange-400 mt-0.5 shrink-0" />
          <span>
            {data.daily_streak > 0 ? (
              <>
                <span className="text-orange-300 font-medium">{data.daily_streak}-day play streak</span>
                {!data.played_today && ' — play a game today to keep it'}
                {milestone && daysToMilestone != null && (
                  <span className="text-bf-muted">
                    {' '}· {daysToMilestone === 1 ? 'next milestone tomorrow:' : `${daysToMilestone} days to`}{' '}
                    <span className="text-bf-gold">{milestone.gold} gold</span>
                  </span>
                )}
              </>
            ) : (
              <>Play a game today to start a streak{milestone && (
                <span className="text-bf-muted"> — <span className="text-bf-gold">{milestone.gold} gold</span> at day {milestone.day}</span>
              )}</>
            )}
          </span>
        </p>

        {freezeSavedRecently && (
          <p className="text-xs text-sky-300 flex items-start gap-2" data-testid="freeze-saved-notice">
            <Snowflake size={13} className="mt-0.5 shrink-0" />
            <span>A streak freeze covered your missed day — your streak survived.</span>
          </p>
        )}

        {/* Streak freezes */}
        {showFreezes && (
          <div className="flex items-center justify-between gap-2 text-sm" data-testid="freeze-row">
            <span className="flex items-center gap-2 text-bf-text">
              <Snowflake size={15} className="text-sky-300 shrink-0" />
              <span>
                {(data.streak_freezes ?? 0) > 0
                  ? <>{data.streak_freezes} streak freeze{data.streak_freezes === 1 ? '' : 's'} armed</>
                  : 'Protect your streak'}
              </span>
            </span>
            {data.streak_freezes_purchasable && (data.streak_freezes ?? 0) < data.streak_freeze_max && (
              <button
                onClick={handleBuyFreeze}
                disabled={buyingFreeze}
                className="text-xs px-2 py-1 rounded-md bg-sky-500/10 border border-sky-500/30 text-sky-300 hover:bg-sky-500/20 transition-colors disabled:opacity-50"
              >
                {buyingFreeze ? 'Buying…' : `Buy · ${data.streak_freeze_price} gold`}
              </button>
            )}
          </div>
        )}

        {/* Login chest */}
        {data.already_claimed_today === false && data.today_login_reward != null ? (
          <button
            onClick={handleClaim}
            disabled={claiming}
            className="w-full py-2.5 rounded-lg bg-bf-gold/20 border border-bf-gold/30 text-bf-gold text-sm font-medium hover:bg-bf-gold/30 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
          >
            <Coins size={14} />
            {claiming ? 'Claiming...' : `Claim ${data.today_login_reward} gold`}
          </button>
        ) : (
          <p className="text-xs text-bf-muted flex items-center gap-2">
            <Coins size={13} className="text-bf-gold shrink-0" />
            <span>
              Login chest claimed
              {data.tomorrow_login_reward != null && (
                <> — <span className="text-bf-gold">{data.tomorrow_login_reward} gold</span> tomorrow</>
              )}
            </span>
          </p>
        )}

        {/* Daily challenge */}
        {!isNewUser && (
          <Link to="/daily" className="flex items-start gap-2 text-sm text-bf-text group" data-testid="daily-challenge-row">
            <Swords size={15} className="text-sky-300 mt-0.5 shrink-0" />
            <span>
              <span className="group-hover:underline underline-offset-2">Daily Challenge</span>
              {data.daily_challenge_done_today || dailySummary?.completed ? (
                <span className="text-green-300 text-xs ml-1.5">✓ done</span>
              ) : (
                <span className="text-bf-muted">
                  {dailySummary ? <> — {ERA_LABELS[dailySummary.era_id] ?? dailySummary.era_id}, same map for everyone</> : ' — one puzzle per day'}
                </span>
              )}
            </span>
          </Link>
        )}

        {/* Multi-day game nudge */}
        {asyncOnboardingEnabled && !hasActiveAsyncGames && (
          <button
            onClick={handleAsyncCta}
            className="w-full flex items-start gap-2 text-sm text-bf-text text-left rounded-lg border border-bf-border bg-bf-dark/40 hover:border-bf-gold/40 transition-colors p-2.5"
            data-testid="async-cta-row"
          >
            <Hourglass size={15} className="text-purple-300 mt-0.5 shrink-0" />
            <span>
              <span className="font-medium">Start a multi-day game</span>
              <span className="text-bf-muted block text-xs mt-0.5">
                Challenge a friend, play a turn whenever — we&apos;ll notify you when it&apos;s your move.
              </span>
            </span>
          </button>
        )}
      </div>

      {/* Month calendar, tucked behind a disclosure */}
      <button
        onClick={() => setCalendarOpen((v) => !v)}
        className="w-full mt-3 pt-2 border-t border-bf-border text-xs text-bf-muted flex items-center justify-center gap-1 hover:text-bf-text transition-colors"
        aria-expanded={calendarOpen}
      >
        {calendarOpen ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
        {calendarOpen ? 'Hide login calendar' : 'Login calendar & milestones'}
      </button>
      {calendarOpen && <DailyLoginCalendar className="mt-2 border-0 bg-transparent p-0" />}
    </div>
  );
}
