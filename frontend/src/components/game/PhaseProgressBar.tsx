import React from 'react';
import clsx from 'clsx';
import { Shield, Sword, ArrowRight, Flag, Check } from 'lucide-react';
import { TURN_PHASE_ORDER, PHASE_SHORT_LABELS } from '../../constants/phaseLabels';

/**
 * Persistent "Reinforce → Attack → Fortify → End Turn" stepper for the HUD
 * header. Shows completed phases (checked), the current phase (prominent), and
 * upcoming phases (muted) so a player can always see where they are in the turn.
 *
 * Purely presentational and driven entirely by the authoritative `phase` from
 * game:state — it does no rules logic and holds no state. Flag-gating lives at
 * the mount site (GameHUD) so this stays trivially testable.
 *
 * Renders nothing outside the per-turn cycle (territory_select / game_over),
 * since those phases don't fit the three-step model.
 */

type StepStatus = 'done' | 'active' | 'upcoming';

const STEP_ICONS: Record<string, React.ReactNode> = {
  draft: <Shield className="w-3.5 h-3.5" aria-hidden="true" />,
  attack: <Sword className="w-3.5 h-3.5" aria-hidden="true" />,
  fortify: <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />,
};

interface PhaseStep {
  key: string;
  label: string;
  icon: React.ReactNode;
  status: StepStatus;
}

interface PhaseProgressBarProps {
  phase: string;
  isMyTurn?: boolean;
  variant?: 'full' | 'compact';
  className?: string;
}

export function PhaseProgressBar({
  phase,
  isMyTurn = false,
  variant = 'full',
  className,
}: PhaseProgressBarProps) {
  const currentIndex = (TURN_PHASE_ORDER as readonly string[]).indexOf(phase);
  // Only render during the repeating turn cycle. The opening land grab and the
  // end-of-game screen have no meaningful "next phase" to show.
  if (currentIndex === -1) return null;

  const steps: PhaseStep[] = TURN_PHASE_ORDER.map((key, i) => ({
    key,
    label: PHASE_SHORT_LABELS[key] ?? key,
    icon: STEP_ICONS[key],
    status: i < currentIndex ? 'done' : i === currentIndex ? 'active' : 'upcoming',
  }));
  // Terminal "End Turn" node — becomes the highlighted next action on fortify.
  const endTurnActiveNext = currentIndex === TURN_PHASE_ORDER.length - 1;
  steps.push({
    key: 'end_turn',
    label: 'End Turn',
    icon: <Flag className="w-3.5 h-3.5" aria-hidden="true" />,
    status: 'upcoming',
  });

  return (
    <ol
      className={clsx(
        'flex items-center gap-1 text-[11px] font-medium select-none',
        !isMyTurn && 'opacity-60',
        className,
      )}
      aria-label="Turn phases"
    >
      {steps.map((step, i) => {
        const isActive = step.status === 'active';
        const isDone = step.status === 'done';
        const isEndTurnNext = step.key === 'end_turn' && endTurnActiveNext;
        // In compact mode, only the active step shows its text label; the rest
        // stay icon-only to fit a narrow drawer. Full mode always shows labels.
        const showLabel = variant === 'full' || isActive;
        return (
          <React.Fragment key={step.key}>
            {i > 0 && (
              <span className="text-bf-muted/50" aria-hidden="true">
                ›
              </span>
            )}
            <li
              className={clsx(
                'flex items-center gap-1 rounded px-1.5 py-0.5 whitespace-nowrap transition-colors',
                isActive && 'bg-bf-gold/15 text-bf-gold',
                isDone && 'text-emerald-400/80',
                step.status === 'upcoming' && !isEndTurnNext && 'text-bf-muted',
                isEndTurnNext && 'text-bf-gold/70',
              )}
              aria-current={isActive ? 'step' : undefined}
            >
              {isDone ? <Check className="w-3.5 h-3.5" aria-hidden="true" /> : step.icon}
              {showLabel && <span>{step.label}</span>}
              {/* Non-visual status cue so completion/current isn't color-only. */}
              <span className="sr-only">
                {isDone ? ' (done)' : isActive ? ' (current phase)' : ' (upcoming)'}
              </span>
            </li>
          </React.Fragment>
        );
      })}
    </ol>
  );
}
