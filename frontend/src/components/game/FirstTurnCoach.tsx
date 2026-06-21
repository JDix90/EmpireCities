/**
 * Coached first turn (WI1) — a single dismissible card overlaid on the real game
 * (not a separate tutorial) for brand-new players' first turn on the globe.
 * Mirrors TutorialOverlay's visual recipe + reuses its renderTutorialText; the
 * wrapper is pointer-events-none / inner pointer-events-auto so it never blocks
 * globe drag. Gating + which phase to show live in GamePage / firstTurnCoach.ts.
 */
import React from 'react';
import { GraduationCap, X } from 'lucide-react';
import clsx from 'clsx';
import { isMobileViewport } from '../../utils/device';
import { renderTutorialText } from './TutorialOverlay';
import type { CoachPhase } from '../../utils/firstTurnCoach';

interface CoachCopy {
  title: string;
  body: string;
  hint: string;
}

function copyFor(phase: CoachPhase, unitsToPlace?: number): CoachCopy {
  switch (phase) {
    case 'reinforcement':
      return {
        title: 'Place your reinforcements',
        body:
          unitsToPlace != null
            ? `You have **${unitsToPlace}** ${unitsToPlace === 1 ? 'unit' : 'units'} to place. Tap one of your glowing territories, then confirm.`
            : 'You have **new units** to place. Tap one of your glowing territories, then confirm.',
        hint: 'Stacking units near enemies sets up your attacks.',
      };
    case 'attack':
      return {
        title: 'Attack a neighbor',
        body: 'Tap one of your territories with **2+ units**, then pick a red **Attack** target from the list.',
        hint: 'You can keep attacking until you choose to stop.',
      };
    case 'fortify':
      return {
        title: 'Move your troops',
        body: 'Shift units toward your front line between connected territories, then **End Turn**.',
        hint: 'Only territories you own that connect can trade troops.',
      };
  }
}

export interface FirstTurnCoachProps {
  phase: CoachPhase;
  unitsToPlace?: number;
  playerColorName?: string;
  onDismiss: () => void;
}

export default function FirstTurnCoach({
  phase,
  unitsToPlace,
  playerColorName,
  onDismiss,
}: FirstTurnCoachProps) {
  const { title, body, hint } = copyFor(phase, unitsToPlace);
  const anchorTop = isMobileViewport();

  return (
    <div className="fixed inset-0 pointer-events-none z-40" data-testid="first-turn-coach">
      <div
        className={clsx(
          'pointer-events-auto w-full px-4',
          anchorTop
            ? 'absolute left-1/2 -translate-x-1/2 max-w-md top-[calc(env(safe-area-inset-top,0px)+3.25rem)]'
            : 'absolute bottom-20 left-1/2 -translate-x-1/2 max-w-md mx-4',
        )}
      >
        <div
          className={clsx(
            'rounded-xl border border-bf-gold/30 bg-bf-surface/95 backdrop-blur-sm shadow-2xl',
            anchorTop ? 'p-3' : 'p-5',
          )}
        >
          <div className="flex items-start justify-between gap-2 mb-1">
            <span className="text-[10px] text-bf-muted/60 uppercase tracking-widest">First turn</span>
            <button
              type="button"
              onClick={onDismiss}
              data-testid="first-turn-coach-dismiss"
              aria-label="Dismiss"
              className="-mt-1 -mr-1 p-1 text-bf-muted/70 hover:text-bf-text transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="flex items-center gap-2 mb-2">
            <GraduationCap className="w-5 h-5 text-bf-gold shrink-0" />
            <h3 className="font-display text-lg text-bf-gold">{title}</h3>
          </div>

          <p className={clsx('text-bf-muted leading-relaxed mb-2', anchorTop ? 'text-xs' : 'text-sm')}>
            {renderTutorialText(body, playerColorName)}
          </p>
          <p className={clsx('text-bf-muted/60 italic', anchorTop ? 'text-[11px]' : 'text-xs')}>
            {renderTutorialText(hint, playerColorName)}
          </p>

          <button
            type="button"
            onClick={onDismiss}
            className={clsx('btn-secondary w-full mt-3', anchorTop ? 'text-xs py-1.5' : 'text-sm')}
          >
            Got it
          </button>
        </div>
      </div>
    </div>
  );
}
