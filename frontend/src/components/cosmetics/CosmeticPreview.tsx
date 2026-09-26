import React from 'react';
import clsx from 'clsx';
import { COSMETIC_TYPE_KIND, cosmeticLook } from '@borderfall/shared';
import BannerTag from './BannerTag';
import CosmeticGlyph from './CosmeticGlyph';
import FrameRing from './FrameRing';
import { diceEffectClass, diceFaceStyle } from './diceSkin';

/**
 * How an item looks when worn: a frame around an avatar, a banner's tag, a
 * marker on a territory, a die. Decorative, so hidden from screen readers (the
 * card names the item). Nothing when the item has no look of its type's kind.
 */
export default function CosmeticPreview({
  cosmeticId,
  type,
  initial = '?',
  className,
}: {
  cosmeticId: string;
  /** The catalog type: an id whose look is of another kind draws nothing. */
  type: string;
  /** The letter on the preview avatar. */
  initial?: string;
  className?: string;
}) {
  const look = cosmeticLook(cosmeticId);
  if (!look || COSMETIC_TYPE_KIND[type] !== look.kind) return null;

  let body: React.ReactNode;
  switch (look.kind) {
    case 'frame':
      body = (
        <FrameRing frameId={cosmeticId}>
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-bf-border font-display text-lg text-bf-text">
            {initial.slice(0, 1).toUpperCase()}
          </span>
        </FrameRing>
      );
      break;
    case 'banner':
      body = <BannerTag bannerId={cosmeticId} size="md" />;
      break;
    case 'marker':
      body = (
        <span className="flex h-12 w-16 items-center justify-center rounded-md border border-bf-border bg-emerald-900/60">
          <CosmeticGlyph
            glyph={look.glyph}
            color={look.color}
            className="h-7 w-7 drop-shadow-[0_1px_1px_rgba(0,0,0,0.9)]"
          />
        </span>
      );
      break;
    case 'dice':
      body = (
        <span
          className={clsx(
            'flex h-11 w-11 items-center justify-center rounded-xl font-mono text-xl font-bold',
            diceEffectClass(look, false),
          )}
          style={diceFaceStyle(look)}
        >
          6
        </span>
      );
      break;
  }

  return (
    <div
      aria-hidden="true"
      data-testid="cosmetic-preview"
      data-kind={look.kind}
      className={clsx('flex h-16 items-center justify-center rounded-lg bg-bf-dark/60', className)}
    >
      {body}
    </div>
  );
}
