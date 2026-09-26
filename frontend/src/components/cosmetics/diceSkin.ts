import type React from 'react';
import type { DiceLook } from '@borderfall/shared';

/** Textures drawn over a die's face, as CSS background layers. */
const PATTERNS: Record<NonNullable<DiceLook['pattern']>, string> = {
  veins:
    'linear-gradient(115deg, transparent 38%, rgba(100, 116, 139, 0.35) 40%, transparent 43%), '
    + 'linear-gradient(35deg, transparent 62%, rgba(100, 116, 139, 0.25) 63%, transparent 66%)',
  grain: 'repeating-linear-gradient(100deg, rgba(0, 0, 0, 0.14) 0 2px, transparent 2px 7px)',
  stars:
    'radial-gradient(1px 1px at 22% 28%, #fff 99%, transparent), '
    + 'radial-gradient(1px 1px at 74% 36%, #fff 99%, transparent), '
    + 'radial-gradient(1.5px 1.5px at 38% 76%, #fff 99%, transparent), '
    + 'radial-gradient(1px 1px at 84% 82%, #fff 99%, transparent), '
    + 'radial-gradient(1px 1px at 58% 12%, #fff 99%, transparent)',
};

/** A die face in a dice skin's colours: the face (and its texture), the number and the border. */
export function diceFaceStyle(look: DiceLook): React.CSSProperties {
  const face = look.face.length > 1 ? `linear-gradient(135deg, ${look.face.join(', ')})` : look.face[0];
  const background = look.pattern ? `${PATTERNS[look.pattern]}, ${face}` : face;
  return { background, color: look.ink, border: `1px solid ${look.edge}` };
}

/**
 * The class that animates a skin's effect: `wobble` only while the die rolls,
 * `shimmer` always. The global reduced-motion rule in index.css stills both.
 */
export function diceEffectClass(look: DiceLook, rolling: boolean): string | undefined {
  if (look.effect === 'wobble') return rolling ? 'animate-dice-wobble' : undefined;
  if (look.effect === 'shimmer') return 'cosmetic-shimmer';
  return undefined;
}
