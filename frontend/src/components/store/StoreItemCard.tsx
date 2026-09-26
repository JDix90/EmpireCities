import React from 'react';
import clsx from 'clsx';
import { CheckCircle, Coins, Lock } from 'lucide-react';
import CosmeticPreview from '../cosmetics/CosmeticPreview';
import RarityBadge from './RarityBadge';
import type { CatalogItem, ItemAction } from './storeCatalog';

const actionButton = 'min-h-11 w-full rounded-md px-3 text-sm font-medium disabled:cursor-not-allowed';

/** One item: how it looks when worn, its rarity and price, and what the player can do with it. */
export default function StoreItemCard({
  item,
  action,
  initial,
  busy,
  onBuy,
  onEquip,
}: {
  item: CatalogItem;
  action: ItemAction;
  /** The letter on the preview avatar. */
  initial: string;
  /** A request for this item is in flight. */
  busy: boolean;
  onBuy: () => void;
  onEquip: () => void;
}) {
  const headingId = `store-item-${item.cosmetic_id}`;
  return (
    <article
      aria-labelledby={headingId}
      data-testid="store-item"
      data-item={item.cosmetic_id}
      className={clsx('card flex flex-col gap-2 p-3 sm:p-4', item.owned && 'border-bf-gold/20 bg-bf-gold/5')}
    >
      <CosmeticPreview cosmeticId={item.cosmetic_id} type={item.type} initial={initial} />
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <h3 id={headingId} className="font-display text-sm text-bf-text">{item.name}</h3>
        <RarityBadge rarity={item.rarity} />
      </div>
      {item.description && <p className="line-clamp-3 text-xs text-bf-muted">{item.description}</p>}

      <div className="mt-auto flex flex-col gap-2 pt-1">
        {item.owned ? (
          <span className="flex items-center gap-1 text-xs text-bf-gold">
            <CheckCircle className="h-3.5 w-3.5" aria-hidden /> Owned
          </span>
        ) : action.kind === 'earn' ? (
          <span className="flex items-center gap-1 text-xs text-bf-muted">
            <Lock className="h-3.5 w-3.5" aria-hidden /> Earned in play
          </span>
        ) : (
          <span className="flex items-center gap-1 text-sm font-medium text-bf-gold">
            <Coins className="h-3.5 w-3.5" aria-hidden />
            <span className="tabular-nums">{item.price_gems.toLocaleString()}</span>
            <span className="sr-only">gold</span>
          </span>
        )}

        {action.kind === 'equipped' && (
          <span className={clsx(actionButton, 'flex items-center justify-center gap-1 border border-bf-gold/40 text-bf-gold')}>
            <CheckCircle className="h-4 w-4" aria-hidden /> Equipped
          </span>
        )}
        {action.kind === 'equip' && (
          <button type="button" onClick={onEquip} disabled={busy} className={clsx(actionButton, 'btn-secondary')}>
            {busy ? 'Equipping…' : 'Equip'}
          </button>
        )}
        {action.kind === 'buy' && (
          <button type="button" onClick={onBuy} disabled={busy} className={clsx(actionButton, 'btn-primary')}>
            {busy ? 'Buying…' : 'Buy'}
          </button>
        )}
        {action.kind === 'short' && (
          <button type="button" disabled className={clsx(actionButton, 'border border-bf-border text-bf-muted')}>
            Need <span className="tabular-nums">{action.need.toLocaleString()}</span> more
          </button>
        )}
      </div>
    </article>
  );
}
