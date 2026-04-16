import React, { useEffect, useState } from 'react';
import clsx from 'clsx';
import { Clock, Trophy } from 'lucide-react';
import { api } from '../../services/api';

interface SeasonData {
  season_id: string;
  name: string;
  featured_eras: string[];
  started_at: string;
  ended_at: string;
  days_remaining: number;
  current_tier: string;
  highest_tier: string;
}

const TIER_COLORS: Record<string, string> = {
  bronze: '#cd7f32',
  silver: '#c0c0c0',
  gold: '#ffd700',
  platinum: '#69d6e0',
  diamond: '#b9f2ff',
};

const TIER_ICONS: Record<string, string> = {
  bronze: '🥉',
  silver: '🥈',
  gold: '🥇',
  platinum: '💎',
  diamond: '👑',
};

interface SeasonBannerProps {
  className?: string;
}

export default function SeasonBanner({ className }: SeasonBannerProps) {
  const [season, setSeason] = useState<SeasonData | null>(null);

  useEffect(() => {
    api.get('/progression/season')
      .then((res) => setSeason(res.data.season))
      .catch(() => {});
  }, []);

  if (!season) return null;

  const tierColor = TIER_COLORS[season.current_tier] ?? TIER_COLORS.bronze;
  const totalDays = Math.ceil(
    (new Date(season.ended_at).getTime() - new Date(season.started_at).getTime()) / 86_400_000,
  );
  const elapsed = totalDays - season.days_remaining;
  const progressPct = Math.min((elapsed / totalDays) * 100, 100);

  return (
    <div
      className={clsx(
        'rounded-xl border p-4',
        className,
      )}
      style={{ borderColor: `${tierColor}40`, background: `linear-gradient(135deg, ${tierColor}08, transparent)` }}
    >
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <Trophy size={16} style={{ color: tierColor }} />
          <span className="font-display text-sm text-cc-text">{season.name}</span>
        </div>
        <div className="flex items-center gap-1 text-xs text-cc-muted">
          <Clock size={12} />
          <span>{season.days_remaining}d remaining</span>
        </div>
      </div>

      <div className="flex items-center gap-3 mb-3">
        <span className="text-2xl">{TIER_ICONS[season.current_tier] ?? '🥉'}</span>
        <div>
          <p className="text-sm font-bold capitalize" style={{ color: tierColor }}>
            {season.current_tier}
          </p>
          {season.highest_tier !== season.current_tier && (
            <p className="text-[10px] text-cc-muted">
              Peak: <span className="capitalize">{season.highest_tier}</span>
            </p>
          )}
        </div>
      </div>

      {/* Season progress bar */}
      <div className="h-1.5 rounded-full bg-cc-dark overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{ width: `${progressPct}%`, backgroundColor: tierColor }}
        />
      </div>

      <div className="flex items-center gap-1 mt-2 text-[10px] text-cc-muted">
        <span>Featured eras:</span>
        {season.featured_eras.map((era) => (
          <span
            key={era}
            className="px-1.5 py-0.5 rounded bg-cc-dark border border-cc-border"
          >
            {era.replace('era_', '').replace(/_/g, ' ')}
          </span>
        ))}
      </div>
    </div>
  );
}
