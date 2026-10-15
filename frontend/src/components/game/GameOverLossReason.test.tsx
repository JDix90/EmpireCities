/**
 * Why you lost (`loss_reason_enabled`): the defeat screen's coaching listed the
 * player's best moves and never said what went wrong. With the flag on, one
 * line under how the game ended names the strongest reason from the tallies
 * the server sends for the viewer.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
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
    turnCount: 19,
    viewerId: 'me',
    victory_condition: 'humans_eliminated',
    players: [
      {
        player_id: 'me', username: 'Ada', color: '#fff', territory_count: 0, is_eliminated: true, is_ai: false,
        units_lost_to_events: 3, turns_ended_with_set: 1, worst_round_loss: { turn: 12, from: 9, to: 4 },
      },
      {
        player_id: 'ai1', username: 'AI Bot 1', color: '#f00', territory_count: 12, is_eliminated: false, is_ai: true,
        turns_ended_with_set: 9,
      },
    ],
    ...overrides,
  } as GameOverModalData;
}

const setFlag = (on: boolean) =>
  useFeatureFlagsStore.setState((s) => ({ flags: { ...s.flags, loss_reason_enabled: on } }));

const line = () => screen.queryByTestId('gameover-loss-reason');

describe('why you lost', () => {
  beforeEach(() => {
    window.matchMedia = vi.fn().mockReturnValue({
      matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn(),
      addListener: vi.fn(), removeListener: vi.fn(),
    }) as unknown as typeof window.matchMedia;
    useAuthStore.setState({
      user: { user_id: 'me', username: 'Ada', level: 2, xp: 250, mmr: 1000 },
      isAuthenticated: true,
    });
  });
  afterEach(() => setFlag(true));

  it('names the viewer\'s own strongest reason under how the game ended', () => {
    setFlag(true);
    render(<ActionModal data={gameOver()} onDismiss={() => {}} />);
    expect(line()?.textContent).toBe(
      'Why you lost' +
      'Turn 12 cost you most: your territories fell from 9 to 4 in one round. ' +
      'Fewer borders with your armies stacked on them are harder to break through.',
    );
  });

  it('says nothing to the winner, or when nothing stands out', () => {
    setFlag(true);
    const { unmount } = render(<ActionModal data={gameOver({ isWinner: true })} onDismiss={() => {}} />);
    expect(line()).toBeNull();
    unmount();

    const quiet = gameOver();
    quiet.players = [{ ...quiet.players[0], worst_round_loss: { turn: 12, from: 9, to: 7 } }, quiet.players[1]];
    render(<ActionModal data={quiet} onDismiss={() => {}} />);
    expect(line()).toBeNull();
  });

  it('says nothing for a game nobody finished, or an objective day', () => {
    setFlag(true);
    const { unmount } = render(<ActionModal data={gameOver({ victory_condition: 'abandoned' })} onDismiss={() => {}} />);
    expect(line()).toBeNull();
    unmount();
    render(<ActionModal data={gameOver({ daily_challenge: { outcome: 'failed', goal: 'Hold Ukraine' } })} onDismiss={() => {}} />);
    expect(line()).toBeNull();
  });

  it('is the defeat screen as before with the flag off', () => {
    setFlag(false);
    render(<ActionModal data={gameOver()} onDismiss={() => {}} />);
    expect(line()).toBeNull();
    expect(screen.queryByText('Why you lost')).toBeNull();
  });
});
