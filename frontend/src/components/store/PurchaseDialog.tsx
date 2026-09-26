import React from 'react';
import clsx from 'clsx';
import { COSMETIC_SETS } from '@borderfall/shared';
import Modal from '../ui/Modal';
import CapitalPreview from '../cosmetics/CapitalPreview';
import CosmeticPreview from '../cosmetics/CosmeticPreview';
import { SLOT_BY_TYPE, isForSale, type CatalogItem } from './storeCatalog';
import { bandStyle, plinthBackground, rarityStyle } from './storeStyles';

export interface PurchaseState {
  item: CatalogItem;
  /** Confirming, until the server says the item is the player's. */
  bought: boolean;
}

const COINS = [1, 2, 3, 4, 5, 6, 7, 8];

/**
 * Buying an item: a confirmation first, then the moment it is the player's.
 * The item arrives (a marker drops onto its capital) in a burst of coins, and
 * a set's item says how much of the set the player now has.
 */
export default function PurchaseDialog({
  state,
  catalog,
  gold,
  initial,
  busy,
  motion,
  onCancel,
  onConfirm,
  onWear,
}: {
  state: PurchaseState | null;
  /** The catalog after the purchase, for the set's progress. */
  catalog: CatalogItem[];
  gold: number;
  initial: string;
  busy: boolean;
  /** Cosmetic motion is allowed (not lite mode). */
  motion: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  onWear: () => void;
}) {
  if (!state) return null;
  const { item } = state;
  const rarity = rarityStyle(item.rarity);
  const price = item.price_gems.toLocaleString();

  if (!state.bought) {
    return (
      <Modal open onClose={onCancel} title="Confirm purchase" className="!max-w-sm">
        <div className="space-y-4">
          <div
            className="flex h-36 items-center justify-center rounded-xl border border-white/5"
            style={{ background: plinthBackground(rarity) }}
          >
            <CosmeticPreview cosmeticId={item.cosmetic_id} type={item.type} initial={initial} size="lg" />
          </div>
          <p className="text-sm text-bf-text">
            Buy <span className="font-medium text-bf-gold">{item.name}</span> for{' '}
            <span className="font-medium tabular-nums text-bf-gold">{price} gold</span>?
          </p>
          <p className="text-xs text-bf-muted">
            Balance after purchase:{' '}
            <span className="tabular-nums">{Math.max(0, gold - item.price_gems).toLocaleString()} gold</span>
          </p>
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-secondary px-4 text-sm" onClick={onCancel}>
              Cancel
            </button>
            <button type="button" className="btn-primary px-4 text-sm" disabled={busy} onClick={onConfirm}>
              {busy ? 'Buying…' : 'Buy'}
            </button>
          </div>
        </div>
      </Modal>
    );
  }

  const setId = item.cosmetic_set && Object.prototype.hasOwnProperty.call(COSMETIC_SETS, item.cosmetic_set)
    ? item.cosmetic_set
    : null;
  const setItems = setId ? catalog.filter((i) => i.cosmetic_set === setId && isForSale(i)) : [];
  const setOwned = setItems.filter((i) => i.owned).length;
  const setAccent = bandStyle(setId ?? undefined).accent;

  return (
    <Modal open onClose={onCancel} ariaLabelledBy="bought-heading" className="!max-w-md overflow-hidden !p-0 sm:!p-0">
      <div
        data-testid="bought-stage"
        className="relative flex h-48 items-center justify-center overflow-hidden sm:h-56"
        style={{
          background: `radial-gradient(260px 170px at 50% 62%, ${rarity.light}, transparent 70%), radial-gradient(420px 200px at 50% 0%, rgba(201, 168, 76, 0.16), transparent 70%), #0d111b`,
        }}
      >
        {item.type === 'map_marker' ? (
          <span className="relative inline-block w-[220px] sm:w-[250px]">
            <CapitalPreview markerId={item.cosmetic_id} className="w-full" pipClassName={motion ? 'store-drop-in' : undefined} />
            {motion && (
              <span
                aria-hidden
                className="store-ripple absolute left-[45.2%] top-[52.3%] -ml-8 -mt-8 h-16 w-16 rounded-full border-2 border-[#f3d98b]/85"
              />
            )}
          </span>
        ) : (
          <span className="scale-125">
            <span className={clsx('block', motion && 'store-pop')}>
              <CosmeticPreview cosmeticId={item.cosmetic_id} type={item.type} initial={initial} size="lg" />
            </span>
          </span>
        )}
        {motion && COINS.map((n) => <span key={n} aria-hidden className={`store-coin store-coin-${n}`} />)}
      </div>

      <div className="flex flex-col items-center gap-2 px-6 pb-7 pt-5 text-center sm:px-8">
        <span className="text-[11px] font-bold uppercase tracking-[0.18em]" style={{ color: rarity.text }}>
          {rarity.label}
          {setId ? ` · ${COSMETIC_SETS[setId].name}` : ''}
        </span>
        <h2 id="bought-heading" className="font-display text-2xl font-bold text-[#f5f0e1]">
          {item.name} is yours
        </h2>
        <p className="text-sm text-bf-muted">
          <span className="tabular-nums">{price}</span> gold spent · <span className="tabular-nums">{gold.toLocaleString()}</span> left
        </p>

        {setId && setItems.length > 0 && (
          <div
            data-testid="bought-set-progress"
            className="mt-2 flex w-full flex-col items-center gap-2 rounded-xl border px-4 py-3"
            style={{ borderColor: `${setAccent}4d`, background: `${setAccent}10` }}
          >
            <span className="flex gap-1.5" aria-hidden>
              {setItems.map((i, n) => (
                <span
                  key={i.cosmetic_id}
                  className="block h-1.5 w-10 rounded-full"
                  style={n < setOwned
                    ? { background: setAccent, boxShadow: `0 0 10px ${setAccent}` }
                    : { background: 'rgba(255, 255, 255, 0.12)' }}
                />
              ))}
            </span>
            <span className="text-[13px] text-bf-text">
              {COSMETIC_SETS[setId].name}: {setOwned} of {setItems.length} collected
            </span>
          </div>
        )}

        <div className="mt-4 grid w-full grid-cols-2 gap-2.5">
          {SLOT_BY_TYPE[item.type] && (
            <button type="button" className="btn-primary min-h-12 px-3 text-[15px]" disabled={busy} onClick={onWear}>
              Wear it now
            </button>
          )}
          <button
            type="button"
            className={clsx('btn-secondary min-h-12 px-3 text-[15px]', !SLOT_BY_TYPE[item.type] && 'col-span-2')}
            onClick={onCancel}
          >
            Keep browsing
          </button>
        </div>
      </div>
    </Modal>
  );
}
