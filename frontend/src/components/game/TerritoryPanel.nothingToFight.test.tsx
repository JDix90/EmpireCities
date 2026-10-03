/**
 * The territory panel on a board with nothing to fight. An economy daily
 * clears the map to empty neutrals and parks the AI across an ocean, so no
 * territory of the player's has a legal target. "No enemy borders this
 * territory. Attack from one that does." was true of the tile and false of
 * the board, and sent players hunting for a territory that did not exist.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import TerritoryPanel from './TerritoryPanel';
import { useGameStore, type GameState } from '../../store/gameStore';
import { useUiStore } from '../../store/uiStore';
import { useAuthStore } from '../../store/authStore';

const MAP_TERRITORIES = [
  { territory_id: 'home', name: 'Eastern USA', region_id: 'atlantic' },
  { territory_id: 'west', name: 'Western USA', region_id: 'atlantic' },
  { territory_id: 'coast', name: 'Britain', region_id: 'atlantic' },
  { territory_id: 'far', name: 'Japan', region_id: 'pacific' },
  { territory_id: 'beach', name: 'Hawaii', region_id: 'pacific' },
];
const MAP_REGIONS = [
  { region_id: 'atlantic', name: 'Atlantic', bonus: 2 },
  { region_id: 'pacific', name: 'Pacific', bonus: 2 },
];
const CONNECTIONS = [
  { from: 'home', to: 'coast', type: 'land' as const },
  { from: 'home', to: 'west', type: 'land' as const },
  { from: 'coast', to: 'far', type: 'land' as const },
  { from: 'west', to: 'beach', type: 'land' as const },
];

/** `beachHeld`: the enemy also holds Hawaii, which borders Western USA. */
function game(beachHeld: boolean): GameState {
  const player = (player_id: string, player_index: number, username: string) => ({
    player_id, player_index, username, color: '#888', is_ai: player_id !== 'me', is_eliminated: false,
    territory_count: 2, cards: [], mmr: 1000, unlocked_techs: [], ability_uses: {},
  });
  return {
    game_id: 'g1',
    era: 'ww2',
    map_id: 'm1',
    phase: 'attack',
    current_player_index: 0,
    starting_player_index: 0,
    turn_number: 2,
    players: [player('me', 0, 'Jeff'), player('foe', 1, 'Rival')],
    territories: {
      home: { territory_id: 'home', owner_id: 'me', unit_count: 9 },
      west: { territory_id: 'west', owner_id: 'me', unit_count: 5 },
      coast: { territory_id: 'coast', owner_id: null, unit_count: 0 },
      far: { territory_id: 'far', owner_id: 'foe', unit_count: 7 },
      beach: beachHeld
        ? { territory_id: 'beach', owner_id: 'foe', unit_count: 3 }
        : { territory_id: 'beach', owner_id: null, unit_count: 0 },
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

describe('TerritoryPanel with nothing to fight', () => {
  beforeEach(() => {
    window.matchMedia = vi.fn().mockReturnValue({
      matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn(),
      addListener: vi.fn(), removeListener: vi.fn(),
    }) as unknown as typeof window.matchMedia;
    useAuthStore.setState({ user: { user_id: 'me', username: 'Jeff' } as never, isAuthenticated: true });
  });

  it('says the board has nothing to fight, not that this territory lacks an enemy', () => {
    show(game(false), 'home');
    expect(
      screen.getByText(/Nothing to fight: no enemy borders any of your territories, and empty land cannot be taken/),
    ).toBeTruthy();
    expect(screen.queryByText(/Attack from one that does/)).toBeNull();
  });

  it('keeps the per-territory wording when another of my territories does have an enemy', () => {
    show(game(true), 'home');
    expect(screen.getByText('No enemy borders this territory. Attack from one that does.')).toBeTruthy();
    expect(screen.queryByText(/Nothing to fight/)).toBeNull();
  });
});
