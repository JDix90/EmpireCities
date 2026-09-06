import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import TechTreeEraProgress from './TechTreeEraProgress';
import type { AdvanceEraClientPreview, GameState, PlayerState } from '../../store/gameStore';

function preview(overrides: Partial<AdvanceEraClientPreview> = {}): AdvanceEraClientPreview {
  return {
    cost: 20,
    can_advance: false,
    current_era_index: 0,
    max_era_index: 5,
    current_era_id: 'ancient',
    next_era_id: 'medieval',
    gate_mode: 'milestone',
    readiness: {
      met: false,
      mode: 'milestone',
      tier1: { met: false, current: 1, required: 3, label: 'tier-1 technologies' },
      tier2: { met: true, current: 1, required: 1, label: 'tier-2 technologies' },
      buildings: { met: false, current: 0, required: 1, label: 'buildings' },
    },
    next_signature: { id: 'levy_of_knights', name: 'Levy of Knights', description: '+1 attack die.' },
    ...overrides,
  };
}

function gameState(p: AdvanceEraClientPreview | undefined, settings: Partial<GameState['settings']> = {}): GameState {
  return {
    phase: 'draft',
    era_spine: [{ era_id: 'ancient' }, { era_id: 'medieval' }],
    era_advancement_preview: p,
    settings: { era_advancement_enabled: true, tech_trees_enabled: true, ...settings },
  } as unknown as GameState;
}

function player(overrides: Partial<PlayerState> = {}): PlayerState {
  return { player_id: 'me', special_resource: 100, current_era_index: 0, ...overrides } as PlayerState;
}

describe('TechTreeEraProgress', () => {
  it('renders the advancement gate chips and next-era target', () => {
    render(<TechTreeEraProgress gameState={gameState(preview())} player={player()} />);
    expect(screen.getByTestId('techtree-era-progress')).toBeInTheDocument();
    const chips = screen.getByTestId('techtree-gate-chips');
    expect(chips).toHaveTextContent('T1 1/3');
    expect(chips).toHaveTextContent('Bldg 0/1');
    expect(screen.getByText(/Levy of Knights/)).toBeInTheDocument();
  });

  it('shows the tier-3 chip only when the gate requires it', () => {
    const withT3 = preview({
      readiness: {
        met: false,
        mode: 'milestone',
        tier1: { met: true, current: 3, required: 3, label: 't1' },
        tier2: { met: true, current: 2, required: 2, label: 't2' },
        tier3: { met: false, current: 0, required: 1, label: 't3' },
        buildings: { met: true, current: 2, required: 2, label: 'b' },
      },
    });
    render(<TechTreeEraProgress gameState={gameState(withT3)} player={player()} />);
    expect(screen.getByTestId('techtree-gate-chips')).toHaveTextContent('T3 0/1');
  });

  it('summarizes era-keyed tech echo carried forward', () => {
    render(
      <TechTreeEraProgress
        gameState={gameState(preview({ current_era_index: 2, current_era_id: 'discovery', next_era_id: 'ww2' }))}
        player={player({ current_era_index: 2, era_advancement_tech_echo: { ancient: { attack_bonus: 2 }, medieval: { reinforce_bonus: 1 } } })}
      />,
    );
    const echo = screen.getByTestId('techtree-echo');
    expect(echo).toHaveTextContent('+2 Atk');
    expect(echo).toHaveTextContent('+1 Reinf');
  });

  it('renders nothing when era advancement is off, no preview, or no player', () => {
    const { container: off } = render(
      <TechTreeEraProgress gameState={gameState(preview(), { era_advancement_enabled: false })} player={player()} />,
    );
    expect(off.querySelector('[data-testid="techtree-era-progress"]')).toBeNull();

    const { container: noPreview } = render(
      <TechTreeEraProgress gameState={gameState(undefined)} player={player()} />,
    );
    expect(noPreview.querySelector('[data-testid="techtree-era-progress"]')).toBeNull();

    const { container: noPlayer } = render(<TechTreeEraProgress gameState={gameState(preview())} player={null} />);
    expect(noPlayer.querySelector('[data-testid="techtree-era-progress"]')).toBeNull();
  });

  it('hides a requirement the gate does not have, instead of showing "0/0"', () => {
    // The core tutorial drops the tier-2 and building requirements. A chip
    // reading "T2 0/0" looks like something still to do.
    const techOnly = preview({
      readiness: {
        met: false,
        mode: 'milestone',
        tier1: { met: false, current: 1, required: 2, label: 't1' },
        tier2: { met: true, current: 0, required: 0, label: 't2' },
        buildings: { met: true, current: 0, required: 0, label: 'b' },
      },
    });
    render(<TechTreeEraProgress gameState={gameState(techOnly)} player={player()} />);
    const chips = screen.getByTestId('techtree-gate-chips');
    expect(chips).toHaveTextContent('T1 1/2');
    expect(chips).not.toHaveTextContent('T2');
    expect(chips).not.toHaveTextContent('Bldg');
  });

  it('offers Advance inline once the gate is ready', () => {
    // The only other Advance control is in a sidebar panel that is collapsed by
    // default and sits behind this modal's backdrop, so a player told "the gate
    // is ready" had to guess they must close the tree and go find it.
    const onAdvance = vi.fn();
    const ready = preview({
      can_advance: true,
      readiness: {
        met: true,
        mode: 'milestone',
        tier1: { met: true, current: 2, required: 2, label: 't1' },
        tier2: { met: true, current: 0, required: 0, label: 't2' },
        buildings: { met: true, current: 0, required: 0, label: 'b' },
      },
    });
    render(
      <TechTreeEraProgress
        gameState={gameState(ready)}
        player={player()}
        onAdvanceEra={onAdvance}
        canAdvanceNow
      />,
    );
    fireEvent.click(screen.getByTestId('techtree-advance-era'));
    expect(onAdvance).toHaveBeenCalledTimes(1);
  });

  it('disables the inline Advance off your own draft phase rather than hiding it', () => {
    const ready = preview({
      can_advance: true,
      readiness: {
        met: true,
        mode: 'milestone',
        tier1: { met: true, current: 2, required: 2, label: 't1' },
        tier2: { met: true, current: 0, required: 0, label: 't2' },
        buildings: { met: true, current: 0, required: 0, label: 'b' },
      },
    });
    render(
      <TechTreeEraProgress gameState={gameState(ready)} player={player()} onAdvanceEra={() => {}} canAdvanceNow={false} />,
    );
    const btn = screen.getByTestId('techtree-advance-era');
    expect(btn).toBeDisabled();
    expect(btn).toHaveTextContent(/wait for your turn/i);
  });

  it('shows no inline Advance while the gate is unmet', () => {
    render(<TechTreeEraProgress gameState={gameState(preview())} player={player()} onAdvanceEra={() => {}} canAdvanceNow />);
    expect(screen.queryByTestId('techtree-advance-era')).toBeNull();
  });

  it('shows an apex message at the final era', () => {
    render(
      <TechTreeEraProgress
        gameState={gameState(preview({ current_era_index: 5, max_era_index: 5, current_era_id: 'modern', next_era_id: 'modern' }))}
        player={player({ current_era_index: 5 })}
      />,
    );
    expect(screen.getByText(/Final era reached/)).toBeInTheDocument();
  });
});

