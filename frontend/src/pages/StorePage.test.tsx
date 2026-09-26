import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
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

  it('previews every item, with its rarity and price', async () => {
    serve();
    renderStore();
    await screen.findByRole('article', { name: 'Ancient Bone Dice' });

    const cards = screen.getAllByTestId('store-item');
    expect(cards).toHaveLength(CATALOG.length);
    expect(cards.every((c) => within(c).queryByTestId('cosmetic-preview'))).toBe(true);
    expect(within(card('Ancient Bone Dice')).getByText('common')).toBeInTheDocument();
    expect(within(card('Level 50 Frame')).getByText('legendary')).toBeInTheDocument();
    expect(within(card('Ancient Bone Dice')).getByText('200')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'For sale' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Earned in play' })).toBeInTheDocument();
    expect(within(card('Level 50 Frame')).queryByRole('button')).toBeNull();
  });

  it('says how much more gold an item needs', async () => {
    serve({ gold: 220 });
    renderStore();
    const holo = await screen.findByRole('article', { name: 'Holographic Dice' });
    await within(holo).findByRole('button', { name: 'Need 30 more' });
    expect(within(holo).getByRole('button', { name: 'Need 30 more' })).toBeDisabled();
    expect(within(card('Ancient Bone Dice')).getByRole('button', { name: 'Buy' })).toBeEnabled();
  });

  it('buys after a confirmation, then equips it on the spot', async () => {
    serve();
    postMock.mockResolvedValueOnce({ data: { new_balance: 20 } });
    putMock.mockResolvedValueOnce({
      data: { ok: true, equipped: { frame: null, banner: 'general_banner', marker: null, dice: 'bone_dice' } },
    });
    renderStore();
    const bone = await screen.findByRole('article', { name: 'Ancient Bone Dice' });
    await within(bone).findByRole('button', { name: 'Buy' });
    fireEvent.click(within(bone).getByRole('button', { name: 'Buy' }));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/Balance after purchase/)).toHaveTextContent('20 gold');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Buy' }));
    expect(postMock).toHaveBeenCalledWith('/store/buy', { cosmetic_id: 'bone_dice' });

    fireEvent.click(await screen.findByRole('button', { name: 'Equip now' }));
    expect(putMock).toHaveBeenCalledWith('/users/me/cosmetics/equip', { dice_id: 'bone_dice' });
    expect(await within(card('Ancient Bone Dice')).findByText('Equipped')).toBeInTheDocument();
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

  it('lists the era sets first, each with its era and total', async () => {
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
    expect(within(imperium).getByText('Ancient World set · 2 items · 700 gold in all')).toBeInTheDocument();
    expect(within(imperium).getAllByRole('article').map((a) => a.getAttribute('data-item')))
      .toEqual(['marker_imperium_temple', 'dice_imperium_marble']);
    expect(screen.getByRole('region', { name: 'More for sale' })).toBeInTheDocument();
  });

  it('lets guests browse but not buy or equip', async () => {
    serve({ gold: 0 });
    renderStore({ guest: true });
    const bone = await screen.findByRole('article', { name: 'Ancient Bone Dice' });
    expect(screen.queryByRole('heading', { name: 'Your look' })).toBeNull();
    expect(screen.getByText(/Guest accounts earn gold/)).toBeInTheDocument();

    fireEvent.click(await within(bone).findByRole('button', { name: 'Buy' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(postMock).not.toHaveBeenCalled();
  });
});
