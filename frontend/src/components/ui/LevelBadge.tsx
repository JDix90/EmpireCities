import React from 'react';
import clsx from 'clsx';
import { getLevel } from '@erasofempire/shared';

interface LevelBadgeProps {
  xp: number;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

const SIZE_CLASSES = {
  sm: 'w-6 h-6 text-[10px]',
  md: 'w-8 h-8 text-xs',
  lg: 'w-10 h-10 text-sm',
} as const;

export default function LevelBadge({ xp, size = 'md', className }: LevelBadgeProps) {
  const level = getLevel(xp);
  return (
    <div
      className={clsx(
        'inline-flex items-center justify-center rounded-full bg-cc-gold/20 border border-cc-gold/40 text-cc-gold font-bold font-display',
        SIZE_CLASSES[size],
        className,
      )}
      title={`Level ${level}`}
    >
      {level}
    </div>
  );
}
