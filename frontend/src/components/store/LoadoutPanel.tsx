import React, { useMemo, useState } from 'react';
import clsx from 'clsx';
import { Check } from 'lucide-react';
import CosmeticPreview from '../cosmetics/CosmeticPreview';
import DefaultLook from './DefaultLook';
import {
  SLOT_BY_TYPE,
  SLOT_HINTS,
  SLOT_LABELS,
  SLOTS,
  compareItems,
  type CatalogItem,
  type Loadout,
  type Slot,
} from './storeCatalog';

/**
 * What the player wears, one tile per slot. A tile opens its choices: the
 * items owned for that slot, and Default, which takes the item off.
 */
export default function LoadoutPanel({
  worn,
  owned,
  initial,
  pending,
  onPick,
}: {
  worn: Loadout;
  /** Everything the player owns. */
  owned: CatalogItem[];
  initial: string;
  /** The slot with a change in flight. */
  pending: Slot | null;
  onPick: (slot: Slot, item: CatalogItem | null) => void;
}) {
  const [open, setOpen] = useState<Slot | null>(null);
  const byId = useMemo(() => new Map(owned.map((i) => [i.cosmetic_id, i])), [owned]);
  const options = useMemo(
    () => (open ? owned.filter((i) => SLOT_BY_TYPE[i.type] === open).sort(compareItems) : []),
    [open, owned],
  );

  return (
    <section aria-labelledby="loadout-heading" className="card mb-6 p-4 sm:p-6">
      <div className="mb-3 flex items-baseline justify-between gap-2">
        <div>
          <h2 id="loadout-heading" className="font-display text-bf-gold">Your look</h2>
          <p className="text-xs text-bf-muted">How rivals see you</p>
        </div>
        <p className="text-right text-xs text-bf-muted">Choose a slot to change it</p>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-3">
        {SLOTS.map((slot) => {
          const item = worn[slot] ? byId.get(worn[slot]!) : undefined;
          return (
            <button
              key={slot}
              type="button"
              aria-expanded={open === slot}
              aria-controls={open === slot ? 'loadout-picker' : undefined}
              onClick={() => setOpen(open === slot ? null : slot)}
              data-testid={`loadout-slot-${slot}`}
              className={clsx(
                'flex min-h-11 flex-col gap-1.5 rounded-lg border p-2 text-left transition-colors',
                open === slot ? 'border-bf-gold/60 bg-bf-gold/10' : 'border-bf-border hover:border-bf-muted',
              )}
            >
              <span className="text-[11px] font-semibold uppercase tracking-wider text-bf-muted">{SLOT_LABELS[slot]}</span>
              {item ? (
                <CosmeticPreview cosmeticId={item.cosmetic_id} type={item.type} initial={initial} />
              ) : (
                <DefaultLook slot={slot} initial={initial} />
              )}
              <span className="truncate text-sm text-bf-text">{item?.name ?? 'Default'}</span>
            </button>
          );
        })}
      </div>

      {open && (
        <div id="loadout-picker" className="mt-3 border-t border-bf-border pt-3">
          <p className="mb-2 text-xs text-bf-muted">{SLOT_HINTS[open]}</p>
          <div
            role="group"
            aria-label={`Choose your ${SLOT_LABELS[open].toLowerCase()}`}
            className="flex gap-2 overflow-x-auto pb-1"
          >
            {[null, ...options].map((item) => {
              const isWorn = item ? worn[open] === item.cosmetic_id : !worn[open];
              return (
                <button
                  key={item?.cosmetic_id ?? 'default'}
                  type="button"
                  aria-pressed={isWorn}
                  disabled={pending === open}
                  onClick={() => !isWorn && onPick(open, item)}
                  className={clsx(
                    'flex w-28 min-h-11 shrink-0 flex-col gap-1 rounded-lg border p-1.5 text-left disabled:opacity-60',
                    isWorn ? 'border-bf-gold/60 bg-bf-gold/10' : 'border-bf-border hover:border-bf-muted',
                  )}
                >
                  {item ? (
                    <CosmeticPreview cosmeticId={item.cosmetic_id} type={item.type} initial={initial} />
                  ) : (
                    <DefaultLook slot={open} initial={initial} />
                  )}
                  <span className="flex items-center gap-1 text-xs text-bf-text">
                    {isWorn && <Check className="h-3 w-3 shrink-0 text-bf-gold" aria-hidden />}
                    <span className="truncate">{item?.name ?? 'Default'}</span>
                  </span>
                </button>
              );
            })}
          </div>
          {options.length === 0 && (
            <p className="mt-2 text-xs text-bf-muted">Nothing to wear here yet: buy or earn one below.</p>
          )}
        </div>
      )}
    </section>
  );
}
