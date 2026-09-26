import React from 'react';
import clsx from 'clsx';
import { markerLook } from '@borderfall/shared';
import CosmeticGlyph from './CosmeticGlyph';

/**
 * A capital on a patch of map, with the owner's marker pinned above it as the
 * map draws it: a gold-rimmed pip above and to the right of the capital's
 * diamond. No marker, no pip: the diamond alone, as the game draws it.
 * Decorative; the fixed aspect ratio keeps the pip over the diamond at any size.
 */
export default function CapitalPreview({
  markerId,
  className,
  pipClassName,
}: {
  markerId: string | null | undefined;
  /** Sets the width; the height follows. */
  className?: string;
  /** Extra classes on the pip (an entrance animation). */
  pipClassName?: string;
}) {
  const look = markerLook(markerId);
  return (
    <span
      aria-hidden="true"
      data-testid="capital-preview"
      data-marker={look ? markerId : undefined}
      className={clsx('relative inline-block aspect-[124/88]', className)}
    >
      <svg viewBox="0 0 124 88" className="absolute inset-0 h-full w-full" focusable="false">
        <path d="M6 24 L40 6 L72 18 L98 8 L118 32 L112 66 L80 82 L42 76 L12 80 L4 52 Z" fill="#1d3a66" stroke="#3b6fb6" strokeWidth="1.5" />
        <path d="M40 6 L52 42 L12 54" fill="none" stroke="#3b6fb6" strokeWidth="1" />
        <path d="M52 42 L98 8" fill="none" stroke="#3b6fb6" strokeWidth="1" />
        <path d="M52 42 L80 82" fill="none" stroke="#3b6fb6" strokeWidth="1" />
        <path d="M56 38 L64 46 L56 54 L48 46 Z" fill="#3b82f6" stroke="#ffd700" strokeWidth="2" />
      </svg>
      {look && (
        <span
          data-testid="capital-marker"
          className={clsx(
            // Placed by offsets, not a transform, so an entrance animation can move it.
            'store-pip absolute left-[43.5%] top-[10%] flex aspect-square w-[27%] items-center justify-center rounded-full border-2 border-bf-gold bg-bf-dark shadow-[0_6px_14px_rgba(0,0,0,0.55)]',
            pipClassName,
          )}
        >
          <CosmeticGlyph glyph={look.glyph} color={look.color} className="h-[62%] w-[62%]" />
        </span>
      )}
    </span>
  );
}
