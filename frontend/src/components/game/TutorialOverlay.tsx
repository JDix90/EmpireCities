import React, { useEffect, useState } from 'react';
import { GraduationCap, ChevronDown, ChevronRight, ChevronUp, X } from 'lucide-react';
import clsx from 'clsx';
import { useTranslation } from 'react-i18next';
import { isMobileViewport, isShortViewport } from '../../utils/device';
import {
  TUTORIAL_MODULES,
  TUTORIAL_V2_ENABLED,
  type TutorialLessonModule,
  type TutorialStep,
} from '../../tutorial';
import { getCompletedTutorialModules } from '../../tutorial/progression';
import { localizeTutorialModuleMeta, localizeTutorialStep } from '../../tutorial/localize';

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
  /**
   * A territory panel is open on the board. It occupies the same bottom-left
   * gutter an aside-docked card does and can run 500px tall, so the two cannot
   * share the column: the card folds to a title strip while the player works
   * the panel, and unfolds again the moment they close it (or tap the strip).
   */
  territorySelected?: boolean;
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
  territorySelected = false,
}: TutorialOverlayProps) {
  const { t } = useTranslation('tutorial');
  const rawStep = steps[stepIndex] as TutorialStep | undefined;
  // Copy in the active language; gates, actions and layout hints are untouched.
  const step = rawStep ? localizeTutorialStep(rawStep, t, lessonModule) : undefined;
  const [whyOpen, setWhyOpen] = useState(false);
  /**
   * Explicit fold choice for a docked card, or null to follow the default.
   * Reset per step: a player who unfolds on step 3 should not find step 4
   * already unfolded on top of the panel they are still working.
   */
  const [foldOverride, setFoldOverride] = useState<boolean | null>(null);
  const stepId = step?.id;
  useEffect(() => { setFoldOverride(null); }, [stepId]);
  if (!step) return null;

  const title = skipped && step.skippedTitle ? step.skippedTitle : step.title;
  const message = skipped && step.skippedMessage ? step.skippedMessage : step.message;

  const completedModules = getCompletedTutorialModules();
  const isMobile = isMobileViewport();
  /**
   * Wide enough for the desktop layout but too short for it. A portal embed
   * (itch.io, CrazyGames) and an unmaximised laptop both land here: every
   * breakpoint above is width-only, so they take the desktop path and get a
   * card sized for a tall window. On a 720px-tall frame the default
   * bottom-center card covers the half of the board its own copy is pointing
   * at, and there is no fold control because that is docked-only.
   */
  const isShort = isShortViewport();
  const anchorTop = isMobile && !centered && !!step.requireAction;
  /**
   * Dock left of a centered full-screen panel. The coaching card sits
   * bottom-center by default, which is exactly where the tech tree's Research
   * buttons are — it covered the very controls its own copy was telling the
   * player to press. Desktop only; on mobile the panel fills the screen and
   * `anchorTop` already moves the card clear.
   *
   * A short viewport docks for the same reason even with no panel open: the
   * gutter is the one place a wide-but-short frame has room to spare, and
   * docking is what makes the card foldable (see `foldable` below), so the
   * player can collapse it to a title strip and look underneath.
   */
  const dockAside = (panelOpen || step.cardPosition === 'aside' || isShort) && !isMobile && !centered;
  /**
   * A step that asks the player to click a specific territory docks to the
   * TOP-left, not the bottom-left used for a full-screen panel: the territory
   * panel opens along the bottom-left, so bottom-docking would trade covering
   * the board for covering the panel.
   */
  const dockAsideTop = dockAside && !panelOpen;
  /**
   * A docked card can fold to a title strip. It defaults to folded once a
   * territory panel is open, because the two then compete for the same space:
   * on desktop the panel fills the left gutter this card docks into, and on a
   * phone the card already covers the northern half of the board. Either way
   * the player has read the card and is now acting on it; the strip keeps it
   * one tap away.
   */
  const foldable = dockAsideTop || anchorTop;
  const folded = foldable && (foldOverride ?? territorySelected);

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
      {!step.requireAction && !folded && (
        <div className="absolute inset-0 bg-black/30 pointer-events-none" aria-hidden />
      )}
      {folded ? (
        <button
          type="button"
          data-testid="tutorial-card-unfold"
          onClick={() => setFoldOverride(false)}
          aria-expanded={false}
          className={clsx(
            'pointer-events-auto absolute max-w-[17rem] flex items-center gap-2 rounded-xl border border-bf-gold/30 bg-bf-surface/95 backdrop-blur-sm shadow-2xl px-3 py-2 text-left',
            anchorTop
              ? 'left-4 top-[calc(env(safe-area-inset-top,0px)+3.25rem)]'
              : 'top-24 left-4',
          )}
        >
          <GraduationCap className="w-4 h-4 text-bf-gold shrink-0" />
          <span className="min-w-0">
            <span className="block text-[10px] text-bf-muted/60 uppercase tracking-widest">
              {t('overlay.step', { current: stepIndex + 1, total: steps.length })}
            </span>
            <span className="block font-display text-sm text-bf-gold truncate">{title}</span>
          </span>
          <ChevronDown className="w-4 h-4 text-bf-muted shrink-0" />
        </button>
      ) : (
      <div
        className={clsx(
          'pointer-events-auto w-full px-4',
          centered
            // Cap the height on a phone: at full height this card covered the
            // whole 390×844 viewport, hiding the board it describes and
            // clipping the era banner mid-sentence. The card scrolls its PROSE
            // only (see the flex column below) — when the whole card scrolled,
            // a 390×664 phone showed the welcome step's copy cut mid-sentence
            // with Next and "Skip to the end" below the fold and no scroll
            // affordance, which is the first screen of the game.
            ? 'absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 max-w-lg max-h-[82vh] flex'
            : anchorTop
              ? 'absolute left-1/2 -translate-x-1/2 max-w-md top-[calc(env(safe-area-inset-top,0px)+3.25rem)]'
              : dockAsideTop
                // Capped so a long card can never reach the bottom of the
                // gutter; `asideFolded` handles the territory panel, which
                // needs the gutter outright.
                ? 'absolute top-24 left-0 max-w-[19rem] max-h-[calc(100vh-8rem)] overflow-y-auto'
                : dockAside
                  ? 'absolute bottom-20 left-0 max-w-[19rem]'
                  : 'absolute bottom-20 left-1/2 -translate-x-1/2 max-w-md mx-4',
        )}
      >
        <div
          className={clsx(
            centered
              ? 'rounded-2xl border-2 border-bf-gold/40 bg-bf-surface/95 backdrop-blur-lg shadow-2xl text-center flex flex-col min-h-0 w-full'
              : 'rounded-xl border border-bf-gold/30 bg-bf-surface/95 backdrop-blur-sm shadow-2xl',
            // Same flex-column trick as `centered`: the prose scrolls, the
            // actions below stay pinned. When the whole card scrolled, a phone
            // clipped the hint and the Exit control with no affordance.
            //
            // Padding is set here ONCE. It used to be `p-8` in the centered
            // branch above plus `p-5` here, leaving both classes on the same
            // element and letting Tailwind's stylesheet order pick the winner.
            // A centered card can't spare `p-8` on a short viewport — that is
            // 4rem of chrome out of a 700px frame.
            anchorTop
              ? 'p-3 max-h-[38vh] flex flex-col min-h-0'
              : centered
                ? (isShort ? 'p-5' : 'p-8')
                : 'p-5',
          )}
        >
          {/* Prose scrolls; the actions below stay pinned to the card. */}
          <div className={centered || anchorTop ? 'min-h-0 overflow-y-auto' : undefined}>
          <div className={`flex items-center justify-between mb-1 ${centered ? 'px-1' : ''}`}>
            <span className="text-[10px] text-bf-muted/60 uppercase tracking-widest">
              {t('overlay.step', { current: stepIndex + 1, total: steps.length })}
            </span>
            {foldable && (
              <button
                type="button"
                data-testid="tutorial-card-fold"
                onClick={() => setFoldOverride(true)}
                aria-expanded
                aria-label={t('overlay.collapse')}
                title={t('overlay.collapseTitle')}
                className="-mr-1 -mt-1 p-1 text-bf-muted hover:text-bf-gold transition-colors"
              >
                <ChevronUp className="w-4 h-4" />
              </button>
            )}
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
                {t('overlay.whyThisMatters')}
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
          </div>

          {step.actionOpenTechTree && onOpenTechTree && (
            <button type="button" onClick={onOpenTechTree} className="btn-secondary text-sm w-full mb-2">
              {t('overlay.openTechTree')}
            </button>
          )}
          {step.actionOpenBonuses && onOpenBonuses && (
            <button type="button" onClick={onOpenBonuses} className="btn-secondary text-sm w-full mb-2">
              {t('overlay.openBonuses')}
            </button>
          )}
          {step.actionOpenSettingsLab && onOpenSettingsLab && (
            <button
              type="button"
              data-testid="tutorial-open-settings-lab"
              onClick={onOpenSettingsLab}
              className="btn-secondary text-sm w-full mb-2"
            >
              {t('overlay.openSettingsLab')}
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
                {t('overlay.continuePlaying')}
              </button>
              {lessonModule === 'core' && onLaunchModule && TUTORIAL_V2_ENABLED && (
                <div className="pt-2 border-t border-bf-border/60 space-y-2">
                  <p className="text-[10px] uppercase tracking-widest text-bf-muted">{t('overlay.optionalDeepDives')}</p>
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
                        <span>{meta ? localizeTutorialModuleMeta(meta, t).title : mod}</span>
                        <span className="text-[10px] text-bf-muted shrink-0">
                          {done ? t('overlay.done') : t('overlay.minutesShort', { minutes: meta?.estimatedMinutes ?? 5 })}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
              <button type="button" onClick={onReturnToLobby} className="btn-secondary text-base w-full">
                {t('overlay.returnToLobby')}
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
                {t('overlay.backToLobby')}
              </button>
              {onLaunchModule && (
                <p className="text-xs text-bf-muted">{t('overlay.moreLessons')}</p>
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
                {t('overlay.next')}
              </button>
              {step.id === 'welcome' && onSkipToEnd && (
                <button
                  type="button"
                  data-testid="tutorial-skip-btn"
                  onClick={onSkipToEnd}
                  className="btn-secondary text-sm w-full"
                >
                  {t('overlay.skipToEnd')}
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
                ? t('overlay.waitTechResearched')
                : step.requireAction === 'ability_used'
                  ? t('overlay.waitAbilityUsed')
                  : step.requireAction === 'bonuses_opened'
                    ? t('overlay.waitBonusesOpened')
                    : step.requireAction === 'tech_tree_opened'
                      ? t('overlay.waitTechTreeOpened')
                      : t('overlay.waitDefault')}
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
                {t('overlay.exitTutorial')}
              </button>
            </div>
          )}
        </div>
      </div>
      )}
    </div>
  );
}
