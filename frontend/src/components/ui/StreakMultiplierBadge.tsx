import React from 'react';
import clsx from 'clsx';
import { Flame, Zap } from 'lucide-react';

interface StreakMultiplierBadgeProps {
  winStreak: number;
  goldMultiplier: number;
  className?: string;
}

/**
 * Shows the current win streak multiplier in the game-over summary or HUD.
 * Only visible when multiplier > 1.
 */
export default function StreakMultiplierBadge({
  winStreak,
  goldMultiplier,
  className,
}: StreakMultiplierBadgeProps) {
  if (goldMultiplier <= 1) return null;

  const intensity =
    goldMultiplier >= 2.0
      ? 'from-red-500/20 to-orange-500/20 border-red-500/40 text-red-400'
      : goldMultiplier >= 1.5
        ? 'from-orange-500/20 to-yellow-500/20 border-orange-500/40 text-orange-400'
        : 'from-yellow-500/20 to-cc-gold/20 border-yellow-500/40 text-yellow-400';

  return (
    <div
      className={clsx(
        'inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 border bg-gradient-to-r text-xs font-bold',
        intensity,
        className,
      )}
    >
      <Flame size={14} className="animate-pulse-slow" />
      <span>{goldMultiplier}× Gold</span>
      <span className="text-[10px] opacity-70">({winStreak} wins)</span>
      <Zap size={12} />
    </div>
  );
}
