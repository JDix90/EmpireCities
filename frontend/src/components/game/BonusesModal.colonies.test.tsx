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

describe('BonusesModal — the Lane Crown on a Schism board', () => {
  beforeEach(() => {
    useAuthStore.setState({ user: { user_id: 'me', username: 'me' } as never, isAuthenticated: true });
  });

  function schismGame(myGateways: number): GameState {
    const gateways = ['sol_amazonia', 'sol_cathay', 'sol_guinea', 'sol_pacific_rim'];
    const base = galaxyGame(2, false);
    return {
      ...base,
      territories: Object.fromEntries(gateways.map((id, i) => [id, { owner_id: i < myGateways ? 'me' : 'p1', unit_count: 3 }])),
      galaxy_mode: {
        id: 'schism',
        relations: 'concord',
        concord_rounds: 3,
        lane_crown_bonus: 2,
        houses: [
          { player_id: 'me', world_id: 'sol', half: 0, name: 'Western Mandate' },
          { player_id: 'p1', world_id: 'sol', half: 1, name: 'Eastern Mandate' },
        ],
        crown_gateways: { sol: gateways },
      },
    } as unknown as GameState;
  }

  it('says how to win it while the house does not wear it', async () => {
    useGameStore.setState({ gameState: schismGame(2) } as never);
    render(<BonusesModal techTree={[]} onClose={() => {}} />);
    expect(await screen.findByText('Lane Crown · Western Mandate')).toBeInTheDocument();
    expect(screen.getByText('not worn')).toBeInTheDocument();
    expect(screen.getByText(/your two and the Eastern Mandate's — and you draft \+2 a turn/)).toBeInTheDocument();
  });

  it('shows the +2 while the house holds all four gateways', async () => {
    useGameStore.setState({ gameState: schismGame(4) } as never);
    render(<BonusesModal techTree={[]} onClose={() => {}} />);
    expect(await screen.findByText('Lane Crown · Western Mandate')).toBeInTheDocument();
    expect(screen.getByText(/the Lane Crown adds this at the start of each of your draft phases/)).toBeInTheDocument();
    expect(screen.queryByText('not worn')).toBeNull();
  });

  it("shows the house's own bonus when its half has one", async () => {
    const game = schismGame(2);
    const mode = game.galaxy_mode as { houses: Array<{ player_id: string; reinforce_bonus?: number }> };
    mode.houses = mode.houses.map((h) => (h.player_id === 'me' ? { ...h, reinforce_bonus: 2 } : h));
    useGameStore.setState({ gameState: game } as never);
    render(<BonusesModal techTree={[]} onClose={() => {}} />);
    expect(await screen.findByText('House Bonus · Western Mandate')).toBeInTheDocument();
    expect(screen.getByText(/is the harder ground, so the board pays it back/)).toBeInTheDocument();
  });

  it('plays Allied houses without the Crown, and names their tuning as the side', async () => {
    const game = schismGame(4);
    const mode = game.galaxy_mode as {
      relations: string; concord_rounds: number; lane_crown_bonus: number;
      houses: Array<{ player_id: string; reinforce_bonus?: number }>;
    };
    mode.relations = 'allied';
    mode.concord_rounds = 0;
    mode.lane_crown_bonus = 0;
    mode.houses = mode.houses.map((h) => ({ ...h, reinforce_bonus: 3 }));
    useGameStore.setState({ gameState: game } as never);
    render(<BonusesModal techTree={[]} onClose={() => {}} />);
    expect(await screen.findByText('House Bonus · Western Mandate')).toBeInTheDocument();
    expect(screen.getByText(/Both Allied houses of Sol III draft this extra/)).toBeInTheDocument();
    expect(screen.queryByText(/Lane Crown/)).toBeNull();
  });

  it('tells a house alone on its world the Crown is its two gateways and the unclaimed half\'s', async () => {
    const game = schismGame(2);
    const mode = game.galaxy_mode as { houses: Array<{ player_id: string }>; unclaimed_garrison?: unknown };
    mode.houses = mode.houses.filter((h) => h.player_id === 'me');
    mode.unclaimed_garrison = { gateway: 9, interior: 11 };
    useGameStore.setState({ gameState: game } as never);
    render(<BonusesModal techTree={[]} onClose={() => {}} />);
    expect(await screen.findByText('Lane Crown · Western Mandate')).toBeInTheDocument();
    expect(screen.getByText(/your two and the unclaimed half's — and you draft \+2 a turn/)).toBeInTheDocument();
  });

  it("shows an Allied seat holding a whole world its own number, and no Crown", async () => {
    const game = schismGame(4);
    const mode = game.galaxy_mode as {
      relations: string; concord_rounds: number; lane_crown_bonus: number;
      houses: Array<{ player_id: string }>; whole_worlds?: unknown;
    };
    mode.relations = 'allied';
    mode.concord_rounds = 0;
    mode.lane_crown_bonus = 0;
    mode.houses = [];
    mode.whole_worlds = [{ player_id: 'me', world_id: 'sol', reinforce_bonus: 2 }];
    useGameStore.setState({ gameState: game } as never);
    render(<BonusesModal techTree={[]} onClose={() => {}} />);
    expect(await screen.findByText('Whole World · Sol III')).toBeInTheDocument();
    expect(screen.getByText(/You hold Sol III alone, a side of one against sides of two houses, so the board adds this/)).toBeInTheDocument();
    expect(screen.queryByText(/Lane Crown/)).toBeNull();
    expect(screen.queryByText(/House Bonus/)).toBeNull();
  });

  it('has no Lane Crown row off a Schism board', async () => {
    useGameStore.setState({ gameState: galaxyGame(4, false) } as never);
    render(<BonusesModal techTree={[]} onClose={() => {}} />);
    await screen.findByText('+2 / turn');
    expect(screen.queryByText(/Lane Crown/)).toBeNull();
  });
});
