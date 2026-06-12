import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import AdvanceEraPanel from './AdvanceEraPanel';
import type { GameState, PlayerState } from '../../store/gameStore';

function player(overrides: Partial<PlayerState> = {}): PlayerState {
  return {
    player_id: 'me',
    player_index: 0,
    username: 'Me',
    color: '#fff',
    is_ai: false,
    is_eliminated: false,
    territory_count: 5,
    cards: [],
    mmr: 1000,
    current_era_index: 0,
    special_resource: 0,
    tech_points: 0,
    unlocked_techs: [],
    ...overrides,
  } as PlayerState;
}

function state(overrides: Partial<GameState['settings']> = {}): GameState {
  return {
    game_id: 'g1',
    era: 'ancient',
    map_id: 'm1',
    phase: 'attack',
    current_player_index: 0,
    turn_number: 3,
    players: [player()],
    territories: {},
    card_set_redemption_count: 0,
    settings: {
      fog_of_war: false,
      turn_timer_seconds: 0,
      diplomacy_enabled: false,
      era_advancement_enabled: true,
      tech_trees_enabled: true,
      economy_enabled: true,
      era_advancement_max_era_index: 1,
      ...overrides,
    },
  } as unknown as GameState;
}

describe('AdvanceEraPanel (sidebar)', () => {
  it('renders collapsed by default — summary row only, no requirements list', () => {
    render(
      <AdvanceEraPanel gameState={state()} myPlayer={player()} isMyTurn onAdvanceEra={() => {}} />,
    );
    expect(screen.getByText('Era Advancement')).toBeInTheDocument();
    expect(screen.getByText(/\d+ to go/)).toBeInTheDocument();
    // The detail body (gates list, advance button) must be hidden.
    expect(screen.queryByText(/Your civilization/)).toBeNull();
    expect(screen.queryByText(/Advance Era/)).toBeNull();
  });

  it('expands and collapses via the summary row', () => {
    render(
      <AdvanceEraPanel gameState={state()} myPlayer={player()} isMyTurn onAdvanceEra={() => {}} />,
    );
    const toggle = screen.getByRole('button', { name: /Era Advancement/ });
    fireEvent.click(toggle);
    expect(screen.getByText(/Your civilization/)).toBeInTheDocument();
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(toggle);
    expect(screen.queryByText(/Your civilization/)).toBeNull();
  });

  it('shows the vulnerable-window warning even while collapsed', () => {
    render(
      <AdvanceEraPanel
        gameState={state()}
        myPlayer={player({ era_transition_turns_remaining: 1 })}
        isMyTurn
        onAdvanceEra={() => {}}
      />,
    );
    expect(screen.getByText(/Vulnerable window/)).toBeInTheDocument();
    expect(screen.queryByText(/Your civilization/)).toBeNull();
  });

  it('compact variant is unaffected (still a single button)', () => {
    const onAdvance = vi.fn();
    render(
      <AdvanceEraPanel
        gameState={state()}
        myPlayer={player()}
        isMyTurn
        onAdvanceEra={onAdvance}
        variant="compact"
      />,
    );
    expect(screen.queryByText('Era Advancement')).toBeNull();
    expect(screen.getByRole('button')).toBeInTheDocument();
  });
});
