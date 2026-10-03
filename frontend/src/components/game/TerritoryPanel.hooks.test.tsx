/**
 * The territory panel stays mounted while its checks flip. Its hooks used to
 * sit below two early returns (no game state; the selected tile missing from
 * the board or the map), so a tile that went missing while its panel was open,
 * and then came back, changed how many hooks ran between renders, which React
 * reports as an error. The checks now live in a thin wrapper and the panel's
 * hooks run on every render of the panel.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import TerritoryPanel from './TerritoryPanel';
import { useGameStore, type GameState } from '../../store/gameStore';
import { useUiStore } from '../../store/uiStore';
import { useAuthStore } from '../../store/authStore';

const MAP_TERRITORIES = [
  { territory_id: 'home', name: 'Eastern USA', region_id: 'atlantic' },
  { territory_id: 'west', name: 'Western USA', region_id: 'atlantic' },
];
const MAP_REGIONS = [{ region_id: 'atlantic', name: 'Atlantic', bonus: 2 }];
const CONNECTIONS = [{ from: 'home', to: 'west', type: 'land' as const }];

function game(withHome: boolean): GameState {
  const player = (player_id: string, player_index: number, username: string) => ({
    player_id, player_index, username, color: '#888', is_ai: player_id !== 'me', is_eliminated: false,
    territory_count: 1, cards: [], mmr: 1000, unlocked_techs: [], ability_uses: {},
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
      ...(withHome ? { home: { territory_id: 'home', owner_id: 'me', unit_count: 9 } } : {}),
      west: { territory_id: 'west', owner_id: 'foe', unit_count: 3 },
    },
    card_set_redemption_count: 0,
    settings: { fog_of_war: false },
  } as unknown as GameState;
}

const panel = (
  <TerritoryPanel
    mapTerritories={MAP_TERRITORIES}
    mapRegions={MAP_REGIONS}
    mapConnections={CONNECTIONS}
    resolvedViewerPlayerId="me"
    onAttack={() => {}}
    onDraft={() => {}}
    onClose={() => {}}
  />
);

describe('TerritoryPanel keeps its hooks stable', () => {
  let consoleError: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    window.matchMedia = vi.fn().mockReturnValue({
      matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn(),
      addListener: vi.fn(), removeListener: vi.fn(),
    }) as unknown as typeof window.matchMedia;
    useAuthStore.setState({ user: { user_id: 'me', username: 'Jeff' } as never, isAuthenticated: true });
    consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleError.mockRestore();
  });

  it('survives its tile going missing and coming back while mounted', () => {
    useGameStore.setState({ gameState: game(true), draftUnitsRemaining: 0 } as never);
    useUiStore.setState({ selectedTerritory: 'home', attackSource: null, navalSource: null } as never);
    const { container } = render(panel);
    expect(screen.getAllByText('Eastern USA').length).toBeGreaterThan(0);

    // The selected tile drops out of the board: the panel renders nothing.
    act(() => { useGameStore.setState({ gameState: game(false) } as never); });
    expect(container.innerHTML).toBe('');

    // And comes back: the panel renders again, with no hook-order error.
    act(() => { useGameStore.setState({ gameState: game(true) } as never); });
    expect(screen.getAllByText('Eastern USA').length).toBeGreaterThan(0);

    const hookErrors = consoleError.mock.calls.filter((args) =>
      args.some((a) => /Rendered (more|fewer) hooks|change in the order of Hooks/i.test(String(a))));
    expect(hookErrors).toEqual([]);
  });
});
