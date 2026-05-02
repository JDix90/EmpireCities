import React from 'react';
import clsx from 'clsx';
import { Lightbulb, ChevronRight, Sparkles } from 'lucide-react';

export interface ReplayInsight {
  turn: number;
  title: string;
  impact: 'high' | 'medium';
  explanation: string;
  alternative: string;
}

interface ReplayInsightsPanelProps {
  insights: ReplayInsight[];
  currentTurn: number;
  /** Called with a turn number when the user clicks an insight item. */
  onJumpToTurn: (turn: number) => void;
  /** Called when the user wants to (re-)open the toast for an insight. */
  onShowTip: (insight: ReplayInsight) => void;
  loading?: boolean;
}

/** Sidebar listing every coaching tip, with click-to-jump to the relevant turn. */
export default function ReplayInsightsPanel({
  insights,
  currentTurn,
  onJumpToTurn,
  onShowTip,
  loading,
}: ReplayInsightsPanelProps) {
  return (
    <div className="rounded-xl border border-cc-border bg-cc-surface/85 backdrop-blur-sm w-72 max-w-[80vw] flex flex-col max-h-[70vh] overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-cc-border">
        <Sparkles className="w-4 h-4 text-cc-gold" />
        <p className="font-display text-sm text-cc-gold tracking-wide">Coaching Tips</p>
        <span className="ml-auto text-xs text-cc-muted tabular-nums">{insights.length}</span>
      </div>

      {loading ? (
        <p className="px-4 py-6 text-sm text-cc-muted text-center animate-pulse">
          Generating coaching tips…
        </p>
      ) : insights.length === 0 ? (
        <p className="px-4 py-6 text-sm text-cc-muted text-center">
          Coaching tips weren&apos;t generated for this match.
        </p>
      ) : (
        <ul className="overflow-y-auto divide-y divide-cc-border/60">
          {insights.map((tip, idx) => {
            const isCurrent = currentTurn === tip.turn;
            return (
              <li key={`${tip.turn}-${idx}`}>
                <button
                  type="button"
                  onClick={() => {
                    onJumpToTurn(tip.turn);
                    onShowTip(tip);
                  }}
                  className={clsx(
                    'w-full text-left px-4 py-3 transition-colors flex items-start gap-2 group',
                    isCurrent
                      ? 'bg-cc-gold/10 border-l-2 border-cc-gold'
                      : 'hover:bg-white/5 border-l-2 border-transparent',
                  )}
                >
                  <div className="mt-0.5">
                    <Lightbulb
                      className={clsx(
                        'w-4 h-4 shrink-0',
                        tip.impact === 'high' ? 'text-amber-400' : 'text-cc-muted',
                      )}
                    />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="text-[10px] uppercase tracking-wider text-cc-muted">Turn {tip.turn}</span>
                      {tip.impact === 'high' && (
                        <span className="text-[10px] uppercase tracking-wider text-amber-400 bg-amber-500/10 border border-amber-500/30 rounded px-1.5 py-0.5">
                          High impact
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-cc-text font-medium leading-tight mb-1">{tip.title}</p>
                    <p className="text-xs text-cc-muted leading-snug line-clamp-2">{tip.explanation}</p>
                  </div>
                  <ChevronRight className="w-4 h-4 text-cc-muted/50 group-hover:text-cc-gold transition-colors shrink-0" />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
