import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import NeighborTerritoryPicker from './NeighborTerritoryPicker';
import type { NeighborTargetRow } from '../../utils/mapAdjacencyTargets';

function row(over: Partial<NeighborTargetRow> = {}): NeighborTargetRow {
  return { territoryId: 'milan', name: 'Milan', unitCount: 3, isSea: false, isOrbit: false, ...over };
}

describe('NeighborTerritoryPicker — attack rows attack', () => {
  it('fires the attack from the wide row, not just the narrow button', () => {
    const onAttack = vi.fn();
    const onSelect = vi.fn();
    render(
      <NeighborTerritoryPicker
        phase="attack"
        sourceName="Rome"
        neighbors={[row()]}
        onSelect={onSelect}
        onAttack={onAttack}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Attack Milan' }));
    expect(onAttack).toHaveBeenCalledWith('milan');
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('keeps an inspect affordance that navigates instead of attacking', () => {
    const onAttack = vi.fn();
    const onSelect = vi.fn();
    render(
      <NeighborTerritoryPicker
        phase="attack"
        sourceName="Rome"
        neighbors={[row()]}
        onSelect={onSelect}
        onAttack={onAttack}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Inspect Milan/ }));
    expect(onSelect).toHaveBeenCalledWith('milan');
    expect(onAttack).not.toHaveBeenCalled();
  });

  it('still selects (never attacks) when no attack handler is wired', () => {
    const onSelect = vi.fn();
    render(
      <NeighborTerritoryPicker phase="attack" sourceName="Rome" neighbors={[row()]} onSelect={onSelect} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Select Milan' }));
    expect(onSelect).toHaveBeenCalledWith('milan');
    expect(screen.queryByRole('button', { name: /Inspect Milan/ })).toBeNull();
  });

  it('leaves fortify rows as plain selection', () => {
    const onSelect = vi.fn();
    const onAttack = vi.fn();
    render(
      <NeighborTerritoryPicker
        phase="fortify"
        sourceName="Rome"
        neighbors={[row({ name: 'Turin', territoryId: 'turin' })]}
        onSelect={onSelect}
        onAttack={onAttack}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Select Turin' }));
    expect(onSelect).toHaveBeenCalledWith('turin');
    expect(onAttack).not.toHaveBeenCalled();
  });

  it('does not attack from a locked hyperspace row', () => {
    const onAttack = vi.fn();
    const onSelect = vi.fn();
    render(
      <NeighborTerritoryPicker
        phase="attack"
        sourceName="Rome"
        neighbors={[row({ isOrbit: true, targetWorldName: 'Verdan' })]}
        onSelect={onSelect}
        onAttack={onAttack}
        orbitLocked
        orbitLockReason="Hyperspace travel requires: Hyperspace Chart tech"
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Milan locked/ }));
    expect(onAttack).not.toHaveBeenCalled();
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('counts one unit as a unit', () => {
    render(
      <NeighborTerritoryPicker
        phase="attack"
        sourceName="Rome"
        neighbors={[row({ unitCount: 1 }), row({ territoryId: 'turin', name: 'Turin', unitCount: 2 })]}
        onSelect={() => {}}
        onAttack={() => {}}
      />,
    );
    expect(screen.getByText('1 unit')).toBeInTheDocument();
    expect(screen.getByText('2 units')).toBeInTheDocument();
  });

  it('hides fog-hidden strength rather than claiming "-1 units"', () => {
    render(
      <NeighborTerritoryPicker
        phase="attack"
        sourceName="Rome"
        neighbors={[row({ unitCount: -1 })]}
        onSelect={() => {}}
        onAttack={() => {}}
      />,
    );
    expect(screen.getByText('? units')).toBeInTheDocument();
  });
});
