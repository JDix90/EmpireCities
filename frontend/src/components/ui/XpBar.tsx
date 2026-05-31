import React from 'react';
import clsx from 'clsx';
import { getLevelProgress } from '@borderfall/shared';

interface XpBarProps {
  xp: number;
  className?: string;
}

export default function XpBar({ xp, className }: XpBarProps) {
  const { level, currentLevelXp, nextLevelXp, progress } = getLevelProgress(xp);
  const pct = Math.min(progress * 100, 100);

  return (
    <div className={clsx('flex flex-col gap-1', className)}>
      <div className="flex items-center justify-between text-xs">
        <span className="font-display text-bf-gold">Level {level}</span>
        <span className="text-bf-muted">
          {currentLevelXp} / {nextLevelXp} XP
        </span>
      </div>
      <div className="h-2 rounded-full bg-bf-dark overflow-hidden border border-bf-border">
        <div
          className="h-full rounded-full bg-gradient-to-r from-bf-gold/70 to-bf-gold transition-all duration-500"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
