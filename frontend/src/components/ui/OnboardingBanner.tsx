import React from 'react';
import clsx from 'clsx';
import { ONBOARDING_QUESTS } from '@borderfall/shared';
import type { QuestDef } from '@borderfall/shared';

interface OnboardingBannerProps {
  /** Current quest stage index (0-based). null/undefined = all done. */
  stage: number | null | undefined;
  onSkip?: () => void;
  className?: string;
  /**
   * lobby_cleanup_enabled (utils/questOrder.ts): the quest to show, its place
   * among the quests this player can do, and where to do it. Overrides `stage`.
   */
  pick?: { quest: QuestDef; position: number; total: number; where?: string } | null;
}

export default function OnboardingBanner({ stage, onSkip, className, pick }: OnboardingBannerProps) {
  if (pick === null) return null;
  if (!pick && (stage == null || stage >= ONBOARDING_QUESTS.length)) return null;

  const quest: QuestDef = pick ? pick.quest : ONBOARDING_QUESTS[stage!];
  const position = pick ? pick.position : stage! + 1;
  const total = pick ? pick.total : ONBOARDING_QUESTS.length;
  const progress = (position - 1) / total;

  return (
    <div
      className={clsx(
        'rounded-xl bg-gradient-to-r from-bf-gold/10 to-bf-surface border border-bf-gold/30 p-4',
        className,
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1">
          <p className="text-xs text-bf-gold font-display uppercase tracking-wider mb-1">
            Getting Started — {position}/{total}
          </p>
          <p className="text-sm text-bf-text font-medium">{quest.title}</p>
          <p className="text-xs text-bf-muted mt-0.5">{quest.description}</p>
          {pick?.where && (
            <p className="text-xs text-bf-text/80 mt-1" data-testid="quest-where">{pick.where}</p>
          )}
          <div className="flex items-center gap-2 mt-2 text-xs text-bf-gold">
            <span>🪙 {quest.reward_gold} gold</span>
          </div>
        </div>
        {onSkip && (
          <button
            onClick={onSkip}
            className="tap-min text-xs text-bf-muted hover:text-bf-text transition-colors whitespace-nowrap"
          >
            Skip all
          </button>
        )}
      </div>

      {/* Progress bar */}
      <div className="mt-3 h-1.5 rounded-full bg-bf-dark overflow-hidden">
        <div
          className="h-full rounded-full bg-bf-gold transition-all duration-500"
          style={{ width: `${progress * 100}%` }}
        />
      </div>
    </div>
  );
}
