/**
 * Phone sheet fit (`phone_sheet_fit_enabled`): on a 664px-tall phone the half
 * snap ended 30px into the Place button, and the attack target rows sat under
 * the fold the same way. With the flag on, the peek and half snaps grow to the
 * measured bottom of that main action; off, the sheet is the snap it always
 * was; a sheet dragged to full is left alone.
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

function game(phase: 'draft' | 'attack'): GameState {
  const player = (player_id: string, player_index: number, username: string) => ({
    player_id, player_index, username, color: '#888', is_ai: player_id !== 'me', is_eliminated: false,
    territory_count: 1, cards: [], mmr: 1000, unlocked_techs: [], ability_uses: {},
  });
  return {
    game_id: 'g1',
    era: 'ww2',
    map_id: 'm1',
    phase,
    current_player_index: 0,
    starting_player_index: 0,
    turn_number: 2,
    players: [player('me', 0, 'Jeff'), player('foe', 1, 'Rival')],
    territories: {
      home: { territory_id: 'home', owner_id: 'me', unit_count: 9 },
      west: { territory_id: 'west', owner_id: 'foe', unit_count: 2 },
    },
    draft_units_remaining: phase === 'draft' ? 4 : 0,
    card_set_redemption_count: 0,
    settings: { fog_of_war: false },
  } as unknown as GameState;
}

function renderPanel(phase: 'draft' | 'attack', sheetSnap: SheetSnap) {
  useGameStore.setState({ gameState: game(phase), draftUnitsRemaining: phase === 'draft' ? 4 : 0 } as never);
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
  useFeatureFlagsStore.setState((s) => ({ flags: { ...s.flags, phone_sheet_fit_enabled: on } }));

describe('TerritoryPanel phone sheet fit', () => {
  let rects: ReturnType<typeof vi.spyOn>;
  const width = Object.getOwnPropertyDescriptor(window, 'innerWidth');
  const height = Object.getOwnPropertyDescriptor(window, 'innerHeight');

  beforeEach(() => {
    // An upright 664px phone: the sheet is a portrait phone's.
    Object.defineProperty(window, 'innerWidth', { value: 390, configurable: true });
    Object.defineProperty(window, 'innerHeight', { value: 664, configurable: true });
    window.matchMedia = vi.fn().mockReturnValue({
      matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn(),
      addListener: vi.fn(), removeListener: vi.fn(),
    }) as unknown as typeof window.matchMedia;
    useAuthStore.setState({ user: { user_id: 'me', username: 'Jeff' } as never, isAuthenticated: true });
    useUiStore.setState({ selectedTerritory: 'home', attackSource: null, navalSource: null } as never);
    // jsdom has no layout: the sheet starts at y=325 (as measured in Chromium
    // at 390x664) and the main action ends at y=622, 297px into the sheet.
    rects = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      const top = this.classList.contains('mobile-sheet-above-nav') ? 325 : 0;
      const isAction = this.dataset.testid === 'draft-place' || this.hasAttribute('data-neighbor-target');
      const bottom = isAction ? 622 : top;
      return { top, bottom, left: 0, right: 0, width: 0, height: bottom - top, x: 0, y: top, toJSON: () => ({}) } as DOMRect;
    });
  });

  afterEach(() => {
    rects.mockRestore();
    setFlag(true);
    if (width) Object.defineProperty(window, 'innerWidth', width);
    if (height) Object.defineProperty(window, 'innerHeight', height);
  });

  it('grows the half snap to the Place button while reinforcing', () => {
    setFlag(true);
    const sheet = renderPanel('draft', 'half');
    expect(sheet.querySelector('[data-testid="draft-place"]')).not.toBeNull();
    expect(sheet.classList.contains('mobile-sheet-fit-half')).toBe(true);
    expect(sheet.classList.contains('mobile-sheet-half')).toBe(false);
    expect(sheet.style.getPropertyValue('--sheet-fit-height')).toBe('309px');
  });

  it('grows the peek snap to the first target row while attacking', () => {
    setFlag(true);
    const sheet = renderPanel('attack', 'peek');
    expect(sheet.querySelector('[data-neighbor-target]')).not.toBeNull();
    expect(sheet.classList.contains('mobile-sheet-fit-peek')).toBe(true);
    expect(sheet.style.getPropertyValue('--sheet-fit-height')).toBe('309px');
  });

  it('keeps the snap exactly as before with the flag off', () => {
    setFlag(false);
    const sheet = renderPanel('draft', 'half');
    expect(sheet.classList.contains('mobile-sheet-half')).toBe(true);
    expect(sheet.classList.contains('mobile-sheet-fit-half')).toBe(false);
    expect(sheet.style.getPropertyValue('--sheet-fit-height')).toBe('');
  });

  it('leaves a sheet the player dragged to full alone', () => {
    setFlag(true);
    const sheet = renderPanel('draft', 'full');
    expect(sheet.classList.contains('mobile-sheet-full')).toBe(true);
    expect(sheet.style.getPropertyValue('--sheet-fit-height')).toBe('');
  });
});
