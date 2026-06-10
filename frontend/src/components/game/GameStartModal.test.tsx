import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import GameStartModal, { turnOrderFrom, describeViewerPosition } from './GameStartModal';
import type { GameState, PlayerState } from '../../store/gameStore';

function player(overrides: Partial<PlayerState>): PlayerState {
  return {
    player_id: 'p',
    player_index: 0,
    username: 'p',
    color: '#fff',
    is_ai: false,
    is_eliminated: false,
    territory_count: 0,
    cards: [],
    mmr: 1000,
    ...overrides,
  } as PlayerState;
}

const players = [
  player({ player_id: 'me', player_index: 0, username: 'Jeff', special_resource: 3, tech_points: 2 }),
  player({ player_id: 'a1', player_index: 1, username: 'AI Bot 1', is_ai: true, ai_difficulty: 'medium' }),
  player({ player_id: 'a2', player_index: 2, username: 'AI Bot 2', is_ai: true, ai_difficulty: 'hard' }),
];

function makeState(overrides: Partial<GameState> = {}): GameState {
  return {
    game_id: 'g1',
    era: 'ancient',
    map_id: 'm1',
    phase: 'draft',
    current_player_index: 1,
    starting_player_index: 1,
    turn_number: 1,
    players,
    territories: {},
    card_set_redemption_count: 0,
    settings: {
      fog_of_war: false,
      turn_timer_seconds: 60,
      diplomacy_enabled: false,
      economy_enabled: true,
      tech_trees_enabled: true,
    },
    ...overrides,
  } as GameState;
}

describe('turnOrderFrom', () => {
  it('rotates the seat list to start at the starting player', () => {
    expect(turnOrderFrom(players, 1).map((p) => p.player_id)).toEqual(['a1', 'a2', 'me']);
  });

  it('is the identity when the first seat starts', () => {
    expect(turnOrderFrom(players, 0).map((p) => p.player_id)).toEqual(['me', 'a1', 'a2']);
  });

  it('tolerates an out-of-range starting index', () => {
    expect(turnOrderFrom(players, 3).map((p) => p.player_id)).toEqual(['me', 'a1', 'a2']);
  });

  it('handles an empty seat list', () => {
    expect(turnOrderFrom([], 0)).toEqual([]);
  });
});

describe('describeViewerPosition', () => {
  it('announces going first', () => {
    expect(describeViewerPosition(turnOrderFrom(players, 0), 'me')).toBe('You go first');
  });

  it('announces a later position with the table size', () => {
    expect(describeViewerPosition(turnOrderFrom(players, 1), 'me')).toBe('You go 3rd of 3');
  });

  it('returns null for non-participants', () => {
    expect(describeViewerPosition(turnOrderFrom(players, 0), 'ghost')).toBeNull();
    expect(describeViewerPosition(turnOrderFrom(players, 0), null)).toBeNull();
  });
});

describe('GameStartModal', () => {
  it('shows turn order with the viewer marked and starting resources', () => {
    render(
      <GameStartModal open onClose={() => {}} gameState={makeState()} viewerPlayerId="me" />,
    );
    expect(screen.getByText('You go 3rd of 3.')).toBeInTheDocument();
    expect(screen.getByText('(you)')).toBeInTheDocument();
    expect(screen.getByText('Medium AI')).toBeInTheDocument();
    expect(screen.getByText('3 PP')).toBeInTheDocument();
    expect(screen.getByText('2 TP')).toBeInTheDocument();
  });

  it('hides resources when economy and tech are disabled', () => {
    const state = makeState({
      settings: { ...makeState().settings, economy_enabled: false, tech_trees_enabled: false },
    });
    render(<GameStartModal open onClose={() => {}} gameState={state} viewerPlayerId="me" />);
    expect(screen.queryByText(/starting resources/i)).toBeNull();
  });

  it('dismisses via the To battle button', () => {
    const onClose = vi.fn();
    render(<GameStartModal open onClose={onClose} gameState={makeState()} viewerPlayerId="me" />);
    fireEvent.click(screen.getByRole('button', { name: /to battle/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('renders nothing when closed', () => {
    const { container } = render(
      <GameStartModal open={false} onClose={() => {}} gameState={makeState()} viewerPlayerId="me" />,
    );
    expect(container.firstChild).toBeNull();
  });
});
