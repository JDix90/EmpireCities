import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import BuildingPanel, { BUILDING_META, buildingMetaForEra } from './BuildingPanel';
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

  it('offers a Galactic Age world building with its name, effect and price', () => {
    const onBuild = vi.fn();
    render(<BuildingPanel {...baseProps} onBuild={onBuild} extraBuildOptions={['toll_beacon']} />);
    const btn = screen.getByRole('button', { name: /Toll Beacon/ });
    expect(btn).toHaveTextContent('+1 PP/turn while you hold both ends of its lane (one per lane)');
    expect(btn).toHaveTextContent('6💰');
    fireEvent.click(btn);
    expect(onBuild).toHaveBeenCalledWith('toll_beacon');
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

describe('BuildingPanel — era building names (Galactic Age buildings v2)', () => {
  it('names a standing building and a build option for the era when nameEra is set', () => {
    render(<BuildingPanel {...baseProps} buildings={['production_1']} nameEra="galaxy_age" />);
    expect(screen.getByText('Fabricator (I)')).toBeInTheDocument();
    expect(screen.queryByText('Workshop (I)')).toBeNull();
    // The upgrade of the standing building, offered under its era name.
    expect(screen.getByRole('button', { name: /Orbital Foundry \(II\)/ })).toBeInTheDocument();
  });

  it('keeps the shared names without nameEra, and for an era without its own', () => {
    render(<BuildingPanel {...baseProps} buildings={['production_1']} />);
    expect(screen.getByText('Workshop (I)')).toBeInTheDocument();
    expect(buildingMetaForEra('production_1')?.label).toBe(BUILDING_META.production_1.label);
    expect(buildingMetaForEra('production_1', 'space_age')?.label).toBe('Workshop (I)');
    expect(buildingMetaForEra('production_1', 'galaxy_age')).toMatchObject({
      label: 'Fabricator (I)',
      cost: BUILDING_META.production_1.cost,
      description: BUILDING_META.production_1.description,
    });
    expect(buildingMetaForEra('wonder_colosseum', 'galaxy_age')).toBeUndefined();
  });
});

describe('BuildingPanel — orbital infrastructure (Galactic Age buildings, Phase 2)', () => {
  it('says that a gateway\'s buildings survive capture, only when told so', () => {
    render(<BuildingPanel {...baseProps} buildings={['production_1']} orbital />);
    expect(screen.getByTestId('orbital-infrastructure-note')).toHaveTextContent(/survive capture/);
  });

  it('says nothing on an ordinary tile', () => {
    render(<BuildingPanel {...baseProps} buildings={['production_1']} />);
    expect(screen.queryByTestId('orbital-infrastructure-note')).toBeNull();
  });
});

describe("BuildingPanel — buildings that cannot matter, and today's goal", () => {
  // The economy day that produced this offered a Laboratory (tech trees off),
  // a Palisade (nothing could reach it) and a wonder beside the one Workshop
  // the goal needed, on a budget that could afford exactly one mistake.
  const blocked = { tech_gen_1: 'No tech trees in this game, so tech points would go unused.' };

  it('lists a building that cannot matter here, disabled, with the reason and no price', () => {
    const onBuild = vi.fn();
    render(<BuildingPanel {...baseProps} onBuild={onBuild} unavailable={blocked} />);
    const row = screen.getByRole('button', { name: /Laboratory/ });
    expect(row).toBeDisabled();
    expect(row).toHaveTextContent('No tech trees in this game');
    expect(row).not.toHaveTextContent('💰');
    fireEvent.click(row);
    expect(onBuild).not.toHaveBeenCalled();
    // The others are untouched.
    expect(screen.getByRole('button', { name: /Workshop/ })).not.toBeDisabled();
  });

  it('lets the reason outrank a tech lock', () => {
    const onOpenTechTree = vi.fn();
    render(
      <BuildingPanel
        {...baseProps}
        techLocks={{ tech_gen_1: 'Scholarship' }}
        onOpenTechTree={onOpenTechTree}
        unavailable={blocked}
      />,
    );
    const row = screen.getByRole('button', { name: /Laboratory/ });
    expect(row).toBeDisabled();
    expect(row).not.toHaveTextContent('Scholarship');
    fireEvent.click(row);
    expect(onOpenTechTree).not.toHaveBeenCalled();
  });

  it('says what today counts, and tags the live rows that do not', () => {
    const onBuild = vi.fn();
    render(
      <BuildingPanel
        {...baseProps}
        onBuild={onBuild}
        focus={{
          note: "Today's goal: Workshop (I), then Foundry (II) on top of it. Nothing else counts toward it.",
          countsToward: ['production_1', 'production_2'],
        }}
      />,
    );
    expect(screen.getByTestId('build-focus-note')).toHaveTextContent('Workshop (I), then Foundry (II)');
    expect(screen.getByRole('button', { name: /Workshop/ })).not.toHaveTextContent("Not today's goal");
    const palisade = screen.getByRole('button', { name: /Palisade/ });
    expect(palisade).toHaveTextContent("Not today's goal");
    // Tagged, not blocked: it still builds.
    expect(palisade).not.toBeDisabled();
    fireEvent.click(palisade);
    expect(onBuild).toHaveBeenCalledWith('defense_1');
  });

  it('does not tag a row it has already marked as unable to matter', () => {
    render(
      <BuildingPanel
        {...baseProps}
        unavailable={blocked}
        focus={{ note: 'x', countsToward: ['production_1'] }}
      />,
    );
    expect(screen.getByRole('button', { name: /Laboratory/ })).not.toHaveTextContent("Not today's goal");
  });
});

describe('BuildingPanel — garrison doctrines (Galactic Age buildings, Phase 3)', () => {
  it('offers both doctrines to the owner on their turn, and trains the one clicked', () => {
    const onSet = vi.fn();
    render(<BuildingPanel {...baseProps} buildings={['production_1']} garrison={{ cost: 6, onSet }} />);
    const hardened = screen.getByRole('button', { name: /Hardened/ });
    fireEvent.click(hardened);
    expect(onSet).toHaveBeenCalledWith('hardened');
    expect(screen.getByRole('button', { name: /Forward/ })).not.toBeDisabled();
  });

  it('shows the held doctrine to anyone, and disables re-buying it', () => {
    render(<BuildingPanel {...baseProps} buildings={['production_1']} garrison={{ current: 'forward', cost: 6, onSet: vi.fn() }} />);
    expect(screen.getByTestId('garrison-doctrine-current')).toHaveTextContent(/Forward garrison/);
    expect(screen.getByRole('button', { name: /Forward/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Hardened/ })).not.toBeDisabled();
  });

  it('names what blocks training, and leaves both disabled', () => {
    render(<BuildingPanel {...baseProps} buildings={[]} garrison={{ cost: 6, blockedReason: 'Needs a building on this system', onSet: vi.fn() }} />);
    expect(screen.getByTestId('garrison-doctrine-blocked')).toHaveTextContent(/Needs a building/);
    expect(screen.getByRole('button', { name: /Hardened/ })).toBeDisabled();
  });

  it('is disabled when the purse is short, and absent on a rival\'s tile with no doctrine', () => {
    const { unmount } = render(<BuildingPanel {...baseProps} playerResources={4} buildings={['production_1']} garrison={{ cost: 6, onSet: vi.fn() }} />);
    expect(screen.getByRole('button', { name: /Forward/ })).toBeDisabled();
    unmount();
    render(<BuildingPanel {...baseProps} isMine={false} buildings={['production_1']} garrison={{ cost: 6 }} />);
    expect(screen.queryByTestId('garrison-doctrine')).toBeNull();
  });

  it('says nothing about garrisons in a game without them', () => {
    render(<BuildingPanel {...baseProps} buildings={['production_1']} />);
    expect(screen.queryByTestId('garrison-doctrine')).toBeNull();
  });
});
