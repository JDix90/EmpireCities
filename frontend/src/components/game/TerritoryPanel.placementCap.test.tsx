/**
 * Placement cap note (`placement_cap_note_enabled`): below 50 stability a
 * territory takes only a few units per draft, and every conquered one starts
 * at 30. The panel said "stability cap: 3 more here" at most, and nothing at
 * all in its stability section above 29. With the flag on, it says how many
 * more and why where the units are placed.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import TerritoryPanel from './TerritoryPanel';
import { placementCapMessage } from './PlacementCapNote';
import { useGameStore, type GameState } from '../../store/gameStore';
import { useUiStore } from '../../store/uiStore';
import { useAuthStore } from '../../store/authStore';
import { useFeatureFlagsStore } from '../../store/featureFlagsStore';

const MAP_TERRITORIES = [
  { territory_id: 'home', name: 'Eastern USA', region_id: 'atlantic' },
  { territory_id: 'won', name: 'Western USA', region_id: 'atlantic' },
];
const MAP_REGIONS = [{ region_id: 'atlantic', name: 'Atlantic', bonus: 2 }];
const CONNECTIONS = [{ from: 'home', to: 'won', type: 'land' as const }];

function draftGame(capLeft: number): GameState {
  const player = (player_id: string, player_index: number, username: string) => ({
    player_id, player_index, username, color: '#888', is_ai: player_id !== 'me', is_eliminated: false,
    territory_count: 2, cards: [], mmr: 1000, unlocked_techs: [], ability_uses: {},
  });
  return {
    game_id: 'g1',
    era: 'ancient',
    map_id: 'm1',
    phase: 'draft',
    current_player_index: 0,
    starting_player_index: 0,
    turn_number: 3,
    players: [player('me', 0, 'Jeff'), player('foe', 1, 'Rival')],
    territories: {
      home: { territory_id: 'home', owner_id: 'me', unit_count: 9, stability: 80 },
      won: { territory_id: 'won', owner_id: 'me', unit_count: 2, stability: 30 },
    },
    draft_units_remaining: 7,
    draft_deploy_caps: { won: capLeft },
    card_set_redemption_count: 0,
    settings: { fog_of_war: false, stability_enabled: true },
  } as unknown as GameState;
}

function renderPanel() {
  return render(
    <TerritoryPanel
      mapTerritories={MAP_TERRITORIES}
      mapRegions={MAP_REGIONS}
      mapConnections={CONNECTIONS}
      resolvedViewerPlayerId="me"
      onAttack={() => {}}
      onDraft={() => {}}
      onFortifyTo={() => {}}
      onClose={() => {}}
    />,
  );
}

const setFlag = (on: boolean) =>
  useFeatureFlagsStore.setState((s) => ({ flags: { ...s.flags, placement_cap_note_enabled: on } }));

describe('placement cap note', () => {
  beforeEach(() => {
    // Desktop: the draft section under the territory details.
    window.matchMedia = vi.fn().mockReturnValue({
      matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn(),
      addListener: vi.fn(), removeListener: vi.fn(),
    }) as unknown as typeof window.matchMedia;
    useAuthStore.setState({ user: { user_id: 'me', username: 'Jeff' } as never, isAuthenticated: true });
    useUiStore.setState({ selectedTerritory: 'won', attackSource: null, navalSource: null } as never);
  });

  afterEach(() => setFlag(true));

  it('says how many more units a newly conquered territory takes, and why', () => {
    setFlag(true);
    useGameStore.setState({ gameState: draftGame(3), draftUnitsRemaining: 7 } as never);
    renderPanel();
    const note = screen.getByTestId('placement-cap-note');
    expect(note).toHaveTextContent('Unsettled territory: 3 more units here this turn');
    expect(note).toHaveTextContent('Stability 30; at 50 it takes any number.');
    expect(note).toHaveTextContent('Conquered land starts at 30');
    // The terse suffix goes; the dial still stops at the cap.
    expect(screen.queryByText(/stability cap:/)).toBeNull();
    // The stability section warns from 50 down, not only below 30.
    expect(screen.getByText(/Unsettled — takes only a few reinforcements a turn until stability reaches 50/)).toBeTruthy();
  });

  it('says the cap is reached, and where the rest can go', () => {
    setFlag(true);
    useGameStore.setState({ gameState: draftGame(0), draftUnitsRemaining: 7 } as never);
    renderPanel();
    expect(screen.getByTestId('placement-cap-note')).toHaveTextContent(
      'Unsettled territory: no more units here this turn',
    );
    expect(screen.getByTestId('placement-cap-note')).toHaveTextContent('Place the rest on settled territory.');
    expect(screen.queryByText(/Stability cap reached/)).toBeNull();
  });

  it('sits under the dial on a phone, so the dial stays above the fold', () => {
    setFlag(true);
    window.matchMedia = vi.fn().mockReturnValue({
      matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn(),
      addListener: vi.fn(), removeListener: vi.fn(),
    }) as unknown as typeof window.matchMedia;
    useGameStore.setState({ gameState: draftGame(3), draftUnitsRemaining: 7 } as never);
    renderPanel();
    const note = screen.getByTestId('placement-cap-note');
    const all = screen.getByRole('button', { name: /^All/ });
    expect(all.compareDocumentPosition(note) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // The label keeps the reason in view above the dial.
    expect(screen.getByText(/Place reinforcements \(7 remaining · unsettled: 3 more here\)/)).toBeTruthy();
  });

  it('shows nothing on a settled territory', () => {
    setFlag(true);
    useGameStore.setState({ gameState: draftGame(3), draftUnitsRemaining: 7 } as never);
    useUiStore.setState({ selectedTerritory: 'home' } as never);
    renderPanel();
    expect(screen.queryByTestId('placement-cap-note')).toBeNull();
  });

  it('is the panel as before with the flag off', () => {
    setFlag(false);
    useGameStore.setState({ gameState: draftGame(3), draftUnitsRemaining: 7 } as never);
    const { unmount } = renderPanel();
    expect(screen.queryByTestId('placement-cap-note')).toBeNull();
    expect(screen.getByText(/stability cap: 3 more here/)).toBeTruthy();
    expect(screen.queryByText(/Unsettled/)).toBeNull();
    unmount();

    useGameStore.setState({ gameState: draftGame(0), draftUnitsRemaining: 7 } as never);
    renderPanel();
    expect(screen.getByText(/Stability cap reached/)).toBeTruthy();
  });
});

describe('placementCapMessage', () => {
  it('counts one unit in the singular', () => {
    expect(placementCapMessage(34, 1).title).toBe('Unsettled territory: 1 more unit here this turn');
  });

  it('still explains the cap when stability is unknown', () => {
    expect(placementCapMessage(undefined, 2).detail).toMatch(/^Below 50 stability a territory takes only a few units a turn\./);
  });
});
