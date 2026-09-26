import React, { useMemo, useState } from 'react';
import clsx from 'clsx';
import { Check, ChevronDown } from 'lucide-react';
import { bannerLook, diceLook } from '@borderfall/shared';
import BannerTag from '../cosmetics/BannerTag';
import CapitalPreview from '../cosmetics/CapitalPreview';
import CosmeticPreview from '../cosmetics/CosmeticPreview';
import FrameRing from '../cosmetics/FrameRing';
import { diceEffectClass, diceFaceStyle } from '../cosmetics/diceSkin';
import DefaultLook from './DefaultLook';
import { TryOnPrimary, tryOnStatus } from './tryOn';
import {
  SLOT_BY_TYPE,
  SLOT_HINTS,
  SLOT_LABELS,
  SLOTS,
  compareItems,
  type CatalogItem,
  type ItemAction,
  type Loadout,
  type Slot,
} from './storeCatalog';

const DIE = 'flex h-14 w-14 items-center justify-center rounded-xl font-mono text-[28px] font-bold';

/**
 * What the player wears, as rivals see it: on their profile, on their capital
 * and in battle. An item being tried on takes its slot's place until it is
 * put back, bought or worn. A slot's tile opens its choices: the items owned
 * for that slot, and Default, which takes the item off.
 */
