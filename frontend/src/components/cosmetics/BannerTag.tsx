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
  size?: 'sm' | 'md' | 'lg';
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
        'inline-flex shrink-0 items-center border font-bold uppercase tracking-wider leading-none',
        size === 'lg' && 'gap-2 rounded-lg border-[1.5px] px-3.5 py-2 font-display text-base',
        size === 'md' && 'gap-1 rounded px-2 py-1 text-xs',
        size === 'sm' && 'gap-1 rounded px-1.5 py-0.5 text-[10px]',
        className,
      )}
      style={{
        color: look.color,
        backgroundColor: look.background,
        borderColor: look.trim,
        boxShadow: size === 'lg' ? `0 10px 26px -10px ${look.trim}` : undefined,
      }}
    >
      <CosmeticGlyph
        glyph={look.glyph}
        color={look.color}
        className={size === 'lg' ? 'h-6 w-6' : size === 'md' ? 'h-4 w-4' : 'h-3 w-3'}
      />
      {look.title && <span>{look.title}</span>}
    </span>
  );
}
