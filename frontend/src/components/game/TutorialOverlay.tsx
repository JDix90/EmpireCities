import React from 'react';
import { GraduationCap } from 'lucide-react';

interface TutorialStep {
  id: string;
  title: string;
  message: string;
  /** Extra detail shown smaller — keeps main message punchy */
  detail?: string;
  hint?: string;
  requireAction?: string;
  /** Final card: two actions instead of a single Next */
  variant?: 'wrapup';
}

const TUTORIAL_STEPS: TutorialStep[] = [
  // ── Welcome ────────────────────────────────────────────────
  {
    id: 'welcome',
    title: 'Welcome, Commander!',
    message: 'Eras of Empire is a strategy game of territory control. Each turn has three phases: Draft → Attack → Fortify. Your goal is to conquer the map — or complete a secret mission.',
    hint: 'Played Risk before? You\'ll feel right at home. Click "Next" to learn the details, or "Skip Tutorial" to jump straight in.',
  },

  // ── Reinforcements ────────────────────────────────────────
  {
    id: 'draft_explain',
    title: 'Draft Phase — Reinforcements',
    message: 'At the start of your turn you receive new units. The formula: 1 unit per 3 territories you hold (minimum 3), plus bonuses for controlling entire continents.',
    detail: 'Later you may also earn bonus units from card sets, technologies, and buildings — but those are optional features you can enable when creating a game.',
  },
  {
    id: 'draft_do',
    title: 'Place Your Units',
    message: 'Click one of your territories on the map to place reinforcements there. You can spread them across multiple territories or stack them on one.',
    requireAction: 'draft',
  },

  // ── Combat ────────────────────────────────────────────────
  {
    id: 'attack_explain',
    title: 'Attack Phase — Combat',
    message: 'Click one of your territories (must have 2+ units), then click an adjacent enemy territory to attack. Combat is resolved with dice.',
    detail: 'Attacker rolls up to 3 dice, defender up to 2. Highest dice are compared pair-by-pair — the loser of each pair loses a unit. Ties go to the defender. You capture a territory when its last defender falls.',
  },
  {
    id: 'attack_do',
    title: 'Launch an Attack!',
    message: 'Try attacking an adjacent enemy territory now. You can attack as many times as you like in one turn — or skip attacking entirely.',
    hint: 'The tutorial will advance you to the next phase after your first battle or a short wait.',
    requireAction: 'end_phase',
  },

  // ── Fortify ───────────────────────────────────────────────
  {
    id: 'fortify_explain',
    title: 'Fortify Phase — Reposition',
    message: 'Move units between your connected territories to shore up defenses or prepare for next turn. You can fortify once per turn, or skip.',
    requireAction: 'end_phase',
  },

  // ── Cards ─────────────────────────────────────────────────
  {
    id: 'cards_explain',
    title: 'Territory Cards',
    message: 'Each turn you capture at least one territory, you draw a card (Infantry, Cavalry, or Artillery). Collect a matching set of 3 to trade for bonus units during your Draft phase.',
    detail: 'Valid sets: three of a kind, or one of each type. Wild cards match anything. Each trade-in gives more units than the last (4 → 6 → 8 → 10 → …), so timing matters.',
  },

  // ── Victory ───────────────────────────────────────────────
  {
    id: 'victory_explain',
    title: 'How to Win',
    message: 'The default goal is world domination — capture every territory. But the host can choose other victory conditions when creating a game.',
    detail: 'Options include: Threshold (own a set percentage of the map), Capital Conquest (capture all capitals), and Secret Missions (each player gets a hidden objective like "eliminate Player 3" or "control two continents").',
  },

  // ── Opponent turn ─────────────────────────────────────────
  {
    id: 'opponent_turn',
    title: 'Opponent Turns',
    message: 'When it\'s not your turn, watch the action unfold. You\'ll see enemy dice rolls, territory changes, and combat results in real time. The active player is highlighted in the sidebar.',
    requireAction: 'my_turn',
  },

  // ── Game settings overview ────────────────────────────────
  {
    id: 'settings_overview',
    title: 'Game Modes & Options',
    message: 'When you create a game, you can customize the experience. Choose an era (Ancient → Modern), add AI opponents, set turn timers, toggle fog of war, and enable advanced features.',
    detail: 'Advanced features include: Economy & Buildings, Technology Trees, Naval Warfare, Historical Events, Factions, and Population & Stability. Each can be toggled independently — start simple and add complexity as you like.',
  },

  // ── Wrap-up ───────────────────────────────────────────────
  {
    id: 'wrapup',
    title: 'You\'re Ready!',
    message: 'That covers the essentials. Keep playing this practice match to hone your strategy, or head to the lobby to start a real game. Check "How to Play" in the menu anytime for a full rules reference.',
    variant: 'wrapup',
  },
];


interface TutorialOverlayProps {
  stepIndex: number;
  onAdvance: () => void;
  onContinuePlaying: () => void;
  onReturnToLobby: () => void;
  onSkipTutorial?: () => void;
  centered?: boolean;
}

export default function TutorialOverlay({
  stepIndex,
  onAdvance,
  onContinuePlaying,
  onReturnToLobby,
  onSkipTutorial,
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
            : 'absolute bottom-20 left-1/2 -translate-x-1/2 pointer-events-auto max-w-md w-full mx-4'
        }
      >
        <div
          className={
            centered
              ? 'rounded-2xl border-2 border-cc-gold/40 bg-[#1a1a2e]/95 backdrop-blur-lg p-8 shadow-2xl text-center'
              : 'rounded-xl border border-cc-gold/30 bg-[#1a1a2e]/95 backdrop-blur-sm p-5 shadow-2xl'
          }
        >
          {/* Step counter */}
          <div className={`flex items-center justify-between mb-1 ${centered ? 'px-1' : ''}`}>
            <span className="text-[10px] text-cc-muted/60 uppercase tracking-widest">
              Step {stepIndex + 1} / {TUTORIAL_STEPS.length}
            </span>
            {onSkipTutorial && step.variant !== 'wrapup' && (
              <button
                type="button"
                onClick={onSkipTutorial}
                className="text-[10px] text-cc-muted/60 hover:text-cc-text transition-colors uppercase tracking-wider"
              >
                Skip Tutorial
              </button>
            )}
          </div>

          <div className={centered ? 'flex flex-col items-center gap-3 mb-4' : 'flex items-center gap-2 mb-3'}>
            <GraduationCap className={centered ? 'w-8 h-8 text-cc-gold' : 'w-5 h-5 text-cc-gold'} />
            <h3 className={centered ? 'font-display text-2xl text-cc-gold' : 'font-display text-lg text-cc-gold'}>{step.title}</h3>
          </div>
          <p className={centered ? 'text-cc-muted text-lg leading-relaxed mb-2' : 'text-cc-muted text-sm leading-relaxed mb-2'}>{step.message}</p>
          {step.detail && (
            <p className={centered ? 'text-cc-muted/70 text-sm leading-relaxed mb-4' : 'text-cc-muted/60 text-xs leading-relaxed mb-3'}>{step.detail}</p>
          )}
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
              Perform the action above to continue…
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

export { TUTORIAL_STEPS };
