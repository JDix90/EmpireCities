import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import BuildingPanel from './BuildingPanel';

const baseProps = {
  territoryId: 't1',
  buildings: [] as string[],
  playerResources: 100,
  isMine: true,
  isMyTurn: true,
  phase: 'draft',
  onBuild: () => {},
};

describe('BuildingPanel — era-aware buildings (#8)', () => {
  it('offers an era-special building (launch_pad) passed via extraBuildOptions', () => {
    const onBuild = vi.fn();
    render(<BuildingPanel {...baseProps} onBuild={onBuild} extraBuildOptions={['launch_pad']} />);
    const btn = screen.getByRole('button', { name: /Launch Pad/ });
    expect(btn).toBeInTheDocument();
    fireEvent.click(btn);
    expect(onBuild).toHaveBeenCalledWith('launch_pad');
  });

  it('does not offer an era-special building already built on the territory', () => {
    render(<BuildingPanel {...baseProps} buildings={['launch_pad']} extraBuildOptions={['launch_pad']} />);
    // It shows as an existing building, not as a build button.
    expect(screen.queryByRole('button', { name: /Launch Pad/ })).toBeNull();
    expect(screen.getByText('Launch Pad')).toBeInTheDocument();
  });

  it('renders a built wonder from any era by name (not just the current era)', () => {
    // Ancient wonder still on the territory after advancing; current eraWonder is the Space Age one.
    render(
      <BuildingPanel
        {...baseProps}
        buildings={['wonder_colosseum']}
        eraWonder={{ id: 'wonder_space_elevator', name: 'Space Elevator', description: 'x', cost: 25, alreadyBuilt: false }}
      />,
    );
    expect(screen.getByText('Colosseum')).toBeInTheDocument();
  });

  it('offers the current-era wonder build option from eraWonder', () => {
    const onBuild = vi.fn();
    render(
      <BuildingPanel
        {...baseProps}
        onBuild={onBuild}
        eraWonder={{ id: 'wonder_space_elevator', name: 'Space Elevator', description: 'Orbital marvel', cost: 25, alreadyBuilt: false }}
      />,
    );
    const btn = screen.getByRole('button', { name: /Space Elevator/ });
    fireEvent.click(btn);
    expect(onBuild).toHaveBeenCalledWith('wonder_space_elevator');
  });
});
