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

describe('why you lost: how you played (loss_reason_play_enabled)', () => {
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
  afterEach(() => useFeatureFlagsStore.setState((s) => ({ flags: { ...s.flags, loss_reason_enabled: true, loss_reason_play_enabled: true } })));

  const neverAttacked = () => {
    const data = gameOver();
    data.players = [{ ...data.players[0], turns_taken: 7, turns_attacked: 0 }, data.players[1]];
    return data;
  };

  it('says the viewer never attacked, ahead of the collapse it caused', () => {
    render(<ActionModal data={neverAttacked()} onDismiss={() => {}} />);
    expect(line()?.textContent).toContain('You never attacked.');
  });

  it('keeps the existing reasons with the flag off', () => {
    useFeatureFlagsStore.setState((s) => ({ flags: { ...s.flags, loss_reason_play_enabled: false } }));
    render(<ActionModal data={neverAttacked()} onDismiss={() => {}} />);
    expect(line()?.textContent).toContain('Turn 12 cost you most');
  });
});

describe('placement games (placement_rating_enabled)', () => {
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

  it('shows which placement game this was instead of the rating swing', () => {
    render(<ActionModal data={gameOver({ rating_change: -305, rating_provisional: true, rating_placement: 1 })} onDismiss={() => {}} />);
    expect(screen.getByTestId('gameover-placement').textContent).toContain('1 of 5');
    expect(screen.queryByText('-305')).toBeNull();
    expect(screen.queryByText('Calibrating')).toBeNull();
  });

  it('shows the swing once the server sends no placement number', () => {
    render(<ActionModal data={gameOver({ rating_change: -12, rating_provisional: false })} onDismiss={() => {}} />);
    expect(screen.queryByTestId('gameover-placement')).toBeNull();
    expect(screen.getByText('-12')).toBeTruthy();
  });
});

describe('results actions (results_action_events_enabled)', () => {
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

  it('tells the page when the share sheet opens', async () => {
    const onShareOpened = vi.fn();
    render(<ActionModal data={gameOver({ isWinner: true })} onDismiss={() => {}} onShareOpened={onShareOpened} />);
    screen.getAllByRole('button', { name: /share/i })[0]!.click();
    expect(onShareOpened).toHaveBeenCalledTimes(1);
  });
});
