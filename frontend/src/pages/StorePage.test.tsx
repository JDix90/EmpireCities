import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import StorePage from './StorePage';
import { useAuthStore } from '../store/authStore';
import { storeRefundsSeenKey } from '../utils/storeRefundNotice';

const getMock = vi.fn();
const postMock = vi.fn();
const putMock = vi.fn();
vi.mock('../services/api', () => ({
  api: {
    get: (...a: unknown[]) => getMock(...a),
    post: (...a: unknown[]) => postMock(...a),
    put: (...a: unknown[]) => putMock(...a),
  },
}));

const row = (over: Record<string, unknown>) => ({
  description: null, asset_url: null, is_premium: true, rarity: 'common',
  owned: false, earned_only: false, locked: false, ...over,
});
const CATALOG = [
  row({ cosmetic_id: 'bone_dice', type: 'dice_skin', name: 'Ancient Bone Dice', price_gems: 200 }),
  row({ cosmetic_id: 'holo_dice', type: 'dice_skin', name: 'Holographic Dice', price_gems: 250 }),
  row({ cosmetic_id: 'general_banner', type: 'profile_banner', name: 'General Banner', price_gems: 150, owned: true }),
  row({ cosmetic_id: 'emperor_title', type: 'profile_banner', name: 'Emperor Title', price_gems: 200 }),
  row({ cosmetic_id: 'frame_gold', type: 'profile_frame', name: 'Gold Conqueror', price_gems: 0, earned_only: true, owned: true }),
  row({ cosmetic_id: 'frame_level_50', type: 'profile_frame', name: 'Level 50 Frame', price_gems: 0, earned_only: true, rarity: 'legendary', locked: true }),
];

const REFUND = { item: 'Radar Screen', gold: 600, refunded_at: '2026-09-27T03:00:00.000Z' };

function serve({ gold = 220, banner = 'general_banner' as string | null, refunds = [] as unknown[] } = {}) {
  getMock.mockImplementation(async (url: string) => {
    if (url === '/store/catalog') return { data: { catalog: CATALOG, refunds } };
    if (url === '/users/me') {
      return { data: { gold, equipped_frame: null, equipped_banner: banner, equipped_marker: null, equipped_dice: null } };
    }
    return { data: {} };
  });
}

function renderStore({ guest = false } = {}) {
  useAuthStore.setState({ user: { user_id: 'u1', username: 'commander', is_guest: guest, gold: 220 } as never });
  return render(
    <MemoryRouter initialEntries={['/store']}>
      <StorePage />
    </MemoryRouter>,
  );
}

const card = (name: string) => screen.getByRole('article', { name });

