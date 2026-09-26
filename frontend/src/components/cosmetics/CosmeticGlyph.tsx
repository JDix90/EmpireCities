import React from 'react';
import { COSMETIC_GLYPHS, type CosmeticGlyphName } from '@borderfall/shared';

/** A banner or marker glyph, stroked like a lucide icon. Decorative: label the element around it. */
export default function CosmeticGlyph({
  glyph,
  color,
  className,
  strokeWidth = 2,
}: {
  glyph: CosmeticGlyphName;
  color: string;
  className?: string;
  /** Lucide's 2 by default; thinner for a large, faint emblem. */
  strokeWidth?: number;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      {COSMETIC_GLYPHS[glyph].map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}
