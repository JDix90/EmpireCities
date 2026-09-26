import React from 'react';
import CosmeticPreview from '../cosmetics/CosmeticPreview';
import { TryOnPrimary, tryOnStatus } from './tryOn';
import type { CatalogItem, ItemAction } from './storeCatalog';

/**
 * The item being tried on, pinned to the bottom of the screen while Your look
 * is scrolled out of view: what it is, where it stands, and what to do next.
 * Centred by its margins, not a transform, which its entrance animation uses.
 */
export default function TryOnBar({
  item,
  action,
  initial,
  busy,
  onPutBack,
  onBuy,
  onWear,
}: {
  item: CatalogItem;
  action: ItemAction;
  initial: string;
  busy: boolean;
  onPutBack: () => void;
  onBuy: () => void;
  onWear: () => void;
}) {
  return (
    <div
      role="region"
      aria-label="Trying on"
      data-testid="try-on-bar"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-[#f3d98b]/35 bg-[#141722]/95 px-3 pb-safe-3 pt-3 shadow-[0_-12px_30px_rgba(0,0,0,0.55)] backdrop-blur animate-fade-in sm:bottom-4 sm:mx-auto sm:w-[min(40rem,calc(100%-2rem))] sm:rounded-2xl sm:border sm:pb-3"
    >
      <div className="flex items-center gap-3">
        <span aria-hidden className="hidden h-11 w-14 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-[#0d111b] min-[400px]:flex">
          <CosmeticPreview cosmeticId={item.cosmetic_id} type={item.type} initial={initial} size="md" className="scale-[0.72]" />
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="truncate text-sm text-bf-text">
            Trying on <strong className="font-semibold text-[#f3d98b]">{item.name}</strong>
          </span>
          <span className="truncate text-xs text-bf-muted">{tryOnStatus(item, action)}</span>
        </span>
        <TryOnPrimary item={item} action={action} busy={busy} onBuy={onBuy} onWear={onWear} />
        <button type="button" onClick={onPutBack} className="btn-secondary shrink-0 px-3 text-sm">Put back</button>
      </div>
    </div>
  );
}
