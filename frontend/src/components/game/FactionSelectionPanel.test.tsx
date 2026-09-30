/**
 * The waiting room's faction picker holds each faction to the seats it may
 * take: one, or two in a Galactic Age Schism lobby, where every world's faction
 * is dealt to two houses (backend lobbyCapacity.seatsPerFaction, which the
 * faction-select endpoint enforces).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import FactionSelectionPanel from './FactionSelectionPanel';
import { useAuthStore } from '../../store/authStore';
import type { GameLobbySnapshot } from '../../types/gameLobbyApi';

vi.mock('../../services/api', () => ({
  api: {
    get: vi.fn(() => Promise.resolve({
      data: {
        factions: [
          { faction_id: 'stellar_mandate', name: 'Stellar Mandate', description: '' },
          { faction_id: 'forge_syndicate', name: 'Forge Syndicate', description: '' },
        ],
      },
    })),
    post: vi.fn(() => Promise.resolve({ data: { ok: true } })),
  },
}));

function lobby(maxPlayers: number, holders: Array<string | null>): GameLobbySnapshot {
  return {
    game_id: 'g1',
    era_id: 'galaxy_age',
    map_id: 'era_galaxy',
    status: 'waiting',
    settings_json: { factions_enabled: true, max_players: maxPlayers },
    players: [
      { player_index: 0, user_id: 'me', username: 'me', player_color: '#fff', is_ai: false, faction_id: null },
      ...holders.map((faction_id, i) => ({
        player_index: i + 1, user_id: `u${i}`, username: `u${i}`, player_color: '#fff', is_ai: false, faction_id,
      })),
    ],
  } as unknown as GameLobbySnapshot;
}

describe('FactionSelectionPanel — seats per faction', () => {
  beforeEach(() => {
    useAuthStore.setState({ user: { user_id: 'me', username: 'me' } as never, isAuthenticated: true });
  });

  const option = async (name: string) =>
    (await screen.findByRole('option', { name })) as HTMLOptionElement;

  it('keeps a faction open for a second house in a Schism lobby, and closes it at two', async () => {
    const { unmount } = render(<FactionSelectionPanel lobby={lobby(8, ['stellar_mandate'])} eraId="galaxy_age" />);
    expect((await option('Stellar Mandate')).disabled).toBe(false);
    unmount();

    render(<FactionSelectionPanel lobby={lobby(8, ['stellar_mandate', 'stellar_mandate'])} eraId="galaxy_age" />);
    expect((await option('Stellar Mandate')).disabled).toBe(true);
    expect((await option('Forge Syndicate')).disabled).toBe(false);
  });

  it('closes a faction at one seat in any other lobby', async () => {
    render(<FactionSelectionPanel lobby={lobby(4, ['stellar_mandate'])} eraId="galaxy_age" />);
    expect((await option('Stellar Mandate')).disabled).toBe(true);
    expect((await option('Forge Syndicate')).disabled).toBe(false);
  });
});
