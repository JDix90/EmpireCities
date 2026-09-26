import type React from 'react';
import type { DiceLook } from '@borderfall/shared';

/** A die face in a dice skin's colours: the face, the number and the border. */
export function diceFaceStyle(look: DiceLook): React.CSSProperties {
  const face = look.face.length > 1 ? `linear-gradient(135deg, ${look.face.join(', ')})` : look.face[0];
  return { background: face, color: look.ink, border: `1px solid ${look.edge}` };
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
