import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Trophy, Flame, Star, TrendingUp, ChevronLeft, ChevronRight, Crown, CalendarDays } from 'lucide-react';
import SubpageShell from '../components/ui/SubpageShell';
import clsx from 'clsx';
import { api } from '../services/api';
import { useAuthStore } from '../store/authStore';
import type { TierInfo } from '@borderfall/shared';

type LeaderboardTab = 'rating' | 'level' | 'season' | 'weekly' | 'streaks';

interface RatingEntry {
  rank: number;
  user_id: string;
  username: string;
  rating: number;
  tier: TierInfo;
  level: number;
  games_played: number;
}

interface LevelEntry {
  rank: number;
  user_id: string;
  username: string;
  level: number;
  xp: number;
}

interface SeasonEntry {
  rank: number;
  user_id: string;
  username: string;
  highest_tier: string;
  tier_info: TierInfo;
  games_played: number;
  rating: number;
}

interface StreakEntry {
  rank: number;
  user_id: string;
  username: string;
  win_streak: number;
  daily_streak: number;
}

interface WeeklyEntry {
  rank: number;
  user_id: string;
  username: string;
  wins: number;
  games_played: number;
  tier: TierInfo;
}

interface MyRankResponse {
  rating: { rank: number; value: number; tier: TierInfo } | null;
  level: { rank: number; value: number; xp: number } | null;
  streak: { rank: number; win_streak: number; daily_streak: number } | null;
}

const TABS: { id: LeaderboardTab; label: string; icon: typeof Trophy }[] = [
  { id: 'rating', label: 'Rating', icon: Trophy },
  { id: 'level', label: 'Level', icon: Star },
  { id: 'season', label: 'Season', icon: Crown },
  { id: 'weekly', label: 'Weekly', icon: CalendarDays },
  { id: 'streaks', label: 'Streaks', icon: Flame },
];

const TIER_ICONS: Record<string, string> = {
  bronze: '🥉',
  silver: '🥈',
  gold: '🥇',
  platinum: '💎',
  diamond: '👑',
};

const PAGE_SIZE = 50;

