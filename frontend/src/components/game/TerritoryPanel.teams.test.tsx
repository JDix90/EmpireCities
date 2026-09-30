/**
 * The territory panel in a team game (utils/teams): an ally's ground is marked
 * as such and offers nothing hostile; during the opening ceasefire no side's
 * ground can be attacked, and the panel says why; a region the side holds
 * names the member who collects its bonus. A free-for-all game reads as ever.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import TerritoryPanel from './TerritoryPanel';
import { useGameStore, type GameState } from '../../store/gameStore';
import { useUiStore } from '../../store/uiStore';
import { useAuthStore } from '../../store/authStore';

const TEAMS = [
  { team_id: 'team_1', name: 'Us', player_ids: ['me', 'pal'] },
  { team_id: 'team_2', name: 'Them', player_ids: ['foe'] },
];

const MAP_TERRITORIES = [
  { territory_id: 'home', name: 'Homeland', region_id: 'north' },
  { territory_id: 'friend', name: 'Friendly Shore', region_id: 'north' },
  { territory_id: 'friend2', name: 'Friendly Hills', region_id: 'north' },
  { territory_id: 'enemy', name: 'Enemy Coast', region_id: 'south' },
];
const MAP_REGIONS = [
  { region_id: 'north', name: 'The North', bonus: 3 },
  { region_id: 'south', name: 'The South', bonus: 2 },
];
const CONNECTIONS = [
  { from: 'home', to: 'friend', type: 'land' as const },
  { from: 'home', to: 'enemy', type: 'land' as const },
  { from: 'friend', to: 'friend2', type: 'land' as const },
];

function game(opts: { teams?: boolean; turn?: number } = {}): GameState {
  const player = (player_id: string, player_index: number, username: string) => ({
    player_id, player_index, username, color: '#888', is_ai: player_id !== 'me', is_eliminated: false,
    territory_count: 1, cards: [], mmr: 1000, unlocked_techs: [], ability_uses: {},
  });
  return {
    game_id: 'g1',
    era: 'ancient',
    map_id: 'm1',
    phase: 'attack',
    current_player_index: 0,
    starting_player_index: 0,
    turn_number: opts.turn ?? 5,
    players: [player('me', 0, 'Jeff'), player('foe', 1, 'Rival'), player('pal', 2, 'Pal')],
    territories: {
      home: { territory_id: 'home', owner_id: 'me', unit_count: 8 },
      friend: { territory_id: 'friend', owner_id: 'pal', unit_count: 3 },
      friend2: { territory_id: 'friend2', owner_id: 'pal', unit_count: 3 },
      enemy: { territory_id: 'enemy', owner_id: 'foe', unit_count: 2 },
    },
    card_set_redemption_count: 0,
    settings: { fog_of_war: false },
    ...(opts.teams === false ? {} : { teams: TEAMS }),
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

describe('TerritoryPanel in a team game', () => {
  beforeEach(() => {
    window.matchMedia = vi.fn().mockReturnValue({
      matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn(),
      addListener: vi.fn(), removeListener: vi.fn(),
    }) as unknown as typeof window.matchMedia;
    useAuthStore.setState({ user: { user_id: 'me', username: 'Jeff' } as never, isAuthenticated: true });
  });

  it("marks an ally's ground, and offers no attack on it", () => {
    show(game(), 'friend');
    expect(screen.getByTestId('territory-ally-tag')).toHaveTextContent('your ally');
    expect(screen.queryByRole('button', { name: /Attack from/ })).toBeNull();
  });

  it('names the ally who collects a region the side holds', () => {
    show(game(), 'home');
    // Pal holds two of the North's three tiles, Jeff one.
    expect(screen.getByText('Your side holds it: Pal collects the bonus.')).toBeInTheDocument();
  });

  it('says why an enemy cannot be attacked during the opening ceasefire', () => {
    show(game({ turn: 1 }), 'enemy');
    expect(screen.getByText('Opening ceasefire: no side attacks another until every player has had a turn.')).toBeInTheDocument();
  });

  it('reads as ever in a free-for-all game', () => {
    const { unmount } = show(game({ teams: false }), 'friend');
    expect(screen.queryByTestId('territory-ally-tag')).toBeNull();
    expect(screen.getByRole('button', { name: /Attack from Homeland/ })).toBeInTheDocument();
    expect(screen.queryByText(/Your side holds it/)).toBeNull();
    unmount();
    show(game({ teams: false, turn: 1 }), 'enemy');
    expect(screen.queryByText(/Opening ceasefire/)).toBeNull();
    expect(screen.getByRole('button', { name: /Attack from Homeland/ })).toBeInTheDocument();
  });
});
