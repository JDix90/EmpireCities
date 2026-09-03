import React, { useState } from 'react';
import { GraduationCap, ChevronDown, ChevronRight, X } from 'lucide-react';
import clsx from 'clsx';
import { isMobileViewport } from '../../utils/device';
import {
  TUTORIAL_MODULES,
  TUTORIAL_V2_ENABLED,
  type TutorialLessonModule,
  type TutorialStep,
} from '../../tutorial';
import { getCompletedTutorialModules } from '../../tutorial/progression';

export type { TutorialStep };

/**
 * Render tutorial copy with **bold** emphasis and the {playerColor} token.
 * The step definitions use markdown-style bold; rendering the asterisks
 * literally looked broken at the exact moment we're trying to build trust.
 */
export function renderTutorialText(text: string, playerColorName?: string): React.ReactNode {
  const withColor = playerColorName ? text.split('{playerColor}').join(playerColorName) : text;
  const parts = withColor.split('**');
  if (parts.length === 1) return withColor;
  return parts.map((part: string, i: number) =>
    i % 2 === 1 ? <strong key={i} className="text-bf-text font-semibold">{part}</strong> : part,
  );
}

const OPTIONAL_MODULES: TutorialLessonModule[] = [
  'advanced_settings',
  'faction_ability',
  'tech_tree',
];

interface TutorialOverlayProps {
  steps: TutorialStep[];
  stepIndex: number;
  lessonModule: TutorialLessonModule;
  onAdvance: () => void;
  onContinuePlaying: () => void;
  onReturnToLobby: () => void;
  onExitTutorial?: () => void;
  onLaunchModule?: (module: TutorialLessonModule) => void;
  onOpenTechTree?: () => void;
  onOpenBonuses?: () => void;
  onOpenSettingsLab?: () => void;
  onMarkModuleComplete?: () => void;
  /** Jump straight to the wrap-up step (rendered on the welcome step only). */
  onSkipToEnd?: () => void;
  /**
   * The player got here via "Skip to the end". A step that carries
   * `skippedTitle`/`skippedMessage` shows those instead, so the wrap-up never
   * congratulates a player on a turn cycle they didn't run.
   */
  skipped?: boolean;
  /** Human-readable name of the local player's color (fills {playerColor} in step copy). */
  playerColorName?: string;
  centered?: boolean;
  /**
   * A blocking ActionModal (combat result, turn summary, …) is open. When true
   * the coaching popup drops behind that modal's dimming backdrop so it never
   * covers the modal's action buttons; it re-emerges once the modal is
   * dismissed. Combat results are the common collision (the popup docks
   * bottom-center, right where the result modal's Continue/Attack-again buttons
   * sit).
   */
  behindModal?: boolean;
  /**
   * A full-screen game panel (tech tree, bonuses, settings lab) is open. Unlike
   * `behindModal` the card must stay on top and readable — its copy is what
   * tells the player what to do inside that panel — so it docks out of the
   * panel's way instead of dropping behind it.
   */
  panelOpen?: boolean;
}

