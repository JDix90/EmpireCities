import React from 'react';
import clsx from 'clsx';
import type { CombatResult } from '../../store/gameStore';
import { COMBAT_CALLOUT_LABELS } from '../../utils/abilityActivationFeedback';

interface CombatAbilityCalloutsProps {
  callouts: NonNullable<CombatResult['combat_ability_callouts']>;
  perspective?: 'attacker' | 'defender';
  compact?: boolean;
}

export default function CombatAbilityCallouts({
  callouts,
  perspective = 'attacker',
  compact = false,
}: CombatAbilityCalloutsProps) {
  if (callouts.length === 0) return null;

  return (
    <div className={clsx('space-y-2', compact ? 'mb-2' : 'mb-4')}>
      {callouts.map((callout) => {
        const labelFn = COMBAT_CALLOUT_LABELS[callout.id];
        if (!labelFn) return null;
        const isAttackerBuff = callout.id !== 'gunpowder_passive';
        const tone = isAttackerBuff
          ? perspective === 'attacker'
            ? 'border-amber-300/70 bg-amber-500/15 text-amber-100'
            : 'border-amber-500/40 bg-amber-900/20 text-amber-200'
          : perspective === 'defender'
            ? 'border-red-300/70 bg-red-500/15 text-red-100'
            : 'border-red-500/40 bg-red-900/20 text-red-200';

        return (
          <p
            key={`${callout.id}-${callout.detail ?? ''}`}
            className={clsx(
              'text-xs px-3 py-2 rounded-lg border animate-pulse',
              compact && 'text-[10px] px-2 py-1.5',
              tone,
            )}
          >
            {labelFn(callout.detail)}
          </p>
        );
      })}
    </div>
  );
}
