import React from 'react';
import clsx from 'clsx';
import type { RatingInfo } from '../../store/authStore';
import { getTier } from '@erasofempire/shared';

interface RatingTooltipProps {
  rating: RatingInfo;
  type: 'solo' | 'ranked';
  className?: string;
}

export default function RatingTooltip({ rating, type, className }: RatingTooltipProps) {
  const { label, color } = getTier(rating.mu);
  const displayMu = Math.round(rating.mu);
  const phi = Math.round(rating.phi);

  return (
    <div
      className={clsx(
        'rounded-lg bg-cc-surface border border-cc-border p-3 text-sm shadow-xl min-w-[180px]',
        className,
      )}
    >
      <div className="flex items-center justify-between mb-2">
        <span className="text-cc-muted capitalize">{type}</span>
        {rating.provisional && (
          <span className="text-[10px] text-cc-muted bg-cc-dark rounded px-1.5 py-0.5">
            Provisional
          </span>
        )}
      </div>

      <div className="flex items-baseline gap-2 mb-1">
        <span className="text-xl font-bold font-display" style={{ color }}>
          {displayMu}
        </span>
        <span className="text-xs text-cc-muted">±{phi}</span>
      </div>

      <div className="text-xs" style={{ color }}>
        {label}
      </div>
    </div>
  );
}
