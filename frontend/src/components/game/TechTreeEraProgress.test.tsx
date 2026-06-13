import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
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
