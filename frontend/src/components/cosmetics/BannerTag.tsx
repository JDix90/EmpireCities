import React from 'react';
import clsx from 'clsx';
import { bannerLook } from '@borderfall/shared';
import CosmeticGlyph from './CosmeticGlyph';

/** A banner's tag beside a player's name; nothing when `bannerId` has no banner look. */
export default function BannerTag({
  bannerId,
  size = 'sm',
  className,
}: {
  bannerId: string | null | undefined;
  size?: 'sm' | 'md';
  className?: string;
}) {
  const look = bannerLook(bannerId);
  if (!look) return null;
  return (
    <span
      role="img"
      aria-label={look.label}
      title={look.label}
      data-banner={bannerId}
      className={clsx(
        'inline-flex shrink-0 items-center gap-1 rounded border font-bold uppercase tracking-wider leading-none',
        size === 'md' ? 'px-2 py-1 text-xs' : 'px-1.5 py-0.5 text-[10px]',
        className,
      )}
      style={{ color: look.color, backgroundColor: look.background, borderColor: look.trim }}
    >
      <CosmeticGlyph glyph={look.glyph} color={look.color} className={size === 'md' ? 'h-4 w-4' : 'h-3 w-3'} />
      {look.title && <span>{look.title}</span>}
    </span>
  );
}
