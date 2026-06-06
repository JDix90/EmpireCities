import { Bot } from 'lucide-react';
import clsx from 'clsx';

interface AiBadgeProps {
  /** Optional AI difficulty (easy/medium/hard/expert/tutorial); appended as a suffix when present. */
  difficulty?: string | null;
  size?: 'xs' | 'sm';
  /** When false, renders just the icon + difficulty without the "BOT" word (for tight inline rows). */
  showLabel?: boolean;
  className?: string;
}

function formatDifficulty(difficulty?: string | null): string | null {
  if (!difficulty) return null;
  if (difficulty === 'tutorial') return 'Practice';
  return difficulty.charAt(0).toUpperCase() + difficulty.slice(1);
}

/**
 * Unified, confident visual identity for AI opponents. Sky/cyan reads as "machine"
 * and stays distinct from the gold "you"/host highlight used elsewhere.
 */
export function AiBadge({ difficulty, size = 'sm', showLabel = true, className }: AiBadgeProps) {
  const diff = formatDifficulty(difficulty);
  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1 rounded border border-sky-400/30 bg-sky-400/10 font-medium uppercase tracking-wide text-sky-300',
        size === 'xs' ? 'px-1 py-0.5 text-[10px]' : 'px-1.5 py-0.5 text-xs',
        className,
      )}
      title={diff ? `AI opponent · ${diff}` : 'AI opponent'}
    >
      <Bot className={size === 'xs' ? 'w-3 h-3' : 'w-3.5 h-3.5'} aria-hidden />
      {showLabel ? 'BOT' : null}
      {diff ? <span className="font-normal normal-case opacity-80">{showLabel ? `· ${diff}` : diff}</span> : null}
    </span>
  );
}
