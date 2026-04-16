import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Trophy } from 'lucide-react';
import { api } from '../../services/api';

interface TierInfo {
  tier: string;
  label: string;
  color: string;
}

interface TopEntry {
  rank: number;
  user_id: string;
  username: string;
  rating: number;
  tier: TierInfo;
}

interface ResponseShape {
  top: TopEntry[];
  my_rank: {
    rank: number;
    rating: number;
    tier: TierInfo;
  } | null;
}

const PODIUM_BG: Record<number, string> = {
  1: 'bg-[#d4af37]/10 border-[#d4af37]/30 text-[#f3d77d]',
  2: 'bg-slate-200/10 border-slate-200/25 text-slate-200',
  3: 'bg-amber-700/10 border-amber-700/30 text-amber-300',
};

export default function LeaderboardWidget() {
  const [data, setData] = useState<ResponseShape | null>(null);

  useEffect(() => {
    api.get<ResponseShape>('/leaderboards/top')
      .then((res) => setData(res.data))
      .catch(() => {});
  }, []);

  if (!data) return null;

  return (
    <div className="card h-full">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-display text-sm text-cc-gold flex items-center gap-2">
          <Trophy className="w-4 h-4" /> Top Commanders
        </h3>
        <Link to="/leaderboards" className="text-xs text-cc-muted hover:text-cc-gold transition-colors">
          Full board
        </Link>
      </div>

      <div className="space-y-2">
        {data.top.map((entry) => (
          <Link
            key={entry.user_id}
            to={`/profile/${entry.user_id}`}
            className="flex items-center gap-3 rounded-lg border border-cc-border bg-cc-dark/50 px-3 py-2 hover:border-cc-gold/30 transition-colors"
          >
            <span className={`w-8 h-8 rounded-full border flex items-center justify-center text-xs font-bold ${PODIUM_BG[entry.rank] ?? 'border-cc-border text-cc-muted'}`}>
              #{entry.rank}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm text-cc-text truncate font-medium">{entry.username}</p>
              <p className="text-[11px] truncate" style={{ color: entry.tier.color }}>
                {entry.tier.label}
              </p>
            </div>
            <span className="text-sm font-bold text-cc-gold tabular-nums">{entry.rating}</span>
          </Link>
        ))}
      </div>

      {data.my_rank && (
        <div className="mt-3 rounded-lg border border-cc-gold/20 bg-cc-gold/5 px-3 py-2">
          <p className="text-[10px] uppercase tracking-wider text-cc-muted mb-1">Your Rank</p>
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm text-cc-text font-medium">#{data.my_rank.rank}</p>
              <p className="text-[11px]" style={{ color: data.my_rank.tier.color }}>{data.my_rank.tier.label}</p>
            </div>
            <span className="text-sm font-bold text-cc-gold tabular-nums">{data.my_rank.rating}</span>
          </div>
        </div>
      )}
    </div>
  );
}