export default function YourLook({
  worn,
  catalog,
  trying,
  tryAction,
  initial,
  name,
  pending,
  busy,
  motion,
  onPick,
  onPutBack,
  onWearTried,
  onBuyTried,
  sectionRef,
}: {
  worn: Loadout;
  /** The whole catalog: names every item, and holds what the player owns. */
  catalog: CatalogItem[];
  trying: CatalogItem | null;
  /** What the player can do with the item being tried on. */
  tryAction: ItemAction | null;
  initial: string;
  /** The player's name, as rivals read it. */
  name: string;
  /** The slot with a change in flight. */
  pending: Slot | null;
  /** A request is in flight. */
  busy: boolean;
  /** Cosmetic motion is allowed (not lite mode). */
  motion: boolean;
  onPick: (slot: Slot, item: CatalogItem | null) => void;
  onPutBack: () => void;
  onWearTried: () => void;
  onBuyTried: () => void;
  sectionRef?: React.Ref<HTMLElement>;
}) {
  const [open, setOpen] = useState<Slot | null>(null);
  const byId = useMemo(() => new Map(catalog.map((i) => [i.cosmetic_id, i])), [catalog]);
  const owned = useMemo(() => catalog.filter((i) => i.owned && SLOT_BY_TYPE[i.type]), [catalog]);
  const options = useMemo(
    () => (open ? owned.filter((i) => SLOT_BY_TYPE[i.type] === open).sort(compareItems) : []),
    [open, owned],
  );
  const trySlot = trying ? SLOT_BY_TYPE[trying.type] : undefined;
  const shown: Loadout = trying && trySlot ? { ...worn, [trySlot]: trying.cosmetic_id } : worn;
  const nameOf = (id: string | null) => (id ? byId.get(id)?.name ?? 'Default' : 'Default');
  const letter = initial.slice(0, 1).toUpperCase();
  const dice = diceLook(shown.dice);

  return (
    <section
      ref={sectionRef}
      aria-labelledby="look-heading"
      data-testid="your-look"
      className="mb-6 flex flex-col gap-4 rounded-2xl border border-bf-border p-4 sm:p-6"
      style={{
        background:
          'radial-gradient(900px 300px at 12% 0%, rgba(201, 168, 76, 0.11), transparent 70%), linear-gradient(180deg, #1a1f2e, #141927)',
      }}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h2 id="look-heading" className="font-display text-xl font-semibold text-bf-gold sm:text-2xl">Your look</h2>
          <p className="text-xs text-bf-muted sm:text-[13px]">How rivals see you</p>
        </div>
        {trying && tryAction ? (
          <div
            data-testid="try-on-banner"
            className="flex flex-wrap items-center gap-2 rounded-xl border border-dashed border-[#f3d98b]/60 bg-bf-gold/[0.08] py-1.5 pl-4 pr-1.5"
          >
            <span className="text-sm text-bf-text">
              Trying on <strong className="font-semibold text-[#f3d98b]">{trying.name}</strong>
            </span>
            <TryOnPrimary item={trying} action={tryAction} busy={busy} onBuy={onBuyTried} onWear={onWearTried} />
            {tryAction.kind !== 'buy' && tryAction.kind !== 'equip' && (
              <span className="px-1 text-[13px] text-bf-muted">{tryOnStatus(trying, tryAction)}</span>
            )}
            <button type="button" onClick={onPutBack} className="btn-secondary shrink-0 px-4 text-sm">Put back</button>
          </div>
        ) : (
          <p className="hidden text-xs text-bf-muted sm:block">Choose anything below to try it on.</p>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Stage label="On your profile" className="col-span-2 sm:col-span-1">
          <div className="flex min-h-[96px] items-center gap-4">
            <FrameRing frameId={shown.frame} className="p-1.5" glow="strong">
              <span className="flex h-[68px] w-[68px] items-center justify-center rounded-full bg-[radial-gradient(circle_at_35%_30%,#2a3246,#161b27)] font-display text-3xl text-bf-text sm:h-[76px] sm:w-[76px]">
                {letter}
              </span>
            </FrameRing>
            <div className="flex min-w-0 flex-col gap-2">
              <span className="truncate font-display text-lg font-semibold text-bf-gold sm:text-xl">{name}</span>
              {bannerLook(shown.banner) ? (
                <BannerTag bannerId={shown.banner} size="md" className="self-start" />
              ) : (
                <span className="text-xs text-bf-muted">No banner</span>
              )}
              <span className="text-[11px] text-bf-muted">Also beside your name in every match</span>
            </div>
          </div>
        </Stage>

        <Stage label="On your capital">
          <div className="relative flex min-h-[96px] flex-1 items-center justify-center overflow-hidden rounded-lg bg-[#0c1624]">
            <CapitalPreview
              key={shown.marker ?? 'none'}
              markerId={shown.marker}
              className="w-[118px] sm:w-[132px]"
              pipClassName={motion && trySlot === 'marker' ? 'store-drop-in' : undefined}
            />
            <span className="absolute bottom-1.5 left-2 max-w-[calc(100%-1rem)] truncate rounded bg-[#080a10]/75 px-1.5 py-0.5 text-[10px] text-slate-300">
              {shown.marker ? nameOf(shown.marker) : 'No marker'}
            </span>
          </div>
        </Stage>

        <Stage label="In battle">
          <div className="flex min-h-[96px] flex-1 items-center justify-center gap-3 sm:gap-4">
            <span className="flex flex-col items-center gap-2">
              {dice ? (
                <span
                  key={shown.dice ?? 'none'}
                  data-testid="look-die"
                  data-dice={shown.dice ?? undefined}
                  className={clsx(
                    DIE,
                    'shadow-[0_12px_24px_-8px_rgba(0,0,0,0.7)] ring-[3px] ring-red-500/85',
                    motion && diceEffectClass(dice, false),
                    motion && trySlot === 'dice' && 'store-tumble-once',
                  )}
                  style={{ ...diceFaceStyle(dice), borderWidth: 2 }}
                >
                  6
                </span>
              ) : (
                <span data-testid="look-die" className={clsx(DIE, 'bg-red-500/25 text-red-300 ring-[3px] ring-red-500/60')}>6</span>
              )}
              <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-red-300">You</span>
            </span>
            <span className="font-display text-sm text-slate-500">vs</span>
            <span className="flex flex-col items-center gap-2">
              <span className="flex h-12 w-12 items-center justify-center rounded-xl border-2 border-slate-700 bg-gradient-to-br from-slate-800 to-slate-900 font-mono text-2xl font-bold text-blue-200 ring-[3px] ring-blue-500/80">
                4
              </span>
              <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-blue-300">Rival</span>
            </span>
          </div>
        </Stage>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {SLOTS.map((slot) => {
          const isTrying = trySlot === slot;
          return (
            <button
              key={slot}
              type="button"
              aria-expanded={open === slot}
              aria-controls={open === slot ? 'loadout-picker' : undefined}
              onClick={() => setOpen(open === slot ? null : slot)}
              data-testid={`loadout-slot-${slot}`}
              className={clsx(
                'flex min-h-[52px] items-center justify-between gap-2 rounded-xl border px-3 py-2 text-left transition-colors',
                open === slot
                  ? 'border-bf-gold/60 bg-bf-gold/10'
                  : isTrying
                    ? 'border-[#f3d98b]/70 bg-bf-gold/[0.08]'
                    : 'border-bf-border bg-[#080a10]/35 hover:border-bf-muted',
              )}
            >
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-bf-muted">{SLOT_LABELS[slot]}</span>
                <span className="truncate text-sm text-bf-text">{nameOf(shown[slot])}</span>
              </span>
              {isTrying ? (
                <span className="shrink-0 text-[11px] font-semibold text-[#f3d98b]">Trying on</span>
              ) : (
                <ChevronDown
                  className={clsx('h-4 w-4 shrink-0 text-bf-muted transition-transform', open === slot && 'rotate-180')}
                  aria-hidden
                />
              )}
            </button>
          );
        })}
      </div>

      {open && (
        <div id="loadout-picker" className="border-t border-bf-border pt-3">
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
                    'flex min-h-11 w-28 shrink-0 flex-col gap-1 rounded-lg border p-1.5 text-left disabled:opacity-60',
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

function Stage({ label, className, children }: { label: string; className?: string; children: React.ReactNode }) {
  return (
    <div className={clsx('flex flex-col gap-2.5 rounded-xl border border-[#262d40] bg-[#080a10]/45 p-3 sm:p-4', className)}>
      <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-bf-muted">{label}</span>
      {children}
    </div>
  );
}
