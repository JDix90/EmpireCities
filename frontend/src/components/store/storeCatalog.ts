import { COSMETIC_SETS, type CosmeticRarity } from '@borderfall/shared';

/** A catalog row as GET /store/catalog sends it. */
export interface CatalogItem {
  cosmetic_id: string;
  type: string;
  name: string;
  description: string | null;
  price_gems: number;
  rarity?: CosmeticRarity | null;
  owned: boolean;
  /** Earned through gameplay; never sold. */
  earned_only?: boolean;
  /** Server-authoritative: not owned and not for sale. */
  locked?: boolean;
  /** The era set it belongs to (migration 046). */
  cosmetic_set?: string | null;
}

export type Slot = 'frame' | 'banner' | 'marker' | 'dice';
export type Loadout = Record<Slot, string | null>;

export const SLOTS: readonly Slot[] = ['frame', 'banner', 'marker', 'dice'];

export const SLOT_BY_TYPE: Readonly<Record<string, Slot>> = {
  profile_frame: 'frame',
  profile_banner: 'banner',
  map_marker: 'marker',
  dice_skin: 'dice',
};

export const TYPE_BY_SLOT: Readonly<Record<Slot, string>> = {
  frame: 'profile_frame',
  banner: 'profile_banner',
  marker: 'map_marker',
  dice: 'dice_skin',
};

/** Each slot's key in PUT /users/me/cosmetics/equip. */
export const SLOT_KEY: Readonly<Record<Slot, 'frame_id' | 'banner_id' | 'marker_id' | 'dice_id'>> = {
  frame: 'frame_id',
  banner: 'banner_id',
  marker: 'marker_id',
  dice: 'dice_id',
};

export const SLOT_LABELS: Readonly<Record<Slot, string>> = {
  frame: 'Frame',
  banner: 'Banner',
  marker: 'Map marker',
  dice: 'Dice',
};

/** Where each slot shows, for the loadout panel. */
export const SLOT_HINTS: Readonly<Record<Slot, string>> = {
  frame: 'Around your name on your profile and in matches',
  banner: 'Beside your name on your profile and in matches',
  marker: 'On your capital, on both maps',
  dice: 'Your rolls in every battle',
};

export const EMPTY_LOADOUT: Loadout = { frame: null, banner: null, marker: null, dice: null };

/** The loadout in a /users/me payload. */
export function loadoutOf(me: {
  equipped_frame?: string | null;
  equipped_banner?: string | null;
  equipped_marker?: string | null;
  equipped_dice?: string | null;
} | null | undefined): Loadout {
  return {
    frame: me?.equipped_frame ?? null,
    banner: me?.equipped_banner ?? null,
    marker: me?.equipped_marker ?? null,
    dice: me?.equipped_dice ?? null,
  };
}

/** What a card offers the player. */
export type ItemAction =
  | { kind: 'equipped' }
  | { kind: 'equip' }
  | { kind: 'buy' }
  | { kind: 'short'; need: number }
  | { kind: 'earn' };

export function itemAction(
  item: CatalogItem,
  { gold, worn, guest = false }: { gold: number; worn: Loadout; guest?: boolean },
): ItemAction {
  if (item.owned) {
    const slot = SLOT_BY_TYPE[item.type];
    return slot && worn[slot] === item.cosmetic_id ? { kind: 'equipped' } : { kind: 'equip' };
  }
  if (item.locked || item.price_gems <= 0) return { kind: 'earn' };
  // A guest can't buy at any balance: Buy is where they are asked for an account.
  if (guest) return { kind: 'buy' };
  const need = item.price_gems - gold;
  return need > 0 ? { kind: 'short', need } : { kind: 'buy' };
}

/** Sold for gold, as opposed to earned in play. */
export const isForSale = (item: CatalogItem) =>
  item.price_gems > 0 && !item.earned_only && item.rarity !== 'legendary' && item.rarity !== 'mythic';

export type TypeFilter = 'all' | 'profile_frame' | 'profile_banner' | 'map_marker' | 'dice_skin';

export const TYPE_FILTERS: ReadonlyArray<{ key: TypeFilter; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'profile_frame', label: 'Frames' },
  { key: 'profile_banner', label: 'Banners' },
  { key: 'map_marker', label: 'Markers' },
  { key: 'dice_skin', label: 'Dice' },
];

const TYPE_ORDER = ['profile_frame', 'profile_banner', 'map_marker', 'dice_skin'];
const RARITY_ORDER = ['common', 'uncommon', 'rare', 'legendary', 'mythic'];
const rank = (order: string[], value: string | null | undefined) => {
  const i = order.indexOf(value ?? '');
  return i === -1 ? order.length : i;
};

/** Frames, banners, markers, dice; then rarity, price and name. */
export function compareItems(a: CatalogItem, b: CatalogItem): number {
  return (
    rank(TYPE_ORDER, a.type) - rank(TYPE_ORDER, b.type)
    || rank(RARITY_ORDER, a.rarity ?? 'common') - rank(RARITY_ORDER, b.rarity ?? 'common')
    || a.price_gems - b.price_gems
    || a.name.localeCompare(b.name)
  );
}

export interface CatalogSection {
  id: string;
  title: string;
  subtitle: string;
  items: CatalogItem[];
}

/** The era set an item is sold in, if the store knows that set. */
const setOf = (item: CatalogItem) =>
  item.cosmetic_set && Object.prototype.hasOwnProperty.call(COSMETIC_SETS, item.cosmetic_set) ? item.cosmetic_set : null;

/**
 * The catalog as the page lays it out: each era set, then everything else
 * for sale, then what is earned in play. Items of a type the loadout has no
 * slot for are left out; the store retired them (migration 044).
 */
export function catalogSections(items: CatalogItem[], filter: TypeFilter): CatalogSection[] {
  const shown = items
    .filter((i) => SLOT_BY_TYPE[i.type] && (filter === 'all' || i.type === filter))
    .sort(compareItems);
  const sets: CatalogSection[] = Object.entries(COSMETIC_SETS).map(([id, set]) => {
    const setItems = shown.filter((i) => isForSale(i) && setOf(i) === id);
    const total = setItems.reduce((sum, i) => sum + i.price_gems, 0);
    return {
      id: `set-${id}`,
      title: set.name,
      subtitle: `${set.era} set · ${setItems.length} ${setItems.length === 1 ? 'item' : 'items'} · ${total.toLocaleString()} gold in all`,
      items: setItems,
    };
  });
  const sections: CatalogSection[] = [
    ...sets,
    {
      id: 'for-sale',
      title: sets.some((s) => s.items.length > 0) ? 'More for sale' : 'For sale',
      subtitle: 'Bought with gold you earn by playing.',
      items: shown.filter((i) => isForSale(i) && !setOf(i)),
    },
    {
      id: 'earned',
      title: 'Earned in play',
      subtitle: 'Never sold: win them through levels, streaks, seasons and achievements.',
      items: shown.filter((i) => !isForSale(i)),
    },
  ];
  return sections.filter((s) => s.items.length > 0);
}
