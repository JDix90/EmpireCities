/**
 * The waiting room's faction picker holds each faction to the seats it may
 * take: one, or two in a Galactic Age lobby of five seats or more, where a
 * faction picked twice splits its world between two houses (backend
 * lobbyCapacity.seatsPerFaction, which the faction-select endpoint enforces).
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
          { faction_id: 'helion_navigators', name: 'Helion Navigators', description: '' },
          { faction_id: 'void_custodians', name: 'Void Custodians', description: '' },
        ],
      },
    })),
    post: vi.fn(() => Promise.resolve({ data: { ok: true } })),
  },
}));

function lobby(maxPlayers: number, holders: Array<string | null>, settings: Record<string, unknown> = {}): GameLobbySnapshot {
  return {
    game_id: 'g1',
    era_id: 'galaxy_age',
    map_id: 'era_galaxy',
    status: 'waiting',
    settings_json: { factions_enabled: true, max_players: maxPlayers, ...settings },
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

  it('keeps a faction open for a second house in a five-seat lobby', async () => {
    render(<FactionSelectionPanel lobby={lobby(5, ['stellar_mandate'])} eraId="galaxy_age" />);
    expect((await option('Stellar Mandate')).disabled).toBe(false);
  });

  it('closes a faction at one seat in any other lobby', async () => {
    render(<FactionSelectionPanel lobby={lobby(4, ['stellar_mandate'])} eraId="galaxy_age" />);
    expect((await option('Stellar Mandate')).disabled).toBe(true);
    expect((await option('Forge Syndicate')).disabled).toBe(false);
  });
});

describe('FactionSelectionPanel — a team lobby', () => {
  beforeEach(() => {
    useAuthStore.setState({ user: { user_id: 'me', username: 'me' } as never, isAuthenticated: true });
  });

  it('says a 2v2 faction is a side, naming the factions by the roster', async () => {
    render(<FactionSelectionPanel lobby={lobby(4, [], { galaxy_2v2: true })} eraId="galaxy_age" />);
    await screen.findByRole('option', { name: 'Stellar Mandate' });
    expect(screen.getByTestId('faction-team-note')).toHaveTextContent(
      '2v2: your faction is your team, Stellar Mandate and Forge Syndicate against Helion Navigators and Void Custodians.',
    );
  });

  it('says how Allied houses pair up', async () => {
    render(<FactionSelectionPanel lobby={lobby(8, [], { galaxy_house_relations: 'allied' })} eraId="galaxy_age" />);
    await screen.findByRole('option', { name: 'Stellar Mandate' });
    expect(screen.getByTestId('faction-team-note')).toHaveTextContent(/Pick the same faction as a friend/);
  });

  it('names no team in a free-for-all lobby, and says how a Schism shares worlds', async () => {
    const { unmount } = render(<FactionSelectionPanel lobby={lobby(8, [], { galaxy_house_relations: 'concord' })} eraId="galaxy_age" />);
    await screen.findByRole('option', { name: 'Stellar Mandate' });
    expect(screen.queryByTestId('faction-team-note')).toBeNull();
    expect(screen.getByTestId('faction-schism-note')).toHaveTextContent(/two players on one faction split its world/);
    unmount();

    render(<FactionSelectionPanel lobby={lobby(4, [])} eraId="galaxy_age" />);
    await screen.findByRole('option', { name: 'Stellar Mandate' });
    expect(screen.queryByTestId('faction-team-note')).toBeNull();
    expect(screen.queryByTestId('faction-schism-note')).toBeNull();
  });
});