describe('StorePage', () => {
  beforeEach(() => {
    getMock.mockReset();
    postMock.mockReset();
    putMock.mockReset();
    localStorage.clear();
  });

  it('tells a refunded player what was retired and what came back, until they dismiss it', async () => {
    serve({ refunds: [REFUND] });
    const { unmount } = renderStore();

    expect(
      await screen.findByText(
        'Radar Screen was retired from the store because it had no effect in matches. We refunded the 600 gold you paid.',
      ),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss refund notice' }));
    expect(screen.queryByText(/retired from the store/)).not.toBeInTheDocument();
    expect(localStorage.getItem(storeRefundsSeenKey('u1'))).toBe(REFUND.refunded_at);

    // The next visit doesn't bring it back.
    unmount();
    renderStore();
    expect(await screen.findByRole('article', { name: 'Ancient Bone Dice' })).toBeInTheDocument();
    expect(screen.queryByText(/retired from the store/)).not.toBeInTheDocument();
  });

  it('shows no notice to a player with no refunds', async () => {
    serve();
    renderStore();
    expect(await screen.findByRole('article', { name: 'Ancient Bone Dice' })).toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('offers no filter for the retired unit skins and map themes', async () => {
    serve();
    renderStore();
    expect(await screen.findByRole('button', { name: 'Dice' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Unit Skins' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Map Themes' })).not.toBeInTheDocument();
  });

  it('previews every item, lit by its rarity, with its price', async () => {
    serve();
    renderStore();
    await screen.findByRole('article', { name: 'Ancient Bone Dice' });

    const cards = screen.getAllByTestId('store-item');
    expect(cards).toHaveLength(CATALOG.length);
    expect(cards.every((c) => within(c).queryByTestId('cosmetic-preview'))).toBe(true);
    expect(within(card('Ancient Bone Dice')).getByTestId('rarity')).toHaveTextContent('Common');
    expect(within(card('Level 50 Frame')).getByTestId('rarity')).toHaveTextContent('Legendary');
    expect(card('Level 50 Frame')).toHaveClass('store-sheen');
    expect(within(card('Ancient Bone Dice')).getByRole('button', { name: /^Buy/ })).toHaveTextContent('200');
    expect(screen.getByRole('heading', { name: 'For sale' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Earned in play' })).toBeInTheDocument();
    expect(screen.getByText('1 of 2 earned')).toBeInTheDocument();
    // Earned in play, never sold: something to try on, nothing to buy.
    expect(within(card('Level 50 Frame')).queryByRole('button', { name: /^Buy/ })).toBeNull();
    expect(within(card('Level 50 Frame')).getByRole('button', { name: 'Try on Level 50 Frame' })).toBeInTheDocument();
  });

  it('shows how far the player’s gold goes toward an item they can’t afford yet', async () => {
    serve({ gold: 220 });
    renderStore();
    const holo = await screen.findByRole('article', { name: 'Holographic Dice' });
    const bar = await within(holo).findByRole('progressbar', { name: 'Gold toward Holographic Dice' });
    expect(bar).toHaveAttribute('aria-valuenow', '220');
    expect(bar).toHaveAttribute('aria-valuemax', '250');
    expect(within(holo).getByText(/to go/)).toHaveTextContent('30 to go');
    expect(within(holo).queryByRole('button', { name: /^Buy/ })).toBeNull();
    expect(within(card('Ancient Bone Dice')).getByRole('button', { name: /^Buy/ })).toBeEnabled();
  });

  it('buys after a confirmation, then wears it on the spot', async () => {
    serve();
    postMock.mockResolvedValueOnce({ data: { new_balance: 20 } });
    putMock.mockResolvedValueOnce({
      data: { ok: true, equipped: { frame: null, banner: 'general_banner', marker: null, dice: 'bone_dice' } },
    });
    renderStore();
    const bone = await screen.findByRole('article', { name: 'Ancient Bone Dice' });
    fireEvent.click(await within(bone).findByRole('button', { name: /^Buy/ }));

    const dialog = await screen.findByRole('dialog', { name: 'Confirm purchase' });
    expect(within(dialog).getByText(/Balance after purchase/)).toHaveTextContent('20 gold');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Buy' }));
    expect(postMock).toHaveBeenCalledWith('/store/buy', { cosmetic_id: 'bone_dice' });

    const bought = await screen.findByRole('dialog', { name: 'Ancient Bone Dice is yours' });
    expect(within(bought).getByText(/gold spent/)).toHaveTextContent('200 gold spent · 20 left');
    fireEvent.click(within(bought).getByRole('button', { name: 'Wear it now' }));
    expect(putMock).toHaveBeenCalledWith('/users/me/cosmetics/equip', { dice_id: 'bone_dice' });
    expect(await within(card('Ancient Bone Dice')).findByText('Wearing')).toBeInTheDocument();
    expect(useAuthStore.getState().user).toMatchObject({ gold: 20, equipped_dice: 'bone_dice' });
  });

  it('puts a slot back to Default from Your look', async () => {
    serve({ banner: 'general_banner' });
    putMock.mockResolvedValueOnce({ data: { ok: true, equipped: { frame: null, banner: null, marker: null, dice: null } } });
    renderStore();
    const look = await screen.findByRole('region', { name: 'Your look' });
    expect(within(look).getByText('How rivals see you')).toBeInTheDocument();
    const bannerSlot = within(look).getByTestId('loadout-slot-banner');
    await within(bannerSlot).findByText('General Banner');

    fireEvent.click(bannerSlot);
    const picker = screen.getByRole('group', { name: 'Choose your banner' });
    expect(within(picker).getByRole('button', { name: /General Banner/ })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(within(picker).getByRole('button', { name: /Default/ }));

    expect(putMock).toHaveBeenCalledWith('/users/me/cosmetics/equip', { banner_id: null });
    expect(await within(bannerSlot).findByText('Default')).toBeInTheDocument();
  });

  it('tries an item on in Your look, and puts it back', async () => {
    serve({ gold: 220 });
    renderStore();
    const look = await screen.findByRole('region', { name: 'Your look' });
    expect(within(look).getByTestId('look-die')).not.toHaveAttribute('data-dice');

    fireEvent.click(await screen.findByRole('button', { name: 'Try on Holographic Dice' }));
    expect(within(look).getByTestId('look-die')).toHaveAttribute('data-dice', 'holo_dice');
    const banner = within(look).getByTestId('try-on-banner');
    expect(banner).toHaveTextContent('Trying on Holographic Dice');
    expect(banner).toHaveTextContent('30 more gold to buy');
    expect(within(look).getByTestId('loadout-slot-dice')).toHaveTextContent('Holographic Dice');
    expect(screen.getByRole('button', { name: 'Try on Holographic Dice' })).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(within(banner).getByRole('button', { name: 'Put back' }));
    expect(within(look).queryByTestId('try-on-banner')).toBeNull();
    expect(within(look).getByTestId('look-die')).not.toHaveAttribute('data-dice');
    expect(putMock).not.toHaveBeenCalled();
  });

  it('wears an owned item straight from trying it on', async () => {
    serve();
    putMock.mockResolvedValueOnce({
      data: { ok: true, equipped: { frame: 'frame_gold', banner: 'general_banner', marker: null, dice: null } },
    });
    renderStore();
    const look = await screen.findByRole('region', { name: 'Your look' });
    fireEvent.click(await screen.findByRole('button', { name: 'Try on Gold Conqueror' }));
    fireEvent.click(within(within(look).getByTestId('try-on-banner')).getByRole('button', { name: 'Wear it' }));

    expect(putMock).toHaveBeenCalledWith('/users/me/cosmetics/equip', { frame_id: 'frame_gold' });
    await waitFor(() => expect(within(look).queryByTestId('try-on-banner')).toBeNull());
    expect(within(look).getByTestId('loadout-slot-frame')).toHaveTextContent('Gold Conqueror');
    expect(within(card('Gold Conqueror')).getByText('Wearing')).toBeInTheDocument();
  });

  it('says an item not yet earned is earned in play when it is tried on, and offers nothing to buy', async () => {
    serve();
    renderStore();
    const look = await screen.findByRole('region', { name: 'Your look' });
    fireEvent.click(await screen.findByRole('button', { name: 'Try on Level 50 Frame' }));
    const banner = within(look).getByTestId('try-on-banner');
    expect(banner).toHaveTextContent('Earned in play');
    expect(within(banner).queryByRole('button', { name: /^Buy|Wear it/ })).toBeNull();
  });

  it('pins what is being tried on to the bottom of the screen while Your look is out of view', async () => {
    serve({ gold: 220 });
    renderStore();
    fireEvent.click(await screen.findByRole('button', { name: 'Try on Ancient Bone Dice' }));
    const bar = screen.getByRole('region', { name: 'Trying on' });
    expect(bar).toHaveTextContent('Ancient Bone Dice');
    fireEvent.click(within(bar).getByRole('button', { name: /^Buy/ }));
    expect(await screen.findByRole('dialog', { name: 'Confirm purchase' })).toBeInTheDocument();
  });

  it('keeps that bar away while Your look is on screen', async () => {
    class OnScreen {
      constructor(private readonly callback: IntersectionObserverCallback) {}
      observe(target: Element) {
        this.callback([{ isIntersecting: true, target } as IntersectionObserverEntry], this as unknown as IntersectionObserver);
      }
      unobserve() {}
      disconnect() {}
      takeRecords() {
        return [];
      }
    }
    vi.stubGlobal('IntersectionObserver', OnScreen);
    try {
      serve({ gold: 220 });
      renderStore();
      fireEvent.click(await screen.findByRole('button', { name: 'Try on Ancient Bone Dice' }));
      expect(screen.getByTestId('try-on-banner')).toBeInTheDocument();
      expect(screen.queryByRole('region', { name: 'Trying on' })).toBeNull();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('lists the era sets first, each with its era, price and progress', async () => {
    getMock.mockImplementation(async (url: string) => {
      if (url === '/store/catalog') {
        return {
          data: {
            catalog: [
              ...CATALOG,
              row({ cosmetic_id: 'marker_imperium_temple', type: 'map_marker', name: 'Temple Marker', price_gems: 450, rarity: 'uncommon', cosmetic_set: 'imperium' }),
              row({ cosmetic_id: 'dice_imperium_marble', type: 'dice_skin', name: 'Marble Dice', price_gems: 250, cosmetic_set: 'imperium' }),
            ],
            refunds: [],
          },
        };
      }
      if (url === '/users/me') return { data: { gold: 220 } };
      return { data: {} };
    });
    renderStore();
    const imperium = await screen.findByRole('region', { name: 'Imperium' });
    expect(within(imperium).getByText('Ancient World')).toBeInTheDocument();
    expect(within(imperium).getByText('2 items · 700 gold for the whole set')).toBeInTheDocument();
    expect(within(imperium).getByText('0 of 2 collected')).toBeInTheDocument();
    expect(within(imperium).getAllByRole('article').map((a) => a.getAttribute('data-item')))
      .toEqual(['marker_imperium_temple', 'dice_imperium_marble']);
    expect(screen.getByRole('region', { name: 'More for sale' })).toBeInTheDocument();
  });

  it('counts a set’s progress up when one of its items is bought', async () => {
    getMock.mockImplementation(async (url: string) => {
      if (url === '/store/catalog') {
        return {
          data: {
            catalog: [
              ...CATALOG,
              row({ cosmetic_id: 'marker_imperium_temple', type: 'map_marker', name: 'Temple Marker', price_gems: 450, rarity: 'uncommon', cosmetic_set: 'imperium' }),
              row({ cosmetic_id: 'dice_imperium_marble', type: 'dice_skin', name: 'Marble Dice', price_gems: 250, cosmetic_set: 'imperium', owned: true }),
            ],
            refunds: [],
          },
        };
      }
      if (url === '/users/me') return { data: { gold: 500 } };
      return { data: {} };
    });
    postMock.mockResolvedValueOnce({ data: { new_balance: 50 } });
    renderStore();
    const imperium = await screen.findByRole('region', { name: 'Imperium' });
    expect(within(imperium).getByText('1 of 2 collected')).toBeInTheDocument();
    fireEvent.click(await within(card('Temple Marker')).findByRole('button', { name: /^Buy/ }));
    fireEvent.click(within(await screen.findByRole('dialog', { name: 'Confirm purchase' })).getByRole('button', { name: 'Buy' }));

    const bought = await screen.findByRole('dialog', { name: 'Temple Marker is yours' });
    expect(within(bought).getByText(/gold spent/)).toHaveTextContent('450 gold spent · 50 left');
    expect(within(bought).getByTestId('bought-set-progress')).toHaveTextContent('Imperium: 2 of 2 collected');
    expect(within(bought).getByTestId('capital-marker')).toBeInTheDocument();
    expect(within(imperium).getByText('2 of 2 collected')).toBeInTheDocument();
  });

  it('lets guests browse, but not try on, buy or wear', async () => {
    serve({ gold: 0 });
    renderStore({ guest: true });
    const bone = await screen.findByRole('article', { name: 'Ancient Bone Dice' });
    expect(screen.queryByRole('heading', { name: 'Your look' })).toBeNull();
    expect(screen.getByText(/Guest accounts earn gold/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Try on/ })).toBeNull();

    fireEvent.click(await within(bone).findByRole('button', { name: /^Buy/ }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(postMock).not.toHaveBeenCalled();
  });
});
