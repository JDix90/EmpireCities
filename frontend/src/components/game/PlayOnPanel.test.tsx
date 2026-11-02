/**
 * Play on after a win (play_on_enabled), on the results screen: the winner
 * asks, everyone still in answers, and a unanimous yes takes the players still
 * in to the new game. The server runs the vote; this is what each player sees.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import ActionModal, { type GameOverModalData } from './ActionModal';
import PlayOnPanel from './PlayOnPanel';
import { useAuthStore } from '../../store/authStore';
import { useFeatureFlagsStore } from '../../store/featureFlagsStore';
import { usePlayOnStore, type PlayOnOffer, type PlayOnVoteView } from '../../store/playOnStore';

const emit = vi.hoisted(() => vi.fn());
vi.mock('../../services/socket', () => ({ getSocket: () => ({ emit }) }));
vi.mock('../../services/api', () => ({
  api: { get: vi.fn(() => new Promise(() => {})), post: vi.fn(() => Promise.resolve({ data: {} })) },
}));

const GAME = 'g1';
const offer = (o: Partial<PlayOnOffer> = {}): PlayOnOffer => ({
  proposer_ids: ['me'],
  human_ids: ['me', 'rosa'],
  bot_count: 1,
  expires_at: Date.now() + 300_000,
  ...o,
});
const vote = (o: Partial<PlayOnVoteView> = {}): PlayOnVoteView => ({
  proposer_id: 'me',
  proposer_name: 'Ossawatomix',
  voters: [{ player_id: 'rosa', username: 'Rosa', color: '#3498db', vote: null }],
  bot_count: 1,
  expires_at: Date.now() + 60_000,
  ...o,
});

function panel(viewerId: string, o: Partial<PlayOnOffer> = {}, onContinue = vi.fn()) {
  render(<PlayOnPanel gameId={GAME} offer={offer(o)} viewerId={viewerId} onContinue={onContinue} />);
  return onContinue;
}

describe('PlayOnPanel', () => {
  beforeEach(() => {
    emit.mockReset();
    usePlayOnStore.getState().reset();
    usePlayOnStore.getState().setOffer(GAME, offer());
  });

  it('lets the winner ask the table, and says the win stands', () => {
    panel('me');
    const region = screen.getByRole('region', { name: 'Play on' });
    expect(region.textContent).toMatch(/Keep playing for total domination\?/);
    expect(region.textContent).toMatch(/They all have to agree/);
    expect(region.textContent).toMatch(/Unranked, with no extra rewards: the win already recorded stands/);
    fireEvent.click(screen.getByRole('button', { name: 'Ask to keep playing' }));
    expect(emit).toHaveBeenCalledWith('game:play_on_propose', { gameId: GAME });
    expect(screen.getByRole('button', { name: 'Asking…' })).toBeDisabled();
  });

  it('against bots alone, says they always agree and keeps it to one tap', () => {
    panel('me', { human_ids: ['me'] });
    expect(screen.getByRole('region', { name: 'Play on' }).textContent).toMatch(/The bots always agree/);
    fireEvent.click(screen.getByRole('button', { name: 'Keep playing' }));
    expect(emit).toHaveBeenCalledWith('game:play_on_propose', { gameId: GAME });
  });

  it('shows nothing to a player who did not win until they are asked', () => {
    panel('rosa');
    expect(screen.queryByRole('region', { name: 'Play on' })).toBeNull();
  });

  it('stops offering once the offer has run out', () => {
    panel('me', { expires_at: Date.now() - 1 });
    expect(screen.queryByRole('region', { name: 'Play on' })).toBeNull();
  });

  it('asks everyone else still in, with the time left and who has answered', () => {
    usePlayOnStore.getState().setVote(GAME, vote());
    panel('rosa');
    const region = screen.getByRole('region', { name: 'Play on' });
    expect(region.textContent).toMatch(/Ossawatomix wants to keep playing for total domination/);
    expect(region.textContent).toMatch(/Everyone still in has to agree/);
    expect(region.textContent).toMatch(/1:00/);
    expect(region.textContent).toMatch(/The botAlways yes/);
    fireEvent.click(screen.getByRole('button', { name: 'Keep playing' }));
    expect(emit).toHaveBeenCalledWith('game:play_on_vote', { gameId: GAME, yes: true });
  });

  it('takes a no', () => {
    usePlayOnStore.getState().setVote(GAME, vote());
    panel('rosa');
    fireEvent.click(screen.getByRole('button', { name: 'No thanks' }));
    expect(emit).toHaveBeenCalledWith('game:play_on_vote', { gameId: GAME, yes: false });
  });

  it('shows the asker who has said yes while the others decide', () => {
    usePlayOnStore.getState().setVote(GAME, vote({
      voters: [
        { player_id: 'rosa', username: 'Rosa', color: '#3498db', vote: true },
        { player_id: 'li', username: 'Li', color: '#2ecc71', vote: null },
      ],
    }));
    panel('me');
    const region = screen.getByRole('region', { name: 'Play on' });
    expect(region.textContent).toMatch(/You asked to keep playing/);
    expect(region.textContent).toMatch(/Waiting for everyone to answer/);
    expect(region.textContent).toMatch(/RosaYes/);
    expect(region.textContent).toMatch(/LiDeciding/);
    expect(screen.queryByRole('button', { name: 'Keep playing' })).toBeNull();
  });

  it('takes everyone still in to the new game when the table agrees', () => {
    const onContinue = panel('rosa');
    act(() => usePlayOnStore.getState().setResult(GAME, { outcome: 'accepted', new_game_id: 'g2' }));
    expect(onContinue).toHaveBeenCalledWith('g2');
  });

  it('lets a player already out of it watch, rather than taking them there', () => {
    const onContinue = panel('out');
    act(() => usePlayOnStore.getState().setResult(GAME, { outcome: 'accepted', new_game_id: 'g2' }));
    expect(onContinue).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Watch' }));
    expect(onContinue).toHaveBeenCalledWith('g2');
  });

  it('says why the game ends here when the vote fails', () => {
    for (const [outcome, line] of [
      ['declined', /Not everyone wants to keep playing/],
      ['expired', /Not everyone answered in time/],
      ['failed', /couldn’t be continued/],
    ] as const) {
      usePlayOnStore.getState().setOffer(GAME, offer());
      usePlayOnStore.getState().setResult(GAME, { outcome });
      const { unmount } = render(<PlayOnPanel gameId={GAME} offer={offer()} viewerId="me" onContinue={vi.fn()} />);
      expect(screen.getByRole('region', { name: 'Play on' }).textContent).toMatch(line);
      unmount();
    }
  });

  it('ignores a vote held for another game', () => {
    usePlayOnStore.getState().setOffer('older', offer());
    usePlayOnStore.getState().setResult('older', { outcome: 'declined' });
    panel('me');
    expect(screen.getByRole('button', { name: 'Ask to keep playing' })).toBeTruthy();
  });
});

describe('play on in the results', () => {
  const data = (o: Partial<GameOverModalData> = {}): GameOverModalData => ({
    type: 'game_over',
    gameId: GAME,
    isWinner: true,
    winnerName: 'Ossawatomix',
    winnerColor: '#e74c3c',
    turnCount: 31,
    viewerId: 'me',
    winnerIds: ['me'],
    victory_condition: 'threshold',
    victory_threshold: 65,
    players: [
      { player_id: 'me', username: 'Ossawatomix', color: '#e74c3c', territory_count: 27, is_eliminated: false, is_ai: false },
      { player_id: 'ai_1', username: 'Bot', color: '#3498db', territory_count: 15, is_eliminated: false, is_ai: true },
    ],
    playOn: offer({ human_ids: ['me'] }),
    ...o,
  }) as GameOverModalData;

  beforeEach(() => {
    usePlayOnStore.getState().reset();
    window.matchMedia = vi.fn().mockReturnValue({
      matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn(),
      addListener: vi.fn(), removeListener: vi.fn(),
    }) as unknown as typeof window.matchMedia;
    useAuthStore.setState({
      user: { user_id: 'me', username: 'Ossawatomix', level: 2, xp: 250, mmr: 1000 },
      isAuthenticated: true,
    });
  });

  it('offers it on the Victory screen while its switch is on', () => {
    useFeatureFlagsStore.setState((s) => ({ flags: { ...s.flags, play_on_enabled: true } }));
    render(<ActionModal data={data()} onDismiss={() => {}} onPlayOnContinue={() => {}} />);
    expect(screen.getByTestId('play-on-offer')).toBeTruthy();
  });

  it('offers nothing while its switch is off', () => {
    useFeatureFlagsStore.setState((s) => ({ flags: { ...s.flags, play_on_enabled: false } }));
    render(<ActionModal data={data()} onDismiss={() => {}} onPlayOnContinue={() => {}} />);
    expect(screen.queryByTestId('play-on-offer')).toBeNull();
  });

  it('says a finished play-on game paid nothing, and the win before it stands', () => {
    render(<ActionModal data={data({ playOn: undefined, playOnOf: 'g0', victory_condition: 'domination' })} onDismiss={() => {}} />);
    expect(screen.getByTestId('play-on-finished-note').textContent).toMatch(/unranked and paid nothing; the win before it stands/);
  });
});
