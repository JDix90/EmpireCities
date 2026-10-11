/**
 * The territory panel's region badge reads a region as the game pays it
 * (utils/continentBonus regionBonusOnBoard): only its territories on the
 * board count, and a region pays only with two or more of them there.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import TerritoryPanel from './TerritoryPanel';
import { useGameStore, type GameState } from '../../store/gameStore';
import { useUiStore } from '../../store/uiStore';
import { useAuthStore } from '../../store/authStore';

// The map a client is sent: on a growing board, only the territories in play.
const MAP_TERRITORIES = [
  { territory_id: 'h1', name: 'Heartland', region_id: 'heart' },
  { territory_id: 'h2', name: 'Hill Country', region_id: 'heart' },
  { territory_id: 'h3', name: 'High Plains', region_id: 'heart' },
  { territory_id: 'isle', name: 'Lone Isle', region_id: 'isles' },
];
const MAP_REGIONS = [
  { region_id: 'heart', name: 'The Heart', bonus: 6 },
  // Two more isles are still locked: the one on the board is no region yet.
  { region_id: 'isles', name: 'The Isles', bonus: 4 },
];
const CONNECTIONS = [
  { from: 'h1', to: 'h2', type: 'land' as const },
  { from: 'h2', to: 'h3', type: 'land' as const },
  { from: 'h3', to: 'isle', type: 'sea' as const },
];

function game(players = 6): GameState {
  const ids = ['me', 'foe', 'p3', 'p4', 'p5', 'p6'].slice(0, players);
  return {
    game_id: 'g1',
    era: 'ancient',
    map_id: 'm1',
    phase: 'attack',
    current_player_index: 0,
    starting_player_index: 0,
    turn_number: 5,
    players: ids.map((player_id, player_index) => ({
      player_id, player_index, username: player_id === 'me' ? 'Jeff' : player_id, color: '#888',
      is_ai: player_id !== 'me', is_eliminated: false, territory_count: 1, cards: [], mmr: 1000,
      unlocked_techs: [], ability_uses: {},
    })),
    territories: {
      h1: { territory_id: 'h1', owner_id: 'me', unit_count: 5 },
      h2: { territory_id: 'h2', owner_id: 'me', unit_count: 3 },
      h3: { territory_id: 'h3', owner_id: 'me', unit_count: 3 },
      isle: { territory_id: 'isle', owner_id: 'me', unit_count: 2 },
    },
    card_set_redemption_count: 0,
    settings: { fog_of_war: false },
  } as unknown as GameState;
}

function show(state: GameState, territoryId: string) {
  useGameStore.setState({ gameState: state, draftUnitsRemaining: 0 } as never);
  useUiStore.setState({ selectedTerritory: territoryId, attackSource: null, navalSource: null } as never);
  return render(
    <TerritoryPanel
      mapTerritories={MAP_TERRITORIES}
      mapRegions={MAP_REGIONS}
      mapConnections={CONNECTIONS}
      resolvedViewerPlayerId="me"
      onAttack={() => {}}
      onDraft={() => {}}
      onClose={() => {}}
    />,
  );
}

describe('TerritoryPanel region badge', () => {
  beforeEach(() => {
    window.matchMedia = vi.fn().mockReturnValue({
      matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn(),
      addListener: vi.fn(), removeListener: vi.fn(),
    }) as unknown as typeof window.matchMedia;
    useAuthStore.setState({ user: { user_id: 'me', username: 'Jeff' } as never, isAuthenticated: true });
  });

  it('shows a held region at its bonus, with the holder ticked', () => {
    show(game(), 'h1');
    expect(screen.getByText('The Heart')).toBeInTheDocument();
    expect(screen.getByText('+6')).toBeInTheDocument();
    expect(screen.getByText(/3\/3/)).toHaveTextContent('3/3 ✓');
    expect(screen.queryByTestId('region-too-few')).toBeNull();
  });

  it('shows a region with one territory on the board as paying nothing, and says why', () => {
    show(game(), 'isle');
    expect(screen.getByText('The Isles')).toBeInTheDocument();
    expect(screen.getByText('+0')).toBeInTheDocument();
    expect(screen.getByTestId('region-too-few')).toHaveTextContent(
      'A region pays only with two or more of its territories on the board.',
    );
    // Nothing to progress toward, and no claim that holding it pays.
    expect(screen.queryByText(/1\/1/)).toBeNull();
    expect(screen.queryByText(/Scales with players/)).toBeNull();
  });

  it('counts only the territories on the board', () => {
    // A tile the client's map lists but the board does not hold is not counted.
    const state = game();
    delete (state.territories as Record<string, unknown>).h3;
    show(state, 'h1');
    expect(screen.getByText(/2\/2/)).toHaveTextContent('2/2 ✓');
  });

  it('still scales a paying region by the table', () => {
    show(game(4), 'h1');
    // +6 at four seats: floor(6 × 4 / 6) = +4.
    expect(screen.getByText('+4')).toBeInTheDocument();
    expect(screen.getByText('Scales with players: +4 at 4 (+6 at 6)')).toBeInTheDocument();
  });
});