export default function LeaderboardsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = (searchParams.get('tab') as LeaderboardTab) || 'rating';
  const [page, setPage] = useState(0);
  const [data, setData] = useState<unknown[]>([]);
  const [seasonInfo, setSeasonInfo] = useState<{ season_id: string; label?: string; name?: string } | null>(null);
  const [myRank, setMyRank] = useState<MyRankResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const { user } = useAuthStore();

  const setTab = (tab: LeaderboardTab) => {
    setData([]);
    setLoading(true);
    setSearchParams({ tab });
    setPage(0);
  };

  useEffect(() => {
    api.get<MyRankResponse>('/leaderboards/my-rank')
      .then((res) => setMyRank(res.data))
      .catch(() => {});
  }, []);

  const myRankCard = activeTab === 'level'
    ? myRank?.level
      ? { title: 'Your Level Rank', rank: myRank.level.rank, value: `Lv ${myRank.level.value}` }
      : null
    : activeTab === 'streaks'
      ? myRank?.streak
        ? { title: 'Your Streak Rank', rank: myRank.streak.rank, value: `${myRank.streak.win_streak}W / ${myRank.streak.daily_streak}D` }
        : null
      : myRank?.rating
        ? { title: activeTab === 'weekly' ? 'Your Rated Rank' : 'Your Rating Rank', rank: myRank.rating.rank, value: `${myRank.rating.value}` }
        : null;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    api.get<{ entries?: unknown[]; season?: { season_id: string; label: string } }>(`/leaderboards/${activeTab}`, { params: { limit: PAGE_SIZE, offset: page * PAGE_SIZE } })
      .then((res) => {
        if (cancelled) return;
        setData(res.data.entries ?? []);
        if (res.data.season) setSeasonInfo(res.data.season);
        setLoading(false);
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [activeTab, page]);

  return (
    <SubpageShell title="LEADERBOARDS" icon={Trophy}>
        {/* Tabs */}
        <div className="flex gap-1 bg-bf-surface rounded-xl p-1 mb-6">
          {TABS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={clsx(
                'flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-medium transition-all',
                activeTab === id
                  ? 'bg-bf-gold/20 text-bf-gold border border-bf-gold/30'
                  : 'text-bf-muted hover:text-bf-text',
              )}
            >
              <Icon className="w-4 h-4" />
              <span className="hidden sm:inline">{label}</span>
            </button>
          ))}
        </div>

        {/* Season banner */}
        {activeTab === 'season' && seasonInfo && (
          <div className="mb-4 p-3 rounded-lg bg-bf-gold/5 border border-bf-gold/20 text-center">
            <p className="text-bf-gold font-display text-sm">{seasonInfo.name}</p>
          </div>
        )}

        {myRankCard && (
          <div className="mb-4 rounded-xl border border-bf-gold/20 bg-bf-gold/5 px-4 py-3 flex items-center justify-between gap-3">
            <div>
              <p className="text-[10px] uppercase tracking-wider text-bf-muted">{myRankCard.title}</p>
              <p className="text-sm text-bf-text font-medium">#{myRankCard.rank}</p>
            </div>
            <p className="text-lg font-display text-bf-gold">{myRankCard.value}</p>
          </div>
        )}

        {/* Table */}
        <div className="card overflow-hidden">
          {loading ? (
            <div className="py-16 text-center text-bf-muted animate-pulse">Loading leaderboard…</div>
          ) : data.length === 0 ? (
            <div className="py-16 text-center text-bf-muted">No entries yet</div>
          ) : (
            <div className="divide-y divide-bf-border">
              {activeTab === 'rating' && (data as RatingEntry[]).map((entry) => (
                <Link
                  key={entry.user_id}
                  to={`/profile/${entry.user_id}`}
                  className={clsx(
                    'flex items-center gap-3 px-4 py-3 hover:bg-white/[0.03] transition-colors',
                    entry.rank <= 3 && 'bg-gradient-to-r from-bf-gold/[0.05] to-transparent',
                    user?.user_id === entry.user_id && 'bg-bf-gold/5',
                  )}
                >
                  <span className="text-bf-muted text-sm w-8 text-right tabular-nums">#{entry.rank}</span>
                  <span className="flex-1 font-medium text-bf-text truncate">{entry.username}</span>
                  <span className="text-xs px-2 py-0.5 rounded-full border" style={{ borderColor: entry.tier.color, color: entry.tier.color }}>
                    {TIER_ICONS[entry.tier.tier]} {entry.tier.label}
                  </span>
                  <span className="text-bf-gold font-bold tabular-nums w-16 text-right">{entry.rating}</span>
                </Link>
              ))}

              {activeTab === 'level' && (data as LevelEntry[]).map((entry) => (
                <Link
                  key={entry.user_id}
                  to={`/profile/${entry.user_id}`}
                  className={clsx(
                    'flex items-center gap-3 px-4 py-3 hover:bg-white/[0.03] transition-colors',
                    user?.user_id === entry.user_id && 'bg-bf-gold/5',
                  )}
                >
                  <span className="text-bf-muted text-sm w-8 text-right tabular-nums">#{entry.rank}</span>
                  <span className="flex-1 font-medium text-bf-text truncate">{entry.username}</span>
                  <span className="text-sm text-bf-muted tabular-nums">{entry.xp.toLocaleString()} XP</span>
                  <span className="bg-bf-gold/20 text-bf-gold text-xs font-bold px-2 py-0.5 rounded-full w-14 text-center">
                    Lv {entry.level}
                  </span>
                </Link>
              ))}

              {activeTab === 'season' && (data as SeasonEntry[]).map((entry) => (
                <Link
                  key={entry.user_id}
                  to={`/profile/${entry.user_id}`}
                  className={clsx(
                    'flex items-center gap-3 px-4 py-3 hover:bg-white/[0.03] transition-colors',
                    user?.user_id === entry.user_id && 'bg-bf-gold/5',
                  )}
                >
                  <span className="text-bf-muted text-sm w-8 text-right tabular-nums">#{entry.rank}</span>
                  <span className="flex-1 font-medium text-bf-text truncate">{entry.username}</span>
                  <span className="text-xs text-bf-muted tabular-nums">{entry.games_played} games</span>
                  <span className="text-xs px-2 py-0.5 rounded-full border" style={{ borderColor: entry.tier_info.color, color: entry.tier_info.color }}>
                    {TIER_ICONS[entry.highest_tier]} {entry.tier_info.label}
                  </span>
                  <span className="text-bf-gold font-bold tabular-nums w-16 text-right">{entry.rating}</span>
                </Link>
              ))}

              {activeTab === 'weekly' && (data as WeeklyEntry[]).map((entry) => (
                <Link
                  key={entry.user_id}
                  to={`/profile/${entry.user_id}`}
                  className={clsx(
                    'flex items-center gap-3 px-4 py-3 hover:bg-white/[0.03] transition-colors',
                    entry.rank <= 3 && 'bg-gradient-to-r from-sky-400/[0.06] to-transparent',
                    user?.user_id === entry.user_id && 'bg-bf-gold/5',
                  )}
                >
                  <span className="text-bf-muted text-sm w-8 text-right tabular-nums">#{entry.rank}</span>
                  <span className="flex-1 font-medium text-bf-text truncate">{entry.username}</span>
                  <span className="text-xs" style={{ color: entry.tier.color }}>{entry.tier.label}</span>
                  <span className="text-sm text-bf-muted tabular-nums">{entry.games_played}G</span>
                  <span className="text-bf-gold font-bold tabular-nums w-12 text-right">{entry.wins}W</span>
                </Link>
              ))}

              {activeTab === 'streaks' && (data as StreakEntry[]).map((entry) => (
                <Link
                  key={entry.user_id}
                  to={`/profile/${entry.user_id}`}
                  className={clsx(
                    'flex items-center gap-3 px-4 py-3 hover:bg-white/[0.03] transition-colors',
                    user?.user_id === entry.user_id && 'bg-bf-gold/5',
                  )}
                >
                  <span className="text-bf-muted text-sm w-8 text-right tabular-nums">#{entry.rank}</span>
                  <span className="flex-1 font-medium text-bf-text truncate">{entry.username}</span>
                  {entry.win_streak > 0 && (
                    <span className="inline-flex items-center gap-1 text-xs text-orange-400 bg-orange-400/10 border border-orange-400/20 rounded-full px-2 py-0.5">
                      <Flame className="w-3 h-3" /> {entry.win_streak}W
                    </span>
                  )}
                  {entry.daily_streak > 0 && (
                    <span className="inline-flex items-center gap-1 text-xs text-blue-400 bg-blue-400/10 border border-blue-400/20 rounded-full px-2 py-0.5">
                      <TrendingUp className="w-3 h-3" /> {entry.daily_streak}D
                    </span>
                  )}
                </Link>
              ))}
            </div>
          )}

          {/* Pagination */}
          {data.length > 0 && (
            <div className="flex items-center justify-between px-4 py-3 border-t border-bf-border">
              <button
                onClick={() => setPage(Math.max(0, page - 1))}
                disabled={page === 0}
                className="flex items-center gap-1 text-sm text-bf-muted hover:text-bf-text disabled:opacity-30 transition-colors"
              >
                <ChevronLeft className="w-4 h-4" /> Previous
              </button>
              <span className="text-xs text-bf-muted">
                Page {page + 1}
              </span>
              <button
                onClick={() => setPage(page + 1)}
                disabled={data.length < PAGE_SIZE}
                className="flex items-center gap-1 text-sm text-bf-muted hover:text-bf-text disabled:opacity-30 transition-colors"
              >
                Next <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          )}
        </div>
    </SubpageShell>
  );
}
