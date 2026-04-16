import React from 'react';
import clsx from 'clsx';
import { Flame, Trophy, Calendar } from 'lucide-react';

interface StreakBadgeProps {
  type: 'win' | 'daily';
  count: number;
  className?: string;
}

export default function StreakBadge({ type, count, className }: StreakBadgeProps) {
  if (count <= 0) return null;

  const isWin = type === 'win';
  const Icon = isWin ? Trophy : Calendar;
  const label = isWin ? 'Win streak' : 'Daily streak';
  const colorClass = isWin ? 'text-orange-400 border-orange-400/30 bg-orange-400/10' : 'text-blue-400 border-blue-400/30 bg-blue-400/10';

  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-bold border',
        colorClass,
        className,
      )}
      title={`${label}: ${count}`}
    >
      {count >= 3 ? <Flame size={12} /> : <Icon size={12} />}
      {count}
    </span>
  );
}