/**
 * Reported from the tutorial: every gate chip green, "1 to go" beside them, no
 * Advance button, and nothing on the rail saying what the one thing was. The
 * missing requirement was the phase — `blockers` counted it and the chip row
 * never drew it.
 */
describe('TechTreeEraProgress — the count must match what is shown', () => {
  const allGatesMet = preview({
    cost: 13,
    can_advance: true,
    readiness: {
      met: true,
      mode: 'milestone',
      tier1: { met: true, current: 2, required: 2, label: 'tier-1 technologies' },
      tier2: { met: true, current: 0, required: 0, label: 'tier-2 technologies' },
      buildings: { met: true, current: 0, required: 0, label: 'buildings' },
    },
  });

  it('names the phase requirement instead of counting an invisible one', () => {
    render(
      <TechTreeEraProgress
        gameState={gameState(allGatesMet, {})}
        player={player({ special_resource: 16 })}
      />,
    );
    // Reproduce the report: gold and tier-1 both satisfied.
    const chips = screen.getByTestId('techtree-gate-chips');
    expect(chips).toHaveTextContent('T1 2/2');
    expect(chips).toHaveTextContent('Gold 16/13');
    // In a phase that allows advancing, nothing is outstanding.
    expect(screen.getByText('Ready')).toBeInTheDocument();
    expect(screen.queryByTestId('techtree-gate-blockers')).toBeNull();
  });

  it('shows the phase blocker in fortify, where the gate silently failed', () => {
    const fortifying = { ...gameState(allGatesMet), phase: 'fortify' } as unknown as GameState;
    render(<TechTreeEraProgress gameState={fortifying} player={player({ special_resource: 16 })} />);

    expect(screen.getByText('1 to go')).toBeInTheDocument();
    expect(screen.getByTestId('techtree-gate-blockers')).toHaveTextContent(
      'Advance during your Reinforcement or Attack phase',
    );
    // And it earns a chip of its own, so the row is not all-green above "1 to go".
    expect(screen.getByTestId('techtree-gate-chips')).toHaveTextContent('Reinforce/Attack phase');
  });

  it('counts exactly as many outstanding items as it lists', () => {
    const twoShort = preview({
      cost: 20,
      readiness: {
        met: false,
        mode: 'milestone',
        tier1: { met: false, current: 1, required: 3, label: 't1' },
        tier2: { met: true, current: 0, required: 0, label: 't2' },
        buildings: { met: true, current: 0, required: 0, label: 'b' },
      },
    });
    render(<TechTreeEraProgress gameState={gameState(twoShort)} player={player({ special_resource: 5 })} />);
    // Tier-1 and gold are short; tier-2 and buildings require nothing and are
    // neither drawn nor counted.
    expect(screen.getByText('2 to go')).toBeInTheDocument();
    const blockers = screen.getByTestId('techtree-gate-blockers');
    expect(blockers).toHaveTextContent('Tier-1 technologies: 1/3');
    expect(blockers).toHaveTextContent('Gold: 5 / 20 required');
    expect(blockers).not.toHaveTextContent('Tier-2');
    expect(screen.getByTestId('techtree-gate-chips')).not.toHaveTextContent('T2');
  });

  it('does not offer the Advance button while the phase blocks it', () => {
    const fortifying = { ...gameState(allGatesMet), phase: 'fortify' } as unknown as GameState;
    render(
      <TechTreeEraProgress
        gameState={fortifying}
        player={player({ special_resource: 16 })}
        onAdvanceEra={vi.fn()}
        canAdvanceNow
      />,
    );
    expect(screen.queryByTestId('techtree-advance-era')).toBeNull();
  });
});
