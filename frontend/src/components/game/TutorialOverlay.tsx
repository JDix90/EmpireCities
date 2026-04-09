import React from 'react';
import { GraduationCap } from 'lucide-react';

interface TutorialStep {
  id: string;
  title: string;
  message: string;
  hint?: string;
  requireAction?: string;
  /** Final card: two actions instead of a single Next */
  variant?: 'wrapup';
}

const TUTORIAL_STEPS: TutorialStep[] = [
  {
    id: 'welcome',
    title: 'Welcome, Commander!',
    message: 'This quick tutorial teaches you the core mechanics of Eras of Empire. Each turn has three phases: Draft, Attack, and Fortify.',
    hint: 'Click "Next" to continue.',
  },
  {
    id: 'draft_explain',
    title: 'Reinforcement Phase',
    message: 'You receive units based on how many territories you hold plus continent bonuses. Place them on your territories to strengthen your positions.',
  },
  {
    id: 'draft_do',
    title: 'Place Your Units',
    message: 'Click one of your territories on the map to place your reinforcements there.',
    requireAction: 'draft',
  },
  {
    id: 'attack_explain',
    title: 'Attack Phase',
    message: 'Attack adjacent enemy territories by clicking your territory first, then the target. You need at least 2 units to attack. Dice determine the outcome.',
  },
  {
    id: 'attack_do',
    title: 'Launch an Attack!',
    message:
      'Click your territory then an adjacent enemy territory to attack. When you are done attacking, the tutorial will move you to the fortify phase automatically (same as the "Begin Fortify Phase" control on the right).',
    hint: 'You can make several attacks; we will advance after your first battle, or shortly if you skip attacking.',
    requireAction: 'end_phase',
  },
  {
    id: 'fortify_explain',
    title: 'Fortify Phase',
    message: 'Move units between your connected territories to shore up defenses. You can fortify once, or skip.',
    requireAction: 'end_phase',
  },
  {
    id: 'opponent_turn',
    title: 'Opponent turns',
    message:
      'When it is not your turn, opponents act automatically: they reinforce, attack, and fortify. Follow along in the combat log and watch which player is highlighted in the sidebar. You will see their dice rolls and territory changes just like on your own turn.',
    requireAction: 'my_turn',
  },
  {
    id: 'wrapup',
    title: 'Tutorial complete',
    message:
      'You can keep playing this practice match as long as you like, or return to the lobby for other modes. Tutorial matches are not kept in your "resume" list on the dashboard.',
    variant: 'wrapup',
  },
];


interface TutorialOverlayProps {
  stepIndex: number;
  onAdvance: () => void;
  onContinuePlaying: () => void;
  onReturnToLobby: () => void;
  centered?: boolean;
}

export default function TutorialOverlay({
  stepIndex,
  onAdvance,
  onContinuePlaying,
  onReturnToLobby,
  centered = false,
}: TutorialOverlayProps) {
  const step = TUTORIAL_STEPS[stepIndex];
  if (!step) return null;

  return (
    <div className="fixed inset-0 z-50 pointer-events-none">
      <div className="absolute inset-0 bg-black/30 pointer-events-none" aria-hidden />
      <div
        className={
          centered
            ? 'absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-auto w-full max-w-lg px-4'
            : 'absolute bottom-20 left-1/2 -translate-x-1/2 pointer-events-auto max-w-sm w-full mx-4'
        }
      >
        <div
          className={
            centered
              ? 'rounded-2xl border-2 border-cc-gold/40 bg-[#1a1a2e]/95 backdrop-blur-lg p-8 shadow-2xl text-center'
              : 'rounded-xl border border-cc-gold/30 bg-[#1a1a2e]/95 backdrop-blur-sm p-5 shadow-2xl'
          }
        >
          <div className={centered ? 'flex flex-col items-center gap-3 mb-4' : 'flex items-center gap-2 mb-3'}>
            <GraduationCap className={centered ? 'w-8 h-8 text-cc-gold' : 'w-5 h-5 text-cc-gold'} />
            <h3 className={centered ? 'font-display text-2xl text-cc-gold' : 'font-display text-lg text-cc-gold'}>{step.title}</h3>
          </div>
          <p className={centered ? 'text-cc-muted text-lg leading-relaxed mb-4' : 'text-cc-muted text-sm leading-relaxed mb-3'}>{step.message}</p>
          {step.hint && (
            <p className={centered ? 'text-cc-muted/70 text-base italic mb-4' : 'text-cc-muted/60 text-xs italic mb-3'}>{step.hint}</p>
          )}
          {step.variant === 'wrapup' ? (
            <div className="flex flex-col gap-2 mt-2">
              <button type="button" onClick={onContinuePlaying} className="btn-primary text-base w-full">
                Continue playing
              </button>
              <button type="button" onClick={onReturnToLobby} className="btn-secondary text-base w-full">
                Return to lobby
              </button>
            </div>
          ) : !step.requireAction ? (
            <button type="button" onClick={onAdvance} className="btn-primary text-base w-full">
              Next
            </button>
          ) : (
            <p className="text-cc-gold/80 text-base text-center animate-pulse">
              Perform the action above to continue...
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

export { TUTORIAL_STEPS };
