import { Compass, Crown, Eye, Flame, Shield, type LucideIcon } from 'lucide-react';
import clsx from 'clsx';
import { AI_STYLE_LABELS, type AiStyle } from '@borderfall/shared';

const STYLE_ICONS: Record<AiStyle, LucideIcon> = {
  conqueror: Crown,
  raider: Flame,
  expansionist: Compass,
  opportunist: Eye,
  defender: Shield,
};

interface AiStyleBadgeProps {
  style: AiStyle;
  size?: 'xs' | 'sm';
  /** When false, renders just the icon (for tight rows); the style still reads on hover. */
  showLabel?: boolean;
  className?: string;
}

/**
 * A bot commander's style (backend ai/aiStyles.ts): how it plays, beside the
 * AiBadge that says how well. Its title says what the style does.
 */
export function AiStyleBadge({ style, size = 'sm', showLabel = true, className }: AiStyleBadgeProps) {
  const Icon = STYLE_ICONS[style];
  const label = AI_STYLE_LABELS[style];
  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1 rounded border border-violet-400/30 bg-violet-400/10 font-medium text-violet-200',
        size === 'xs' ? 'px-1 py-0.5 text-[10px]' : 'px-1.5 py-0.5 text-xs',
        className,
      )}
      title={`${label.name}: ${label.blurb}`}
      aria-label={`${label.name}: ${label.blurb}`}
    >
      <Icon className={size === 'xs' ? 'w-3 h-3' : 'w-3.5 h-3.5'} aria-hidden />
      {showLabel ? label.name : null}
    </span>
  );
}
