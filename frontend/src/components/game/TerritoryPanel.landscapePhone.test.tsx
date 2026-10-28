/**
 * The territory card on a phone held on its side. Wider than the mobile
 * breakpoint, it gets the floating card rather than the bottom sheet, but the
 * card is under 300px tall: led by region progress and stats, it put the attack
 * buttons below its fold. It now carries the phone's compact content, as the
 * sheet does; a desktop's card keeps the region badge. A phone narrower than
 * the breakpoint on its side gets the card too: the sheet's snaps there were a
 * quarter to a third of the screen, too short for the attack button.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import TerritoryPanel from './TerritoryPanel';
import { useGameStore, type GameState } from '../../store/gameStore';
import { useUiStore } from '../../store/uiStore';
import { useAuthStore } from '../../store/authStore';

const MAP_TERRITORIES = [
  { territory_id: 'home', name: 'Eastern USA', region_id: 'atlantic' },
  { territory_id: 'coast', name: 'Britain', region_id: 'europe' },
  { territory_id: 'france', name: 'France', region_id: 'europe' },
];
const MAP_REGIONS = [
  { region_id: 'atlantic', name: 'Atlantic Seaboard', bonus: 2 },
  { region_id: 'europe', name: 'Western Front', bonus: 3 },
];
const CONNECTIONS = [
  { from: 'home', to: 'coast', type: 'land' as const },
  { from: 'coast', to: 'france', type: 'land' as const },
];

function game(): GameState {
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
      home: { territory_id: 'home', owner_id: 'me', unit_count: 9 },
      coast: { territory_id: 'coast', owner_id: 'foe', unit_count: 3 },
      france: { territory_id: 'france', owner_id: 'foe', unit_count: 2 },
    },
    card_set_redemption_count: 0,
    settings: { fog_of_war: false },
  } as unknown as GameState;
}

/** A screen of the given size; `coarse` is a finger rather than a mouse. */
function screenOf(width: number, height: number, coarse: boolean) {
  Object.defineProperty(window, 'innerWidth', { value: width, configurable: true });
  Object.defineProperty(window, 'innerHeight', { value: height, configurable: true });
  window.matchMedia = vi.fn((query: string) => ({
    matches: query.includes('pointer: coarse') ? coarse : query.includes('max-width: 768px') ? width <= 768 : false,
    media: query, addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn(),
  })) as unknown as typeof window.matchMedia;
}

function showEnemyTarget() {
  useGameStore.setState({ gameState: game(), draftUnitsRemaining: 0 } as never);
  useUiStore.setState({ selectedTerritory: 'coast', attackSource: 'home', navalSource: null } as never);
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

const width = Object.getOwnPropertyDescriptor(window, 'innerWidth');
const height = Object.getOwnPropertyDescriptor(window, 'innerHeight');

describe('TerritoryPanel on a phone held on its side', () => {
  beforeEach(() => {
    useAuthStore.setState({ user: { user_id: 'me', username: 'Jeff' } as never, isAuthenticated: true });
  });
  afterEach(() => {
    if (width) Object.defineProperty(window, 'innerWidth', width);
    if (height) Object.defineProperty(window, 'innerHeight', height);
  });

  it("leaves out the region badge's detail so the attack comes first", () => {
    screenOf(844, 390, true);
    showEnemyTarget();
    expect(screen.queryByText(/Scales with players/)).toBeNull();
    expect(screen.getByRole('button', { name: /Attack from Eastern USA/ })).toBeTruthy();
  });

  it('uses the card, not the bottom sheet, on a phone under 768px wide on its side', () => {
    screenOf(667, 375, true);
    showEnemyTarget();
    expect(screen.queryByRole('button', { name: 'Expand panel' })).toBeNull();
    expect(screen.getByRole('button', { name: /Attack from Eastern USA/ })).toBeTruthy();
  });

  it('keeps the bottom sheet for the same phone upright', () => {
    screenOf(375, 667, true);
    showEnemyTarget();
    expect(screen.getByRole('button', { name: 'Expand panel' })).toBeTruthy();
  });

  it('keeps the region badge on a desktop the same width', () => {
    screenOf(844, 390, false);
    showEnemyTarget();
    expect(screen.getByText(/Scales with players/)).toBeTruthy();
  });
});
