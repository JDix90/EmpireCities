import React, { useEffect } from 'react';
import { Check, Dices, Undo2 } from 'lucide-react';
import {
  commitLabel,
  describeProposal,
  describeStoredAction,
  verdictCopy,
  type PuzzleProposal,
  type PuzzleVerdict,
} from '../../utils/dailyPuzzleV2';

interface PuzzleVerdictCardProps {
  proposal: PuzzleProposal;
  verdict: PuzzleVerdict;
  nameOf: (id: string) => string;
  /** Commit the held move: an attack rolls the seeded dice, anything else just plays. */
  onRoll: () => void;
  /** Drop the held move: play continues from the same position. */
  onTakeBack: () => void;
}

/**
 * Daily v2's verdict before the dice (docs/DAILY_PUZZLE_V2.md §3): the board
 * answers a move that matters, and the player commits it or takes it back.
 * Blocks the map until one is chosen; Escape takes it back.
 */
export default function PuzzleVerdictCard({ proposal, verdict, nameOf, onRoll, onTakeBack }: PuzzleVerdictCardProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onTakeBack();
      if (e.key === 'Enter') onRoll();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onRoll, onTakeBack]);

  const copy = verdictCopy(verdict);
  const grade = verdict.grade ?? 'best';
  const tone = grade === 'best'
    ? 'border-emerald-600/60 bg-emerald-950/85 text-emerald-50'
    : grade === 'good'
      ? 'border-sky-600/60 bg-sky-950/85 text-sky-50'
      : grade === 'inaccuracy'
        ? 'border-amber-600/60 bg-amber-950/85 text-amber-50'
        : 'border-red-700/60 bg-red-950/85 text-red-50';

  return (
    <div
      className="absolute inset-0 z-30 flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-[2px] px-3 pb-4 sm:pb-0"
      role="dialog"
      aria-modal="true"
      aria-labelledby="puzzle-verdict-question"
      data-testid="puzzle-verdict-card"
    >
      <div className={`w-full max-w-md rounded-xl border p-4 shadow-2xl animate-fade-in ${tone}`}>
        <p className="text-[10px] uppercase tracking-[0.2em] opacity-70 mb-1">A decision</p>
        <p id="puzzle-verdict-question" className="font-display text-lg leading-snug">{describeProposal(proposal, nameOf)}</p>
        <p className="mt-2 text-sm leading-relaxed">{copy.body}</p>
        <p className="mt-1 text-xs font-semibold uppercase tracking-wide opacity-90">{copy.tag}</p>
        {verdict.best && (
          <p className="mt-2 text-sm">
            <span className="opacity-70">Best here: </span>
            <span className="font-medium">{describeStoredAction(verdict.best, nameOf)}</span>
          </p>
        )}
        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={onRoll}
            className="flex-1 inline-flex items-center justify-center gap-2 rounded-lg bg-white/15 hover:bg-white/25 border border-white/20 px-3 py-2.5 text-sm font-medium"
            autoFocus
          >
            {proposal.kind === 'attack' ? <Dices className="w-4 h-4" /> : <Check className="w-4 h-4" />}
            {commitLabel(proposal, grade)}
          </button>
          <button
            type="button"
            onClick={onTakeBack}
            className="flex-1 inline-flex items-center justify-center gap-2 rounded-lg bg-black/25 hover:bg-black/35 border border-white/10 px-3 py-2.5 text-sm font-medium"
          >
            <Undo2 className="w-4 h-4" /> Take it back
          </button>
        </div>
        <p className="mt-2 text-[11px] opacity-70">{copy.takebackNote}</p>
      </div>
    </div>
  );
}
