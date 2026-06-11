import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ActionModal, { type GameOverModalData } from './ActionModal';
import { useAuthStore } from '../../store/authStore';

function gameOver(overrides: Partial<GameOverModalData> = {}): GameOverModalData {
  return {
    type: 'game_over',
    gameId: 'g1',
    isWinner: false,
    winnerName: 'AI Bot 1',
    winnerColor: '#f00',
    turnCount: 5,
    players: [
      { player_id: 'me', username: 'Guest_ab12cd34', color: '#fff', territory_count: 0, is_eliminated: true, is_ai: false },
      { player_id: 'ai1', username: 'AI Bot 1', color: '#f00', territory_count: 12, is_eliminated: false, is_ai: true },
    ],
    xpEarned: 25,
    ...overrides,
  } as GameOverModalData;
}

describe('game-over guest upgrade CTA', () => {
  beforeEach(() => {
    window.matchMedia = vi.fn().mockReturnValue({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
    }) as unknown as typeof window.matchMedia;
  });

  it('shows the CTA for guests and routes through the provided handler', () => {
    useAuthStore.setState({
      user: { user_id: 'me', username: 'Guest_ab12cd34', level: 2, xp: 250, mmr: 1000, is_guest: true },
      isAuthenticated: true,
    });
    const onUpgrade = vi.fn();
    render(
      <ActionModal data={gameOver()} onDismiss={() => {}} onUpgradeAccount={onUpgrade} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Create Free Account' }));
    expect(onUpgrade).toHaveBeenCalledTimes(1);
  });

  it('renders no CTA for registered players', () => {
    useAuthStore.setState({
      user: { user_id: 'me', username: 'RealCommander', level: 5, xp: 4000, mmr: 1100, is_guest: false },
      isAuthenticated: true,
    });
    render(
      <ActionModal data={gameOver()} onDismiss={() => {}} onUpgradeAccount={() => {}} />,
    );
    expect(screen.queryByRole('button', { name: 'Create Free Account' })).toBeNull();
  });

  it('skips the CTA in tutorial games (tutorial has its own prompt)', () => {
    useAuthStore.setState({
      user: { user_id: 'me', username: 'Guest_ab12cd34', level: 1, xp: 0, mmr: 1000, is_guest: true },
      isAuthenticated: true,
    });
    render(
      <ActionModal
        data={gameOver({
          rematchConfig: { era_id: 'ancient', map_id: 'm', settings: { tutorial: true }, human_player_ids: [] },
        })}
        onDismiss={() => {}}
        onUpgradeAccount={() => {}}
      />,
    );
    expect(screen.queryByRole('button', { name: 'Create Free Account' })).toBeNull();
  });
});
