import React from 'react';
import clsx from 'clsx';
import { ONBOARDING_QUESTS } from '@erasofempire/shared';
import type { QuestDef } from '@erasofempire/shared';

interface OnboardingBannerProps {
  /** Current quest stage index (0-based). null/undefined = all done. */
  stage: number | null | undefined;
  onSkip?: () => void;
  className?: string;
}

export default function OnboardingBanner({ stage, onSkip, className }: OnboardingBannerProps) {
  if (stage == null || stage >= ONBOARDING_QUESTS.length) return null;

  const quest: QuestDef = ONBOARDING_QUESTS[stage];
  const progress = stage / ONBOARDING_QUESTS.length;

  return (
    <div
      className={clsx(
        'rounded-xl bg-gradient-to-r from-cc-gold/10 to-cc-surface border border-cc-gold/30 p-4',
        className,
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1">
          <p className="text-xs text-cc-gold font-display uppercase tracking-wider mb-1">
            Getting Started — {stage + 1}/{ONBOARDING_QUESTS.length}
          </p>
          <p className="text-sm text-cc-text font-medium">{quest.title}</p>
          <p className="text-xs text-cc-muted mt-0.5">{quest.description}</p>
          <div className="flex items-center gap-2 mt-2 text-xs text-cc-gold">
            <span>🪙 {quest.reward_gold} gold</span>
          </div>
        </div>
        {onSkip && (
          <button
            onClick={onSkip}
            className="text-xs text-cc-muted hover:text-cc-text transition-colors whitespace-nowrap"
          >
            Skip all
          </button>
        )}
      </div>

      {/* Progress bar */}
      <div className="mt-3 h-1.5 rounded-full bg-cc-dark overflow-hidden">
        <div
          className="h-full rounded-full bg-cc-gold transition-all duration-500"
          style={{ width: `${progress * 100}%` }}
        />
      </div>
    </div>
  );
}
