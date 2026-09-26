import React from 'react';
import clsx from 'clsx';
import { COSMETIC_TYPE_KIND, cosmeticLook } from '@borderfall/shared';
import BannerTag from './BannerTag';
import CapitalPreview from './CapitalPreview';
import CosmeticGlyph from './CosmeticGlyph';
import FrameRing from './FrameRing';
import { diceEffectClass, diceFaceStyle } from './diceSkin';
import { useCosmeticMotion } from './useCosmetics';

/** `sm` sits in a small tile of its own; `md` and `lg` fill a space the caller lights. */
export type PreviewSize = 'sm' | 'md' | 'lg';

const DIE_SHADOW = 'shadow-[0_12px_24px_-8px_rgba(0,0,0,0.75)]';

/**
 * How an item looks when worn: a frame around an avatar, a banner's tag, a
 * marker on a capital, a die. Decorative, so hidden from screen readers (the
 * card names the item). Nothing when the item has no look of its type's kind.
 */
export default function CosmeticPreview({
  cosmeticId,
  type,
  initial = '?',
  size = 'sm',
  className,
  pipClassName,
}: {
  cosmeticId: string;
  /** The catalog type: an id whose look is of another kind draws nothing. */
  type: string;
  /** The letter on the preview avatar. */
  initial?: string;
  size?: PreviewSize;
  className?: string;
  /** Extra classes on a marker's pip, at `md` and `lg` (an entrance animation). */
  pipClassName?: string;
}) {
  const look = cosmeticLook(cosmeticId);
  const motion = useCosmeticMotion();
  if (!look || COSMETIC_TYPE_KIND[type] !== look.kind) return null;
  const letter = initial.slice(0, 1).toUpperCase();

  let body: React.ReactNode;
  switch (look.kind) {
    case 'frame':
      body = (
        <FrameRing frameId={cosmeticId} className={size === 'lg' ? 'p-1.5' : 'p-1'} glow={size === 'sm' ? 'soft' : 'strong'}>
          <span
            className={clsx(
              'flex items-center justify-center rounded-full font-display text-bf-text',
              size === 'sm' ? 'bg-bf-border' : 'bg-[radial-gradient(circle_at_35%_30%,#2a3246,#161b27)]',
              size === 'lg' ? 'h-[72px] w-[72px] text-3xl' : size === 'md' ? 'h-12 w-12 text-xl' : 'h-10 w-10 text-lg',
            )}
          >
            {letter}
          </span>
        </FrameRing>
      );
      break;
    case 'banner':
      body = <BannerTag bannerId={cosmeticId} size={size === 'lg' ? 'lg' : 'md'} />;
      break;
    case 'marker':
      body = size === 'sm' ? (
        <span className="flex h-12 w-16 items-center justify-center rounded-md border border-bf-border bg-emerald-900/60">
          <CosmeticGlyph
            glyph={look.glyph}
            color={look.color}
            className="h-7 w-7 drop-shadow-[0_1px_1px_rgba(0,0,0,0.9)]"
          />
        </span>
      ) : (
        <CapitalPreview markerId={cosmeticId} className={size === 'lg' ? 'w-[124px]' : 'w-20'} pipClassName={pipClassName} />
      );
      break;
    case 'dice': {
      const face = diceFaceStyle(look);
      const effect = motion ? diceEffectClass(look, false) : undefined;
      body = size === 'lg' ? (
        <span className="flex items-start gap-2.5">
          <span
            className={clsx('store-die flex h-14 w-14 items-center justify-center rounded-xl font-mono text-[28px] font-bold', DIE_SHADOW, effect)}
            style={{ ...face, borderWidth: 2 }}
          >
            6
          </span>
          <span
            className={clsx('store-die mt-4 flex h-11 w-11 items-center justify-center rounded-[10px] font-mono text-[22px] font-bold', DIE_SHADOW, effect)}
            style={{ ...face, borderWidth: 2 }}
          >
            4
          </span>
        </span>
      ) : (
        <span
          className={clsx('store-die flex h-11 w-11 items-center justify-center rounded-xl font-mono text-xl font-bold', size === 'md' && DIE_SHADOW, effect)}
          style={face}
        >
          6
        </span>
      );
      break;
    }
  }

  return (
    <div
      aria-hidden="true"
      data-testid="cosmetic-preview"
      data-kind={look.kind}
      className={clsx('flex items-center justify-center', size === 'sm' && 'h-16 rounded-lg bg-bf-dark/60', className)}
    >
      {body}
    </div>
  );
}
