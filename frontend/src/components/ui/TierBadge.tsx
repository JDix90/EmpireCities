import React from 'react';
import clsx from 'clsx';
import { getTier } from '@erasofempire/shared';

interface TierBadgeProps {
  mu: number;
  showLabel?: boolean;
  className?: string;
}

const TIER_ICONS: Record<string, string> = {
  bronze: '🥉',
  silver: '🥈',
  gold: '🥇',
  platinum: '💎',
  diamond: '👑',
};

export default function TierBadge({ mu, showLabel = true, className }: TierBadgeProps) {
  const { tier, label, color } = getTier(mu);

  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-bold border',
        className,
      )}
      style={{ color, borderColor: `${color}40`, backgroundColor: `${color}15` }}
      title={`${label} — Rating ${Math.round(mu)}`}
    >
      <span>{TIER_ICONS[tier]}</span>
      {showLabel && <span>{label}</span>}
    </span>
  );
}
