/**
 * The game-over screen asks "How was the Galactic Age?" only for a Galactic
 * Age game while its beta is open (GamePage sets `galacticBeta`), and only of
 * a player who sat in it.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import ActionModal, { type GameOverModalData } from './ActionModal';
import { useAuthStore } from '../../store/authStore';

vi.mock('../../services/api', () => ({
  api: { get: vi.fn(() => new Promise(() => {})), post: vi.fn(() => Promise.resolve({ data: {} })) },
}));

function gameOver(overrides: Partial<GameOverModalData> = {}): GameOverModalData {
  return {
    type: 'game_over',
    gameId: 'g1',
    isWinner: true,
    winnerName: 'Ossawatomix',
    winnerColor: '#e74c3c',
    turnCount: 18,
    viewerId: 'me',
    winnerIds: ['me'],
    victory_condition: 'lane_sovereignty',
    players: [
      { player_id: 'me', username: 'Ossawatomix', color: '#e74c3c', territory_count: 30, is_eliminated: false, is_ai: false },
      { player_id: 'ai1', username: 'Lady Hoshiko (AI)', color: '#3498db', territory_count: 9, is_eliminated: false, is_ai: true },
    ],
    ...overrides,
  } as GameOverModalData;
}

describe('the Galactic Age beta question at game over', () => {
  beforeEach(() => {
    window.matchMedia = vi.fn().mockReturnValue({
      matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn(),
      addListener: vi.fn(), removeListener: vi.fn(),
    }) as unknown as typeof window.matchMedia;
    useAuthStore.setState({
      user: { user_id: 'me', username: 'Ossawatomix', level: 2, xp: 250, mmr: 1000 },
      isAuthenticated: true,
    });
  });

  it('asks in a Galactic Age beta game', () => {
    render(<ActionModal data={gameOver({ galacticBeta: true })} onDismiss={() => {}} />);
    expect(screen.getByTestId('galactic-gameover-feedback').textContent).toMatch(/How was the Galactic Age\?/);
  });

  it('does not ask in any other game', () => {
    render(<ActionModal data={gameOver()} onDismiss={() => {}} />);
    expect(screen.queryByTestId('galactic-gameover-feedback')).toBeNull();
  });

  it('does not ask a viewer who did not play', () => {
    useAuthStore.setState({
      user: { user_id: 'watcher', username: 'Watcher', level: 2, xp: 250, mmr: 1000 },
      isAuthenticated: true,
    });
    render(<ActionModal data={gameOver({ galacticBeta: true })} onDismiss={() => {}} />);
    expect(screen.queryByTestId('galactic-gameover-feedback')).toBeNull();
  });
});
