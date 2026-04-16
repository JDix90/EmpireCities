import React from 'react';
import clsx from 'clsx';
import { getLevelProgress } from '@erasofempire/shared';

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
        <span className="font-display text-cc-gold">Level {level}</span>
        <span className="text-cc-muted">
          {currentLevelXp} / {nextLevelXp} XP
        </span>
      </div>
      <div className="h-2 rounded-full bg-cc-dark overflow-hidden border border-cc-border">
        <div
          className="h-full rounded-full bg-gradient-to-r from-cc-gold/70 to-cc-gold transition-all duration-500"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
