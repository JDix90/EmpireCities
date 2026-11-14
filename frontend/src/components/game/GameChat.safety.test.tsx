/**
 * Chat report and block (chat_safety_enabled): a message from someone else
 * offers Report and Block; Block drops what they said; Report files the
 * message with its id and blocks them too unless unticked. Off, or on your
 * own messages, there is no menu.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, waitFor, within } from '@testing-library/react';
import GameChat, { type ChatMessagePayload } from './GameChat';
import { useAuthStore } from '../../store/authStore';
import { useFeatureFlagsStore } from '../../store/featureFlagsStore';

const handlers = vi.hoisted(() => new Map<string, (msg: unknown) => void>());
const postMock = vi.hoisted(() => vi.fn(async () => ({ data: { ok: true } })));

vi.mock('../../services/socket', () => ({
  getSocket: () => ({
    on: (event: string, fn: (msg: unknown) => void) => { handlers.set(event, fn); },
    off: (event: string) => { handlers.delete(event); },
    emit: vi.fn(),
  }),
}));
vi.mock('../../services/api', () => ({
  api: { post: postMock, get: vi.fn(async () => ({ data: { blocks: [] } })), delete: vi.fn(async () => ({})) },
}));

const msg = (over: Partial<ChatMessagePayload>): ChatMessagePayload => ({
  gameId: 'g1', playerId: 'rude-1', username: 'RudeRaven', color: '#00f', message: 'you stink', timestamp: 1, messageId: 'm-1', ...over,
});

function arrive(event: string, m: ChatMessagePayload) {
  act(() => { handlers.get(event)!(m); });
}

describe('chat report and block', () => {
  beforeEach(() => {
    handlers.clear();
    postMock.mockClear();
    useAuthStore.setState({ user: { user_id: 'me', username: 'Me', is_guest: true } as never, isAuthenticated: true });
    useFeatureFlagsStore.setState((st) => ({ flags: { ...st.flags, chat_safety_enabled: true } }));
  });
  afterEach(() => {
    useFeatureFlagsStore.setState((st) => ({ flags: { ...st.flags, chat_safety_enabled: false } }));
  });

  it('offers Report and Block on other players\' messages, not on your own', () => {
    render(<GameChat gameId="g1" embedded />);
    arrive('game:chat_message', msg({}));
    arrive('game:chat_message', msg({ playerId: 'me', username: 'Me', message: 'hi', messageId: 'm-2' }));
    expect(screen.getAllByRole('button', { name: /^Report or block/ })).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Report or block RudeRaven' }));
    expect(screen.getByRole('button', { name: 'Report message' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Block RudeRaven' })).toBeInTheDocument();
  });

  it('blocks a player and drops everything they said here', async () => {
    render(<GameChat gameId="g1" embedded />);
    arrive('game:chat_message', msg({}));
    arrive('game:chat_message', msg({ message: 'and again', messageId: 'm-3' }));
    arrive('game:chat_message', msg({ playerId: 'kind-1', username: 'KindKite', message: 'gl hf', messageId: 'm-4' }));
    fireEvent.click(screen.getAllByRole('button', { name: 'Report or block RudeRaven' })[0]!);
    fireEvent.click(screen.getByRole('button', { name: 'Block RudeRaven' }));
    await waitFor(() => expect(screen.queryByText('you stink')).toBeNull());
    expect(postMock).toHaveBeenCalledWith('/safety/blocks', { user_id: 'rude-1' });
    expect(screen.queryByText('and again')).toBeNull();
    expect(screen.getByText('gl hf')).toBeInTheDocument();
  });

  it('reports a message by its id, with a reason, and blocks the sender too by default', async () => {
    render(<GameChat gameId="g1" lobbyMode embedded />);
    arrive('game:lobby_chat_message', msg({}));
    fireEvent.click(screen.getByRole('button', { name: 'Report or block RudeRaven' }));
    fireEvent.click(screen.getByRole('button', { name: 'Report message' }));
    const form = await screen.findByTestId('report-chat-form');
    // Nothing to send until there is a reason.
    expect(within(form).getByRole('button', { name: 'Send report' })).toBeDisabled();
    fireEvent.click(within(form).getByRole('button', { name: 'Harassment or bullying' }));
    expect(within(form).getByRole('button', { name: 'Harassment or bullying' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(form).getByRole('button', { name: 'Send report' })).toBeEnabled();
    fireEvent.change(within(form).getByLabelText(/Anything else/), { target: { value: 'all game long' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Send report' }));
    await waitFor(() => expect(postMock).toHaveBeenCalledWith('/safety/blocks', { user_id: 'rude-1' }));
    expect(postMock).toHaveBeenCalledWith('/safety/reports', {
      game_id: 'g1', channel: 'lobby', message_id: 'm-1', reported_user_id: 'rude-1',
      reason: 'harassment', details: 'all game long', message: 'you stink',
    });
    await waitFor(() => expect(screen.queryByText('you stink')).toBeNull());
  });

  it('reports without blocking when the box is unticked', async () => {
    render(<GameChat gameId="g1" spectatorMode embedded />);
    arrive('game:spectator_chat_message', msg({}));
    fireEvent.click(screen.getByRole('button', { name: 'Report or block RudeRaven' }));
    fireEvent.click(screen.getByRole('button', { name: 'Report message' }));
    const form = await screen.findByTestId('report-chat-form');
    fireEvent.click(within(form).getByRole('button', { name: 'Spam or advertising' }));
    fireEvent.click(within(form).getByRole('checkbox'));
    fireEvent.click(within(form).getByRole('button', { name: 'Send report' }));
    await waitFor(() => expect(postMock).toHaveBeenCalledWith('/safety/reports', expect.objectContaining({ channel: 'spectator', reason: 'spam' })));
    expect(postMock).not.toHaveBeenCalledWith('/safety/blocks', expect.anything());
    expect(screen.getByText('you stink')).toBeInTheDocument();
  });

  it('has no menu with the switch off', () => {
    useFeatureFlagsStore.setState((st) => ({ flags: { ...st.flags, chat_safety_enabled: false } }));
    render(<GameChat gameId="g1" embedded />);
    arrive('game:chat_message', msg({}));
    expect(screen.getByText('you stink')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Report or block/ })).toBeNull();
  });
});
