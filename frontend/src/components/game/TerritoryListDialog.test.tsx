import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import TerritoryListDialog from './TerritoryListDialog';
import type { GameState } from '../../store/gameStore';

const territories = [
  { territory_id: 'gaul', name: 'Gaul', region_id: 'west' },
  { territory_id: 'italia', name: 'Italia', region_id: 'west' },
  { territory_id: 'parthia', name: 'Parthia', region_id: 'east' },
  // Authored for a later era: not on this board.
  { territory_id: 'vinland', name: 'Vinland', region_id: 'americas' },
];
const regions = [
  { region_id: 'west', name: 'The West' },
  { region_id: 'east', name: 'The East' },
];
const gameState = {
  players: [
    { player_id: 'me', username: 'Me', color: '#111111' },
    { player_id: 'ai', username: 'Marshal', color: '#222222' },
  ],
  territories: {
    gaul: { territory_id: 'gaul', owner_id: 'me', unit_count: 4 },
    italia: { territory_id: 'italia', owner_id: 'ai', unit_count: 2 },
    parthia: { territory_id: 'parthia', owner_id: 'ai', unit_count: -1 },
  },
} as unknown as GameState;

function mount() {
  const onSelect = vi.fn();
  const onClose = vi.fn();
  render(
    <TerritoryListDialog
      territories={territories}
      regions={regions}
      gameState={gameState}
      viewerPlayerId="me"
      selectedTerritoryId="gaul"
      onSelect={onSelect}
      onClose={onClose}
    />,
  );
  return { onSelect, onClose };
}

describe('TerritoryListDialog', () => {
  it('lists the territories on the board, grouped by region, with owner and units', () => {
    mount();
    expect(screen.getByRole('dialog', { name: 'Territories' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'The West' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'The East' })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Gaul.*Yours · 4 units/ })).toHaveAttribute('aria-current', 'true');
    expect(screen.getByRole('button', { name: /Italia.*Marshal · 2 units/ })).toBeTruthy();
    // Fog of war: a hidden count is -1 on the client.
    expect(screen.getByRole('button', { name: /Parthia.*Marshal · units hidden/ })).toBeTruthy();
    expect(screen.queryByText('Vinland')).toBeNull();
  });

  it('hands the chosen territory to the map handler and closes', () => {
    const { onSelect, onClose } = mount();
    fireEvent.click(screen.getByRole('button', { name: /Italia/ }));
    expect(onSelect).toHaveBeenCalledWith('italia');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('filters by name and by ownership', () => {
    mount();
    const filter = screen.getByLabelText('Filter territories by name');
    fireEvent.change(filter, { target: { value: 'par' } });
    expect(screen.queryByText('Gaul')).toBeNull();
    expect(screen.getByText('Parthia')).toBeTruthy();
    fireEvent.change(filter, { target: { value: '' } });
    fireEvent.click(screen.getByLabelText('Only my territories'));
    expect(screen.getByText('Gaul')).toBeTruthy();
    expect(screen.queryByText('Italia')).toBeNull();
  });

  it('focuses the filter on open and closes on Escape', () => {
    const { onClose } = mount();
    expect(document.activeElement).toBe(screen.getByLabelText('Filter territories by name'));
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
