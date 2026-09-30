/**
 * The Bonuses modal shows what a faction actually drafts in this game. On the
 * Colonies board a kit's flat bonus can differ from the kit: the Helion
 * Navigators draft +1 in a two-player duel, not +2 (backend
 * state/galaxyModes.ts `factionReinforceBonus`).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import BonusesModal from './BonusesModal';
import { useGameStore, type GameState } from '../../store/gameStore';
import { useAuthStore } from '../../store/authStore';

const NAVIGATORS = {
  faction_id: 'helion_navigators',
  name: 'Helion Navigators',
  description: 'Lane-mappers and drift pilots.',
  reinforce_bonus: 2,
  colony_reinforce_bonus: { '2': 1 },
};

vi.mock('../../services/api', () => ({
  api: { get: vi.fn(() => Promise.resolve({ data: { factions: [NAVIGATORS] } })) },
}));

function galaxyGame(seats: number, colonies: boolean): GameState {
  return {
    game_id: 'g1',
    era: 'galaxy_age',
    map_id: 'era_galaxy',
    phase: 'draft',
    current_player_index: 0,
    turn_number: 1,
    players: Array.from({ length: seats }, (_, i) => ({
      player_id: i === 0 ? 'me' : `p${i}`,
      player_index: i,
      username: i === 0 ? 'me' : `p${i}`,
      color: '#fff',
      is_ai: i > 0,
      is_eliminated: false,
      territory_count: 16,
      cards: [],
      mmr: 1000,
      faction_id: i === 0 ? 'helion_navigators' : 'stellar_mandate',
      unlocked_techs: [],
    })),
    territories: {},
    card_set_redemption_count: 0,
    settings: { fog_of_war: false, turn_timer_seconds: 0, diplomacy_enabled: false, factions_enabled: true },
    ...(colonies ? { galaxy_mode: { id: 'colonies', neutral_worlds: ['nexus_station', 'rust'] } } : {}),
  } as unknown as GameState;
}

describe('BonusesModal — the faction reinforcement bonus on a Colonies board', () => {
  beforeEach(() => {
    useAuthStore.setState({ user: { user_id: 'me', username: 'me' } as never, isAuthenticated: true });
  });

  it('shows the +1 the Navigators draft in a two-player Colonies game', async () => {
    useGameStore.setState({ gameState: galaxyGame(2, true) } as never);
    render(<BonusesModal techTree={[]} onClose={() => {}} />);
    expect(await screen.findByText('+1 / turn')).toBeInTheDocument();
    expect(screen.getByText(/\+2 in other games; this Colonies board sets it at \+1/)).toBeInTheDocument();
  });

  it('shows the kit\'s +2 anywhere else', async () => {
    useGameStore.setState({ gameState: galaxyGame(4, false) } as never);
    render(<BonusesModal techTree={[]} onClose={() => {}} />);
    expect(await screen.findByText('+2 / turn')).toBeInTheDocument();
    expect(screen.getByText('Added at the start of each of your draft phases.')).toBeInTheDocument();
  });
});
