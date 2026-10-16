import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ActionModal, { type GameOverModalData } from './ActionModal';
import { useAuthStore } from '../../store/authStore';
import { useFeatureFlagsStore } from '../../store/featureFlagsStore';

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

  it('says "Save your account" with save_account_copy_enabled, and that it takes just an email when it does', () => {
    const setFlags = (flags: Record<string, boolean>) =>
      useFeatureFlagsStore.setState((st) => ({ flags: { ...st.flags, ...flags } }));
    useAuthStore.setState({
      user: { user_id: 'me', username: 'SwiftFalcon_48213', level: 2, xp: 250, mmr: 1000, is_guest: true },
      isAuthenticated: true,
    });
    setFlags({ save_account_copy_enabled: true, email_account_save_enabled: true });
    try {
      const onUpgrade = vi.fn();
      render(<ActionModal data={gameOver()} onDismiss={() => {}} onUpgradeAccount={onUpgrade} />);
      expect(screen.getByTestId('gameover-save-account')).toHaveTextContent(
        'Your progress is saved in this browser. Save your account to keep it safe and play on any device. All it takes is your email.',
      );
      fireEvent.click(screen.getByRole('button', { name: 'Save your account' }));
      expect(onUpgrade).toHaveBeenCalledTimes(1);
      expect(screen.queryByRole('button', { name: 'Create Free Account' })).toBeNull();
    } finally {
      setFlags({ save_account_copy_enabled: false, email_account_save_enabled: false });
    }
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
