/**
 * Game results (`results_footer_enabled`): Rematch and Return to Lobby used to
 * sit below the chart, coaching and guest box, a scroll on a laptop and five
 * swipes on a phone. With the flag on they sit in a footer pinned to the
 * bottom of the results; off, they stay where they were.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
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
    rematchConfig: { era_id: 'ancient', map_id: 'm', settings: {}, human_player_ids: [] },
    ...overrides,
  } as GameOverModalData;
}

const setFlag = (on: boolean) =>
  useFeatureFlagsStore.setState((s) => ({ flags: { ...s.flags, results_footer_enabled: on } }));

describe('game results footer', () => {
  beforeEach(() => {
    window.matchMedia = vi.fn().mockReturnValue({
      matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn(),
      addListener: vi.fn(), removeListener: vi.fn(),
    }) as unknown as typeof window.matchMedia;
    useAuthStore.setState({
      user: { user_id: 'me', username: 'Guest_ab12cd34', level: 2, xp: 250, mmr: 1000, is_guest: true },
      isAuthenticated: true,
    });
  });
  afterEach(() => setFlag(true));

  it('pins Rematch and Return to Lobby in the footer with the flag on', () => {
    setFlag(true);
    const onDismiss = vi.fn();
    const onRematch = vi.fn();
    render(<ActionModal data={gameOver()} onDismiss={onDismiss} onRematch={onRematch} onUpgradeAccount={() => {}} />);
    const footer = screen.getByTestId('gameover-footer');
    expect(footer.className).toContain('sticky');
    fireEvent.click(within(footer).getByRole('button', { name: /Return to Lobby/ }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
    fireEvent.click(within(footer).getByRole('button', { name: /Rematch/ }));
    expect(onRematch).toHaveBeenCalledTimes(1);
    // Each appears once: the footer replaces the old place, it does not copy it.
    expect(screen.getAllByRole('button', { name: /Return to Lobby/ })).toHaveLength(1);
    // The secondary actions stay in the results.
    expect(within(footer).queryByRole('button', { name: /Share/ })).toBeNull();
    expect(screen.getByRole('button', { name: /Share/ })).toBeTruthy();
  });

  it('keeps the buttons where they were with the flag off', () => {
    setFlag(false);
    render(<ActionModal data={gameOver()} onDismiss={() => {}} onRematch={() => {}} onUpgradeAccount={() => {}} />);
    expect(screen.queryByTestId('gameover-footer')).toBeNull();
    expect(screen.getAllByRole('button', { name: /Return to Lobby/ })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: /Rematch/ })).toHaveLength(1);
  });
});
