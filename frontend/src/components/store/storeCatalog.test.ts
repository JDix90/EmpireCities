import { describe, it, expect } from 'vitest';
import { catalogSections, itemAction, loadoutOf, type CatalogItem, type Loadout } from './storeCatalog';

const item = (over: Partial<CatalogItem>): CatalogItem => ({
  cosmetic_id: 'x', type: 'dice_skin', name: 'X', description: null, price_gems: 200,
  rarity: 'common', owned: false, earned_only: false, locked: false, ...over,
});
const none: Loadout = { frame: null, banner: null, marker: null, dice: null };

describe('itemAction', () => {
  it('equipped, or equip, for what the player owns', () => {
    expect(itemAction(item({ owned: true }), { gold: 0, worn: { ...none, dice: 'x' } })).toEqual({ kind: 'equipped' });
    expect(itemAction(item({ owned: true }), { gold: 0, worn: none })).toEqual({ kind: 'equip' });
  });

  it('buy when the player can afford it, and how much more gold when not', () => {
    expect(itemAction(item({ price_gems: 200 }), { gold: 200, worn: none })).toEqual({ kind: 'buy' });
    expect(itemAction(item({ price_gems: 250 }), { gold: 220, worn: none })).toEqual({ kind: 'short', need: 30 });
  });

  it('earn for what the store does not sell', () => {
    expect(itemAction(item({ locked: true, price_gems: 0 }), { gold: 9999, worn: none })).toEqual({ kind: 'earn' });
    expect(itemAction(item({ price_gems: 0 }), { gold: 9999, worn: none })).toEqual({ kind: 'earn' });
  });
});

describe('catalogSections', () => {
  const catalog = [
    item({ cosmetic_id: 'holo', name: 'Holo', price_gems: 250 }),
    item({ cosmetic_id: 'bone', name: 'Bone', price_gems: 200 }),
    item({ cosmetic_id: 'banner', type: 'profile_banner', name: 'Banner', price_gems: 150 }),
    item({ cosmetic_id: 'gold', type: 'profile_frame', name: 'Gold', price_gems: 0, earned_only: true, locked: true }),
    item({ cosmetic_id: 'l50', type: 'profile_frame', name: 'L50', price_gems: 0, earned_only: true, rarity: 'legendary', locked: true }),
    item({ cosmetic_id: 'skin', type: 'unit_skin', name: 'Old skin', price_gems: 300 }),
  ];

  it('puts what is sold before what is earned, frames first, cheapest first', () => {
    const sections = catalogSections(catalog, 'all');
    expect(sections.map((s) => s.id)).toEqual(['for-sale', 'earned']);
    expect(sections[0].items.map((i) => i.cosmetic_id)).toEqual(['banner', 'bone', 'holo']);
    expect(sections[1].items.map((i) => i.cosmetic_id)).toEqual(['gold', 'l50']);
  });

  it('leaves out types with no slot, and filters by type', () => {
    expect(catalogSections(catalog, 'all').flatMap((s) => s.items).some((i) => i.type === 'unit_skin')).toBe(false);
    const frames = catalogSections(catalog, 'profile_frame');
    expect(frames.map((s) => s.id)).toEqual(['earned']);
  });
});

describe('loadoutOf', () => {
  it('reads the four slots of a /users/me payload', () => {
    expect(loadoutOf({ equipped_frame: 'f', equipped_banner: null, equipped_dice: 'd' }))
      .toEqual({ frame: 'f', banner: null, marker: null, dice: 'd' });
    expect(loadoutOf(null)).toEqual(none);
  });
});
