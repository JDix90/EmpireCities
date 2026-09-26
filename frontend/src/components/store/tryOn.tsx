import React from 'react';
import type { CatalogItem, ItemAction } from './storeCatalog';

/** Where an item being tried on stands: its price, how far off it is, or how it is earned. */
export function tryOnStatus(item: CatalogItem, action: ItemAction): string {
  switch (action.kind) {
    case 'buy':
      return `${item.price_gems.toLocaleString()} gold`;
    case 'short':
      return `${action.need.toLocaleString()} more gold to buy`;
    case 'earn':
      return item.description ? `Earned in play: ${item.description}` : 'Earned in play';
    case 'equip':
      return 'Yours to wear';
    case 'equipped':
      return 'You’re wearing this';
  }
}

/** The one thing to do with an item being tried on, when there is one: buy it, or wear it. */
export function TryOnPrimary({
  item,
  action,
  busy,
  onBuy,
  onWear,
}: {
  item: CatalogItem;
  action: ItemAction;
  busy: boolean;
  onBuy: () => void;
  onWear: () => void;
}) {
  if (action.kind === 'buy') {
    return (
      <button type="button" onClick={onBuy} disabled={busy} className="btn-primary shrink-0 gap-1.5 px-4 text-sm">
        Buy <span aria-hidden className="opacity-60">·</span>
        <span className="tabular-nums">{item.price_gems.toLocaleString()}</span>
        <span className="sr-only">gold</span>
      </button>
    );
  }
  if (action.kind === 'equip') {
    return (
      <button type="button" onClick={onWear} disabled={busy} className="btn-primary shrink-0 px-4 text-sm">
        {busy ? 'Putting it on…' : 'Wear it'}
      </button>
    );
  }
  return null;
}
