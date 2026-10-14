/**
 * Phone fortify (`phone_fortify_fit_enabled`): at the fixed peek height the
 * header, owner and amount dial filled the sheet and the destinations sat below
 * the fold. With the flag on, the peek snap grows to the measured bottom of the
 * first destination; off, the sheet is the peek snap it always was.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render } from '@testing-library/react';
import TerritoryPanel from './TerritoryPanel';
import type { SheetSnap } from '../../hooks/useBottomSheetSnap';
import { useGameStore, type GameState } from '../../store/gameStore';
import { useUiStore } from '../../store/uiStore';
import { useAuthStore } from '../../store/authStore';
import { useFeatureFlagsStore } from '../../store/featureFlagsStore';

const MAP_TERRITORIES = [
  { territory_id: 'home', name: 'Eastern USA', region_id: 'atlantic' },
  { territory_id: 'west', name: 'Western USA', region_id: 'atlantic' },
];
const MAP_REGIONS = [{ region_id: 'atlantic', name: 'Atlantic', bonus: 2 }];
const CONNECTIONS = [{ from: 'home', to: 'west', type: 'land' as const }];

function fortifyGame(): GameState {
  const player = (player_id: string, player_index: number, username: string) => ({
    player_id, player_index, username, color: '#888', is_ai: player_id !== 'me', is_eliminated: false,
    territory_count: 2, cards: [], mmr: 1000, unlocked_techs: [], ability_uses: {},
  });
  return {
    game_id: 'g1',
    era: 'ww2',
    map_id: 'm1',
    phase: 'fortify',
    current_player_index: 0,
    starting_player_index: 0,
    turn_number: 2,
    players: [player('me', 0, 'Jeff'), player('foe', 1, 'Rival')],
    territories: {
      home: { territory_id: 'home', owner_id: 'me', unit_count: 9 },
      west: { territory_id: 'west', owner_id: 'me', unit_count: 2 },
    },
    card_set_redemption_count: 0,
    settings: { fog_of_war: false },
  } as unknown as GameState;
}

function renderPanel(sheetSnap: SheetSnap) {
  const { container } = render(
    <TerritoryPanel
      mapTerritories={MAP_TERRITORIES}
      mapRegions={MAP_REGIONS}
      mapConnections={CONNECTIONS}
      resolvedViewerPlayerId="me"
      sheetSnap={sheetSnap}
      onAttack={() => {}}
      onDraft={() => {}}
      onFortifyTo={() => {}}
      onClose={() => {}}
    />,
  );
  const sheet = container.querySelector<HTMLElement>('.mobile-sheet-above-nav');
  expect(sheet).not.toBeNull();
  return sheet!;
}

const setFlag = (on: boolean) =>
  useFeatureFlagsStore.setState((s) => ({ flags: { ...s.flags, phone_fortify_fit_enabled: on } }));

describe('TerritoryPanel phone fortify fit', () => {
  let rects: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // A phone: isMobileViewport() reads the 768px media query.
    window.matchMedia = vi.fn().mockReturnValue({
      matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn(),
      addListener: vi.fn(), removeListener: vi.fn(),
    }) as unknown as typeof window.matchMedia;
    useAuthStore.setState({ user: { user_id: 'me', username: 'Jeff' } as never, isAuthenticated: true });
    useGameStore.setState({ gameState: fortifyGame(), draftUnitsRemaining: 0 } as never);
    useUiStore.setState({ selectedTerritory: 'home', attackSource: null, navalSource: null } as never);
    // jsdom has no layout: the sheet starts at y=400 and the first destination
    // ends at y=700, so the dial and that row need 300px plus a little air.
    rects = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      const top = this.classList.contains('mobile-sheet-above-nav') ? 400 : 0;
      const bottom = this.hasAttribute('data-neighbor-target') ? 700 : top;
      return { top, bottom, left: 0, right: 0, width: 0, height: bottom - top, x: 0, y: top, toJSON: () => ({}) } as DOMRect;
    });
  });

  afterEach(() => {
    rects.mockRestore();
    setFlag(false);
  });

  it('grows the peek snap to the first destination row with the flag on', () => {
    setFlag(true);
    const sheet = renderPanel('peek');
    expect(sheet.classList.contains('mobile-sheet-fortify-fit')).toBe(true);
    expect(sheet.classList.contains('mobile-sheet-peek')).toBe(false);
    expect(sheet.style.getPropertyValue('--fortify-fit-height')).toBe('312px');
  });

  it('keeps the peek snap exactly as before with the flag off', () => {
    setFlag(false);
    const sheet = renderPanel('peek');
    expect(sheet.classList.contains('mobile-sheet-peek')).toBe(true);
    expect(sheet.classList.contains('mobile-sheet-fortify-fit')).toBe(false);
    expect(sheet.style.getPropertyValue('--fortify-fit-height')).toBe('');
  });

  it('leaves a snap the player dragged to alone', () => {
    setFlag(true);
    const sheet = renderPanel('full');
    expect(sheet.classList.contains('mobile-sheet-full')).toBe(true);
    expect(sheet.classList.contains('mobile-sheet-fortify-fit')).toBe(false);
  });
});
