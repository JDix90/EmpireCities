import { Bot, WifiOff } from 'lucide-react';
import clsx from 'clsx';

interface AiBadgeProps {
  /** Optional AI difficulty (easy/medium/hard/expert/tutorial); appended as a suffix when present. */
  difficulty?: string | null;
  size?: 'xs' | 'sm';
  /** When false, renders just the icon + difficulty without the "BOT" word (for tight inline rows). */
  showLabel?: boolean;
  /**
   * Away variant: this seat is a *disconnected human* whose turns the AI is
   * temporarily covering (reclaimable on reconnect) — distinct from a real bot.
   */
  away?: boolean;
  className?: string;
}

function formatDifficulty(difficulty?: string | null): string | null {
  if (!difficulty) return null;
  if (difficulty === 'tutorial') return 'Practice';
  return difficulty.charAt(0).toUpperCase() + difficulty.slice(1);
}

/**
 * Unified, confident visual identity for AI opponents. Sky/cyan reads as "machine"
 * and stays distinct from the gold "you"/host highlight used elsewhere. The amber
 * `away` variant marks a disconnected human the AI is covering for.
 */
export function AiBadge({ difficulty, size = 'sm', showLabel = true, away = false, className }: AiBadgeProps) {
  const iconCls = size === 'xs' ? 'w-3 h-3' : 'w-3.5 h-3.5';
  if (away) {
    return (
      <span
        className={clsx(
          'inline-flex items-center gap-1 rounded border border-amber-400/30 bg-amber-400/10 font-medium uppercase tracking-wide text-amber-300',
          size === 'xs' ? 'px-1 py-0.5 text-[10px]' : 'px-1.5 py-0.5 text-xs',
          className,
        )}
        title="Disconnected — AI is covering their turns until they return"
      >
        <WifiOff className={iconCls} aria-hidden />
        {showLabel ? 'AWAY' : null}
      </span>
    );
  }
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
      <Bot className={iconCls} aria-hidden />
      {showLabel ? 'BOT' : null}
      {diff ? <span className="font-normal normal-case opacity-80">{showLabel ? `· ${diff}` : diff}</span> : null}
    </span>
  );
}
