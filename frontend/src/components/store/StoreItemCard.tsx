import React from 'react';
import clsx from 'clsx';
import { Check, Lock } from 'lucide-react';
import CosmeticPreview from '../cosmetics/CosmeticPreview';
import RarityBadge from './RarityBadge';
import { plinthBackground, rarityStyle } from './storeStyles';
import type { CatalogItem, ItemAction } from './storeCatalog';

/**
 * One item: shown large on a plinth lit in its rarity's colour, with its
 * name, what it is, and what the player can do with it. The plinth tries the
 * item on (not for guests, who browse only). `compact` is the earned wall's tile.
 */
export default function StoreItemCard({
  item,
  action,
  initial,
  busy,
  trying = false,
  onTryOn,
  onBuy,
  onEquip,
  variant = 'full',
  className,
}: {
  item: CatalogItem;
  action: ItemAction;
  /** The letter on the preview avatar. */
  initial: string;
  /** A request for this item is in flight. */
  busy: boolean;
  /** Being tried on in Your look. */
  trying?: boolean;
  onTryOn?: () => void;
  onBuy: () => void;
  onEquip: () => void;
  variant?: 'full' | 'compact';
  className?: string;
}) {
  const compact = variant === 'compact';
  const rarity = rarityStyle(item.rarity);
  const headingId = `store-item-${item.cosmetic_id}`;

  const plinthBody = (
    <>
      <CosmeticPreview
        cosmeticId={item.cosmetic_id}
        type={item.type}
        initial={initial}
        size={compact ? 'md' : 'lg'}
        className={clsx('store-pv', action.kind === 'earn' && 'brightness-[0.72] grayscale-[0.8]')}
      />
      {trying ? (
        <span className="absolute left-2 top-2 rounded-full bg-[#f3d98b] px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.12em] text-[#14110a] sm:text-[10px]">
          Trying on
        </span>
      ) : onTryOn ? (
        <span className="store-hint absolute bottom-2 right-2 rounded-full border border-white/15 bg-[#080a10]/75 px-2 py-0.5 text-[10px] font-semibold text-bf-text sm:text-[11px]">
          Try on
        </span>
      ) : null}
    </>
  );
  const plinthClass = clsx(
    'store-plinth relative flex w-full shrink-0 items-center justify-center border-b border-white/5',
    compact ? 'h-20 sm:h-24' : 'h-28 sm:h-36',
  );
  const plinthStyle = { background: plinthBackground(rarity) };

  return (
    <article
      aria-labelledby={headingId}
      data-testid="store-item"
      data-item={item.cosmetic_id}
      data-rarity={item.rarity ?? 'common'}
      className={clsx(
        'relative flex flex-col overflow-hidden rounded-2xl border bg-[#111623]',
        rarity.sheen && 'store-sheen',
        className,
      )}
      style={{
        borderColor: trying ? '#f3d98b' : rarity.edge,
        boxShadow: trying ? `0 0 0 2px rgba(243, 217, 139, 0.9), ${rarity.glow}` : rarity.glow,
      }}
    >
      {onTryOn ? (
        <button
          type="button"
          onClick={onTryOn}
          aria-pressed={trying}
          aria-label={`Try on ${item.name}`}
          className={clsx(plinthClass, 'cursor-pointer')}
          style={plinthStyle}
        >
          {plinthBody}
        </button>
      ) : (
        <div className={plinthClass} style={plinthStyle}>{plinthBody}</div>
      )}

      <div className={clsx('flex flex-1 flex-col', compact ? 'items-center gap-1 p-2.5 text-center' : 'gap-2 p-3 sm:p-4')}>
        <div className={clsx('flex gap-x-2 gap-y-1', compact ? 'flex-col items-center' : 'flex-wrap items-baseline justify-between')}>
          <h3
            id={headingId}
            className={clsx('font-display font-bold leading-tight text-[#f1ede2]', compact ? 'text-xs sm:text-[13px]' : 'text-sm sm:text-[15px]')}
          >
            {item.name}
          </h3>
          <RarityBadge rarity={item.rarity} />
        </div>
        {item.description && (
          <p className={clsx('text-bf-muted', compact ? 'line-clamp-3 text-[11px] leading-snug' : 'line-clamp-2 text-xs leading-relaxed')}>
            {item.description}
          </p>
        )}
        <div className={clsx('mt-auto w-full', compact ? 'pt-1' : 'pt-1.5')}>
          <ItemActionArea item={item} action={action} busy={busy} compact={compact} onBuy={onBuy} onEquip={onEquip} />
        </div>
      </div>
    </article>
  );
}

function ItemActionArea({
  item,
  action,
  busy,
  compact,
  onBuy,
  onEquip,
}: {
  item: CatalogItem;
  action: ItemAction;
  busy: boolean;
  compact: boolean;
  onBuy: () => void;
  onEquip: () => void;
}) {
  switch (action.kind) {
    case 'equipped':
      return (
        <span
          className={clsx(
            'flex min-h-11 items-center justify-center gap-1.5 rounded-lg border border-bf-gold/45 bg-bf-gold/[0.08] font-semibold text-[#f3d98b]',
            compact ? 'text-xs' : 'text-sm',
          )}
        >
          <Check className={compact ? 'h-3.5 w-3.5' : 'h-4 w-4'} aria-hidden /> Wearing
        </span>
      );
    case 'equip':
      return (
        <button
          type="button"
          onClick={onEquip}
          disabled={busy}
          className={clsx('btn-secondary w-full', compact ? 'px-2 text-xs' : 'px-3 text-sm')}
        >
          {busy ? 'Putting it on…' : 'Wear'}
        </button>
      );
    case 'buy':
      return (
        <button type="button" onClick={onBuy} disabled={busy} className="btn-primary w-full gap-1.5 px-3 text-sm">
          {busy ? 'Buying…' : (
            <>
              Buy <span aria-hidden className="opacity-60">·</span>
              <span className="tabular-nums">{item.price_gems.toLocaleString()}</span>
              <span className="sr-only">gold</span>
            </>
          )}
        </button>
      );
    case 'short': {
      const have = Math.max(0, item.price_gems - action.need);
      const pct = Math.max(3, Math.min(100, Math.round((have / Math.max(1, item.price_gems)) * 100)));
      return (
        <div className="flex min-h-11 flex-col justify-center gap-1.5">
          <div className="flex flex-wrap justify-between gap-x-2 text-xs">
            <span className="tabular-nums text-bf-muted">
              {have.toLocaleString()} / {item.price_gems.toLocaleString()}
            </span>
            <span className="font-semibold text-[#f3d98b]">
              <span className="tabular-nums">{action.need.toLocaleString()}</span> to go
            </span>
          </div>
          <div
            role="progressbar"
            aria-label={`Gold toward ${item.name}`}
            aria-valuemin={0}
            aria-valuemax={item.price_gems}
            aria-valuenow={have}
            className="h-2 overflow-hidden rounded bg-[#232a3c]"
          >
            <div className="h-full rounded bg-gradient-to-r from-[#8a6d24] via-bf-gold to-[#f3d98b]" style={{ width: `${pct}%` }} />
          </div>
        </div>
      );
    }
    case 'earn':
      // On the earned wall the description already says how; elsewhere, say it isn't sold.
      return compact ? null : (
        <span className="flex items-center gap-1 text-xs text-bf-muted">
          <Lock className="h-3.5 w-3.5" aria-hidden /> Earned in play
        </span>
      );
  }
}
