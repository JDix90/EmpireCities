import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import StorePage from './StorePage';
import { useAuthStore } from '../store/authStore';
import { storeRefundsSeenKey } from '../utils/storeRefundNotice';

const getMock = vi.fn();
vi.mock('../services/api', () => ({
  api: { get: (...a: unknown[]) => getMock(...a), post: vi.fn(), put: vi.fn() },
}));

const REFUND = { item: 'Radar Screen', gold: 600, refunded_at: '2026-09-27T03:00:00.000Z' };
const OWNED_MEDAL = {
  cosmetic_id: 'frame_bronze',
  type: 'profile_frame',
  name: 'Bronze Commander',
  description: 'A bronze ring for your first victory.',
  asset_url: null,
  price_gems: 0,
  is_premium: false,
  rarity: 'common',
  earned_only: true,
  owned: true,
  locked: false,
};

function serve({ catalog = [] as unknown[], refunds = [] as unknown[] } = {}) {
  getMock.mockImplementation(async (url: string) => {
    if (url === '/store/catalog') return { data: { catalog, refunds } };
    if (url === '/users/me') return { data: { gold: 700 } };
    return { data: [] };
  });
}

function renderStore() {
  useAuthStore.setState({ user: { user_id: 'u1', username: 'commander', is_guest: false, gold: 700 } as never });
  return render(
    <MemoryRouter initialEntries={['/store']}>
      <StorePage />
    </MemoryRouter>,
  );
}

describe('StorePage', () => {
  beforeEach(() => {
    getMock.mockReset();
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
    expect(await screen.findByText('No items in this category.')).toBeInTheDocument();
    expect(screen.queryByText(/retired from the store/)).not.toBeInTheDocument();
  });

  it('shows no notice to a player with no refunds', async () => {
    serve();
    renderStore();
    expect(await screen.findByText('No items in this category.')).toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('offers no filter for the retired unit skins and map themes', async () => {
    serve();
    renderStore();
    expect(await screen.findByRole('button', { name: 'Dice' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Unit Skins' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Map Themes' })).not.toBeInTheDocument();
  });

  it('shows an owned earned reward as earned, and never offers anything free', async () => {
    serve({ catalog: [OWNED_MEDAL] });
    renderStore();
    expect(await screen.findByText('Bronze Commander')).toBeInTheDocument();
    expect(screen.getByText('Earned')).toBeInTheDocument();
    expect(screen.getByText('Collected')).toBeInTheDocument();
    expect(screen.queryByText('Free')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Get Free' })).not.toBeInTheDocument();
  });
});
