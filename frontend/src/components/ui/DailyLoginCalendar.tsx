import React, { useEffect, useState } from 'react';
import clsx from 'clsx';
import { Calendar, Coins, Flame } from 'lucide-react';
import { api } from '../../services/api';
import { useAuthStore } from '../../store/authStore';

interface CalendarData {
  month: string;
  days_in_month: number;
  logins: string[];
  gold_per_day: number;
  daily_streak: number;
  already_claimed_today: boolean;
}

const STREAK_MILESTONES = [
  { days: 3, reward: '25 gold' },
  { days: 7, reward: '75 gold + frame' },
  { days: 14, reward: '150 gold' },
  { days: 28, reward: '300 gold + frame' },
];

interface DailyLoginCalendarProps {
  className?: string;
}

function toLocalIsoDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export default function DailyLoginCalendar({ className }: DailyLoginCalendarProps) {
  const [data, setData] = useState<CalendarData | null>(null);
  const [claiming, setClaiming] = useState(false);
  const user = useAuthStore((s) => s.user);
  const setUser = useAuthStore((s) => s.setUser);

  useEffect(() => {
    api.get('/progression/login-calendar')
      .then((res) => setData(res.data))
      .catch(() => {});
  }, []);

  const handleClaim = async () => {
    if (claiming || !data || data.already_claimed_today) return;
    setClaiming(true);
    try {
      const res = await api.post('/progression/daily-login');
      setData((prev) =>
        prev
          ? {
              ...prev,
              already_claimed_today: true,
              logins: [...prev.logins, toLocalIsoDate(new Date())],
              daily_streak: res.data.daily_streak,
            }
          : prev,
      );
      if (user) {
        setUser({ ...user, gold: res.data.gold, daily_streak: res.data.daily_streak });
      }
    } catch {
      // silently fail
    } finally {
      setClaiming(false);
    }
  };

  if (!data) return null;

  const todayDate = new Date();
  const today = toLocalIsoDate(todayDate);
  const loginSet = new Set(data.logins);
  const [monthYear, monthMonth] = data.month.split('-').map(Number);
  const monthName = new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric' }).format(
    new Date(monthYear, monthMonth - 1, 1),
  );

  // Build day grid
  const firstDayOfWeek = new Date(monthYear, monthMonth - 1, 1).getDay();
  const days: Array<{ day: number; date: string; isLogin: boolean; isToday: boolean; isPast: boolean }> = [];
  for (let d = 1; d <= data.days_in_month; d++) {
    const dateStr = `${data.month.slice(0, 7)}-${String(d).padStart(2, '0')}`;
    days.push({
      day: d,
      date: dateStr,
      isLogin: loginSet.has(dateStr),
      isToday: dateStr === today,
      isPast: dateStr < today,
    });
  }

  return (
    <div className={clsx('rounded-xl bg-cc-surface border border-cc-border p-4', className)}>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Calendar size={16} className="text-cc-gold" />
          <span className="font-display text-sm text-cc-gold">Daily Login — {monthName}</span>
        </div>
        {data.daily_streak > 0 && (
          <div className="flex items-center gap-1 text-xs text-orange-400">
            <Flame size={12} />
            <span>{data.daily_streak} day streak</span>
          </div>
        )}
      </div>

      {/* Calendar grid */}
      <div className="grid grid-cols-7 gap-1 mb-3">
        {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => (
          <div key={i} className="text-center text-[10px] text-cc-muted font-medium py-1">
            {d}
          </div>
        ))}
        {/* Empty cells for offset */}
        {Array.from({ length: firstDayOfWeek }).map((_, i) => (
          <div key={`empty-${i}`} />
        ))}
        {days.map((d) => (
          <div
            key={d.day}
            className={clsx(
              'aspect-square rounded-md flex items-center justify-center text-xs relative',
              d.isLogin && 'bg-cc-gold/20 text-cc-gold font-bold',
              d.isToday && !d.isLogin && 'border border-cc-gold/40 text-cc-text',
              d.isPast && !d.isLogin && 'text-cc-muted/40',
              !d.isPast && !d.isToday && !d.isLogin && 'text-cc-muted',
            )}
          >
            {d.day}
            {d.isLogin && (
              <span className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full bg-cc-gold" />
            )}
          </div>
        ))}
      </div>

      {/* Claim button */}
      {!data.already_claimed_today ? (
        <button
          onClick={handleClaim}
          disabled={claiming}
          className="w-full py-2.5 rounded-lg bg-cc-gold/20 border border-cc-gold/30 text-cc-gold text-sm font-medium hover:bg-cc-gold/30 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
        >
          <Coins size={14} />
          {claiming ? 'Claiming...' : `Claim ${data.gold_per_day} gold`}
        </button>
      ) : (
        <div className="text-center text-xs text-cc-muted py-2">
          ✅ Today&apos;s reward claimed
        </div>
      )}

      {/* Streak milestones */}
      <div className="mt-3 pt-3 border-t border-cc-border">
        <p className="text-[10px] text-cc-muted uppercase tracking-wider mb-2">Streak Milestones</p>
        <div className="grid grid-cols-4 gap-1">
          {STREAK_MILESTONES.map((m) => (
            <div
              key={m.days}
              className={clsx(
                'rounded-md p-1.5 text-center border',
                data.daily_streak >= m.days
                  ? 'border-cc-gold/30 bg-cc-gold/10'
                  : 'border-cc-border bg-cc-dark/50',
              )}
            >
              <p
                className={clsx(
                  'text-xs font-bold',
                  data.daily_streak >= m.days ? 'text-cc-gold' : 'text-cc-muted',
                )}
              >
                {m.days}d
              </p>
              <p className="text-[9px] text-cc-muted mt-0.5">{m.reward}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