export default function TutorialOverlay({
  steps,
  stepIndex,
  lessonModule,
  onAdvance,
  onContinuePlaying,
  onReturnToLobby,
  onExitTutorial,
  onLaunchModule,
  onOpenTechTree,
  onOpenBonuses,
  onOpenSettingsLab,
  onMarkModuleComplete,
  onSkipToEnd,
  skipped = false,
  playerColorName,
  centered = false,
  behindModal = false,
  panelOpen = false,
}: TutorialOverlayProps) {
  const step = steps[stepIndex];
  const [whyOpen, setWhyOpen] = useState(false);
  if (!step) return null;

  const title = skipped && step.skippedTitle ? step.skippedTitle : step.title;
  const message = skipped && step.skippedMessage ? step.skippedMessage : step.message;

  const completedModules = getCompletedTutorialModules();
  const isMobile = isMobileViewport();
  const anchorTop = isMobile && !centered && !!step.requireAction;
  /**
   * Dock left of a centered full-screen panel. The coaching card sits
   * bottom-center by default, which is exactly where the tech tree's Research
   * buttons are — it covered the very controls its own copy was telling the
   * player to press. Desktop only; on mobile the panel fills the screen and
   * `anchorTop` already moves the card clear.
   */
  const dockAside = panelOpen && !isMobile && !centered;

  const handleModuleComplete = () => {
    onMarkModuleComplete?.();
    onReturnToLobby();
  };

  return (
    <div
      className={clsx(
        'fixed inset-0 pointer-events-none',
        // Sit behind an open blocking modal so its buttons stay visible/clickable.
        behindModal ? 'z-40' : 'z-50',
      )}
      data-testid="tutorial-overlay"
    >
      {!step.requireAction && (
        <div className="absolute inset-0 bg-black/30 pointer-events-none" aria-hidden />
      )}
      <div
        className={clsx(
          'pointer-events-auto w-full px-4',
          centered
            ? 'absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 max-w-lg'
            : anchorTop
              ? 'absolute left-1/2 -translate-x-1/2 max-w-md top-[calc(env(safe-area-inset-top,0px)+3.25rem)]'
              : dockAside
                ? 'absolute bottom-20 left-0 max-w-[19rem]'
                : 'absolute bottom-20 left-1/2 -translate-x-1/2 max-w-md mx-4',
        )}
      >
        <div
          className={clsx(
            centered
              ? 'rounded-2xl border-2 border-bf-gold/40 bg-bf-surface/95 backdrop-blur-lg p-8 shadow-2xl text-center'
              : 'rounded-xl border border-bf-gold/30 bg-bf-surface/95 backdrop-blur-sm shadow-2xl',
            anchorTop ? 'p-3 max-h-[30vh] overflow-y-auto' : 'p-5',
          )}
        >
          <div className={`flex items-center justify-between mb-1 ${centered ? 'px-1' : ''}`}>
            <span className="text-[10px] text-bf-muted/60 uppercase tracking-widest">
              Step {stepIndex + 1} / {steps.length}
            </span>
          </div>

          <div className={centered ? 'flex flex-col items-center gap-3 mb-4' : 'flex items-center gap-2 mb-3'}>
            <GraduationCap className={centered ? 'w-8 h-8 text-bf-gold' : 'w-5 h-5 text-bf-gold'} />
            <h3 className={centered ? 'font-display text-2xl text-bf-gold' : 'font-display text-lg text-bf-gold'}>
              {title}
            </h3>
          </div>

          <p
            className={clsx(
              'text-bf-muted leading-relaxed mb-2',
              centered ? 'text-lg' : anchorTop ? 'text-xs' : 'text-sm',
            )}
          >
            {renderTutorialText(message, playerColorName)}
          </p>
          {step.detail && (
            <p
              className={clsx(
                'text-bf-muted/60 leading-relaxed',
                centered ? 'text-sm mb-4' : anchorTop ? 'text-[11px] mb-2' : 'text-xs mb-3',
              )}
            >
              {renderTutorialText(step.detail, playerColorName)}
            </p>
          )}
          {step.whyItMatters && (
            <div className={clsx('mb-3', centered ? 'text-left' : '')}>
              <button
                type="button"
                onClick={() => setWhyOpen((o) => !o)}
                className="flex items-center gap-1 text-xs text-bf-gold/90 hover:text-bf-gold transition-colors"
              >
                {whyOpen ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                Why this matters
              </button>
              {whyOpen && (
                <p className="text-bf-muted/70 text-xs mt-1 leading-relaxed">{step.whyItMatters}</p>
              )}
            </div>
          )}
          {step.hint && (
            <p
              className={clsx(
                'text-bf-muted/60 italic',
                centered ? 'text-base mb-4' : anchorTop ? 'text-[11px] mb-2' : 'text-xs mb-3',
              )}
            >
              {renderTutorialText(step.hint, playerColorName)}
            </p>
          )}

          {step.actionOpenTechTree && onOpenTechTree && (
            <button type="button" onClick={onOpenTechTree} className="btn-secondary text-sm w-full mb-2">
              Open Tech Tree
            </button>
          )}
          {step.actionOpenBonuses && onOpenBonuses && (
            <button type="button" onClick={onOpenBonuses} className="btn-secondary text-sm w-full mb-2">
              Open Bonuses
            </button>
          )}
          {step.actionOpenSettingsLab && onOpenSettingsLab && (
            <button
              type="button"
              data-testid="tutorial-open-settings-lab"
              onClick={onOpenSettingsLab}
              className="btn-secondary text-sm w-full mb-2"
            >
              Open Settings Lab
            </button>
          )}

          {step.variant === 'wrapup' ? (
            <div className="flex flex-col gap-2 mt-2">
              <button
                type="button"
                data-testid="tutorial-continue-btn"
                onClick={onContinuePlaying}
                className="btn-primary text-base w-full"
              >
                Continue playing
              </button>
              {lessonModule === 'core' && onLaunchModule && TUTORIAL_V2_ENABLED && (
                <div className="pt-2 border-t border-bf-border/60 space-y-2">
                  <p className="text-[10px] uppercase tracking-widest text-bf-muted">Optional deep dives</p>
                  {OPTIONAL_MODULES.map((mod) => {
                    const meta = TUTORIAL_MODULES.find((m) => m.id === mod);
                    const done = completedModules.includes(mod);
                    return (
                      <button
                        key={mod}
                        type="button"
                        onClick={() => onLaunchModule(mod)}
                        className="btn-secondary text-sm w-full text-left flex justify-between items-center gap-2"
                      >
                        <span>{meta?.title ?? mod}</span>
                        <span className="text-[10px] text-bf-muted shrink-0">
                          {done ? 'Done' : `~${meta?.estimatedMinutes ?? 5}m`}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
              <button type="button" onClick={onReturnToLobby} className="btn-secondary text-base w-full">
                Return to lobby
              </button>
            </div>
          ) : step.variant === 'module_complete' ? (
            <div className="flex flex-col gap-2 mt-2">
              <button
                type="button"
                data-testid="tutorial-module-complete-btn"
                onClick={handleModuleComplete}
                className="btn-primary text-base w-full"
              >
                Back to lobby
              </button>
              {onLaunchModule && (
                <p className="text-xs text-bf-muted">More lessons are available from the lobby or How to Play.</p>
              )}
            </div>
          ) : !step.requireAction ? (
            <div className="flex flex-col gap-2">
              <button
                type="button"
                data-testid="tutorial-next-btn"
                onClick={onAdvance}
                className="btn-primary text-base w-full"
              >
                Next
              </button>
              {step.id === 'welcome' && onSkipToEnd && (
                <button
                  type="button"
                  data-testid="tutorial-skip-btn"
                  onClick={onSkipToEnd}
                  className="btn-secondary text-sm w-full"
                >
                  Skip to the end
                </button>
              )}
            </div>
          ) : (
            <p
              className={clsx(
                'text-bf-gold/80 text-center animate-pulse',
                anchorTop ? 'text-xs mt-1' : 'text-base',
              )}
            >
              {step.requireAction === 'tech_researched'
                ? 'Research a technology to continue…'
                : step.requireAction === 'ability_used'
                  ? 'Use your faction ability to continue…'
                  : step.requireAction === 'bonuses_opened'
                    ? 'Open the Bonuses panel to continue…'
                    : step.requireAction === 'tech_tree_opened'
                      ? 'Open the Tech Tree to continue…'
                      : 'Complete the action to continue…'}
            </p>
          )}

          {/* Exit Tutorial — clearly separated from primary action by divider */}
          {onExitTutorial && step.variant !== 'wrapup' && step.variant !== 'module_complete' && (
            <div className={clsx('border-t border-bf-border/50', anchorTop ? 'mt-3 pt-2' : 'mt-5 pt-3')}>
              <button
                type="button"
                data-testid="tutorial-exit-btn"
                onClick={onExitTutorial}
                className={clsx(
                  'w-full flex items-center justify-center gap-1.5 rounded-lg border transition-colors',
                  'border-red-500/20 text-red-400/70 hover:text-red-400 hover:bg-red-500/10 hover:border-red-500/40',
                  anchorTop ? 'py-1 text-[11px]' : 'py-2 text-xs',
                )}
              >
                <X className="w-3.5 h-3.5 shrink-0" />
                Exit Tutorial
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
