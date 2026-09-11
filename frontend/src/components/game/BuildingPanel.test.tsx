import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import BuildingPanel, { BUILDING_META } from './BuildingPanel';
import { BUILDING_DISPLAY, buildingDisplayName, buildingEffect } from '@borderfall/shared';

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

/**
 * Building names and effects used to live in three independent tables — this
 * panel, the Bonuses modal, and the backend's validation messages — and had
 * drifted apart on both. They now all read `BUILDING_DISPLAY` from
 * @borderfall/shared; these tests are what stop a fourth local table appearing.
 */
describe('building names and effects come from the shared table', () => {
  it('renders every building with the shared name and effect', () => {
    for (const [id, meta] of Object.entries(BUILDING_META)) {
      expect(meta.label).toBe(buildingDisplayName(id));
      expect(meta.description).toBe(buildingEffect(id));
    }
  });

  it('has a shared entry for every building it can render', () => {
    // A missing entry falls back to the raw id, so a player would see
    // "production_1" on a build button.
    for (const id of Object.keys(BUILDING_META)) {
      expect(BUILDING_DISPLAY[id]).toBeDefined();
      expect(meaningful(BUILDING_META[id].label)).toBe(true);
      expect(meaningful(BUILDING_META[id].description)).toBe(true);
    }
  });

  it('describes production buildings as production points, never as units', () => {
    // The bug this table exists to prevent: the chain was called Camp /
    // Barracks / Arsenal and advertised "+N units per turn", but it credits the
    // PP pool and nothing converts PP to reinforcements.
    for (const id of ['production_1', 'production_2', 'production_3', 'production_4']) {
      const { label, description } = BUILDING_META[id];
      expect(description).toMatch(/PP\/turn$/);
      expect(description).not.toMatch(/unit/i);
      expect(label).not.toMatch(/camp|barracks|arsenal/i);
    }
  });

  it('names the production chain as one escalating industry, tiered I-IV', () => {
    const tiers = ['production_1', 'production_2', 'production_3', 'production_4']
      .map((id) => BUILDING_DISPLAY[id]?.tier);
    expect(tiers).toEqual(['I', 'II', 'III', 'IV']);
  });
});

describe('buildings gated behind an unresearched tech', () => {
  // The server refuses these with "You must research the required technology
  // first" — a rejection that names neither the building nor the tech, after
  // the player has already spent the click. The panel now says so up front.
  const locked = { production_1: 'Granaries' };

  it('lists the locked building rather than hiding it, and names the research', () => {
    render(<BuildingPanel {...baseProps} techLocks={locked} />);
    const row = screen.getByRole('button', { name: /Workshop/ });
    expect(row).toHaveTextContent('Granaries');
    expect(row).not.toHaveTextContent('💰');
  });

  it('routes a click to the tech tree instead of attempting the build', () => {
    const onBuild = vi.fn();
    const onOpenTechTree = vi.fn();
    render(
      <BuildingPanel {...baseProps} onBuild={onBuild} techLocks={locked} onOpenTechTree={onOpenTechTree} />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Workshop/ }));
    expect(onOpenTechTree).toHaveBeenCalledTimes(1);
    expect(onBuild).not.toHaveBeenCalled();
  });

  it('is inert rather than misleading when there is no tech tree to open', () => {
    const onBuild = vi.fn();
    render(<BuildingPanel {...baseProps} onBuild={onBuild} techLocks={locked} />);
    const row = screen.getByRole('button', { name: /Workshop/ });
    expect(row).toBeDisabled();
    fireEvent.click(row);
    expect(onBuild).not.toHaveBeenCalled();
  });

  it('builds normally once the tech is researched', () => {
    const onBuild = vi.fn();
    render(<BuildingPanel {...baseProps} onBuild={onBuild} techLocks={{}} />);
    fireEvent.click(screen.getByRole('button', { name: /Workshop/ }));
    expect(onBuild).toHaveBeenCalledWith('production_1');
  });

  it('shows the tech lock ahead of the price — saving up cannot open it', () => {
    render(<BuildingPanel {...baseProps} playerResources={0} techLocks={locked} onOpenTechTree={() => {}} />);
    const row = screen.getByRole('button', { name: /Workshop/ });
    expect(row).toHaveTextContent('Granaries');
    expect(row).not.toHaveTextContent(/more resources/);
  });
});

function meaningful(text: string): boolean {
  return text.length > 0 && !/^[a-z_]+[0-9]?$/.test(text);
}

describe('BuildingPanel — era heritage & modernize', () => {
  it('labels a build option offered only by an inherited right, and keeps it live', () => {
    // The reported case: tier-3 walls in the old era, so a basic wall must stay
    // buildable in the new one rather than reading as locked.
    const onBuild = vi.fn();
    render(
      <BuildingPanel
        {...baseProps}
        onBuild={onBuild}
        heritageUnlocks={['defense_1']}
      />,
    );
    const btn = screen.getByRole('button', { name: /Heritage/ });
    expect(btn).not.toBeDisabled();
    fireEvent.click(btn);
    expect(onBuild).toHaveBeenCalledWith('defense_1');
  });

  it('marks a carried-forward building as aged and names the research that lifts it', () => {
    render(
      <BuildingPanel
        {...baseProps}
        buildings={['defense_3']}
        buildingStates={{ defense_3: 'aged' }}
        modernizeTechFor={{ defense_3: 'Castle Keep' }}
      />,
    );
    expect(screen.getByText('aged')).toBeInTheDocument();
    expect(screen.getByTitle(/Research Castle Keep to modernize it/)).toBeInTheDocument();
  });

  it('marks a modernized building as outperforming new construction', () => {
    render(
      <BuildingPanel
        {...baseProps}
        buildings={['defense_3']}
        buildingStates={{ defense_3: 'modernized' }}
      />,
    );
    expect(screen.getByText('modernized')).toBeInTheDocument();
    expect(screen.getByTitle(/outperforms new construction/)).toBeInTheDocument();
  });

  it('says nothing about age when the feature is off (no state passed)', () => {
    render(<BuildingPanel {...baseProps} buildings={['defense_3']} />);
    expect(screen.queryByText('aged')).toBeNull();
    expect(screen.queryByText('modernized')).toBeNull();
    expect(screen.queryByText(/Heritage/)).toBeNull();
  });
});
