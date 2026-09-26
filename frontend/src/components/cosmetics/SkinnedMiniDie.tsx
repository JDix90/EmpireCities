import React from 'react';
import clsx from 'clsx';
import type { DiceLook } from '@borderfall/shared';
import { diceEffectClass, diceFaceStyle } from './diceSkin';
import { useCosmeticMotion } from './useCosmetics';

/** Who rolled a die: kept as a red or blue ring around a skinned die. */
export type DiceSide = 'attacker' | 'defender';

export const DICE_SIDE_RING: Record<DiceSide, string> = {
  attacker: 'ring-red-500/80',
  defender: 'ring-blue-500/80',
};

/** A small settled die (battle log, turn strip) in its roller's dice skin. */
export default function SkinnedMiniDie({
  value,
  look,
  side,
  className,
}: {
  value: number;
  look: DiceLook;
  side: DiceSide;
  /** Size and text classes, as the plain die at the same spot uses. */
  className: string;
}) {
  const motion = useCosmeticMotion();
  return (
    <span
      data-testid="skinned-die"
      className={clsx(
        'inline-flex items-center justify-center rounded font-mono font-bold ring-1',
        DICE_SIDE_RING[side],
        className,
        motion && diceEffectClass(look, false),
      )}
      style={diceFaceStyle(look)}
    >
      {value}
    </span>
  );
}
