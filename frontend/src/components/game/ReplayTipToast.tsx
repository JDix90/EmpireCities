import React, { useEffect } from 'react';
import clsx from 'clsx';
import { Lightbulb, X } from 'lucide-react';
import type { ReplayInsight } from './ReplayInsightsPanel';

interface ReplayTipToastProps {
  insight: ReplayInsight;
  /** Auto-dismiss after this many ms (set to 0 to disable). */
  autoDismissMs?: number;
  onClose: () => void;
  /**
   * The phone's form: sits at the foot of the map it is rendered in rather than
   * at a fixed height above the bottom of the screen (a phone's playback
   * controls are taller than that height, so the fixed card covered the play
   * button), and keeps to the title and what to try. The full card covered most
   * of a phone's map; the whole tip is a tap away in the tips panel.
   */
  docked?: boolean;
}

/** Bottom-center floating tip card that appears when playback enters a coached turn. */
export default function ReplayTipToast({
  insight,
  autoDismissMs = 7000,
  onClose,
  docked,
}: ReplayTipToastProps) {
  useEffect(() => {
    if (!autoDismissMs) return;
    const timer = setTimeout(onClose, autoDismissMs);
    return () => clearTimeout(timer);
  }, [insight, autoDismissMs, onClose]);

  return (
    <div
      role="status"
      aria-live="polite"
      className={clsx(
        'left-1/2 -translate-x-1/2 z-40 max-w-md pointer-events-auto',
        docked ? 'absolute bottom-2 w-[calc(100%-1rem)]' : 'fixed bottom-28 w-[calc(100%-2rem)]',
      )}
    >
      <div className={clsx('rounded-xl border border-amber-500/40 bg-bf-surface/95 shadow-2xl backdrop-blur-sm', docked ? 'p-3' : 'p-4')}>
        <div className="flex items-start gap-3">
          <div className="shrink-0 mt-0.5">
            <Lightbulb
              className={
                insight.impact === 'high'
                  ? 'w-5 h-5 text-amber-400'
                  : 'w-5 h-5 text-bf-gold'
              }
            />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-[10px] uppercase tracking-wider text-bf-muted">Turn {insight.turn}</span>
              {insight.impact === 'high' && (
                <span className="text-[10px] uppercase tracking-wider text-amber-400 bg-amber-500/10 border border-amber-500/30 rounded px-1.5 py-0.5">
                  High impact
                </span>
              )}
            </div>
            <p className={clsx('text-sm text-bf-text font-medium', docked ? 'mb-1' : 'mb-1.5')}>{insight.title}</p>
            <p className={clsx('text-xs text-bf-muted leading-relaxed mb-2', docked && 'hidden')}>{insight.explanation}</p>
            <p className={clsx('text-xs text-amber-200/90', docked ? 'leading-snug line-clamp-2' : 'leading-relaxed')}>
              <span className="text-amber-400 font-medium">Try instead: </span>
              {insight.alternative}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Dismiss tip"
            className="tap-target shrink-0 p-1 rounded text-bf-muted hover:text-bf-text hover:bg-white/5 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
